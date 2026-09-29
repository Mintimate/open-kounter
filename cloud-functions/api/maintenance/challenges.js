import { createStore, failResponse, optionsResponse, requireAuth, successResponse } from '../_api.js'
import { cleanupExpiredChallenges } from '../_challengeCleanup.js'
import { validateScheduledCleanupToken } from '../_scheduledCleanupAuth.js'

const MAX_SCHEDULE_PAYLOAD_BYTES = 1024

function getBodyStream(request) {
  // Makers shadows Request.body with parsed JSON; read the native prototype getter.
  for (let prototype = Object.getPrototypeOf(request); prototype; prototype = Object.getPrototypeOf(prototype)) {
    const getter = Object.getOwnPropertyDescriptor(prototype, 'body')?.get
    if (getter) return getter.call(request)
  }
  return request.body
}

async function readCleanupToken(request) {
  const body = getBodyStream(request)
  if (!body || Number(request.headers.get('Content-Length')) > MAX_SCHEDULE_PAYLOAD_BYTES) {
    throw new Error('Invalid cleanup payload')
  }
  const reader = body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_SCHEDULE_PAYLOAD_BYTES) {
        await reader.cancel()
        throw new Error('Invalid cleanup payload')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid cleanup payload')
  return payload.cleanupToken
}

function logCleanup(result) {
  console.info(JSON.stringify({ event: 'passkey_challenge_cleanup', ...result }))
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse(request)
  if (request.method !== 'POST') return failResponse(request, 'Method not allowed')
  let authorized = false
  let scheduled = false
  try {
    let store
    if (request.headers.has('Authorization')) {
      store = createStore({ env })
      await requireAuth(request, store, env)
    } else {
      const token = await readCleanupToken(request)
      if (!validateScheduledCleanupToken(token, env)) throw new Error('Unauthorized')
      scheduled = true
    }
    authorized = true
    store ||= createStore({ env })
    const result = await cleanupExpiredChallenges(store)
    if (scheduled) logCleanup(result)
    return successResponse(request, result)
  } catch {
    if (scheduled) logCleanup({ failed: 1, hasMore: true, status: 'error' })
    return failResponse(request, authorized ? 'Challenge cleanup failed' : 'Unauthorized')
  }
}
