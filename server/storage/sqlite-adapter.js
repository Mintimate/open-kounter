import fs from 'fs'
import path from 'path'
import initSqlJs from 'sql.js'
import { StorageAdapter } from './interface.js'

/**
 * SQLite Storage Adapter (using sql.js)
 * 使用 sql.js 实现存储接口（纯 JavaScript，无需编译）
 */
export class SQLiteAdapter extends StorageAdapter {
  constructor(dbPath = './data/openkounter.db') {
    super()
    this.dbPath = dbPath
    this.db = null
    this.SQL = null
    this.initPromise = this.initDatabase()
  }

  async initDatabase() {
    // Initialize sql.js
    this.SQL = await initSqlJs()
    
    // Ensure data directory exists
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath)
      this.db = new this.SQL.Database(buffer)
    } else {
      this.db = new this.SQL.Database()
    }
    
    // Create table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_expires_at ON kv_store(expires_at)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_key_prefix ON kv_store(key)`)
    
    // Save to disk
    this.saveToFile()
    
    // Start cleanup task
    this.startCleanupTask()
  }

  saveToFile() {
    if (!this.db) return
    const data = this.db.export()
    fs.writeFileSync(this.dbPath, data)
  }

  async ensureReady() {
    await this.initPromise
  }

  /**
   * Get value by key
   */
  async get(key) {
    await this.ensureReady()
    const now = Date.now()
    
    // Get and check expiration
    const result = this.db.exec(`
      SELECT value, expires_at FROM kv_store WHERE key = ?
    `, [key])
    
    if (result.length === 0 || result[0].values.length === 0) return null
    
    const row = result[0].values[0]
    const value = row[0]
    const expiresAt = row[1]
    
    // Check if expired
    if (expiresAt && expiresAt < now) {
      // Delete expired key
      this.db.run('DELETE FROM kv_store WHERE key = ?', [key])
      this.saveToFile()
      return null
    }
    
    return value
  }

  /**
   * Set key-value pair
   */
  async put(key, value, options = {}) {
    await this.ensureReady()
    const now = Date.now()
    const expiresAt = options.expirationTtl 
      ? now + options.expirationTtl * 1000 
      : null
    
    this.db.run(`
      INSERT INTO kv_store (key, value, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `, [key, value, expiresAt, now, now])
    
    this.saveToFile()
  }

  /**
   * Delete key
   */
  async delete(key) {
    await this.ensureReady()
    this.db.run('DELETE FROM kv_store WHERE key = ?', [key])
    this.saveToFile()
  }

  /**
   * List keys with prefix
   */
  async list(prefix, options = {}) {
    await this.ensureReady()
    const now = Date.now()
    const limit = options.limit || 1000
    
    const result = this.db.exec(`
      SELECT key, value FROM kv_store 
      WHERE key LIKE ? 
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT ?
    `, [`${prefix}%`, now, limit])
    
    if (result.length === 0) return []
    
    return result[0].values.map(row => ({
      key: row[0],
      value: row[1]
    }))
  }

  /**
   * Clean up expired keys periodically
   */
  startCleanupTask() {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      await this.ensureReady()
      const now = Date.now()
      
      this.db.run(`
        DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at < ?
      `, [now])
      
      const changes = this.db.getRowsModified()
      if (changes > 0) {
        console.log(`[SQLite] Cleaned up ${changes} expired keys`)
        this.saveToFile()
      }
    }, 5 * 60 * 1000)
  }

  /**
   * Close database connection
   */
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    if (this.db) {
      this.saveToFile()
      this.db.close()
    }
  }
}
