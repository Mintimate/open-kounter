import { createStore, failResponse } from '../_api.js'
import {
  consumeTransientJson, loadSystemState, oidcSessionKey, oidcStateKey,
  readJson, updateSystemState, writeJson
} from '../_blobStore.js'
import {
  browserCookie, discoverOIDCEndpoints, exchangeOidcCode, hasOidcConfig,
  hashOidcValue, oidcRedirect, randomOidcValue, verifyOidcIdToken
} from '../_oidc.js'

export async function onRequest({ request, env }) {
  if (!hasOidcConfig(env)) return failResponse(request, 'OIDC not configured')
  try {
    if (request.method !== 'GET') throw new Error('Method not allowed')
    const url = new URL(request.url)
    const stateId = url.searchParams.get('state')
    if (!stateId || !/^[A-Za-z0-9_-]{43}$/.test(stateId)) throw new Error('Invalid OIDC state')
    const store = createStore({ env })
    const key = oidcStateKey(stateId)
    const pending = await readJson(store, key)
    const cookie = browserCookie(request)
    if (!cookie || !pending?.browserHash || hashOidcValue(cookie) !== pending.browserHash) {
      throw new Error('OIDC browser mismatch')
    }
    const state = await consumeTransientJson(store, key)
    if (!state || state.state !== stateId || state.issuer !== env.OIDC_ISSUER
      || state.clientId !== env.OIDC_CLIENT_ID || state.redirectUri !== env.OIDC_REDIRECT_URI) {
      throw new Error('OIDC state expired or configuration changed')
    }
    const code = url.searchParams.get('code')
    if (url.searchParams.has('error') || !code) throw new Error('OIDC authorization failed')
    const endpoints = await discoverOIDCEndpoints(env.OIDC_ISSUER)
    const tokens = await exchangeOidcCode(code, state, env, endpoints)
    const identity = await verifyOidcIdToken(tokens.id_token, env, state.nonce, endpoints)

    if (state.mode === 'bind') {
      await updateSystemState(store, (current) => {
        if (![env.ADMIN_TOKEN, current.token].filter(Boolean).some((token) => hashOidcValue(token) === state.tokenHash)) {
          throw new Error('Administrator authorization expired')
        }
        return { ...current, oidc: {
          sub: identity.sub, issuer: identity.iss,
          email: typeof identity.email === 'string' ? identity.email : '',
          name: typeof identity.name === 'string' ? identity.name : '',
          boundAt: Date.now()
        }, updatedAt: Date.now() }
      })
      return oidcRedirect(env, { oidc_bound: 'true' })
    }
    if (state.mode !== 'login') throw new Error('Invalid OIDC mode')
    const current = await loadSystemState(store)
    if (current.oidc?.sub !== identity.sub || current.oidc?.issuer !== identity.iss) {
      throw new Error('OIDC identity mismatch')
    }
    const token = env.ADMIN_TOKEN || current.token
    if (!token) throw new Error('Not initialized')
    const sessionId = randomOidcValue()
    await writeJson(store, oidcSessionKey(sessionId), {
      sessionId, sub: identity.sub, issuer: identity.iss, boundAt: current.oidc.boundAt,
      tokenHash: hashOidcValue(token), createdAt: Date.now(), expiresAt: Date.now() + 60000
    }, { onlyIfNew: true })
    return oidcRedirect(env, { oidc_session: sessionId })
  } catch {
    // Never reflect provider payloads, authorization codes or internal errors in URLs/logs.
    return oidcRedirect(env, { oidc_error: 'OIDC 验证失败或已过期，请重新登录' })
  }
}
