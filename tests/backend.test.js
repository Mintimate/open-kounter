import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { afterEach, beforeEach, mock, test } from 'node:test'

import { PreconditionFailedError, Store } from '@edgeone/pages-blob'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

import * as blob from '../cloud-functions/api/_blobStore.js'
import { hashOidcValue, verifyOidcIdToken } from '../cloud-functions/api/_oidc.js'
import { getPasskeyConfig } from '../cloud-functions/api/_passkey.js'
import { importLegacyBundle } from '../cloud-functions/api/_legacyMigration.js'
import { onRequest as auth } from '../cloud-functions/api/auth.js'
import { onRequest as counter } from '../cloud-functions/api/counter.js'
import { onRequest as oidcLogin } from '../cloud-functions/api/oidc/login.js'
import { onRequest as oidcCallback } from '../cloud-functions/api/oidc/callback.js'
import { onRequest as passkey } from '../cloud-functions/api/passkey.js'

const origin = 'https://review.example'
const rpID = 'review.example'
const originalCredential = process.env.PAGES_BLOB_DEPLOY_CREDENTIAL
let records, reads, writes, deletes, env
beforeEach(() => {
  process.env.PAGES_BLOB_DEPLOY_CREDENTIAL = randomUUID()
  records = new Map()
  reads = []; writes = []; deletes = []
  env = { ADMIN_TOKEN: randomUUID() }
  mock.method(Store.prototype, 'get', async function (key) {
    reads.push(key)
    return structuredClone(records.get(key) ?? null)
  })
  mock.method(Store.prototype, 'setJSON', async function (key, value, options) {
    if (options?.onlyIfNew && records.has(key)) throw new PreconditionFailedError()
    writes.push(key)
    records.set(key, structuredClone(value))
  })
  mock.method(Store.prototype, 'delete', async function (key) { deletes.push(key); records.delete(key) })
  mock.method(Store.prototype, 'list', async function ({ prefix }) {
    assert.ok(prefix, 'never list the entire store during cleanup')
    return { blobs: [...records.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }
  })
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request') })
  mock.method(console, 'error', () => {})
})
afterEach(() => {
  mock.restoreAll()
  if (originalCredential === undefined) delete process.env.PAGES_BLOB_DEPLOY_CREDENTIAL
  else process.env.PAGES_BLOB_DEPLOY_CREDENTIAL = originalCredential
})
const store = () => blob.createOpenKounterStore(env)
async function call(handler, body, headers = {}) {
  const response = await handler({ env, request: new Request(`${origin}/api/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body)
  }) })
  return response.json()
}
const adminHeaders = () => ({ Authorization: `Bearer ${env.ADMIN_TOKEN}` })
const hash = (value) => createHash('sha256').update(value).digest()
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const publicKeyBytes = isoCBOR.encode(new Map([
    [1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]
  ]))
  const id = randomBytes(32).toString('base64url')
  const userId = hash('open-kounter-passkey:admin').toString('base64url')
  return { id, userId, privateKey, publicKeyBytes }
}
function registrationResponse(f, challenge, { flags = 0x45, requestOrigin = origin, rp = rpID } = {}) {
  const id = Buffer.from(f.id, 'base64url')
  const length = Buffer.alloc(2); length.writeUInt16BE(id.length)
  const authData = Buffer.concat([hash(rp), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), length, id, f.publicKeyBytes])
  const attestation = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]))
  return { id: f.id, rawId: f.id, type: 'public-key', response: {
    clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: requestOrigin })).toString('base64url'),
    attestationObject: Buffer.from(attestation).toString('base64url'), transports: ['internal']
  } }
}
function assertionResponse(f, challenge, { flags = 0x05, requestOrigin = origin, rp = rpID, count = 1 } = {}) {
  const counterBytes = Buffer.alloc(4); counterBytes.writeUInt32BE(count)
  const authenticatorData = Buffer.concat([hash(rp), Buffer.from([flags]), counterBytes])
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: requestOrigin }))
  const signature = sign('sha256', Buffer.concat([authenticatorData, hash(clientDataJSON)]), f.privateKey)
  return { id: f.id, rawId: f.id, type: 'public-key', response: {
    clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'),
    signature: signature.toString('base64url'), userHandle: f.userId
  } }
}
function seedCredential(f, legacy = false) {
  records.set(blob.passkeyUserKey(f.userId), { id: f.userId, username: 'admin', token: randomUUID(), credentialIds: [f.id] })
  records.set(blob.passkeyCredentialKey(f.id), {
    id: f.id, userId: f.userId, webAuthnUserID: f.userId, counter: 0,
    publicKey: legacy ? registrationResponse(f, 'unused').response.attestationObject : Buffer.from(f.publicKeyBytes).toString('base64url'),
    ...(legacy ? {} : { publicKeyFormat: 'cose' })
  })
}
async function authenticationOptions(purpose = 'authentication') {
  const result = await call(passkey, { action: 'generateAuthenticationOptions', data: { username: 'admin', purpose } })
  assert.equal(result.code, 0)
  return result.data
}

test('Passkey registration validates attestation and stores a real COSE key', async () => {
  const f = fixture()
  const options = await call(passkey, { action: 'generateRegistrationOptions', data: { username: 'admin', token: env.ADMIN_TOKEN } })
  const response = registrationResponse(f, options.data.options.challenge)
  const result = await call(passkey, { action: 'verifyRegistration', data: { challengeId: options.data.challengeId, response } })
  assert.equal(result.code, 0)
  const stored = records.get(blob.passkeyCredentialKey(f.id))
  assert.equal(stored.publicKeyFormat, 'cose')
  assert.equal(stored.publicKey, Buffer.from(f.publicKeyBytes).toString('base64url'))
})

test('Passkey rejects registration with a wrong RP ID or absent user verification', async () => {
  for (const invalid of [{ rp: 'other.example' }, { flags: 0x41 }]) {
    const f = fixture()
    const options = await call(passkey, { action: 'generateRegistrationOptions', data: { username: 'admin', token: env.ADMIN_TOKEN } })
    const result = await call(passkey, { action: 'verifyRegistration', data: {
      challengeId: options.data.challengeId, response: registrationResponse(f, options.data.options.challenge, invalid)
    } })
    assert.equal(result.code, 1000)
    assert.equal(records.has(blob.passkeyCredentialKey(f.id)), false)
  }
})

test('Passkey verifies signed assertions for both current and legacy credential formats', async () => {
  for (const legacy of [false, true]) {
    const f = fixture(); seedCredential(f, legacy)
    const options = await authenticationOptions()
    const body = { action: 'verifyAuthentication', data: { challengeId: options.challengeId, response: assertionResponse(f, options.options.challenge) } }
    const result = await call(passkey, body)
    assert.equal(result.code, 0)
    assert.equal(result.data.token, env.ADMIN_TOKEN, 'return current token, not stale user.token')
    assert.equal(records.get(blob.passkeyCredentialKey(f.id)).counter, 1)
    assert.equal(records.get(blob.passkeyCredentialKey(f.id)).publicKeyFormat, 'cose')
    assert.equal((await call(passkey, body)).code, 1000, 'challenge cannot be replayed')
  }
})

test('Passkey rejects missing/invalid signatures, wrong origin/RP, no UV and stale signature counters', async () => {
  const f = fixture(); seedCredential(f)
  const mutations = [
    (response) => { delete response.response.signature },
    (response) => { response.response.signature = randomBytes(64).toString('base64url') },
    null, null, null, null
  ]
  const optionsOverrides = [{}, {}, { requestOrigin: 'https://other.example' }, { rp: 'other.example' }, { flags: 1 }, { count: 0 }]
  records.get(blob.passkeyCredentialKey(f.id)).counter = 1
  for (let i = 0; i < mutations.length; i++) {
    const options = await authenticationOptions()
    const response = assertionResponse(f, options.options.challenge, { count: 2, ...optionsOverrides[i] })
    mutations[i]?.(response)
    const result = await call(passkey, { action: 'verifyAuthentication', data: { challengeId: options.challengeId, response } })
    assert.equal(result.code, 1000)
    assert.equal(result.data?.token, undefined)
  }
})

test('Passkey management requires its own signed ceremony and grants only one token change', async () => {
  const f = fixture(); seedCredential(f)
  const login = await authenticationOptions()
  const wrongPurpose = await call(passkey, { action: 'generateManagementToken', data: {
    challengeId: login.challengeId, response: assertionResponse(f, login.options.challenge)
  } })
  assert.equal(wrongPurpose.code, 1000)
  const options = await authenticationOptions('management')
  const result = await call(passkey, { action: 'generateManagementToken', data: {
    challengeId: options.challengeId, response: assertionResponse(f, options.options.challenge)
  } })
  assert.equal(result.code, 0)
  const body = { managementToken: result.data.managementToken, newToken: randomUUID() }
  assert.equal((await call(auth, body)).code, 0)
  assert.equal((await call(auth, body)).code, 1000)
})

test('Passkey trusted origin is not derived from caller Origin/Referer', () => {
  const request = new Request(`${origin}/api/passkey`, { headers: { Origin: 'https://attacker.example', Referer: 'https://attacker.example' } })
  assert.equal(getPasskeyConfig(request, {}).origin, origin)
})

test('only one concurrent consumer can claim a transient authentication document', async () => {
  const key = blob.oidcStateKey(randomUUID())
  records.set(key, { expiresAt: Date.now() + 60000 })
  const results = await Promise.all(Array.from({ length: 12 }, () => blob.consumeTransientJson(store(), key)))
  assert.equal(results.filter(Boolean).length, 1)
})

test('an expired lock is never stolen from a still-running owner', async () => {
  let release, entered
  const gate = new Promise((resolve) => { release = resolve })
  const ready = new Promise((resolve) => { entered = resolve })
  const key = blob.legacyMigrationLockKey()
  const first = blob.withBlobLock(store(), key, async () => { entered(); await gate }, { ttlMs: 1 })
  await ready
  records.get(key).expiresAt = Date.now() - 1
  let secondEntered = false
  await assert.rejects(blob.withBlobLock(store(), key, async () => { secondEntered = true }, { maxAttempts: 2, retryMs: 1 }), /timeout/)
  assert.equal(secondEntered, false)
  release(); await first
  assert.equal(records.has(key), false)
})

test('business conflicts inside a lock are never retried as lock acquisition failures', async () => {
  let executions = 0
  await assert.rejects(blob.withBlobLock(store(), blob.legacyMigrationLockKey(), async () => {
    executions++; throw new PreconditionFailedError()
  }))
  assert.equal(executions, 1)
})

test('import validates before writes, preserves zero and leaves original data on write failure', async () => {
  const original = { items: { existing: { target: 'existing', time: 42 } }, version: '2.1' }
  records.set(blob.COUNTERS_DOC_KEY, structuredClone(original))
  for (const counters of [[], { bad: -1 }, { bad: '3junk' }, { bad: null }, { bad: { time: 2, updated_at: -1 } }]) {
    const result = await call(counter, { action: 'import_all', data: { counters } }, adminHeaders())
    assert.equal(result.code, 1000)
    assert.deepEqual(records.get(blob.COUNTERS_DOC_KEY), original)
  }
  assert.equal(writes.length, 0)
  const originalSet = Store.prototype.setJSON
  mock.method(Store.prototype, 'setJSON', async function (key, value, options) {
    if (key === blob.COUNTERS_DOC_KEY) throw new Error('Simulated write failure')
    return originalSet.call(this, key, value, options)
  })
  assert.equal((await call(counter, { action: 'import_all', data: { counters: { zero: 0 } } }, adminHeaders())).code, 1000)
  assert.deepEqual(records.get(blob.COUNTERS_DOC_KEY), original)
  assert.equal(deletes.includes(blob.COUNTERS_DOC_KEY), false)
  assert.equal(blob.validateCounterImport({ zero: 0 }).zero.time, 0)
})

test('list and summary share one counter read and keep top-k ordering', async () => {
  const items = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`page-${i}`, { target: `page-${i}`, time: i % 9, updated_at: i, created_at: 0 }]))
  records.set(blob.COUNTERS_DOC_KEY, { items })
  const result = await call(counter, { action: 'list', pageSize: 4, sortBy: 'count', includeSummary: true }, adminHeaders())
  assert.equal(result.code, 0)
  assert.equal(result.data.items.length, 4)
  assert.equal(reads.filter((key) => key === blob.COUNTERS_DOC_KEY).length, 1)
  const expected = Object.values(items).sort((a, b) => b.time - a.time || a.target.localeCompare(b.target)).slice(0, 8).map((item) => item.target)
  assert.deepEqual(result.data.summary.topPages.map((item) => item.target), expected)
  assert.deepEqual(result.data.summary.recentlyActive.map((item) => item.target), Array.from({ length: 8 }, (_, i) => `page-${39 - i}`))
})

test('legacy migration never clears unrelated OIDC/system documents', async () => {
  const preservedKey = blob.oidcStateKey(randomUUID())
  records.set(preservedKey, { sentinel: true })
  await importLegacyBundle(store(), env, { counters: { page: 1 }, system: {}, passkey: {} })
  assert.deepEqual(records.get(preservedKey), { sentinel: true })
  assert.equal(deletes.includes(blob.COUNTERS_DOC_KEY), false)
})

test('OIDC verifies signatures, required claims, nonce and authorized party', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const key = createLocalJWKSet({ keys: [await exportJWK(publicKey)] })
  const config = { OIDC_ISSUER: 'https://issuer.example', OIDC_CLIENT_ID: randomUUID() }
  const nonce = randomUUID()
  const base = { iss: config.OIDC_ISSUER, aud: config.OIDC_CLIENT_ID, sub: 'subject', nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 }
  const signed = (claims, signer = privateKey) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).sign(signer)
  assert.equal((await verifyOidcIdToken(await signed(base), config, nonce, {}, key)).sub, 'subject')
  for (const changed of [{ iss: 'https://other.example' }, { aud: 'other' }, { exp: 1 }, { nonce: 'other' }, { azp: 'other' }, { exp: undefined }, { nonce: undefined }, { aud: [config.OIDC_CLIENT_ID, 'other'] }]) {
    await assert.rejects(verifyOidcIdToken(await signed({ ...base, ...changed }), config, nonce, {}, key))
  }
  const other = await generateKeyPair('RS256')
  await assert.rejects(verifyOidcIdToken(await signed(base, other.privateKey), config, nonce, {}, key))
})

test('OIDC binding rejects tokens in URL and emits PKCE plus an HttpOnly browser cookie', async () => {
  env = { ...env, OIDC_ISSUER: 'https://bind-issuer.example', OIDC_CLIENT_ID: randomUUID(), OIDC_CLIENT_SECRET: randomUUID(), OIDC_REDIRECT_URI: `${origin}/api/oidc/callback` }
  mock.method(globalThis, 'fetch', async () => Response.json({ issuer: env.OIDC_ISSUER, authorization_endpoint: `${env.OIDC_ISSUER}/authorize`, token_endpoint: `${env.OIDC_ISSUER}/token`, jwks_uri: `${env.OIDC_ISSUER}/jwks` }))
  const forbidden = await oidcLogin({ env, request: new Request(`${origin}/api/oidc/login?mode=bind&token=${env.ADMIN_TOKEN}`) })
  assert.equal((await forbidden.json()).code, 1000)
  const response = await oidcLogin({ env, request: new Request(`${origin}/api/oidc/login`, {
    method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'bind' })
  }) })
  const payload = await response.json()
  assert.equal(payload.code, 0)
  const url = new URL(payload.data.authorizationUrl)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/)
  assert.equal(payload.data.authorizationUrl.includes(env.ADMIN_TOKEN), false)
  const pending = records.get(blob.oidcStateKey(url.searchParams.get('state')))
  assert.equal(hashOidcValue(pending.codeVerifier), url.searchParams.get('code_challenge'))
  assert.equal(pending.token, undefined)
  const rejected = await oidcCallback({ env, request: new Request(`${origin}/api/oidc/callback?state=${pending.state}&code=unused`) })
  assert.match(rejected.headers.get('location'), /oidc_error/)
  assert.equal(records.has(blob.oidcStateKey(pending.state)), true, 'wrong browser must not consume the legitimate flow')
})

test('OIDC sessions expire, bind to current identity/token and can be exchanged only once', async () => {
  env.OIDC_ISSUER = 'https://session-issuer.example'
  records.set(blob.SYSTEM_STATE_KEY, { oidc: { issuer: env.OIDC_ISSUER, sub: 'subject', boundAt: 1 } })
  const session = { issuer: env.OIDC_ISSUER, sub: 'subject', boundAt: 1, tokenHash: hashOidcValue(env.ADMIN_TOKEN), expiresAt: Date.now() + 60000 }
  const id = randomUUID(); records.set(blob.oidcSessionKey(id), session)
  const body = { action: 'oidc_verify', oidcSession: id }
  assert.equal((await call(auth, body)).data.token, env.ADMIN_TOKEN)
  assert.equal((await call(auth, body)).code, 1000)
  for (const changed of [{ expiresAt: 1 }, { issuer: 'https://other.example' }, { sub: 'other' }, { boundAt: 2 }, { tokenHash: randomUUID() }]) {
    const id = randomUUID(); records.set(blob.oidcSessionKey(id), { ...session, ...changed })
    assert.equal((await call(auth, { action: 'oidc_verify', oidcSession: id })).code, 1000)
  }
})

test('old unverified management grants are rejected after upgrading', async () => {
  const id = randomUUID()
  records.set(blob.passkeyManagementTokenKey(id), { userId: 'admin', expiresAt: Date.now() + 60000 })
  assert.equal((await call(auth, { managementToken: id, newToken: randomUUID() })).code, 1000)
})

test('OIDC bind and login complete through PKCE exchange and JWKS signature verification', async () => {
  const issuer = `https://${randomUUID()}.example`
  env = { ...env, OIDC_ISSUER: issuer, OIDC_CLIENT_ID: randomUUID(), OIDC_CLIENT_SECRET: randomUUID(), OIDC_REDIRECT_URI: `${origin}/api/oidc/callback` }
  const pair = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256' }
  let pending, tokenCalls = 0, discoveryCalls = 0
  mock.method(globalThis, 'fetch', async (url, options) => {
    const href = String(url)
    if (href.endsWith('/.well-known/openid-configuration')) {
      discoveryCalls++
      return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, token_endpoint_auth_methods_supported: ['client_secret_post'] })
    }
    if (href.endsWith('/jwks')) return Response.json({ keys: [jwk] })
    assert.equal(href, `${issuer}/token`)
    tokenCalls++
    const params = new URLSearchParams(options.body)
    assert.equal(params.get('code_verifier'), pending.codeVerifier)
    assert.equal(params.get('client_id'), env.OIDC_CLIENT_ID)
    assert.equal(params.get('client_secret'), env.OIDC_CLIENT_SECRET)
    const id_token = await new SignJWT({ sub: 'verified-subject', nonce: pending.nonce, name: '测试用户' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(env.OIDC_CLIENT_ID)
      .setIssuedAt().setExpirationTime('1m').sign(pair.privateKey)
    return Response.json({ id_token })
  })
  async function start(mode) {
    const request = mode === 'bind' ? new Request(`${origin}/api/oidc/login`, {
      method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ mode })
    }) : new Request(`${origin}/api/oidc/login?mode=login`)
    const result = await oidcLogin({ env, request })
    const url = new URL(mode === 'bind' ? (await result.json()).data.authorizationUrl : result.headers.get('location'))
    pending = records.get(blob.oidcStateKey(url.searchParams.get('state')))
    const cookie = result.headers.get('set-cookie').split(';')[0]
    return new Request(`${origin}/api/oidc/callback?state=${pending.state}&code=local-code`, { headers: { Cookie: cookie } })
  }
  const bindRequest = await start('bind')
  const bound = await oidcCallback({ env, request: bindRequest })
  assert.equal(new URL(bound.headers.get('location')).searchParams.get('oidc_bound'), 'true')
  assert.equal(records.get(blob.SYSTEM_STATE_KEY).oidc.name, '测试用户')
  const loginRequest = await start('login')
  const loggedIn = await oidcCallback({ env, request: loginRequest })
  const sessionId = new URL(loggedIn.headers.get('location')).searchParams.get('oidc_session')
  assert.ok(sessionId)
  assert.equal(records.get(blob.oidcSessionKey(sessionId)).effectiveToken, undefined)
  assert.equal((await call(auth, { action: 'oidc_verify', oidcSession: sessionId })).data.token, env.ADMIN_TOKEN)
  assert.equal(tokenCalls, 2)
  assert.equal(discoveryCalls, 1, 'reuse cached discovery between authorization and callback')
  await oidcCallback({ env, request: loginRequest })
  assert.equal(tokenCalls, 2, 'replayed state cannot exchange another code')
})

test('concurrent increment requests serialize without losing accepted counts', async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => call(counter, { action: 'inc', target: 'page' })))
  assert.ok(responses.every((result) => result.code === 0))
  assert.equal(records.get(blob.COUNTERS_DOC_KEY).items.page.time, 12)
  assert.deepEqual(responses.map((result) => result.data.time).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1))
})

