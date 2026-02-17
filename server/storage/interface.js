/**
 * Storage Adapter Interface
 * 统一的存储接口，支持 KV 和 SQLite 两种后端
 */
export class StorageAdapter {
  /**
   * Get value by key
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async get(key) {
    throw new Error('Not implemented')
  }

  /**
   * Set key-value pair
   * @param {string} key
   * @param {string} value - JSON string
   * @param {Object} options
   * @param {number} options.expirationTtl - TTL in seconds
   * @returns {Promise<void>}
   */
  async put(key, value, options = {}) {
    throw new Error('Not implemented')
  }

  /**
   * Delete key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    throw new Error('Not implemented')
  }

  /**
   * List keys with prefix
   * @param {string} prefix
   * @param {Object} options
   * @returns {Promise<Array<{key: string, value: string}>>}
   */
  async list(prefix, options = {}) {
    throw new Error('Not implemented')
  }
}
