import { createHmac, timingSafeEqual } from 'node:crypto'

const CLEANUP_SCOPE = 'open-kounter:maintenance:passkey-challenges:v1'

export function createScheduledCleanupToken(secret) {
  if (typeof secret !== 'string' || secret.length < 32) return null
  return createHmac('sha256', secret).update(CLEANUP_SCOPE).digest('base64url')
}

export function validateScheduledCleanupToken(token, env) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  const expected = createScheduledCleanupToken(env?.OPEN_KOUNTER_CLEANUP_SECRET)
  return expected !== null && timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}