test('successful import replaces counters, preserves timestamps and updates allowed domains', async () => {
  records.set(blob.COUNTERS_DOC_KEY, { items: { removed: { target: 'removed', time: 10 } } })
  const result = await call(counter, { action: 'import_all', data: {
    counters: { zero: 0, page: { time: '12', created_at: 0, updated_at: 10 } }, allowedDomains: [origin]
  } }, adminHeaders())
  assert.equal(result.code, 0)
  assert.equal(result.data.imported, 2)
  const items = records.get(blob.COUNTERS_DOC_KEY).items
  assert.equal(items.zero.time, 0)
  assert.equal(items.page.time, 12)
  assert.equal(items.page.created_at, 0)
  assert.equal(items.removed, undefined)
  assert.deepEqual(records.get(blob.SYSTEM_STATE_KEY).allowedDomains, [origin])
})

test('set and import reject invalid counts before any writes and accepted values round-trip through backup', async () => {
  const invalidValues = [-1, 1.5, '12junk', '1.5', '1e3', '', ' 12 ', true, null, {}, [], Number.MAX_SAFE_INTEGER + 1, '9007199254740992']
  for (const value of invalidValues) {
    assert.equal((await call(counter, { action: 'set', target: 'page', value }, adminHeaders())).code, 1000)
    assert.equal((await call(counter, { action: 'import_all', data: { counters: { page: value } } }, adminHeaders())).code, 1000)
  }
  assert.equal(writes.length, 0)
  for (const [target, value] of Object.entries({ zero: 0, numericString: '0012', maximum: Number.MAX_SAFE_INTEGER })) {
    assert.equal((await call(counter, { action: 'set', target, value }, adminHeaders())).code, 0)
  }
  const exported = await call(counter, { action: 'export_all' }, adminHeaders())
  assert.equal(exported.code, 0)
  assert.equal((await call(counter, { action: 'import_all', data: exported.data }, adminHeaders())).code, 0)
  const restored = await call(counter, { action: 'export_all' }, adminHeaders())
  assert.deepEqual(restored.data.counters, exported.data.counters)
  assert.equal(restored.data.counters.numericString.time, 12)
})

