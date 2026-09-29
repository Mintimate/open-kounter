import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestJson } from '../src/utils/requestJson.js'

test('JSON requests time out even when fetch ignores abort', async t => {
  let requestSignal
  t.mock.method(globalThis, 'fetch', (url, { signal }) => {
    requestSignal = signal
    return new Promise(() => {})
  })
  await assert.rejects(requestJson('/api/auth', { timeoutMs: 5 }), /请求超时/)
  assert.equal(requestSignal.aborted, true)
})

test('JSON request timeout includes reading the response body', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: () => new Promise(() => {}) }))
  await assert.rejects(requestJson('/api/auth', { timeoutMs: 5 }), /请求超时/)
})

test('cancelling a JSON request settles ignored abort and removes its listener', async t => {
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}))
  const controller = new AbortController()
  const remove = t.mock.method(controller.signal, 'removeEventListener')
  const request = requestJson('/api/auth', { signal: controller.signal })
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(remove.mock.callCount(), 1)
})

test('an already cancelled JSON request does not start a fetch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(requestJson('/api/auth', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('HTTP failures and invalid responses are distinct from business rejection', async t => {
  for (const response of [
    new Response('{"code":1000,"message":"Invalid token or unauthorized"}', { status: 503 }),
    new Response('invalid json'),
    new Response('{}'),
    new Response('null')
  ]) {
    t.mock.method(globalThis, 'fetch', async () => response)
    await assert.rejects(requestJson('/api/auth'), /服务/)
  }
  const rejected = { code: 1000, message: 'Invalid token or unauthorized' }
  t.mock.method(globalThis, 'fetch', async () => Response.json(rejected))
  assert.deepEqual(await requestJson('/api/auth'), rejected)
})

test('successful requests clean up timeout and abort listeners', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0 }))
  const controller = new AbortController()
  const remove = t.mock.method(controller.signal, 'removeEventListener')
  const clear = t.mock.method(globalThis, 'clearTimeout')
  assert.deepEqual(await requestJson('/api/auth', { signal: controller.signal }), { code: 0 })
  assert.equal(remove.mock.callCount(), 1)
  assert.equal(clear.mock.callCount(), 1)
})
