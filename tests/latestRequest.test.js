import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLatestRequest } from '../src/utils/latestRequest.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('a stale response cannot overwrite data or end the newer loading state', async () => {
  const latest = createLatestRequest()
  const old = deferred(), fresh = deferred()
  const values = []; let settled = 0
  const callbacks = { onSuccess: (value) => values.push(value), onFinally: () => { settled++ } }
  const a = latest.run(() => old.promise, callbacks)
  const b = latest.run(() => fresh.promise, callbacks)
  old.resolve('old'); await a
  assert.deepEqual(values, []); assert.equal(settled, 0)
  fresh.resolve('fresh'); await b
  assert.deepEqual(values, ['fresh']); assert.equal(settled, 1)
})

test('cancel/unmount suppresses both success and errors, including ignored abort signals', async () => {
  const latest = createLatestRequest()
  const pending = deferred()
  let touched = false
  const request = latest.run(() => pending.promise, { onError: () => { touched = true }, onFinally: () => { touched = true } })
  latest.cancel(); pending.reject(new Error('late failure')); await request
  assert.equal(touched, false)
})

test('a request timeout reports an error and releases loading', async () => {
  const latest = createLatestRequest(5)
  let message, settled = false
  await latest.run((signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))), {
    onError: (error) => { message = error.message }, onFinally: () => { settled = true }
  })
  assert.match(message, /超时/); assert.equal(settled, true)
})
