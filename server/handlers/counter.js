import express from 'express'

const RES_CODE = { SUCCESS: 0, FAIL: 1000 }

export function createCounterRouter(storage) {
  const router = express.Router()

  // Helper functions
  async function checkAuth(req) {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized')
    }
    const token = authHeader.split(' ')[1]
    
    // If ADMIN_TOKEN is set, always accept it
    const hasAdminToken = process.env.ADMIN_TOKEN
    if (hasAdminToken && token === process.env.ADMIN_TOKEN) {
      return
    }
    
    // Check against storage token
    const storedToken = await storage.get('system:token')
    
    if (!storedToken) {
      throw new Error('System not initialized or Unauthorized')
    }

    if (token !== storedToken) {
      throw new Error('Unauthorized')
    }
  }

  async function getCounterData(target) {
    const val = await storage.get(`counter:${target}`)
    if (!val) return null
    try {
      const data = JSON.parse(val)
      if (typeof data === 'object' && data !== null && 'time' in data) {
        return data
      }
      // Legacy: plain number stored as string
      return { time: parseInt(val), created_at: 0, updated_at: 0 }
    } catch {
      return { time: parseInt(val || '0'), created_at: 0, updated_at: 0 }
    }
  }

  async function getCount(target) {
    const data = await getCounterData(target)
    return data ? data.time : 0
  }

  async function incrementCount(target) {
    const key = `counter:${target}`
    const oldData = await getCounterData(target)
    
    const current = oldData ? oldData.time : 0
    const next = current + 1
    const now = Date.now()
    
    const newData = {
      time: next,
      created_at: (oldData && oldData.created_at) ? oldData.created_at : now,
      updated_at: now
    }
    
    await storage.put(key, JSON.stringify(newData))
    
    return next
  }

  async function updateIndex(target) {
    const indexKey = 'system:counter_index'
    const indexData = await storage.get(indexKey)
    let index = indexData ? JSON.parse(indexData) : []
    
    const idx = index.indexOf(target)
    if (idx > -1) {
      index.splice(idx, 1)
    }
    index.push(target)
    
    await storage.put(indexKey, JSON.stringify(index))
  }

  async function updateIndexBatch(targets) {
    if (!targets || targets.length === 0) return
    const indexKey = 'system:counter_index'
    const indexData = await storage.get(indexKey)
    let index = indexData ? JSON.parse(indexData) : []
    
    const targetsSet = new Set(targets)
    index = index.filter(t => !targetsSet.has(t))
    index.push(...targets)
    
    await storage.put(indexKey, JSON.stringify(index))
  }

  async function removeFromIndex(target) {
    const indexKey = 'system:counter_index'
    const indexData = await storage.get(indexKey)
    if (!indexData) return
    
    let index = JSON.parse(indexData)
    index = index.filter(item => item !== target)
    await storage.put(indexKey, JSON.stringify(index))
  }

  async function checkOriginAllowed(req) {
    const origin = req.headers.origin
    if (!origin) return true
    
    const allowedDomainsData = await storage.get('system:allowed_domains')
    if (!allowedDomainsData) return true
    
    const allowedDomains = JSON.parse(allowedDomainsData)
    if (allowedDomains.length === 0) return true
    
    for (let i = 0; i < allowedDomains.length; i++) {
      const domain = allowedDomains[i]
      if (domain === '*' || origin === domain) return true
      if (domain.startsWith('*.')) {
        if (origin.endsWith(domain.slice(2))) return true
      }
    }
    return false
  }

  // GET /api/counter?target=xxx
  router.get('/', async (req, res) => {
    try {
      const target = req.query.target
      if (!target) {
        return res.json({ code: RES_CODE.FAIL, message: 'Missing target' })
      }
      const data = await getCounterData(target)
      const count = data ? data.time : 0
      res.json({ 
        code: RES_CODE.SUCCESS, 
        data: { 
          time: count, 
          target,
          created_at: data ? data.created_at : 0,
          updated_at: data ? data.updated_at : 0
        } 
      })
    } catch (e) {
      res.json({ code: RES_CODE.FAIL, message: e.message })
    }
  })

  // POST /api/counter
  router.post('/', async (req, res) => {
    try {
      const { action, target, requests, value } = req.body

      if (action === 'inc') {
        if (!target) throw new Error('Missing target')
        if (!await checkOriginAllowed(req)) {
          throw new Error('Origin not allowed')
        }
        const newCount = await incrementCount(target)
        await updateIndex(target)
        return res.json({ code: RES_CODE.SUCCESS, data: { time: newCount, target } })
      }

      if (action === 'set') {
        await checkAuth(req)
        if (!target) throw new Error('Missing target')
        if (value === undefined) throw new Error('Missing value')
        
        const oldData = await getCounterData(target)
        const now = Date.now()
        const newData = {
          time: parseInt(value),
          created_at: (oldData && oldData.created_at) ? oldData.created_at : now,
          updated_at: now
        }

        await storage.put(`counter:${target}`, JSON.stringify(newData))
        await updateIndex(target)
        return res.json({ 
          code: RES_CODE.SUCCESS, 
          data: { 
            time: newData.time, 
            target,
            updated_at: newData.updated_at
          } 
        })
      }

      if (action === 'delete') {
        await checkAuth(req)
        if (!target) throw new Error('Missing target')
        await storage.delete(`counter:${target}`)
        await removeFromIndex(target)
        return res.json({ code: RES_CODE.SUCCESS, data: { deleted: true, target } })
      }

      if (action === 'list') {
        await checkAuth(req)
        const { page = 1, pageSize = 20 } = req.body
        
        const indexKey = 'system:counter_index'
        const indexData = await storage.get(indexKey)
        const index = indexData ? JSON.parse(indexData) : []
        
        const total = index.length
        const start = (page - 1) * pageSize
        const end = Math.min(start + pageSize, total)
        const pageItems = []
        for (let i = total - 1 - start; i >= Math.max(total - end, 0); i--) {
          pageItems.push(index[i])
        }
        
        const items = await Promise.all(pageItems.map(async (target) => {
          const data = await getCounterData(target)
          return { 
            target, 
            count: data ? data.time : 0,
            created_at: data ? data.created_at : 0,
            updated_at: data ? data.updated_at : 0
          }
        }))
        
        return res.json({ 
          code: RES_CODE.SUCCESS, 
          data: { 
            items, 
            total, 
            page, 
            pageSize,
            totalPages: Math.ceil(total / pageSize)
          } 
        })
      }

      if (action === 'get_config') {
        await checkAuth(req)
        const allowedDomainsData = await storage.get('system:allowed_domains')
        const allowedDomains = allowedDomainsData ? JSON.parse(allowedDomainsData) : []
        return res.json({ 
          code: RES_CODE.SUCCESS, 
          data: { allowedDomains } 
        })
      }

      if (action === 'set_config') {
        await checkAuth(req)
        const { allowedDomains } = req.body
        if (!Array.isArray(allowedDomains)) throw new Error('allowedDomains must be an array')
        await storage.put('system:allowed_domains', JSON.stringify(allowedDomains))
        return res.json({ 
          code: RES_CODE.SUCCESS, 
          data: { allowedDomains } 
        })
      }

      if (action === 'export_all') {
        await checkAuth(req)
        
        const [allowedDomainsData, indexData] = await Promise.all([
          storage.get('system:allowed_domains'),
          storage.get('system:counter_index')
        ])
        const allowedDomains = allowedDomainsData ? JSON.parse(allowedDomainsData) : []
        const index = indexData ? JSON.parse(indexData) : []
        
        const counterEntries = await Promise.all(index.map(async (target) => {
          const data = await getCounterData(target)
          return [target, data || { time: 0, created_at: 0, updated_at: 0 }]
        }))
        const counters = Object.fromEntries(counterEntries)
        
        return res.json({ 
          code: RES_CODE.SUCCESS, 
          data: { 
            counters,
            allowedDomains,
            timestamp: Date.now(),
            version: '1.0'
          } 
        })
      }

      if (action === 'import_all') {
        await checkAuth(req)
        const { data } = req.body
        
        if (!data || !data.counters) throw new Error('Invalid import data')
        
        // Clear existing data
        const indexKey = 'system:counter_index'
        const oldIndexData = await storage.get(indexKey)
        if (oldIndexData) {
          const oldIndex = JSON.parse(oldIndexData)
          await Promise.all(oldIndex.map(target => storage.delete(`counter:${target}`)))
        }
        
        // Import Config
        if (Array.isArray(data.allowedDomains)) {
          await storage.put('system:allowed_domains', JSON.stringify(data.allowedDomains))
        }
        
        // Import Counters
        const entries = Object.entries(data.counters)
        entries.sort((a, b) => {
          const timeA = (typeof a[1] === 'object' && a[1] !== null) ? (a[1].updated_at || 0) : 0
          const timeB = (typeof b[1] === 'object' && b[1] !== null) ? (b[1].updated_at || 0) : 0
          return timeA - timeB
        })

        const now = Date.now()
        const newIndex = new Array(entries.length)
        const importPromises = new Array(entries.length)
        
        for (let i = 0; i < entries.length; i++) {
          const [target, value] = entries[i]
          newIndex[i] = target
          
          let storeValue
          if (typeof value === 'object' && value !== null && 'time' in value) {
            if (!value.updated_at) value.updated_at = now
            if (!value.created_at) value.created_at = now
            storeValue = JSON.stringify(value)
          } else {
            storeValue = JSON.stringify({
              time: parseInt(value),
              created_at: now,
              updated_at: now
            })
          }
          importPromises[i] = storage.put(`counter:${target}`, storeValue)
        }
        
        await Promise.all(importPromises)
        await storage.put(indexKey, JSON.stringify(newIndex))
        
        return res.json({ 
          code: RES_CODE.SUCCESS, 
          data: { imported: entries.length } 
        })
      }

      if (action === 'batch_inc') {
        if (!Array.isArray(requests)) throw new Error('Invalid requests array')
        if (!await checkOriginAllowed(req)) {
          throw new Error('Origin not allowed')
        }
        
        const results = await Promise.all(requests.map(async (req) => {
           let t = req.target
           if (!t && req.path) {
             const match = req.path.match(/\/classes\/Counter\/(.+)$/)
             if (match) t = match[1]
           }
           
           if (t) {
             const c = await incrementCount(t)
             return { target: t, time: c }
           }
           return null
        }))
        
        const targetsToUpdate = []
        const seen = new Set()
        for (let i = 0; i < results.length; i++) {
          if (results[i] && !seen.has(results[i].target)) {
            seen.add(results[i].target)
            targetsToUpdate.push(results[i].target)
          }
        }
        
        if (targetsToUpdate.length > 0) {
          await updateIndexBatch(targetsToUpdate)
        }
        
        return res.json({ code: RES_CODE.SUCCESS, data: results })
      }

      // Default to get if no action or just target provided in body
      if (target) {
        const count = await getCount(target)
        return res.json({ code: RES_CODE.SUCCESS, data: { time: count, target } })
      }
      
      throw new Error('Unknown action')
    } catch (e) {
      res.json({ code: RES_CODE.FAIL, message: e.message })
    }
  })

  return router
}
