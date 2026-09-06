import {
    consumeManagementToken,
    createStore,
    jsonResponse,
    optionsResponse,
    RES_CODE
} from './_api.js'
import {
    consumeTransientJson,
    loadSystemState,
    oidcSessionKey,
    updateSystemState
} from './_blobStore.js'

import { hashOidcValue } from './_oidc.js'

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return optionsResponse(request)
  }

  const store = createStore(context)

  try {
    if (request.method !== 'POST') {
      throw new Error('Method not allowed')
    }

    const body = await request.json()
    const { action, token, newToken, managementToken, oidcSession } = body
    if (newToken !== undefined && (typeof newToken !== 'string' || !newToken)) throw new Error('Invalid new token')
    const state = await loadSystemState(store)
    const effectiveToken = env.ADMIN_TOKEN || state.token || null

    if (action === 'get_status') {
      const hasOidcConfig = !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_REDIRECT_URI)
      const oidcBound = !!(state.oidc && state.oidc.sub)

      return jsonResponse(request, {
        code: RES_CODE.SUCCESS,
        data: {
          hasAdminToken: !!env.ADMIN_TOKEN,
          initialized: !!effectiveToken,
          // OIDC 登录按钮仅在配置完整且已绑定时显示
          oidcLoginEnabled: hasOidcConfig && oidcBound && state.oidc.issuer === env.OIDC_ISSUER
        }
      })
    }

    if (!effectiveToken) {
      return jsonResponse(request, {
        code: RES_CODE.FAIL,
        message: 'Not initialized'
      })
    }

    // OIDC session 验证
    if (action === 'oidc_verify' && oidcSession) {
      const sessionData = await consumeTransientJson(store, oidcSessionKey(oidcSession))
      if (!sessionData || sessionData.issuer !== env.OIDC_ISSUER
        || sessionData.issuer !== state.oidc?.issuer || sessionData.sub !== state.oidc?.sub
        || sessionData.boundAt !== state.oidc?.boundAt
        || sessionData.tokenHash !== hashOidcValue(effectiveToken)) {
        throw new Error('Invalid or expired OIDC session')
      }
      return jsonResponse(request, {
        code: RES_CODE.SUCCESS,
        data: { authorized: true, token: effectiveToken }
      })
    }

    if (action === 'syncAdminToken') {
      if (!env.ADMIN_TOKEN) {
        return jsonResponse(request, {
          code: RES_CODE.FAIL,
          message: 'ADMIN_TOKEN not configured'
        })
      }

      if (!token || token !== env.ADMIN_TOKEN) {
        return jsonResponse(request, {
          code: RES_CODE.FAIL,
          message: 'Invalid ADMIN_TOKEN'
        })
      }

      await updateSystemState(store, (current) => ({
        ...current,
        token: env.ADMIN_TOKEN,
        initializedAt: current.initializedAt || Date.now(),
        updatedAt: Date.now()
      }))

      return jsonResponse(request, {
        code: RES_CODE.SUCCESS,
        message: 'Blob token synced with ADMIN_TOKEN'
      })
    }

    let authorized = false

    if (token && (token === effectiveToken || (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN))) {
      authorized = true
    } else if (managementToken && newToken) {
      const managementData = await consumeManagementToken(store, managementToken)
      if (managementData) {
        authorized = true
      }
    }

    if (!authorized) {
      return jsonResponse(request, {
        code: RES_CODE.FAIL,
        message: 'Invalid token or unauthorized'
      })
    }

    if (newToken) {
      await updateSystemState(store, (current) => ({
        ...current,
        token: newToken,
        initializedAt: current.initializedAt || Date.now(),
        updatedAt: Date.now()
      }))

      return jsonResponse(request, {
        code: RES_CODE.SUCCESS,
        message: 'Token updated'
      })
    }

    return jsonResponse(request, {
      code: RES_CODE.SUCCESS,
      data: {
        authorized: true,
        initialized: !!state.token || !!env.ADMIN_TOKEN
      }
    })
  } catch (error) {
    return jsonResponse(request, {
      code: RES_CODE.FAIL,
      message: error.message
    })
  }
}

export default { onRequest }