test('counter targets are validated across reads, writes, batch and import before storage mutation', async () => {
  const invalidTargets = [undefined, null, '', ' \t ', 1, true, {}, [], 'x'.repeat(2049)]
  for (const target of invalidTargets) {
    for (const action of ['inc', 'set', 'delete', 'get']) {
      const result = await call(counter, { action, target, value: 1 }, adminHeaders())
      assert.equal(result.code, 1000)
    }
    assert.equal((await call(counter, { action: 'batch_inc', requests: [{ target }] })).code, 1000)
  }
  for (const target of ['', ' \t ', 'x'.repeat(2049)]) {
    const request = new Request(`${origin}/api/counter?${new URLSearchParams({ target })}`)
    assert.equal((await (await counter({ env, request })).json()).code, 1000)
    const counters = { [target]: 1 }
    assert.equal((await call(counter, { action: 'import_all', data: { counters } }, adminHeaders())).code, 1000)
  }
  assert.equal(writes.length, 0)
  assert.equal(reads.includes(blob.COUNTERS_DOC_KEY), false)
  const target = 'x'.repeat(2048)
  assert.equal((await call(counter, { action: 'inc', target })).code, 0)
  const request = new Request(`${origin}/api/counter?${new URLSearchParams({ target })}`)
  const result = await (await counter({ env, request })).json()
  assert.equal(result.data.target, target)
  assert.equal(result.data.time, 1)
})

