import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, mock, test } from 'node:test'

import { PreconditionFailedError, Store } from '@edgeone/pages-blob'

import * as blob from '../cloud-functions/api/_blobStore.js'
import { cleanupExpiredChallenges } from '../cloud-functions/api/_challengeCleanup.js'
import { onRequest } from '../cloud-functions/api/maintenance/challenges.js'

const originalCredential = process.env.PAGES_BLOB_DEPLOY_CREDENTIAL
const origin = 'https://cleanup.example'
const now = 2000000000000
let records, reads, writes, deletes, lists, env

beforeEach(() => {
  process.env.PAGES_BLOB_DEPLOY_CREDENTIAL = randomUUID()
  records = new Map()
  reads = []; writes = []; deletes = []; lists = []
  env = { ADMIN_TOKEN: randomUUID() }
  mock.method(Date, 'now', () => now)
  mock.method(Store.prototype, 'get', async (key, options) => {
    reads.push({ key, options })
    return structuredClone(records.get(key) ?? null)
  })
  mock.method(Store.prototype, 'setJSON', async (key, value, options) => {
    if (options?.onlyIfNew && records.has(key)) throw new PreconditionFailedError()
    writes.push(key)
    records.set(key, structuredClone(value))
  })
  mock.method(Store.prototype, 'delete', async (key) => {
    deletes.push(key)
    records.delete(key)
  })
  mock.method(Store.prototype, 'list', async (options) => {
    lists.push(options)
    assert.equal(options.prefix, blob.getStoragePrefixes().passkeyChallenges)
    assert.equal(options.consistency, 'strong')
    assert.equal(options.limit, 100)
    assert.equal(options.paginate, false)
    assert.ok(!options.cursor || options.cursor.startsWith('opaque:'), 'resume with the SDK cursor, not a key')
    const after = options.cursor ? options.cursor.slice('opaque:'.length) : ''
    const keys = [...records.keys()].filter((key) => key.startsWith(options.prefix) && key > after).sort()
    const page = keys.slice(0, options.limit)
    return {
      blobs: page.map((key) => ({ key })),
      ...(keys.length > page.length ? { cursor: `opaque:${page.at(-1)}` } : {})
    }
  })
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request') })
})

afterEach(() => {
  mock.restoreAll()
  if (originalCredential === undefined) delete process.env.PAGES_BLOB_DEPLOY_CREDENTIAL
  else process.env.PAGES_BLOB_DEPLOY_CREDENTIAL = originalCredential
})

