import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { compileScript, parse } from '@vue/compiler-sfc'
import { computed, ref } from 'vue'

import { createPasskeyCeremony } from '../src/utils/passkeyCeremony.js'
import { requestJson } from '../src/utils/requestJson.js'

// Execute the actual SFC setup with controlled lifecycle and browser boundaries.
function setupComponent(filename, { savedToken = '', search = '', nativeCredentials = {} } = {}) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: filename }).content
    .replace(/^import .*$/gm, '')
    .replace('export default', 'return')
  const mounted = [], unmounted = [], emitted = [], timers = new Map(), timeouts = []
  const pageTarget = new EventTarget()
  const storage = new Map(savedToken ? [['open_kounter_token', savedToken]] : [])
  let timerId = 0
  const bindings = {
    computed, ref,
    onMounted: fn => mounted.push(fn),
    onBeforeUnmount: fn => unmounted.push(fn),
    createPasskeyCeremony: options => createPasskeyCeremony({ ...options, pageTarget }),
    navigator: { credentials: nativeCredentials },
    requestJson: (url, options) => {
      timeouts.push(options.timeoutMs ?? 15000)
      return requestJson(url, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 15000, 15) })
    },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    ThemeSwitcher: {}, ConfirmModal: {},
    applyThemeMode() {}, getStoredThemeMode: () => 'system', saveThemeMode() {},
    useRoute: () => ({ name: 'Home' }),
    useRouter: () => ({ isReady: async () => {}, push() {} }),
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    window: {
      location: { search }, history: { replaceState() {} },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    }
  }
  const component = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings))
  const state = component.setup({ token: savedToken }, { expose() {}, emit: (...event) => emitted.push(event) })
  return {
    state, storage, emitted, timers, timeouts, pageTarget,
    mount: () => Promise.all(mounted.map(fn => fn())),
    unmount: () => unmounted.forEach(fn => fn()),
    finishPlaceholder: () => [...timers.values()].forEach(({ fn }) => fn())
  }
}

function statusResponse(url, auth = { initialized: true, oidcLoginEnabled: false }) {
  if (url === '/api/auth') return Response.json({ code: 0, data: auth })
  if (url === '/legacy-api/migrate') return Response.json({ code: 1000, message: 'OPEN_KOUNTER not bound' })
  return Response.json({ code: 0, data: [] })
}

test('failed initialization detection stays unknown and Token submission only authenticates', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    requests.push({ url, body })
    if (body.action === 'get_status') throw new TypeError('Failed to fetch')
    if (body.token) return Response.json({ code: 0, data: { authorized: true } })
    return statusResponse(url)
  })
  const view = setupComponent('components/Login.vue')
  const mounted = view.mount()
  assert.equal(requests.length, 3, 'all capability checks start concurrently')
  assert.equal(view.state.checkingStatus.value, true)
  assert.deepEqual([...view.timers.values()].map(timer => timer.delay), [600])
  view.finishPlaceholder()
  await mounted
  assert.equal(view.state.isInitialized.value, null)
  assert.match(view.state.statusMessage.value, /重试/)
  assert.equal(view.state.checkingStatus.value, false)
  view.state.tokenInput.value = randomUUID()
  await view.state.handleSubmit()
  assert.equal(requests.at(-1).url, '/api/auth')
  assert.equal(requests.some(request => request.url === '/api/init'), false)
  assert.equal(view.emitted.length, 1)
  assert.deepEqual(view.timeouts, [5000, 5000, 5000, 15000])
  view.unmount()
})

test('only explicit initialized:false permits initialization; missing fields remain unknown', async t => {
  for (const initialized of [false, undefined]) {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push(url)
      if (JSON.parse(options.body).token) return Response.json({ code: 0 })
      return statusResponse(url, { initialized })
    })
    const view = setupComponent('components/Login.vue')
    const mounted = view.mount()
    view.finishPlaceholder()
    await mounted
    assert.equal(view.state.isInitialized.value, initialized === false ? false : null)
    view.state.tokenInput.value = randomUUID()
    await view.state.handleSubmit()
    assert.equal(requests.at(-1), initialized === false ? '/api/init' : '/api/auth')
    view.unmount()
  }
})