test('batch validates every item and its size before acquiring a lock', async () => {
  const invalidRequests = [null, {}, [null], [[]], [{}], [{ path: 12 }], [{ path: '/wrong/page' }],
    [{ target: 'valid' }, { target: '' }], [{ target: 1, path: '/classes/Counter/fallback' }],
    Array.from({ length: 101 }, () => ({ target: 'page' }))]
  for (const requests of invalidRequests) {
    assert.equal((await call(counter, { action: 'batch_inc', requests })).code, 1000)
  }
  assert.equal(writes.length, 0)
  assert.deepEqual((await call(counter, { action: 'batch_inc', requests: [] })).data, [])
  assert.equal(writes.length, 0, 'an empty batch does not acquire a lock')
  const requests = Array.from({ length: 100 }, (_, index) => index % 2
    ? { target: 'page' } : { path: '/1.1/classes/Counter/page' })
  const result = await call(counter, { action: 'batch_inc', requests })
  assert.equal(result.code, 0)
  assert.deepEqual(result.data.map((item) => item.time), Array.from({ length: 100 }, (_, index) => index + 1))
  assert.equal(writes.filter((key) => key === blob.COUNTERS_DOC_KEY).length, 1)
})

test('single and repeated batch increments reject overflow without committing partial counts', async () => {
  const original = { items: {
    page: { target: 'page', time: 10, created_at: 1, updated_at: 1 },
    maximum: { target: 'maximum', time: Number.MAX_SAFE_INTEGER, created_at: 1, updated_at: 1 },
    almost: { target: 'almost', time: Number.MAX_SAFE_INTEGER - 1, created_at: 1, updated_at: 1 }
  }, updatedAt: 1, version: '2.1' }
  records.set(blob.COUNTERS_DOC_KEY, structuredClone(original))
  for (const body of [
    { action: 'inc', target: 'maximum' },
    { action: 'batch_inc', requests: [{ target: 'page' }, { target: 'maximum' }] },
    { action: 'batch_inc', requests: [{ target: 'almost' }, { target: 'almost' }] }
  ]) {
    assert.equal((await call(counter, body)).code, 1000)
    assert.deepEqual(records.get(blob.COUNTERS_DOC_KEY), original)
  }
  assert.equal(writes.includes(blob.COUNTERS_DOC_KEY), false)
  assert.equal((await call(counter, { action: 'inc', target: 'almost' })).data.time, Number.MAX_SAFE_INTEGER)
})

