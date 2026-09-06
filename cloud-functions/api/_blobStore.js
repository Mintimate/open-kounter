import { getStore, PreconditionFailedError } from '@edgeone/pages-blob'

const DEFAULT_STORE_NAME = 'open-kounter'
const STRONG_CONSISTENCY = 'strong'
const SYSTEM_STATE_KEY = 'system/state.json'
const COUNTERS_DOC_KEY = 'system/counters.json'
const PASSKEY_USERS_PREFIX = 'passkey/users/'
const PASSKEY_CREDENTIALS_PREFIX = 'passkey/credentials/'
const PASSKEY_CHALLENGES_PREFIX = 'passkey/challenges/'
const PASSKEY_MANAGEMENT_TOKENS_PREFIX = 'passkey/management-tokens/'
const LOCKS_PREFIX = 'locks/'
const DEFAULT_LOCK_TTL_MS = 5000
const DEFAULT_LOCK_ATTEMPTS = 20
const DEFAULT_LOCK_RETRY_MS = 40

export function createOpenKounterStore(env) {
  return getStore({
    name: env?.OPEN_KOUNTER_BLOB_STORE || env?.BLOB_STORE_NAME || DEFAULT_STORE_NAME,
    consistency: STRONG_CONSISTENCY
  })
}

export function createEmptySystemState() {
  return {
    token: null,
    allowedDomains: [],
    initializedAt: 0,
    updatedAt: 0,
    version: '2.0'
  }
}

export function normalizeSystemState(state) {
  const normalized = {
    ...createEmptySystemState(),
    ...(state || {})
  }

  if (!Array.isArray(normalized.allowedDomains)) {
    normalized.allowedDomains = []
  }

  if (!normalized.token) {
    normalized.initializedAt = 0
  }

  return normalized
}

export async function readJson(store, key) {
  const value = await store.get(key, { type: 'json', consistency: STRONG_CONSISTENCY })
  return value || null
}

export async function writeJson(store, key, value, options) {
  await store.setJSON(key, value, options)
}

export async function deleteJson(store, key) {
  await store.delete(key)
}

export async function loadSystemState(store) {
  const state = await readJson(store, SYSTEM_STATE_KEY)
  return normalizeSystemState(state)
}

export async function saveSystemState(store, state) {
  const normalized = normalizeSystemState(state)
  await writeJson(store, SYSTEM_STATE_KEY, normalized)
  return normalized
}

export async function updateSystemState(store, updater) {
  return withBlobLock(store, `${LOCKS_PREFIX}system-state.json`, async () => {
    const current = await loadSystemState(store)
    const next = normalizeSystemState(await updater(current))
    await saveSystemState(store, next)
    return next
  })
}

export function createEmptyCountersDocument() {
  return {
    items: {},
    updatedAt: 0,
    version: '2.1'
  }
}

export function normalizeCountersDocument(document) {
  const normalized = {
    ...createEmptyCountersDocument(),
    ...(document || {})
  }

  const items = normalized.items && typeof normalized.items === 'object' ? normalized.items : {}
  normalized.items = Object.fromEntries(
    Object.entries(items)
      .map(([target, value]) => [target, normalizeCounterRecord(target, value)])
      .filter(([, value]) => value)
  )
  normalized.updatedAt = Number(normalized.updatedAt) || 0
  normalized.version = normalized.version || '2.1'

  return normalized
}

export async function loadCountersDocument(store) {
  const existing = await readJson(store, COUNTERS_DOC_KEY)
  if (existing) {
    return normalizeCountersDocument(existing)
  }

  return createEmptyCountersDocument()
}

export async function saveCountersDocument(store, document) {
  const normalized = normalizeCountersDocument(document)
  await writeJson(store, COUNTERS_DOC_KEY, normalized)
  return normalized
}

export async function updateCountersDocument(store, updater) {
  return withBlobLock(store, `${LOCKS_PREFIX}counters-document.json`, async () => {
    const current = normalizeCountersDocument((await readJson(store, COUNTERS_DOC_KEY)) || createEmptyCountersDocument())
    return saveCountersDocument(store, await updater(current))
  })
}

export function passkeyUserKey(userId) {
  return `${PASSKEY_USERS_PREFIX}${encodeKeySegment(userId)}.json`
}

export function passkeyUserLockKey(userId) {
  return `${LOCKS_PREFIX}passkey/users/${encodeKeySegment(userId)}.json`
}

export function passkeyCredentialKey(credentialId) {
  return `${PASSKEY_CREDENTIALS_PREFIX}${encodeKeySegment(credentialId)}.json`
}

export function passkeyChallengeKey(challengeId) {
  return `${PASSKEY_CHALLENGES_PREFIX}${encodeKeySegment(challengeId)}.json`
}

export function passkeyManagementTokenKey(tokenId) {
  return `${PASSKEY_MANAGEMENT_TOKENS_PREFIX}${encodeKeySegment(tokenId)}.json`
}

export function oidcStateKey(id) {
  return `oidc/states/${encodeKeySegment(id)}.json`
}

export function oidcSessionKey(id) {
  return `oidc/sessions/${encodeKeySegment(id)}.json`
}

export function consumedDocumentKey(key) {
  return `auth/consumed/${encodeKeySegment(key)}`
}

export function legacyMigrationLockKey() {
  return `${LOCKS_PREFIX}legacy-migration.json`
}

