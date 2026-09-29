import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { createPasskeyCeremony } from '../src/utils/passkeyCeremony.js'

test('independent ceremonies cancel only their own challenges and clean up listeners', async t => {
  const ids = [randomUUID(), randomUUID()]
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return Response.json(body.action === 'cancelChallenge' ? { code: 0 }
      : { code: 0, data: { challengeId: ids.shift() } })
  })
  const pageTarget = new EventTarget()
  const remove = t.mock.method(pageTarget, 'removeEventListener')
  const first = createPasskeyCeremony({ pageTarget })
  const second = createPasskeyCeremony({ pageTarget })
  const firstOptions = await first.generate('generateAuthenticationOptions', {})
  const secondOptions = await second.generate('generateRegistrationOptions', {})
  first.cancel()
  first.cancel()
  second.complete()
  second.cancel()
  pageTarget.dispatchEvent(new Event('pagehide'))
  const cancellations = requests.filter(request => request.action === 'cancelChallenge')
  assert.deepEqual(cancellations, [{ action: 'cancelChallenge', data: { challengeId: firstOptions.challengeId } }])
  assert.notEqual(firstOptions.challengeId, secondOptions.challengeId)
  assert.ok(remove.mock.callCount() >= 2)
})

test('pagehide cleans up a late options response using keepalive', async t => {
  const challengeId = randomUUID()
  let resolveOptions
  const requests = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const body = JSON.parse(options.body)
    requests.push({ ...body, keepalive: options.keepalive, signal: options.signal })
    if (body.action === 'cancelChallenge') return Promise.resolve(Response.json({ code: 0 }))
    return new Promise(resolve => { resolveOptions = resolve })
  })
  const pageTarget = new EventTarget()
  const ceremony = createPasskeyCeremony({ pageTarget })
  const options = ceremony.generate('generateAuthenticationOptions', {})
  pageTarget.dispatchEvent(new Event('pagehide'))
  await assert.rejects(options, { name: 'AbortError' })
  resolveOptions(Response.json({ code: 0, data: { challengeId } }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[1].action, 'cancelChallenge')
  assert.equal(requests[1].data.challengeId, challengeId)
  assert.equal(requests[1].keepalive, true)
  assert.equal(requests[1].signal.aborted, false)
})

test('cleanup rejection is handled and timeout uses an independent bounded request', async t => {
  const timeouts = []
  const originalTimeout = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    timeouts.push(delay)
    return originalTimeout(callback, Math.min(delay, 10))
  })
  let cleanupSignal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (JSON.parse(options.body).action === 'cancelChallenge') {
      cleanupSignal = options.signal
      return new Promise(() => {})
    }
    return Response.json({ code: 0, data: { challengeId: randomUUID() } })
  })
  const lifecycle = new AbortController()
  const ceremony = createPasskeyCeremony({ pageTarget: new EventTarget(), signal: lifecycle.signal })
  await ceremony.generate('generateAuthenticationOptions', {})
  lifecycle.abort()
  assert.equal(cleanupSignal.aborted, false)
  await new Promise(resolve => originalTimeout(resolve, 20))
  assert.equal(cleanupSignal.aborted, true)
  assert.deepEqual(timeouts, [15000, 5000])
})