test('prototype property names remain ordinary counter targets through every operation', async () => {
  const targets = ['__proto__', 'constructor', 'toString', 'hasOwnProperty']
  for (const target of targets) {
    assert.equal((await call(counter, { target })).data.time, 0, 'inherited properties are not counters')
  }
  const initial = await call(counter, { action: 'batch_inc', requests: targets.map((target) => ({ target })) })
  assert.deepEqual(initial.data.map((item) => item.time), [1, 1, 1, 1])
  assert.equal((await call(counter, { action: 'delete', target: '__proto__' }, adminHeaders())).code, 0)
  assert.equal((await call(counter, { action: 'inc', target: '__proto__' })).data.time, 1)
  const result = await call(counter, { action: 'batch_inc', requests: targets.flatMap((target) => [{ target }, { target }]) })
  assert.equal(result.code, 0)
  assert.deepEqual(result.data.map((item) => item.time), targets.flatMap(() => [2, 3]))
  assert.equal((await call(counter, { action: 'set', target: '__proto__', value: 5 }, adminHeaders())).data.time, 5)
  const exported = await call(counter, { action: 'export_all' }, adminHeaders())
  assert.deepEqual(Object.keys(exported.data.counters).sort(), targets.toSorted())
  assert.equal((await call(counter, { action: 'import_all', data: exported.data }, adminHeaders())).code, 0)
  const listed = await call(counter, { action: 'list', includeSummary: true }, adminHeaders())
  assert.equal(listed.code, 0)
  assert.equal(listed.data.total, 4)
  assert.equal(listed.data.summary.totalCounters, 4)
  for (const target of targets) {
    assert.equal(Object.hasOwn(records.get(blob.COUNTERS_DOC_KEY).items, target), true)
    assert.equal((await call(counter, { action: 'delete', target }, adminHeaders())).code, 0)
    assert.equal((await call(counter, { target })).data.time, 0)
  }
  assert.deepEqual(Object.keys(records.get(blob.COUNTERS_DOC_KEY).items), [])
})

