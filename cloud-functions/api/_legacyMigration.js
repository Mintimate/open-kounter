import {
  deleteJson,
  getStoragePrefixes,
  legacyMigrationLockKey,
  loadSystemState,
  normalizeSystemState,
  passkeyChallengeKey,
  passkeyCredentialKey,
  passkeyManagementTokenKey,
  passkeyUserKey,
  replaceAllCounterRecords,
  saveSystemState,
  validateCounterImport,
  withBlobLock,
  writeJson
} from './_blobStore.js'

const LEGACY_CHALLENGE_TTL_MS = 5 * 60 * 1000
const LEGACY_MANAGEMENT_TOKEN_TTL_MS = 5 * 60 * 1000

export async function migrateFromLegacy(request, env, store, token) {
  const bundle = await fetchLegacyBundle(request, token)
  return importLegacyBundle(store, env, bundle)
}

export async function fetchLegacyBundle(request, token) {
  const url = new URL(request.url)
  const response = await fetch(`${url.origin}/legacy-api/migrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'export_all',
      token
    })
  })

  const rawBody = await response.text()
  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    throw new Error(rawBody || `Legacy migration request failed with status ${response.status}`)
  }

  if (payload.code !== 0) {
    throw new Error(payload.message || rawBody || 'Legacy migration failed')
  }

  return payload.data
}

export async function importLegacyBundle(store, env, bundle) {
  validateCounterImport(bundle?.counters)
  return withBlobLock(store, legacyMigrationLockKey(), async () => {
    const prefixes = getStoragePrefixes()
    const [deletedUsers, deletedCredentials, deletedChallenges, deletedManagementTokens] = await Promise.all([
      deletePrefix(store, prefixes.passkeyUsers),
      deletePrefix(store, prefixes.passkeyCredentials),
      deletePrefix(store, prefixes.passkeyChallenges),
      deletePrefix(store, prefixes.passkeyManagementTokens)
    ])

    const counters = bundle?.counters && typeof bundle.counters === 'object' ? bundle.counters : {}
    const passkey = bundle?.passkey && typeof bundle.passkey === 'object' ? bundle.passkey : {}
    const users = passkey.users && typeof passkey.users === 'object' ? passkey.users : {}
    const credentials = passkey.credentials && typeof passkey.credentials === 'object' ? passkey.credentials : {}
    const challenges = passkey.challenges && typeof passkey.challenges === 'object' ? passkey.challenges : {}
    const managementTokens = passkey.managementTokens && typeof passkey.managementTokens === 'object' ? passkey.managementTokens : {}

    const now = Date.now()
    const currentState = await loadSystemState(store)
    const nextState = normalizeSystemState({
      ...currentState,
      token: env.ADMIN_TOKEN || bundle?.system?.token || currentState.token || null,
      allowedDomains: Array.isArray(bundle?.system?.allowedDomains) ? bundle.system.allowedDomains : [],
      initializedAt: currentState.initializedAt || now,
      updatedAt: now,
      version: '2.0'
    })

    await saveSystemState(store, nextState)

    await replaceAllCounterRecords(store, counters)

    await Promise.all(Object.entries(users).map(([userId, value]) => writeJson(store, passkeyUserKey(userId), value)))
    await Promise.all(Object.entries(credentials).map(([credentialId, value]) => writeJson(store, passkeyCredentialKey(credentialId), value)))

    let importedChallenges = 0
    for (const [challengeId, value] of Object.entries(challenges)) {
      const expiresAt = Number(value?.expiresAt) || ((Number(value?.createdAt) || now) + LEGACY_CHALLENGE_TTL_MS)
      if (expiresAt > now) {
        await writeJson(store, passkeyChallengeKey(challengeId), {
          ...value,
          expiresAt
        })
        importedChallenges++
      }
    }

    let importedManagementTokens = 0
    for (const [tokenId, value] of Object.entries(managementTokens)) {
      const expiresAt = Number(value?.expiresAt) || ((Number(value?.createdAt) || now) + LEGACY_MANAGEMENT_TOKEN_TTL_MS)
      if (expiresAt > now) {
        await writeJson(store, passkeyManagementTokenKey(tokenId), {
          ...value,
          expiresAt
        })
        importedManagementTokens++
      }
    }

    return {
      migrated: true,
      importedCounters: Object.keys(counters).length,
      importedUsers: Object.keys(users).length,
      importedCredentials: Object.keys(credentials).length,
      importedChallenges,
      importedManagementTokens,
      deletedCounters: 0,
      deletedUsers,
      deletedCredentials,
      deletedChallenges,
      deletedManagementTokens
    }
  })
}

async function deletePrefix(store, prefix) {
  if (!prefix) throw new Error('Missing migration cleanup prefix')
  const result = await store.list({ prefix, consistency: 'strong' })
  const blobs = result.blobs || []
  await Promise.all(blobs.map(({ key }) => deleteJson(store, key)))
  return blobs.length
}