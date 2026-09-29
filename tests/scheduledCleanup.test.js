import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, mock, test } from 'node:test'

import { PreconditionFailedError, Store } from '@edgeone/pages-blob'

import * as blob from '../cloud-functions/api/_blobStore.js'
import { createScheduledCleanupToken, validateScheduledCleanupToken } from '../cloud-functions/api/_scheduledCleanupAuth.js'
import { onRequest as counter } from '../cloud-functions/api/counter.js'
import { onRequest } from '../cloud-functions/api/maintenance/challenges.js'

const origin = 'https://scheduled-cleanup.example'
const originalCredential = process.env.PAGES_BLOB_DEPLOY_CREDENTIAL
let records, reads, writes, lists, logs, env

beforeEach(() => {
  process.env.PAGES_BLOB_DEPLOY_CREDENTIAL = randomUUID()
  env = { ADMIN_TOKEN: randomUUID(), OPEN_KOUNTER_CLEANUP_SECRET: randomBytes(32).toString('base64url') }
  records = new Map()
  reads = []; writes = []; lists = []; logs = []
  mock.method(Store.prototype, 'get', async (key) => {
    reads.push(key)
    return structuredClone(records.get(key) ?? null)
  })
  mock.method(Store.prototype, 'setJSON', async (key, value, options) => {
    if (options?.onlyIfNew && records.has(key)) throw new PreconditionFailedError()
    writes.push(key)
    records.set(key, structuredClone(value))
  })
  mock.method(Store.prototype, 'delete', async (key) => {
    writes.push(key)
    records.delete(key)
  })
  mock.method(Store.prototype, 'list', async (options) => {
    lists.push(options)
    const after = options.cursor?.slice('opaque:'.length) || ''
    const keys = [...records.keys()].filter((key) => key.startsWith(options.prefix) && key > after).sort()
    const page = keys.slice(0, options.limit)
    return { blobs: page.map((key) => ({ key })), ...(keys.length > page.length ? { cursor: `opaque:${page.at(-1)}` } : {}) }
  })
  mock.method(console, 'info', (message) => logs.push(message))
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request') })
})

afterEach(() => {
  mock.restoreAll()
  if (originalCredential === undefined) delete process.env.PAGES_BLOB_DEPLOY_CREDENTIAL
  else process.env.PAGES_BLOB_DEPLOY_CREDENTIAL = originalCredential
})

const token = () => createScheduledCleanupToken(env.OPEN_KOUNTER_CLEANUP_SECRET)
const call = async ({ body, headers = {}, query = '', handler = onRequest } = {}) => {
  const request = new Request(`${origin}/api/maintenance/challenges${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? JSON.stringify({ cleanupToken: token() }) : body
  })
  return (await handler({ request, env })).json()
}

test('scheduled credentials are stable, purpose scoped HMACs and reject invalid secrets and token formats', () => {
  const secret = env.OPEN_KOUNTER_CLEANUP_SECRET
  const expected = createHmac('sha256', secret).update('open-kounter:maintenance:passkey-challenges:v1').digest('base64url')
  assert.equal(createScheduledCleanupToken(secret), expected)
  assert.match(expected, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(validateScheduledCleanupToken(expected, env), true)
  assert.equal(validateScheduledCleanupToken(expected, { OPEN_KOUNTER_CLEANUP_SECRET: randomBytes(32).toString('base64url') }), false)
  for (const invalidSecret of [undefined, null, 42, '', randomBytes(15).toString('hex')]) {
    assert.equal(createScheduledCleanupToken(invalidSecret), null)
    assert.equal(validateScheduledCleanupToken(expected, { OPEN_KOUNTER_CLEANUP_SECRET: invalidSecret }), false)
  }
  for (const invalidToken of [undefined, null, 42, [], {}, '', expected.slice(1), `${expected}=`, `${expected}\n`, expected.replace(/^./, '+')]) {
    assert.equal(validateScheduledCleanupToken(invalidToken, env), false)
  }
})

test('a scheduled invocation runs one bounded batch and logs only structured cleanup statistics', async () => {
  for (let index = 0; index < 105; index++) {
    records.set(blob.passkeyChallengeKey(String(index).padStart(3, '0')), { expiresAt: Date.now() - 120000, challenge: randomUUID() })
  }
  const proof = token()
  const result = await call()
  assert.deepEqual(result, { code: 0, data: { scanned: 100, deleted: 100, skipped: 0, failed: 0, hasMore: true } })
  assert.equal(lists.length, 1)
  assert.equal(lists[0].limit, 100)
  assert.equal(lists[0].consistency, 'strong')
  assert.equal(lists[0].paginate, false)
  assert.deepEqual(JSON.parse(logs[0]), { event: 'passkey_challenge_cleanup', ...result.data })
  const output = JSON.stringify({ result, logs })
  for (const secret of [proof, env.OPEN_KOUNTER_CLEANUP_SECRET, env.ADMIN_TOKEN]) assert.equal(output.includes(secret), false)
  assert.equal(reads.includes(blob.SYSTEM_STATE_KEY), false, 'scoped permission does not require the administrator token')
})

test('malformed JSON, fields, oversized byte payloads and spoofed query/headers cause no scans or writes', async () => {
  const proof = token()
  const invalidRequests = [
    { body: '{' }, { body: '' }, { body: 'null' }, { body: '[]' }, { body: '{}' },
    { body: JSON.stringify({ cleanupToken: 42 }) },
    { body: JSON.stringify({ cleanupToken: [proof] }) },
    { body: JSON.stringify({ token: proof }) },
    { body: JSON.stringify({ cleanupToken: createScheduledCleanupToken(randomBytes(32).toString('base64url')) }) },
    { body: JSON.stringify({ cleanupToken: proof, padding: 'x'.repeat(1024) }), headers: { 'Content-Length': '1' } },
    { body: JSON.stringify({ cleanupToken: proof, padding: '汉'.repeat(340) }) },
    { body: '{}', query: `?cleanupToken=${encodeURIComponent(proof)}` },
    { body: '{}', headers: { 'X-Cleanup-Token': proof, 'X-EdgeOne-Schedule': 'true' } }
  ]
  for (const request of invalidRequests) assert.deepEqual(await call(request), { code: 1000, message: 'Unauthorized' })
  assert.deepEqual(reads, [])
  assert.deepEqual(lists, [])
  assert.deepEqual(writes, [])
  assert.deepEqual(logs, [])
})

test('streamed payloads are limited by actual bytes and stop reading when they exceed the limit', async () => {
  let canceled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(700))
      controller.enqueue(new Uint8Array(700))
    },
    cancel() { canceled = true }
  })
  const request = new Request(`${origin}/api/maintenance/challenges`, {
    method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }
  })
  assert.deepEqual(await (await onRequest({ request, env })).json(), { code: 1000, message: 'Unauthorized' })
  assert.equal(canceled, true)
  assert.deepEqual(reads, [])
  assert.deepEqual(lists, [])
  assert.deepEqual(writes, [])
})

test('Makers parsed-body wrappers retain bounded access to the original request stream', async () => {
  for (const asynchronous of [false, true]) {
    const payload = { cleanupToken: token() }
    const request = new Request(`${origin}/api/maintenance/challenges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
    Object.defineProperty(request, 'body', { get: () => asynchronous ? Promise.resolve(payload) : payload })
    Object.defineProperty(request, 'signal', { value: undefined })
    assert.equal((await (await onRequest({ request, env })).json()).code, 0)
  }
})