test('domain configuration and imports use the same normalization and reject invalid entries without writes', async () => {
  const invalidDomains = [null, 'https://example.com', [null], [42], [''], ['example.com'], ['ftp://example.com'],
    [`https://user:${randomUUID()}@example.com`], ['https://@example.com'], ['https://example.com/path'], ['https://example.com/a/..'],
    ['https://example.com?'], ['https://example.com#'], ['https://*.example.com'], ['https://example.com\\evil'],
    ['*.example.com:443'], ['*.example.com/path'], ['*.*.example.com'], ['*.-example.com'], ['https://example.com', {}]]
  for (const allowedDomains of invalidDomains) {
    assert.equal((await call(counter, { action: 'set_config', allowedDomains }, adminHeaders())).code, 1000)
    assert.equal((await call(counter, { action: 'import_all', data: { counters: { page: 1 }, allowedDomains } }, adminHeaders())).code, 1000)
  }
  assert.equal(writes.length, 0)
  const allowedDomains = [' HTTPS://BLOG.Example.COM:443/ ', 'https://blog.example.com', ' *.Example.COM ', 'http://localhost:8080/', '*']
  const expected = ['https://blog.example.com', '*.example.com', 'http://localhost:8080', '*']
  const configured = await call(counter, { action: 'set_config', allowedDomains }, adminHeaders())
  assert.deepEqual(configured.data.allowedDomains, expected)
  assert.equal((await call(counter, { action: 'import_all', data: { counters: {}, allowedDomains } }, adminHeaders())).code, 0)
  assert.deepEqual(records.get(blob.SYSTEM_STATE_KEY).allowedDomains, expected)
})

