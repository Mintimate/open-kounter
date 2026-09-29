import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { compileScript, parse } from '@vue/compiler-sfc'
import { ref } from 'vue'

test('the counter form rejects invalid values and preserves accepted integer precision', async t => {
  const source = readFileSync(new URL('../src/components/dashboard/SingleCounterManager.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'counter-form' }).content
    .replace(/^import .*$/gm, '')
    .replace('export default', 'return')
  const component = new Function('ref', 'ConfirmModal', compiled)(ref, {})
  const emitted = []
  const state = component.setup({ token: randomUUID() }, { expose() {}, emit: (...event) => emitted.push(event) })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return Response.json({ code: 0, data: { target: body.target, time: body.value } })
  })
  state.target.value = '/page/'
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '12junk', '', ' 12 ', null, NaN, Infinity]) {
    state.value.value = value
    state.handleSet()
    assert.match(state.singleError.value, /非负安全整数/)
  }
  assert.equal(requests.length, 0)
  assert.equal(emitted.length, 0)
  for (const value of [0, 12, Number.MAX_SAFE_INTEGER]) {
    state.value.value = value
    state.handleSet()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.at(-1).value, value)
    assert.equal(state.result.value.time, value)
    assert.equal(state.singleError.value, '')
  }
  assert.equal(emitted.length, 3)
})
