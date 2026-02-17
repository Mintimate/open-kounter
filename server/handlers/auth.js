import express from 'express'

const RES_CODE = { SUCCESS: 0, FAIL: 1000 }

export function createAuthRouter(storage) {
  const router = express.Router()

  router.post('/', async (req, res) => {
    try {
      const { action, token, newToken, managementToken } = req.body
      const hasAdminToken = !!process.env.ADMIN_TOKEN

      async function getEffectiveToken() {
        if (hasAdminToken) return process.env.ADMIN_TOKEN
        return await storage.get('system:token')
      }

      // get_status: return system status info (no auth required)
      if (action === 'get_status') {
        const storedToken = await storage.get('system:token')
        return res.json({
          code: RES_CODE.SUCCESS,
          data: {
            hasAdminToken: !!hasAdminToken,
            initialized: !!storedToken
          }
        })
      }

      const effectiveToken = await getEffectiveToken()
      
      if (!effectiveToken) {
        return res.json({ code: RES_CODE.FAIL, message: 'Not initialized' })
      }

      if (action === 'syncAdminToken') {
        if (!hasAdminToken) {
          return res.json({ code: RES_CODE.FAIL, message: 'ADMIN_TOKEN not configured' })
        }
        if (!token || token !== process.env.ADMIN_TOKEN) {
          return res.json({ code: RES_CODE.FAIL, message: 'Invalid ADMIN_TOKEN' })
        }
        await storage.put('system:token', process.env.ADMIN_TOKEN)
        return res.json({ code: RES_CODE.SUCCESS, message: 'KV token synced with ADMIN_TOKEN' })
      }

      let authorized = false
      let mgmtTokenKey = null

      // Verify token
      if (token && (token === effectiveToken || (hasAdminToken && token === process.env.ADMIN_TOKEN))) {
        authorized = true
      }
      // Verify Management Token (Passkey)
      else if (managementToken) {
        mgmtTokenKey = `passkey:mgmt_token:${managementToken}`
        const mgmtDataStr = await storage.get(mgmtTokenKey)
        if (mgmtDataStr) {
          authorized = true
        }
      }

      if (authorized) {
        if (newToken) {
          await storage.put('system:token', newToken)
          
          // Delete managementToken to prevent replay
          if (mgmtTokenKey) {
            await storage.delete(mgmtTokenKey)
          }

          return res.json({ code: RES_CODE.SUCCESS, message: 'Token updated' })
        }

        return res.json({ code: RES_CODE.SUCCESS, data: { authorized: true } })
      } else {
        return res.json({ code: RES_CODE.FAIL, message: 'Invalid token or unauthorized' })
      }
    } catch (e) {
      res.json({ code: RES_CODE.FAIL, message: e.message })
    }
  })

  return router
}
