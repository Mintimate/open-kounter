export function validateCounterTarget(target) {
  if (typeof target !== 'string' || !target.trim() || target.length > 2048) {
    throw new Error('Invalid counter target')
  }
  return target
}

export function validateCounterValue(value) {
  const count = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid counter value')
  return count
}

function parseHttpOrigin(value) {
  if (!/^https?:\/\/[^/?#@]+\/?$/i.test(value) || /[\s\\]/.test(value)) throw new Error('Invalid allowed domain')
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.hostname.includes('*')) {
    throw new Error('Invalid allowed domain')
  }
  return url
}

function normalizeAllowedDomain(domain) {
  if (typeof domain !== 'string' || !domain.trim()) throw new Error('Invalid allowed domain')
  const value = domain.trim()
  if (value === '*') return value
  if (value.startsWith('*.')) {
    const suffix = value.slice(2)
    if (/[\s/:@?#\\*]/.test(suffix)) throw new Error('Invalid allowed domain')
    const hostname = parseHttpOrigin(`https://${suffix}`).hostname
    if (hostname.length > 253 || hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
      throw new Error('Invalid allowed domain')
    }
    return `*.${hostname}`
  }
  return parseHttpOrigin(value).origin
}

export function normalizeAllowedDomains(domains) {
  if (!Array.isArray(domains)) throw new Error('allowedDomains must be an array')
  return [...new Set(domains.map(normalizeAllowedDomain))]
}

export function isCounterOriginAllowed(origin, domains) {
  if (!Array.isArray(domains)) return false
  if (domains.length === 0) return true
  // Ignore invalid legacy entries without blocking valid entries or rewriting state.
  const allowedDomains = domains.flatMap((domain) => {
    try {
      return [normalizeAllowedDomain(domain)]
    } catch {
      return []
    }
  })
  if (allowedDomains.includes('*')) return true
  let url
  try {
    url = parseHttpOrigin(origin)
  } catch {
    return false
  }
  return allowedDomains.some((domain) => domain.startsWith('*.')
    ? url.hostname.endsWith(domain.slice(1))
    : url.origin === domain)
}