const store = () => blob.createOpenKounterStore(env)
const challengeKey = (id) => blob.passkeyChallengeKey(id)
const addExpired = (id) => records.set(challengeKey(id), { expiresAt: now - 120000, challenge: randomUUID() })
async function call({ token = env.ADMIN_TOKEN, method = 'POST', query = '', body = {} } = {}) {
  return onRequest({ env, request: new Request(`${origin}/api/maintenance/challenges${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  }) })
}

test('cleanup removes only expired original challenges and leaves credentials, receipts and unrelated locks intact', async () => {
  addExpired('old')
  records.set(challengeKey('boundary'), { expiresAt: now - 60000 })
  records.set(challengeKey('within-margin'), { expiresAt: now - 59999 })
  records.set(challengeKey('active'), { expiresAt: now + 300000 })
  records.set(challengeKey('invalid-expiry'), { expiresAt: '1' })
  records.set(challengeKey('missing-expiry'), {})
  const preserved = new Map([
    [blob.consumedDocumentKey(challengeKey('old')), { expiresAt: now - 120000, consumedAt: now - 180000 }],
    [blob.passkeyCredentialKey('credential'), { id: randomUUID() }],
    [blob.passkeyUserKey('user'), { currentChallengeId: 'old' }],
    [blob.passkeyManagementTokenKey('management'), { expiresAt: now - 120000 }],
    [blob.oidcStateKey('state'), { expiresAt: now - 120000 }],
    [blob.passkeyUserLockKey('user'), { requestId: randomUUID(), expiresAt: now - 120000 }],
    ['passkey/challenges-neighbor/document.json', { expiresAt: now - 120000 }]
  ])
  for (const [key, value] of preserved) records.set(key, structuredClone(value))
  const response = await call()
  const payload = await response.json()
  assert.deepEqual(payload, { code: 0, data: { scanned: 6, deleted: 2, skipped: 4, failed: 0, hasMore: false } })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(records.has(challengeKey('old')), false)
  assert.equal(records.has(challengeKey('boundary')), false)
  for (const id of ['within-margin', 'active', 'invalid-expiry', 'missing-expiry']) assert.equal(records.has(challengeKey(id)), true)
  for (const [key, value] of preserved) assert.deepEqual(records.get(key), value)
  assert.ok(reads.every(({ options }) => options.consistency === 'strong'))
  assert.deepEqual(records.get(blob.challengeCleanupStateKey()), { cursor: null, updatedAt: now })
  assert.equal(records.has(blob.legacyMigrationLockKey()), false)
  assert.deepEqual((await (await call()).json()).data, { scanned: 4, deleted: 0, skipped: 4, failed: 0, hasMore: false })
})

test('bounded pages persist the opaque SDK cursor and reset it after the full scan', async () => {
  for (let index = 0; index < 205; index++) addExpired(String(index).padStart(3, '0'))
  const first = await cleanupExpiredChallenges(store())
  assert.deepEqual(first, { scanned: 100, deleted: 100, skipped: 0, failed: 0, hasMore: true })
  const firstCursor = records.get(blob.challengeCleanupStateKey()).cursor
  assert.deepEqual(firstCursor, { page: `opaque:${challengeKey('099')}`, afterKey: '' })
  const second = await cleanupExpiredChallenges(store())
  assert.equal(lists[1].cursor, firstCursor.page)
  assert.deepEqual(second, { scanned: 100, deleted: 100, skipped: 0, failed: 0, hasMore: true })
  assert.deepEqual(await cleanupExpiredChallenges(store()), { scanned: 5, deleted: 5, skipped: 0, failed: 0, hasMore: false })
  assert.equal(records.get(blob.challengeCleanupStateKey()).cursor, null)
  addExpired('000')
  assert.equal((await cleanupExpiredChallenges(store())).deleted, 1, 'a completed cycle revisits earlier keys')
  assert.equal(lists[3].cursor, '')
})

test('a failed deletion is retried from the checkpoint before that key and never exposes the error message', async () => {
  for (const id of ['a', 'b', 'c']) addExpired(id)
  const originalDelete = Store.prototype.delete
  const failureMessage = randomUUID()
  let failOnce = true
  mock.method(Store.prototype, 'delete', async function (key) {
    if (key === challengeKey('b') && failOnce) {
      failOnce = false
      throw new Error(failureMessage)
    }
    return originalDelete.call(this, key)
  })
  const payload = await (await call()).json()
  assert.deepEqual(payload.data, { scanned: 2, deleted: 1, skipped: 0, failed: 1, hasMore: true })
  assert.equal(JSON.stringify(payload).includes(failureMessage), false)
  assert.deepEqual(records.get(blob.challengeCleanupStateKey()).cursor, { page: '', afterKey: challengeKey('a') })
  assert.equal(records.has(challengeKey('b')), true)
  assert.equal(records.has(challengeKey('c')), true)
  assert.deepEqual(await cleanupExpiredChallenges(store()), { scanned: 2, deleted: 2, skipped: 0, failed: 0, hasMore: false })
})

test('a transient read failure is retried while malformed JSON does not block later documents', async () => {
  for (const id of ['a-malformed', 'b-transient', 'c']) addExpired(id)
  const originalGet = Store.prototype.get
  let failOnce = true
  mock.method(Store.prototype, 'get', async function (key, options) {
    if (key === challengeKey('a-malformed')) throw new SyntaxError('Invalid JSON')
    if (key === challengeKey('b-transient') && failOnce) {
      failOnce = false
      throw new Error('Storage temporarily unavailable')
    }
    return originalGet.call(this, key, options)
  })
  assert.deepEqual(await cleanupExpiredChallenges(store()), { scanned: 2, deleted: 0, skipped: 0, failed: 2, hasMore: true })
  assert.deepEqual(records.get(blob.challengeCleanupStateKey()).cursor, { page: '', afterKey: challengeKey('a-malformed') })
  assert.deepEqual(await cleanupExpiredChallenges(store()), { scanned: 2, deleted: 2, skipped: 0, failed: 0, hasMore: false })
  assert.deepEqual(await cleanupExpiredChallenges(store()), { scanned: 1, deleted: 0, skipped: 0, failed: 1, hasMore: false })
  assert.equal(records.has(challengeKey('a-malformed')), true)
})

test('the cooperative deadline checkpoints a partial page after awaited work without releasing its lock early', async () => {
  records.set(challengeKey('a-active'), { expiresAt: now + 300000 })
  addExpired('b-expired')
  const originalGet = Store.prototype.get
  let elapsed = 0
  mock.method(Date, 'now', () => now + elapsed)
  mock.method(Store.prototype, 'get', async function (key, options) {
    const value = await originalGet.call(this, key, options)
    if (key === challengeKey('a-active')) elapsed = 10000
    return value
  })
  assert.deepEqual(await cleanupExpiredChallenges(store()), { scanned: 1, deleted: 0, skipped: 1, failed: 0, hasMore: true })
  assert.deepEqual(records.get(blob.challengeCleanupStateKey()).cursor, { page: '', afterKey: challengeKey('a-active') })
  assert.equal(reads.some(({ key }) => key === challengeKey('b-expired')), false)
  assert.equal((await cleanupExpiredChallenges(store())).deleted, 1, 'resume beyond retained keys in a partial page')
  assert.equal(records.get(blob.challengeCleanupStateKey()).cursor, null)

  addExpired('c-expired')
  const originalDelete = Store.prototype.delete
  let finishDelete, startedDelete
  const started = new Promise((resolve) => { startedDelete = resolve })
  const pending = new Promise((resolve) => { finishDelete = resolve })
  mock.method(Store.prototype, 'delete', async function (key) {
    if (key === challengeKey('c-expired')) {
      startedDelete()
      await pending
    }
    return originalDelete.call(this, key)
  })
  const running = cleanupExpiredChallenges(store())
  await started
  elapsed += 20000
  assert.equal(records.has(blob.legacyMigrationLockKey()), true)
  assert.equal(records.has(challengeKey('c-expired')), true)
  finishDelete()
  await running
  assert.equal(records.has(blob.legacyMigrationLockKey()), false)
  assert.equal(records.has(challengeKey('c-expired')), false)
})

test('an existing migration lock prevents cleanup even if its diagnostic expiry has passed', async () => {
  addExpired('old')
  const lock = { requestId: randomUUID(), expiresAt: now - 120000, createdAt: now - 180000 }
  records.set(blob.legacyMigrationLockKey(), lock)
  const payload = await (await call()).json()
  assert.deepEqual(payload, { code: 1000, message: 'Challenge cleanup failed' })
  assert.deepEqual(records.get(blob.legacyMigrationLockKey()), lock)
  assert.equal(records.has(challengeKey('old')), true)
  assert.equal(lists.length, 0)
  assert.equal(writes.length, 0)
  assert.equal(deletes.length, 0)
})

test('cleanup requires administrator Bearer authentication and rejects credentials in query/body and wrong tokens', async () => {
  addExpired('old')
  const rejected = [
    { token: null },
    { token: randomUUID() },
    { token: `${env.ADMIN_TOKEN}-different-length` },
    { token: null, query: `?token=${encodeURIComponent(env.ADMIN_TOKEN)}` },
    { token: null, body: { token: env.ADMIN_TOKEN } }
  ]
  for (const options of rejected) assert.deepEqual(await (await call(options)).json(), { code: 1000, message: 'Unauthorized' })
  assert.equal(lists.length, 0)
  assert.equal(writes.length, 0)
  assert.equal(deletes.length, 0)
  const authorized = await (await call()).json()
  assert.equal(authorized.data.deleted, 1)
  assert.equal((await (await call()).json()).code, 0)
  assert.equal((await call({ method: 'OPTIONS', token: null })).status, 204)
  assert.equal((await (await call({ method: 'GET' })).json()).message, 'Method not allowed')
})

test('checkpoint write failure safely permits replay and out-of-prefix list entries cannot be deleted', async () => {
  addExpired('old')
  const neighbor = blob.passkeyCredentialKey('not-a-challenge')
  records.set(neighbor, { expiresAt: now - 120000 })
  const originalList = Store.prototype.list
  mock.method(Store.prototype, 'list', async function (options) {
    const page = await originalList.call(this, options)
    page.blobs.unshift({ key: neighbor })
    return page
  })
  const originalSet = Store.prototype.setJSON
  let failOnce = true
  mock.method(Store.prototype, 'setJSON', async function (key, value, options) {
    if (key === blob.challengeCleanupStateKey() && failOnce) {
      failOnce = false
      throw new Error(randomUUID())
    }
    return originalSet.call(this, key, value, options)
  })
  assert.deepEqual(await (await call()).json(), { code: 1000, message: 'Challenge cleanup failed' })
  assert.equal(records.has(challengeKey('old')), false)
  assert.equal(records.has(blob.challengeCleanupStateKey()), false)
  assert.equal(records.has(neighbor), true)
  assert.equal((await (await call()).json()).code, 0)
  assert.equal(records.has(neighbor), true)
  assert.equal(records.has(blob.legacyMigrationLockKey()), false)
})
