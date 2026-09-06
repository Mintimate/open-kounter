import { createStore, failResponse, optionsResponse, requireAuth, successResponse } from '../_api.js'
import { loadSystemState, oidcStateKey, writeJson } from '../_blobStore.js'
import {
  discoverOIDCEndpoints, hasOidcConfig, hashOidcValue, OIDC_TTL_MS,
  oidcCookie, randomOidcValue
} from '../_oidc.js'

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse(request)
  try {
    if (!hasOidcConfig(env)) throw new Error('OIDC not configured')
    const url = new URL(request.url)
    const store = createStore({ env })
    let mode = 'login'
    let tokenHash = null
    if (request.method === 'POST') {
      const auth = await requireAuth(request, store, env)
      const body = await request.json()
      if (body.mode !== 'bind') throw new Error('Invalid OIDC mode')
      mode = 'bind'
      tokenHash = hashOidcValue(auth.token)
    } else if (request.method === 'GET') {
      if ((url.searchParams.get('mode') || 'login') !== 'login' || url.searchParams.has('token')) {
        throw new Error('OIDC binding requires an authenticated POST')
      }
      const state = await loadSystemState(store)
      if (!state.oidc?.sub || state.oidc.issuer !== env.OIDC_ISSUER) throw new Error('OIDC not bound')
    } else {
      throw new Error('Method not allowed')
    }
    const endpoints = await discoverOIDCEndpoints(env.OIDC_ISSUER)
    const state = randomOidcValue()
    const nonce = randomOidcValue()
    const browserSecret = randomOidcValue()
    const codeVerifier = randomOidcValue()
    await writeJson(store, oidcStateKey(state), {
      state, nonce, mode, tokenHash, codeVerifier,
      issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, redirectUri: env.OIDC_REDIRECT_URI,
      browserHash: hashOidcValue(browserSecret),
      createdAt: Date.now(), expiresAt: Date.now() + OIDC_TTL_MS
    }, { onlyIfNew: true })
    const authUrl = new URL(endpoints.authorization_endpoint)
    for (const [key, value] of Object.entries({
      response_type: 'code', client_id: env.OIDC_CLIENT_ID, redirect_uri: env.OIDC_REDIRECT_URI,
      scope: 'openid email profile', state, nonce,
      code_challenge: hashOidcValue(codeVerifier), code_challenge_method: 'S256'
    })) authUrl.searchParams.set(key, value)
    const response = mode === 'bind'
      ? successResponse(request, { authorizationUrl: authUrl.toString() })
      : new Response(null, { status: 302, headers: { Location: authUrl.toString() } })
    response.headers.set('Set-Cookie', oidcCookie(browserSecret))
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    return failResponse(request, error.message)
  }
}
