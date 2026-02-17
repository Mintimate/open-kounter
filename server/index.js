import cors from 'cors'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createAuthRouter } from './handlers/auth.js'
import { createCounterRouter } from './handlers/counter.js'
import { createInitRouter } from './handlers/init.js'
import { createPasskeyRouter } from './handlers/passkey.js'
import { SQLiteAdapter } from './storage/sqlite-adapter.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize storage
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/openkounter.db')
const storage = new SQLiteAdapter(dbPath)

// Create Express app
const app = express()

// Middleware
app.use(cors())
app.use(express.json())

// Environment context (similar to EdgeOne context)
const createContext = (req) => ({
  request: req,
  env: {
    ADMIN_TOKEN: process.env.ADMIN_TOKEN
  },
  storage
})

// API Routes
app.use('/api/counter', createCounterRouter(storage))
app.use('/api/auth', createAuthRouter(storage))
app.use('/api/passkey', createPasskeyRouter(storage))
app.use('/api/init', createInitRouter(storage))

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist')
  app.use(express.static(distPath))
  
  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err)
  res.status(500).json({
    code: 1000,
    message: err.message || 'Internal server error'
  })
})

// Start server
const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
  console.log(`🚀 OpenKounter server running on http://localhost:${PORT}`)
  console.log(`📦 Storage: SQLite (${dbPath})`)
  console.log(`🔐 Admin Token: ${process.env.ADMIN_TOKEN ? 'Configured' : 'Not set'}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...')
  server.close(() => {
    storage.close()
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...')
  server.close(() => {
    storage.close()
    process.exit(0)
  })
})

export { app, storage }