test('wildcard origins match subdomains at a hostname boundary and preserve exact origin ports', async () => {
  const allowedDomains = ['*.example.com', 'https://exact.example.net:8443', 'http://localhost:8080']
  assert.equal((await call(counter, { action: 'set_config', allowedDomains }, adminHeaders())).code, 0)
  for (const Origin of ['https://blog.example.com', 'http://nested.blog.example.com:8080', 'https://exact.example.net:8443', 'http://localhost:8080']) {
    assert.equal((await call(counter, { action: 'inc', target: 'page' }, { Origin })).code, 0)
  }
  const writeCount = writes.length
  for (const Origin of ['https://example.com', 'https://evil-example.com', 'https://badexample.com', 'https://example.com.attacker.test',
    'https://exact.example.net', 'http://exact.example.net:8443', 'http://localhost:8081', 'null', 'https://blog.example.com/path']) {
    assert.equal((await call(counter, { action: 'inc', target: 'page' }, { Origin })).code, 1000)
    assert.equal((await call(counter, { action: 'batch_inc', requests: [{ target: 'page' }] }, { Origin })).code, 1000)
  }
  assert.equal(writes.length, writeCount)
  const noOrigin = new Request(`${origin}/api/counter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inc', target: 'page' })
  })
  assert.equal((await (await counter({ env, request: noOrigin })).json()).code, 0)
  for (const domains of [[], ['*']]) {
    assert.equal((await call(counter, { action: 'set_config', allowedDomains: domains }, adminHeaders())).code, 0)
    assert.equal((await call(counter, { action: 'inc', target: 'page' }, { Origin: 'https://other.example' })).code, 0)
  }
})

test('invalid legacy domains do not block valid entries or silently allow unmatched origins', async () => {
  const scenarios = [
    { domains: ['https://allowed.example', 'old-bad-entry'], allowed: ['https://allowed.example'], denied: ['https://evil-allowed.example'] },
    { domains: [null, '*.example.com', 'old-bad-entry'], allowed: ['https://blog.example.com'], denied: ['https://evil-example.com', 'https://example.com'] },
    { domains: ['old-bad-entry', '*'], allowed: ['https://any.example'], denied: [] },
    { domains: ['*', 'old-bad-entry'], allowed: ['https://any.example'], denied: [] },
    { domains: ['old-bad-entry', 42], allowed: [], denied: ['https://any.example'] }
  ]
  for (const { domains, allowed, denied } of scenarios) {
    const originalState = { allowedDomains: domains, updatedAt: 1 }
    records.set(blob.SYSTEM_STATE_KEY, structuredClone(originalState))
    for (const Origin of allowed) {
      assert.equal((await call(counter, { action: 'inc', target: 'page' }, { Origin })).code, 0)
    }
    const writeCount = writes.length
    for (const Origin of denied) {
      assert.equal((await call(counter, { action: 'inc', target: 'page' }, { Origin })).code, 1000)
    }
    assert.equal(writes.length, writeCount)
    assert.deepEqual(records.get(blob.SYSTEM_STATE_KEY), originalState)
  }
  assert.equal(writes.includes(blob.SYSTEM_STATE_KEY), false)
})
