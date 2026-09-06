import {
  consumeTransientJson,
  createOpenKounterStore,
  deleteJson,
  loadSystemState,
  passkeyManagementTokenKey,
  readJson
} from './_blobStore.js'

export const RES_CODE = {
  SUCCESS: 0,
  FAIL: 1000,
  NOT_FOUND: 1404
}

export function createStore(context) {
  return createOpenKounterStore(context.env)
}

export function getCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*'
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-LC-Id, X-LC-Key',
    'Access-Control-Max-Age': '600'
  }
}

export function optionsResponse(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  })
}

export function jsonResponse(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: getCorsHeaders(request)
  })
}

export function successResponse(request, data) {
  return jsonResponse(request, {
    code: RES_CODE.SUCCESS,
    data
  })
}

export function failResponse(request, message, code = RES_CODE.FAIL, status = 200) {
  return jsonResponse(request, {
    code,
    message
  }, status)
}

export async function requireAuth(request, store, env) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized')
  }

  const token = authHeader.slice(7)
  const { state, isAdminToken } = await validateTokenValue(token, store, env)

  return {
    token,
    state,
    isAdminToken
  }
}

export async function validateTokenValue(token, store, env) {
  const state = await loadSystemState(store)

  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) {
    return {
      state,
      isAdminToken: true
    }
  }

  if (state.token && token === state.token) {
    return {
      state,
      isAdminToken: false
    }
  }

  throw new Error('Unauthorized')
}

export async function getEffectiveToken(store, env) {
  const state = await loadSystemState(store)
  return env.ADMIN_TOKEN || state.token || null
}

export async function loadManagementToken(store, tokenId) {
  const key = passkeyManagementTokenKey(tokenId)
  const value = await readJson(store, key)
  if (!value) {
    return null
  }

  if (value.expiresAt && value.expiresAt <= Date.now()) {
    await deleteJson(store, key)
    return null
  }

  return value
}

export async function consumeManagementToken(store, tokenId) {
  const value = await consumeTransientJson(store, passkeyManagementTokenKey(tokenId))
  return value?.verificationVersion === 1 ? value : null
}