import { createStore, failResponse, optionsResponse, requireAuth, successResponse } from '../_api.js'
import { cleanupExpiredChallenges } from '../_challengeCleanup.js'

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse(request)
  if (request.method !== 'POST') return failResponse(request, 'Method not allowed')
  let authorized = false
  try {
    const store = createStore({ env })
    await requireAuth(request, store, env)
    authorized = true
    return successResponse(request, await cleanupExpiredChallenges(store))
  } catch {
    return failResponse(request, authorized ? 'Challenge cleanup failed' : 'Unauthorized')
  }
}