test('optional capability timeouts release the Token form and can be retried', async t => {
  t.mock.method(globalThis, 'fetch', async url => url === '/legacy-api/migrate'
    ? new Promise(() => {}) : statusResponse(url))
  const view = setupComponent('components/Login.vue')
  const mounted = view.mount()
  view.finishPlaceholder()
  await mounted
  assert.equal(view.state.checkingStatus.value, false)
  assert.equal(view.state.isInitialized.value, true)
  assert.equal(view.state.hasLegacyData.value, false)
  assert.match(view.state.statusMessage.value, /部分登录方式/)

  t.mock.method(globalThis, 'fetch', async url => statusResponse(url))
  const retry = view.state.checkLoginStatus()
  view.finishPlaceholder()
  await retry
  assert.equal(view.state.statusMessage.value, '', 'an unbound legacy KV is a normal disabled capability')
  assert.equal(view.state.hasLegacyData.value, false)
  view.unmount()
})

test('successful capability detection still waits for the minimum placeholder duration', async t => {
  t.mock.method(globalThis, 'fetch', async url => statusResponse(url))
  const view = setupComponent('components/Login.vue')
  const mounted = view.mount()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.state.checkingStatus.value, true)
  view.finishPlaceholder()
  await mounted
  assert.equal(view.state.checkingStatus.value, false)
  view.unmount()
})

test('login requires a confirmed authorization and never emits after unmount', async t => {
  t.mock.method(globalThis, 'fetch', async url => statusResponse(url))
  const view = setupComponent('components/Login.vue')
  const mounted = view.mount()
  view.finishPlaceholder()
  await mounted
  view.state.tokenInput.value = randomUUID()
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0 }))
  await view.state.handleSubmit()
  assert.deepEqual(view.emitted, [])
  assert.match(view.state.message.value, /响应格式/)

  let resolveLogin
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveLogin = resolve }))
  const login = view.state.handleSubmit()
  view.unmount()
  resolveLogin(Response.json({ code: 0, data: { authorized: true } }))
  await login
  assert.deepEqual(view.emitted, [])
  assert.equal(view.state.message.value, '')
})

test('unmount aborts status detection and suppresses late state updates', async t => {
  let resolveAuth
  t.mock.method(globalThis, 'fetch', async url => url === '/api/auth'
    ? new Promise(resolve => { resolveAuth = resolve }) : statusResponse(url))
  const view = setupComponent('components/Login.vue')
  const mounted = view.mount()
  view.unmount()
  await mounted
  resolveAuth(statusResponse('/api/auth', { initialized: false }))
  await Promise.resolve()
  assert.equal(view.state.isInitialized.value, null)
  assert.equal(view.state.checkingStatus.value, true)
  assert.equal(view.timers.size, 0)
  assert.deepEqual(view.emitted, [])
})

test('stored Token survives network, HTTP, malformed JSON, and internal business failures', async t => {
  for (const failure of [
    () => { throw new TypeError('Failed to fetch') },
    () => new Response('failed', { status: 503 }),
    () => new Response('invalid JSON'),
    () => Response.json({ code: 1000, message: 'Blob temporarily unavailable' }),
    () => Response.json({ code: 0, data: {} }),
    () => new Promise(() => {})
  ]) {
    t.mock.method(globalThis, 'fetch', async () => failure())
    const savedToken = randomUUID()
    const view = setupComponent('App.vue', { savedToken })
    await view.mount()
    assert.equal(view.storage.get('open_kounter_token'), savedToken)
    assert.equal(view.state.isLoggedIn.value, false)
    assert.equal(view.state.isLoading.value, false)
    assert.match(view.state.authMessage.value, /保留/)
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { authorized: true } }))
    await view.state.verifyStoredToken()
    assert.equal(view.state.isLoggedIn.value, true)
    assert.equal(view.state.authMessage.value, '')
    view.unmount()
  }
})

test('only explicit Token invalidation removes stored credentials', async t => {
  for (const message of ['Invalid token or unauthorized', 'Not initialized']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 1000, message }))
    const view = setupComponent('App.vue', { savedToken: randomUUID() })
    await view.mount()
    assert.equal(view.storage.has('open_kounter_token'), false)
    assert.equal(view.state.isLoggedIn.value, false)
    assert.equal(view.state.isLoading.value, false)
    assert.match(view.state.authMessage.value, /失效/)
    view.unmount()
  }
})

