import { createHash, randomBytes } from 'node:crypto'

import { createRemoteJWKSet, jwtVerify } from 'jose'

export const OIDC_TTL_MS = 5 * 60 * 1000
export const OIDC_COOKIE = 'open_kounter_oidc'
const discoveryCache = new Map()
const jwksCache = new Map()
const SIGNING_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']

export function randomOidcValue() {
  return randomBytes(32).toString('base64url')
}

export function hashOidcValue(value) {
  return createHash('sha256').update(value).digest('base64url')
}

export function hasOidcConfig(env) {
  return !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_REDIRECT_URI)
}

function httpsUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('OIDC requires HTTPS endpoints')
  return url
}

export async function discoverOIDCEndpoints(issuer) {
  const cached = discoveryCache.get(issuer)
  if (cached?.expiresAt > Date.now()) return cached.document
  const url = httpsUrl(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok) throw new Error('OIDC discovery failed')
  const document = await response.json()
  if (document.issuer !== issuer) throw new Error('OIDC discovery issuer mismatch')
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) httpsUrl(document[field])
  if (discoveryCache.size >= 8) discoveryCache.clear()
  discoveryCache.set(issuer, { document, expiresAt: Date.now() + OIDC_TTL_MS })
  return document
}

export async function verifyOidcIdToken(idToken, env, nonce, endpoints, key) {
  if (!idToken || !nonce) throw new Error('Missing OIDC ID token or nonce')
  if (!key) {
    if (!jwksCache.has(endpoints.jwks_uri)) {
      if (jwksCache.size >= 8) jwksCache.clear()
      jwksCache.set(endpoints.jwks_uri, createRemoteJWKSet(httpsUrl(endpoints.jwks_uri), { timeoutDuration: 10000 }))
    }
    key = jwksCache.get(endpoints.jwks_uri)
  }
  const { payload } = await jwtVerify(idToken, key, {
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_CLIENT_ID,
    algorithms: SIGNING_ALGORITHMS,
    requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
    clockTolerance: 5
  })
  if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) throw new Error('Invalid OIDC identity')
  if ((Array.isArray(payload.aud) && payload.aud.length > 1 && !payload.azp)
    || (payload.azp !== undefined && payload.azp !== env.OIDC_CLIENT_ID)) throw new Error('OIDC authorized party mismatch')
  return payload
}

export async function exchangeOidcCode(code, state, env, endpoints) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code,
    redirect_uri: env.OIDC_REDIRECT_URI, code_verifier: state.codeVerifier
  })
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  const methods = endpoints.token_endpoint_auth_methods_supported || ['client_secret_basic']
  if (methods.includes('client_secret_basic')) {
    const encode = (value) => new URLSearchParams({ v: value }).toString().slice(2)
    headers.Authorization = `Basic ${Buffer.from(`${encode(env.OIDC_CLIENT_ID)}:${encode(env.OIDC_CLIENT_SECRET)}`).toString('base64')}`
  } else if (methods.includes('client_secret_post')) {
    body.set('client_id', env.OIDC_CLIENT_ID)
    body.set('client_secret', env.OIDC_CLIENT_SECRET)
  } else {
    throw new Error('Unsupported OIDC client authentication method')
  }
  const response = await fetch(endpoints.token_endpoint, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(10000), redirect: 'error'
  })
  if (!response.ok) throw new Error('OIDC token exchange failed')
  return response.json()
}

export function browserCookie(request) {
  return (request.headers.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${OIDC_COOKIE}=`))?.slice(OIDC_COOKIE.length + 1) || ''
}

export function oidcCookie(value, maxAge = 300) {
  return `${OIDC_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/oidc; Max-Age=${maxAge}`
}

export function oidcRedirect(env, params) {
  const url = new URL('/', env.OIDC_REDIRECT_URI)
  url.search = new URLSearchParams(params).toString()
  return new Response(null, { status: 302, headers: {
    Location: url.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Set-Cookie': oidcCookie('', 0)
  } })
}