// onlyIfNew elects exactly one consumer; read-then-delete alone is not atomic.
// Receipts must not be removed while a request that read the original can still run.
export async function consumeTransientJson(store, key) {
  const value = await readJson(store, key)
  if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null
  try {
    await writeJson(store, consumedDocumentKey(key), {
      expiresAt: value.expiresAt,
      consumedAt: Date.now()
    }, { onlyIfNew: true })
  } catch (error) {
    if (error instanceof PreconditionFailedError) return null
    throw error
  }
  await deleteJson(store, key)
  return value.expiresAt > Date.now() ? value : null
}

export async function getCounterRecord(store, target) {
  const document = await loadCountersDocument(store)
  return document.items[target] || null
}

export async function setCounterRecord(store, target, value) {
  return updateCounterRecord(store, target, () => value)
}

export async function deleteCounterRecord(store, target) {
  await updateCountersDocument(store, (current) => {
    const next = {
      ...current,
      items: { ...current.items },
      updatedAt: Date.now()
    }
    delete next.items[target]
    return next
  })
}

export async function updateCounterRecord(store, target, updater) {
  return updateCountersDocument(store, (current) => {
    const currentRecord = current.items[target] || null
    const nextRecord = normalizeCounterRecord(target, updater(currentRecord))
    const next = {
      ...current,
      items: {
        ...current.items
      },
      updatedAt: Date.now()
    }

    if (nextRecord) {
      next.items[target] = nextRecord
    } else {
      delete next.items[target]
    }

    return next
  }).then((document) => document.items[target] || null)
}

// Validate the whole replacement before acquiring a lock or writing anything.
export function validateCounterImport(counters) {
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) {
    throw new Error('counters must be an object')
  }
  const now = Date.now()
  return Object.fromEntries(Object.entries(counters).map(([target, raw]) => {
    if (!target || target.length > 2048) throw new Error('Invalid counter target')
    const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
    const value = record ? record.time : raw
    const count = typeof value === 'number' ? value
      : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid counter value')
    const timestamps = {}
    for (const field of ['created_at', 'updated_at']) {
      const value = record?.[field] ?? now
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid counter timestamp')
      timestamps[field] = value
    }
    return [target, { target, time: count, ...timestamps }]
  }))
}

export async function replaceAllCounterRecords(store, counters) {
  const items = validateCounterImport(counters)

  const document = await updateCountersDocument(store, () => ({
    items,
    updatedAt: Date.now(),
    version: '2.1'
  }))

  return Object.keys(document.items).length
}

export async function listCounterTargets(store) {
  const document = await loadCountersDocument(store)
  return Object.keys(document.items)
}

export async function listCounterRecords(store) {
  const document = await loadCountersDocument(store)
  return Object.values(document.items)
}

export async function listPrefixedJson(store, prefix) {
  const result = await store.list({ prefix, consistency: STRONG_CONSISTENCY })
  const entries = await Promise.all((result.blobs || []).map(async ({ key }) => [key, await readJson(store, key)]))
  return entries.filter(([, value]) => value)
}

export async function purgeExpiredDocument(store, key, expiresAt) {
  if (expiresAt && expiresAt <= Date.now()) {
    await deleteJson(store, key)
    return true
  }
  return false
}

export async function withBlobLock(store, lockKey, fn, options = {}) {
  const ttlMs = options.ttlMs || DEFAULT_LOCK_TTL_MS
  const retryMs = options.retryMs || DEFAULT_LOCK_RETRY_MS
  const maxAttempts = options.maxAttempts || DEFAULT_LOCK_ATTEMPTS
  const requestId = generateRequestId()

  let acquired = false
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await writeJson(store, lockKey, {
        requestId,
        expiresAt: Date.now() + ttlMs,
        createdAt: Date.now()
      }, { onlyIfNew: true })
      acquired = true
      break
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error
      // Expiry does not fence an old writer. Never steal/delete another owner's
      // lock; an orphan requires recovery after all in-flight writers are stopped.
      await sleep(retryMs + Math.floor(Math.random() * retryMs))
    }
  }
  if (acquired) {
    try {
      return await fn()
    } finally {
      const activeLock = await readJson(store, lockKey)
      if (activeLock?.requestId === requestId) await deleteJson(store, lockKey)
    }
  }

  throw new Error(`Blob lock timeout: ${lockKey}`)
}

export function normalizeCounterRecord(target, data) {
  if (!data) {
    return null
  }

  if (typeof data === 'number') {
    return {
      target,
      time: Number(data) || 0,
      created_at: 0,
      updated_at: 0
    }
  }

  if (typeof data === 'string') {
    const count = Number.parseInt(data, 10)
    return {
      target,
      time: Number.isNaN(count) ? 0 : count,
      created_at: 0,
      updated_at: 0
    }
  }

  return {
    target,
    time: Number.parseInt(data.time, 10) || 0,
    created_at: Number(data.created_at) || 0,
    updated_at: Number(data.updated_at) || 0
  }
}

export function encodeKeySegment(value) {
  return encodeURIComponent(String(value))
}

export function decodeKeySegment(value) {
  return decodeURIComponent(value)
}

export function getStoragePrefixes() {
  return {
    countersDocument: COUNTERS_DOC_KEY,
    passkeyUsers: PASSKEY_USERS_PREFIX,
    passkeyCredentials: PASSKEY_CREDENTIALS_PREFIX,
    passkeyChallenges: PASSKEY_CHALLENGES_PREFIX,
    passkeyManagementTokens: PASSKEY_MANAGEMENT_TOKENS_PREFIX
  }
}

function generateRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export { COUNTERS_DOC_KEY, SYSTEM_STATE_KEY }