test('late validation cannot undo a fresh login', async t => {
  let resolveCheck
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveCheck = resolve }))
  const view = setupComponent('App.vue', { savedToken: randomUUID() })
  const mounted = view.mount()
  await Promise.resolve()
  const freshToken = randomUUID()
  view.state.handleLogin(freshToken)
  resolveCheck(Response.json({ code: 1000, message: 'Invalid token or unauthorized' }))
  await mounted
  assert.equal(view.storage.get('open_kounter_token'), freshToken)
  assert.equal(view.state.isLoggedIn.value, true)
  assert.equal(view.state.isLoading.value, false)
  view.unmount()
})

test('OIDC exchange times out without replaying its one-use session', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => new Promise(() => {}))
  const view = setupComponent('App.vue', { search: `?oidc_session=${randomUUID()}` })
  await view.mount()
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(view.state.isLoading.value, false)
  assert.equal(view.state.isLoggedIn.value, false)
  assert.match(view.state.oidcMessage.value, /重新发起 OIDC 登录/)
  view.unmount()
})

test('unmount suppresses late stored Token validation', async t => {
  let resolveCheck
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveCheck = resolve }))
  const savedToken = randomUUID()
  const view = setupComponent('App.vue', { savedToken })
  const mounted = view.mount()
  await Promise.resolve()
  view.unmount()
  resolveCheck(Response.json({ code: 1000, message: 'Invalid token or unauthorized' }))
  await mounted
  assert.equal(view.storage.get('open_kounter_token'), savedToken)
  assert.equal(view.state.authMessage.value, '')
  assert.equal(view.state.isLoggedIn.value, false)
})

function passkeyOptions(challengeId) {
  return { code: 0, data: { challengeId, options: {
    challenge: 'YWJj', allowCredentials: [], user: { id: 'YWJj', name: 'admin' }
  } } }
}

function nativeCredential() {
  const bytes = new Uint8Array([1, 2, 3]).buffer
  return { id: randomUUID(), type: 'public-key', response: {
    clientDataJSON: bytes, authenticatorData: bytes, signature: bytes, attestationObject: bytes
  } }
}

test('Login cancels only its challenge when native authentication is dismissed', async t => {
  const challengeId = randomUUID()
  const actions = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    actions.push({ body, signal: options.signal })
    return Response.json(body.action === 'generateAuthenticationOptions' ? passkeyOptions(challengeId) : { code: 0 })
  })
  const view = setupComponent('components/Login.vue', {
    nativeCredentials: { get: async () => { throw new DOMException('Cancelled', 'NotAllowedError') } }
  })
  await view.state.handlePasskeyLogin()
  assert.deepEqual(actions.map(({ body }) => body.action), ['generateAuthenticationOptions', 'cancelChallenge'])
  assert.deepEqual(actions[1].body.data, { challengeId })
  assert.equal(actions[1].signal.aborted, false)
  assert.deepEqual(view.emitted, [])
  view.unmount()
})

test('Login cleans up a challenge learned after unmount without starting native authentication', async t => {
  const challengeId = randomUUID()
  let resolveOptions
  const actions = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const body = JSON.parse(options.body)
    actions.push(body)
    return body.action === 'generateAuthenticationOptions'
      ? new Promise(resolve => { resolveOptions = resolve }) : Promise.resolve(Response.json({ code: 0 }))
  })
  const native = t.mock.fn(async () => nativeCredential())
  const view = setupComponent('components/Login.vue', { nativeCredentials: { get: native } })
  const login = view.state.handlePasskeyLogin()
  view.unmount()
  await login
  resolveOptions(Response.json(passkeyOptions(challengeId)))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(actions.map(body => body.action), ['generateAuthenticationOptions', 'cancelChallenge'])
  assert.equal(actions[1].data.challengeId, challengeId)
  assert.equal(native.mock.callCount(), 0)
  assert.deepEqual(view.emitted, [])
})

test('pagehide cancels Login native waiting with keepalive and suppresses late success', async t => {
  const challengeId = randomUUID()
  const actions = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    actions.push({ ...body, keepalive: options.keepalive })
    return Response.json(body.action === 'generateAuthenticationOptions' ? passkeyOptions(challengeId) : { code: 0 })
  })
  let resolveNative, nativeSignal
  const view = setupComponent('components/Login.vue', { nativeCredentials: {
    get: ({ signal }) => { nativeSignal = signal; return new Promise(resolve => { resolveNative = resolve }) }
  } })
  const login = view.state.handlePasskeyLogin()
  await new Promise(resolve => setImmediate(resolve))
  view.pageTarget.dispatchEvent(new Event('pagehide'))
  await login
  resolveNative(nativeCredential())
  await Promise.resolve()
  assert.equal(nativeSignal.aborted, true)
  assert.equal(actions.filter(action => action.action === 'cancelChallenge').length, 1)
  assert.equal(actions.at(-1).keepalive, true)
  assert.equal(actions.some(action => action.action === 'verifyAuthentication'), false)
  assert.deepEqual(view.emitted, [])
  view.unmount()
})

