import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../client/adapter.js', import.meta.url), 'utf8')
const UV_KEY = 'OpenKounter_UV_Flag'
const NOW = 1800000000000
const serverCounts = { 'site-pv': 321, 'site-uv': 23, '/post/': 87 }

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function response(data, code = 0) {
  return { ok: true, json: async () => ({ code, data }) }
}

function defaultResponse(call) {
  if (call.method === 'POST') {
    return response(call.body.requests.map(({ target }) => ({ target, time: serverCounts[target] })))
  }
  const target = new URL(call.url).searchParams.get('target')
  return response({ target, time: serverCounts[target] })
}

function runAdapter({
  enabled = true,
  dnt = false,
  hostname = 'blog.example',
  ignoreLocal,
  storedUv,
  pathname = '/post/index.html',
  pathConfig,
  counters = ['site-pv', 'site-uv', 'page-views'],
  fetchResponse = defaultResponse
} = {}) {
  const calls = []
  const timers = new Map()
  const storage = new Map(storedUv === undefined ? [] : [[UV_KEY, storedUv]])
  const writes = []
  const elements = new Map()
  const messages = []
  let nextTimer = 0

  for (const counter of counters) {
    let text = 'unchanged'
    elements.set(`#openkounter-${counter}`, {
      get innerText() { return text },
      set innerText(value) { text = String(value) }
    })
    elements.set(`#openkounter-${counter}-container`, { style: { display: 'none' } })
  }

  const Fluid = { ctx: { dnt } }
  vm.runInNewContext(source, {
    CONFIG: { web_analytics: { enable: enabled, openkounter: {
      server_url: 'https://counter.example', ignore_local: ignoreLocal, path: pathConfig
    } } },
    Fluid,
    window: { Fluid, location: { hostname, pathname } },
    document: { querySelector: selector => elements.get(selector) || null },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => { writes.push({ key, value }); storage.set(key, value) }
    },
    fetch: (url, options = {}) => {
      const call = { url, method: options.method || 'GET', signal: options.signal,
        body: options.body ? JSON.parse(options.body) : undefined }
      calls.push(call)
      return fetchResponse(call)
    },
    AbortController,
    Date: class extends Date { static now() { return NOW } },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
    console: { error: (...args) => messages.push(args), warn: (...args) => messages.push(args) }
  })

  return {
    calls, timers, storage, writes, messages,
    value: counter => elements.get(`#openkounter-${counter}`).innerText,
    display: counter => elements.get(`#openkounter-${counter}-container`).style.display,
    expireRequests: () => {
      for (const { callback, delay } of [...timers.values()]) {
        assert.equal(delay, 15000)
        callback()
      }
    }
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('new visitor uses one batch request and renders confirmed server values', async () => {
  const batch = deferred()
  const app = runAdapter({ fetchResponse: () => batch.promise })
  assert.deepEqual(app.calls.map(call => call.method), ['POST'])
  assert.deepEqual(app.calls[0].body, {
    action: 'batch_inc', requests: [{ target: 'site-pv' }, { target: 'site-uv' }, { target: '/post/' }]
  })
  assert.equal(app.storage.has(UV_KEY), false)
  assert.equal(app.value('site-pv'), 'unchanged')

  batch.resolve(defaultResponse(app.calls[0]))
  await settle()
  assert.equal(app.value('site-pv'), '321')
  assert.equal(app.value('site-uv'), '23')
  assert.equal(app.value('page-views'), '87')
  assert.equal(app.display('site-pv'), 'inline')
  assert.deepEqual(app.writes, [{ key: UV_KEY, value: String(NOW) }])
  assert.equal(app.timers.size, 0)
})

test('returning visitor uses one batch plus one read and preserves UV timestamp', async () => {
  const storedUv = String(NOW - 1000)
  const app = runAdapter({ storedUv })
  await settle()
  assert.deepEqual(app.calls.map(call => call.method), ['POST', 'GET'])
  assert.deepEqual(app.calls[0].body.requests, [{ target: 'site-pv' }, { target: '/post/' }])
  assert.equal(new URL(app.calls[1].url).searchParams.get('target'), 'site-uv')
  assert.equal(app.value('site-pv'), '321')
  assert.equal(app.value('site-uv'), '23')
  assert.equal(app.storage.get(UV_KEY), storedUv)
  assert.equal(app.writes.length, 0)
})

test('expired UV timestamp is replaced only after a confirmed batch', async () => {
  const app = runAdapter({ storedUv: String(NOW - 86400001) })
  await settle()
  assert.deepEqual(app.calls.map(call => call.method), ['POST'])
  assert.equal(app.storage.get(UV_KEY), String(NOW))
})

test('disabled analytics, DNT, and local hosts only read without marking UV', async t => {
  for (const options of [
    { enabled: false }, { dnt: true }, { hostname: 'localhost' },
    { hostname: '127.0.0.1' }, { hostname: '[::1]' }
  ]) {
    await t.test(JSON.stringify(options), async () => {
      const app = runAdapter(options)
      await settle()
      assert.deepEqual(app.calls.map(call => call.method), ['GET', 'GET', 'GET'])
      assert.equal(app.storage.has(UV_KEY), false)
      assert.equal(app.writes.length, 0)
      assert.equal(app.value('site-pv'), '321')
      assert.equal(app.value('site-uv'), '23')
    })
  }
})

test('ignore_local false retains explicit local counting configuration', async () => {
  const app = runAdapter({ hostname: 'localhost', ignoreLocal: false })
  await settle()
  assert.deepEqual(app.calls.map(call => call.method), ['POST'])
  assert.equal(app.storage.get(UV_KEY), String(NOW))
})

test('failed writes do not inflate displayed counts, mark UV, or retry', async t => {
  for (const [name, fetchResponse] of [
    ['business failure', () => response(null, 1000)],
    ['HTTP failure', () => ({ ok: false })],
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['malformed response', () => response({})]
  ]) {
    await t.test(name, async () => {
      const app = runAdapter({ fetchResponse })
      await settle()
      assert.deepEqual(app.calls.map(call => call.method), ['POST'])
      assert.equal(app.value('site-pv'), 'unchanged')
      assert.equal(app.value('site-uv'), 'unchanged')
      assert.equal(app.display('site-pv'), 'none')
      assert.equal(app.storage.has(UV_KEY), false)
      assert.equal(app.timers.size, 0)
    })
  }
})

test('only a valid successful UV record can commit its visitor flag', async t => {
  for (const time of ['24', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(String(time), async () => {
      const app = runAdapter({ fetchResponse: () => response([
        { target: 'site-pv', time: 400 }, null, { target: 'site-uv', time }
      ]) })
      await settle()
      assert.equal(app.value('site-pv'), '400')
      assert.equal(app.value('site-uv'), 'unchanged')
      assert.equal(app.storage.has(UV_KEY), false)
    })
  }
})

test('failed reads stay unavailable instead of fabricating zero', async () => {
  const app = runAdapter({ enabled: false, fetchResponse: () => response(null, 1000) })
  await settle()
  assert.equal(app.value('site-pv'), 'unchanged')
  assert.equal(app.value('site-uv'), 'unchanged')
  assert.equal(app.display('site-pv'), 'none')
  assert.equal(app.storage.has(UV_KEY), false)
})

test('a hanging UV read cannot delay the batch or overwrite its confirmed values', async () => {
  const read = deferred()
  const app = runAdapter({
    storedUv: String(NOW - 1000),
    fetchResponse: call => call.method === 'GET' ? read.promise : defaultResponse(call)
  })
  await settle()
  assert.equal(app.value('site-pv'), '321')
  assert.equal(app.value('page-views'), '87')
  assert.equal(app.value('site-uv'), 'unchanged')
  assert.equal(app.timers.size, 1)

  read.resolve(response({ target: 'site-pv', time: 2 }))
  await settle()
  assert.equal(app.value('site-pv'), '321')
  assert.equal(app.value('site-uv'), 'unchanged')
  assert.equal(app.calls.length, 2)
  assert.equal(app.timers.size, 0)
})

test('write timeout aborts without retry and ignores a transport returning late success', async () => {
  const batch = deferred()
  const app = runAdapter({ fetchResponse: () => batch.promise })
  app.expireRequests()
  await settle()
  assert.equal(app.calls[0].signal.aborted, true)
  assert.equal(app.calls.length, 1)
  assert.equal(app.value('site-pv'), 'unchanged')
  assert.equal(app.storage.has(UV_KEY), false)
  assert.equal(app.timers.size, 0)

  batch.resolve(defaultResponse(app.calls[0]))
  await settle()
  assert.equal(app.value('site-pv'), 'unchanged')
  assert.equal(app.storage.has(UV_KEY), false)
  assert.equal(app.calls.length, 1)
})

test('timeout also bounds response body parsing', async () => {
  const body = deferred()
  const app = runAdapter({ fetchResponse: () => ({ ok: true, json: () => body.promise }) })
  await settle()
  app.expireRequests()
  await settle()
  body.resolve({ code: 0, data: [{ target: 'site-uv', time: 50 }] })
  await settle()
  assert.equal(app.value('site-uv'), 'unchanged')
  assert.equal(app.storage.has(UV_KEY), false)
  assert.equal(app.calls.length, 1)
})

test('a read timeout does not affect an already successful batch or retry', async () => {
  const app = runAdapter({
    storedUv: String(NOW - 1000),
    fetchResponse: call => call.method === 'GET' ? new Promise(() => {}) : defaultResponse(call)
  })
  await settle()
  app.expireRequests()
  await settle()
  assert.equal(app.calls[1].signal.aborted, true)
  assert.equal(app.value('site-pv'), '321')
  assert.equal(app.value('site-uv'), 'unchanged')
  assert.equal(app.calls.length, 2)
  assert.equal(app.writes.length, 0)
})

test('invalid page paths leave site counting operational', async t => {
  for (const [name, options] of [
    ['bad percent encoding', { pathname: '/bad%path' }],
    ['null path', { pathConfig: 'null' }],
    ['missing path', { pathConfig: 'missing.path' }],
    ['oversized target', { pathname: `/${'a'.repeat(2048)}` }]
  ]) {
    await t.test(name, async () => {
      const app = runAdapter(options)
      await settle()
      assert.deepEqual(app.calls[0].body.requests, [{ target: 'site-pv' }, { target: 'site-uv' }])
      assert.equal(app.value('site-pv'), '321')
      assert.equal(app.value('site-uv'), '23')
      assert.equal(app.value('page-views'), 'unchanged')
      assert.equal(app.calls.length, 1)
    })
  }
})
