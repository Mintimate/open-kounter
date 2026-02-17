import express from 'express'

const RES_CODE = { SUCCESS: 0, FAIL: 1000 }

export function createInitRouter(storage) {
  const router = express.Router()

  router.post('/', async (req, res) => {
    try {
      const { token } = req.body
      
      if (!token) {
        return res.json({ code: RES_CODE.FAIL, message: 'Token is required' })
      }

      // Check if already initialized
      const existingToken = await storage.get('system:token')
      if (existingToken) {
        return res.json({ code: RES_CODE.FAIL, message: 'System already initialized' })
      }

      // Initialize system with token
      await storage.put('system:token', token)
      
      res.json({ 
        code: RES_CODE.SUCCESS, 
        message: 'System initialized successfully' 
      })
    } catch (e) {
      res.json({ code: RES_CODE.FAIL, message: e.message })
    }
  })

  return router
}