test('successful Login does not cancel the consumed challenge and blocks duplicate attempts', async t => {
  const challengeId = randomUUID(), loggedInToken = randomUUID()
  const actions = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    actions.push(body.action)
    return Response.json(body.action === 'generateAuthenticationOptions'
      ? passkeyOptions(challengeId) : { code: 0, data: { token: loggedInToken } })
  })
  const view = setupComponent('components/Login.vue', { nativeCredentials: { get: async () => nativeCredential() } })
  const login = view.state.handlePasskeyLogin()
  await view.state.handlePasskeyLogin()
  await login
  view.unmount()
  assert.deepEqual(actions, ['generateAuthenticationOptions', 'verifyAuthentication'])
  assert.deepEqual(view.emitted, [['login', loggedInToken]])
})

test('Passkey manager registration and management failures each clean up their own challenge', async t => {
  for (const method of ['handleBindPasskey', 'executeUpdateToken']) {
    const challengeId = randomUUID()
    const actions = []
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const body = JSON.parse(options.body)
      actions.push(body)
      return Response.json(body.action === 'cancelChallenge' ? { code: 0 } : passkeyOptions(challengeId))
    })
    const cancelled = async () => { throw new DOMException('Cancelled', 'NotAllowedError') }
    const view = setupComponent('components/dashboard/PasskeyManager.vue', {
      savedToken: randomUUID(), nativeCredentials: { create: cancelled, get: cancelled }
    })
    await view.state[method]()
    assert.equal(actions.length, 2)
    assert.equal(actions[1].action, 'cancelChallenge')
    assert.equal(actions[1].data.challengeId, challengeId)
    assert.equal(view.state.loading.value, false)
    view.unmount()
  }
})

test('failed Passkey verification is not retried and releases its challenge', async t => {
  const challengeId = randomUUID()
  const actions = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    actions.push(body.action)
    if (body.action === 'verifyRegistration') throw new TypeError('Failed to fetch')
    return Response.json(body.action === 'generateRegistrationOptions' ? passkeyOptions(challengeId) : { code: 0 })
  })
  const view = setupComponent('components/dashboard/PasskeyManager.vue', {
    savedToken: randomUUID(), nativeCredentials: { create: async () => nativeCredential() }
  })
  await view.state.handleBindPasskey()
  assert.deepEqual(actions, ['generateRegistrationOptions', 'verifyRegistration', 'cancelChallenge'])
  assert.equal(view.state.hasPasskey.value, false)
  view.unmount()
})

test('successful manager ceremonies do not cancel consumed challenges', async t => {
  for (const method of ['handleBindPasskey', 'executeUpdateToken']) {
    const challengeId = randomUUID(), managementToken = randomUUID(), requestedToken = randomUUID()
    const actions = []
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const body = JSON.parse(options.body)
      actions.push(body)
      if (body.action?.startsWith('generate') && body.action !== 'generateManagementToken') {
        return Response.json(passkeyOptions(challengeId))
      }
      if (body.action === 'generateManagementToken') return Response.json({ code: 0, data: { managementToken } })
      if (body.action === 'listCredentials') return Response.json({ code: 0, data: [{ id: randomUUID() }] })
      return Response.json({ code: 0 })
    })
    const view = setupComponent('components/dashboard/PasskeyManager.vue', {
      savedToken: randomUUID(), nativeCredentials: { create: async () => nativeCredential(), get: async () => nativeCredential() }
    })
    view.state.newToken.value = requestedToken
    await view.state[method]()
    assert.match(view.state.message.value, /成功/)
    assert.equal(actions.some(action => action.action === 'cancelChallenge'), false)
    if (method === 'executeUpdateToken') {
      assert.deepEqual(actions.at(-1), { newToken: requestedToken, managementToken })
    } else {
      assert.equal(view.state.hasPasskey.value, true)
    }
    view.unmount()
    assert.equal(view.timers.size, 0)
  }
})