test('a parsed-body wrapper cannot bypass the original byte limit', async () => {
  const payload = { cleanupToken: token() }
  const request = new Request(`${origin}/api/maintenance/challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
    body: JSON.stringify({ ...payload, padding: 'x'.repeat(1024) })
  })
  Object.defineProperty(request, 'body', { get: () => payload })
  assert.deepEqual(await (await onRequest({ request, env })).json(), { code: 1000, message: 'Unauthorized' })
  assert.deepEqual(reads, [])
  assert.deepEqual(lists, [])
  assert.deepEqual(writes, [])
})

test('payloads at the byte limit are accepted and absent or short runtime secrets disable scoped authentication', async () => {
  const base = JSON.stringify({ cleanupToken: token() })
  assert.equal((await call({ body: base.padEnd(1024, ' ') })).code, 0)
  writes.length = 0; reads.length = 0; lists.length = 0; logs.length = 0
  const body = base
  for (const secret of [undefined, '', randomBytes(8).toString('hex')]) {
    env.OPEN_KOUNTER_CLEANUP_SECRET = secret
    assert.deepEqual(await call({ body }), { code: 1000, message: 'Unauthorized' })
  }
  assert.deepEqual(reads, [])
  assert.deepEqual(lists, [])
  assert.deepEqual(writes, [])
  assert.deepEqual(logs, [])
})

test('Authorization is exclusively administrative and never falls back to a valid scheduled payload', async () => {
  const proof = token()
  for (const Authorization of ['', 'Basic ignored', `Bearer ${randomUUID()}`, `Bearer ${proof}`]) {
    assert.deepEqual(await call({ headers: { Authorization } }), { code: 1000, message: 'Unauthorized' })
  }
  assert.deepEqual(lists, [])
  assert.deepEqual(writes, [])
  assert.deepEqual(logs, [])
  delete env.OPEN_KOUNTER_CLEANUP_SECRET
  const manual = await call({ headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: 'ignored body' })
  assert.equal(manual.code, 0)
  assert.deepEqual(logs, [], 'manual requests keep their existing response behavior')
})

test('scheduled credentials cannot authorize ordinary counter administration', async () => {
  const cleanupToken = token()
  for (const headers of [{}, { Authorization: `Bearer ${cleanupToken}` }]) {
    const result = await call({ handler: counter, headers, body: JSON.stringify({ action: 'set', target: 'page', value: 1, cleanupToken }) })
    assert.equal(result.code, 1000)
  }
  assert.deepEqual(lists, [])
  assert.deepEqual(writes, [])
})

test('authorized cleanup failures log only a generic status and never include storage errors or credentials', async () => {
  const secret = env.OPEN_KOUNTER_CLEANUP_SECRET
  const proof = token()
  mock.method(Store.prototype, 'list', async () => { throw new Error(`${secret}:${proof}`) })
  const result = await call()
  assert.deepEqual(result, { code: 1000, message: 'Challenge cleanup failed' })
  assert.deepEqual(logs.map((value) => JSON.parse(value)), [{ event: 'passkey_challenge_cleanup', failed: 1, hasMore: true, status: 'error' }])
  assert.equal(JSON.stringify({ result, logs }).includes(secret), false)
  assert.equal(JSON.stringify({ result, logs }).includes(proof), false)
})
