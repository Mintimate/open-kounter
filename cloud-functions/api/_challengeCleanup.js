import {
  challengeCleanupStateKey,
  deleteJson,
  getStoragePrefixes,
  legacyMigrationLockKey,
  listPrefixedKeysPage,
  readJson,
  withBlobLock,
  writeJson
} from './_blobStore.js'

const CLEANUP_BUDGET_MS = 10000
const EXPIRY_MARGIN_MS = 60000
const MAX_BATCH_SIZE = 100

export async function cleanupExpiredChallenges(store) {
  return withBlobLock(store, legacyMigrationLockKey(), async () => {
    const deadline = Date.now() + CLEANUP_BUDGET_MS
    const expiredBefore = Date.now() - EXPIRY_MARGIN_MS
    const prefix = getStoragePrefixes().passkeyChallenges
    const stateKey = challengeCleanupStateKey()
    const state = await readJson(store, stateKey)
    const checkpoint = {
      page: typeof state?.cursor?.page === 'string' ? state.cursor.page : '',
      afterKey: typeof state?.cursor?.afterKey === 'string' && state.cursor.afterKey.startsWith(prefix)
        ? state.cursor.afterKey : ''
    }
    const result = { scanned: 0, deleted: 0, skipped: 0, failed: 0, hasMore: true }
    if (Date.now() >= deadline) return result

    const page = await listPrefixedKeysPage(store, prefix, checkpoint.page)
    const entries = (page.blobs || []).slice(0, MAX_BATCH_SIZE)
    let interrupted = false
    for (const { key } of entries) {
      if (typeof key !== 'string' || !key.startsWith(prefix)) {
        result.skipped++
        continue
      }
      // The SDK cursor is opaque and is not interchangeable with a returned key.
      if (key <= checkpoint.afterKey) continue
      if (Date.now() >= deadline) {
        interrupted = true
        break
      }

      let challenge
      result.scanned++
      try {
        challenge = await readJson(store, key)
      } catch (error) {
        result.failed++
        if (error instanceof SyntaxError) {
          // A malformed document is retained and revisited after the scan wraps.
          checkpoint.afterKey = key
          continue
        }
        interrupted = true
        break
      }

      if (Number.isFinite(challenge?.expiresAt) && challenge.expiresAt <= expiredBefore) {
        if (Date.now() >= deadline) {
          interrupted = true
          break
        }
        try {
          await deleteJson(store, key)
          result.deleted++
        } catch {
          result.failed++
          interrupted = true
          break
        }
      } else {
        result.skipped++
      }
      checkpoint.afterKey = key
    }

    const partialPage = interrupted || (page.blobs || []).length > entries.length
    const nextCursor = partialPage ? checkpoint
      : page.cursor ? { page: page.cursor, afterKey: '' } : null
    result.hasMore = nextCursor !== null
    // Finish in-flight work and persist progress before releasing the shared lock.
    await writeJson(store, stateKey, { cursor: nextCursor, updatedAt: Date.now() })
    return result
  }, { maxAttempts: 1 })
}
