import {
  COUNTERS_DOC_KEY,
  deleteJson,
  deleteCounterRecord,
  getCounterRecord,
  listCounterRecords,
  loadSystemState,
  replaceAllCounterRecords,
  updateCountersDocument,
  updateCounterRecord,
  updateSystemState
} from './_blobStore.js'
import {
  createStore,
  failResponse,
  jsonResponse,
  optionsResponse,
  requireAuth,
  RES_CODE,
  successResponse
} from './_api.js'
import { importLegacyBundle, migrateFromLegacy } from './_legacyMigration.js'

const STALE_COUNTER_DAYS = 30
const STALE_COUNTER_MS = STALE_COUNTER_DAYS * 24 * 60 * 60 * 1000
const SUMMARY_LIST_LIMIT = 8
const SITE_COUNTER_TARGETS = new Set(['site-pv', 'site-uv'])
const SORT_FIELDS = new Set(['count', 'created_at', 'target', 'updated_at'])

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return optionsResponse(request)
  }

  const store = createStore(context)

  try {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const target = url.searchParams.get('target')
      if (!target) {
        return failResponse(request, 'Missing target')
      }

      const data = await getCounterRecord(store, target)
      return successResponse(request, {
        time: data ? data.time : 0,
        target,
        created_at: data ? data.created_at : 0,
        updated_at: data ? data.updated_at : 0
      })
    }

    if (request.method !== 'POST') {
      throw new Error('Method not allowed')
    }

    const body = await request.json()
    const { action, target, requests, value, legacyToken, legacyBundle } = body

    if (action === 'inc') {
      if (!target) {
        throw new Error('Missing target')
      }

      if (!await checkOriginAllowed(request, store)) {
        throw new Error('Origin not allowed')
      }

      const next = await incrementCounter(store, target)
      return successResponse(request, { time: next.time, target })
    }

    if (action === 'set') {
      await requireAuth(request, store, env)
      if (!target) {
        throw new Error('Missing target')
      }
      if (value === undefined) {
        throw new Error('Missing value')
      }

      const parsedValue = Number.parseInt(value, 10)
      if (Number.isNaN(parsedValue)) {
        throw new Error('Invalid value')
      }

      const next = await updateCounterRecord(store, target, (current) => {
        const now = Date.now()
        return {
          target,
          time: parsedValue,
          created_at: current?.created_at || now,
          updated_at: now
        }
      })

      return successResponse(request, {
        time: next.time,
        target,
        updated_at: next.updated_at
      })
    }

    if (action === 'delete') {
      await requireAuth(request, store, env)
      if (!target) {
        throw new Error('Missing target')
      }

      await deleteCounterRecord(store, target)
      return successResponse(request, { deleted: true, target })
    }

    if (action === 'summary') {
      await requireAuth(request, store, env)
      const counters = await listCounterRecords(store)
      return successResponse(request, createCounterSummary(counters))
    }

    if (action === 'list') {
      await requireAuth(request, store, env)
      const page = Math.max(1, Number.parseInt(body.page, 10) || 1)
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(body.pageSize, 10) || 20))
      const query = String(body.query || '').trim().toLocaleLowerCase()
      const sortBy = SORT_FIELDS.has(body.sortBy) ? body.sortBy : 'updated_at'
      const sortOrder = body.sortOrder === 'asc' ? 'asc' : 'desc'
      const counters = await listCounterRecords(store)
      const filteredCounters = counters
        .filter((item) => !query || item.target.toLocaleLowerCase().includes(query))
        .sort(createCounterComparator(sortBy, sortOrder))
      const total = filteredCounters.length
      const start = (page - 1) * pageSize
      const items = filteredCounters.slice(start, start + pageSize).map(toCounterListItem)

      return successResponse(request, {
        items,
        total,
        allTotal: counters.length,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        query,
        sortBy,
        sortOrder
      })
    }

    if (action === 'get_config') {
      await requireAuth(request, store, env)
      const state = await loadSystemState(store)
      return successResponse(request, {
        allowedDomains: state.allowedDomains
      })
    }

    if (action === 'set_config') {
      await requireAuth(request, store, env)
      const { allowedDomains } = body
      if (!Array.isArray(allowedDomains)) {
        throw new Error('allowedDomains must be an array')
      }

      const state = await updateSystemState(store, (current) => ({
        ...current,
        allowedDomains,
        updatedAt: Date.now()
      }))

      return successResponse(request, {
        allowedDomains: state.allowedDomains
      })
    }

    if (action === 'export_all') {
      await requireAuth(request, store, env)
      const state = await loadSystemState(store)
      const counters = await listCounterRecords(store)

      return successResponse(request, {
        counters: Object.fromEntries(counters.map((item) => [item.target, item])),
        allowedDomains: state.allowedDomains,
        timestamp: Date.now(),
        version: '2.0'
      })
    }

    if (action === 'import_all') {
      await requireAuth(request, store, env)
      if (!body.data || !body.data.counters) {
        throw new Error('Invalid import data')
      }

      const imported = await replaceAllCounters(store, body.data)
      if (Array.isArray(body.data.allowedDomains)) {
        await updateSystemState(store, (current) => ({
          ...current,
          allowedDomains: body.data.allowedDomains,
          updatedAt: Date.now()
        }))
      }

      return successResponse(request, { imported })
    }

    if (action === 'migrate_legacy') {
      const auth = await requireAuth(request, store, env)
      const migration = legacyBundle
        ? await importLegacyBundle(store, env, legacyBundle)
        : await migrateFromLegacy(request, env, store, legacyToken || body.token || auth.token)
      return successResponse(request, migration)
    }

    if (action === 'batch_inc') {
      if (!Array.isArray(requests)) {
        throw new Error('Invalid requests array')
      }

      if (!await checkOriginAllowed(request, store)) {
        throw new Error('Origin not allowed')
      }

      const results = await incrementCountersBatch(store, requests)

      return successResponse(request, results)
    }

    if (target) {
      const data = await getCounterRecord(store, target)
      return successResponse(request, {
        time: data ? data.time : 0,
        target
      })
    }

    throw new Error('Unknown action')
  } catch (error) {
    return jsonResponse(request, {
      code: RES_CODE.FAIL,
      message: error.message
    })
  }
}

async function incrementCounter(store, target) {
  return updateCounterRecord(store, target, (current) => {
    const now = Date.now()
    return {
      target,
      time: (current?.time || 0) + 1,
      created_at: current?.created_at || now,
      updated_at: now
    }
  })
}

async function incrementCountersBatch(store, requests) {
  const normalizedRequests = requests.map((item) => {
    let currentTarget = item.target
    if (!currentTarget && item.path) {
      const match = item.path.match(/\/classes\/Counter\/(.+)$/)
      if (match) {
        currentTarget = match[1]
      }
    }
    return currentTarget || null
  })

  const results = []
  await updateCountersDocument(store, (current) => {
    const now = Date.now()
    const next = {
      ...current,
      items: {
        ...current.items
      },
      updatedAt: now
    }

    for (const target of normalizedRequests) {
      if (!target) {
        results.push(null)
        continue
      }

      const record = next.items[target] || {
        target,
        time: 0,
        created_at: now,
        updated_at: now
      }

      const updated = {
        target,
        time: (record.time || 0) + 1,
        created_at: record.created_at || now,
        updated_at: now
      }

      next.items[target] = updated
      results.push({
        target,
        time: updated.time
      })
    }

    return next
  })

  return results
}

async function replaceAllCounters(store, data) {
  await deleteJson(store, COUNTERS_DOC_KEY)
  return replaceAllCounterRecords(store, data.counters)
}

function createCounterSummary(counters, now = Date.now()) {
  const sitePv = counters.find((item) => item.target === 'site-pv')?.time || 0
  const siteUv = counters.find((item) => item.target === 'site-uv')?.time || 0
  const pageCounters = counters.filter((item) => !SITE_COUNTER_TARGETS.has(item.target))
  const latestUpdatedAt = counters.reduce(
    (latest, item) => Math.max(latest, Number(item.updated_at) || 0),
    0
  )
  const staleBefore = now - STALE_COUNTER_MS

  const topPages = [...pageCounters]
    .sort(createCounterComparator('count', 'desc'))
    .slice(0, SUMMARY_LIST_LIMIT)
    .map(toCounterListItem)
  const recentlyActive = [...pageCounters]
    .sort(createCounterComparator('updated_at', 'desc'))
    .slice(0, SUMMARY_LIST_LIMIT)
    .map(toCounterListItem)

  return {
    sitePv,
    siteUv,
    totalCounters: counters.length,
    pageCounters: pageCounters.length,
    staleCounters: counters.filter((item) => !item.updated_at || item.updated_at < staleBefore).length,
    zeroCounters: counters.filter((item) => !item.time || item.time <= 0).length,
    staleAfterDays: STALE_COUNTER_DAYS,
    latestUpdatedAt,
    generatedAt: now,
    topPages,
    recentlyActive
  }
}

function createCounterComparator(sortBy, sortOrder) {
  const direction = sortOrder === 'asc' ? 1 : -1

  return (left, right) => {
    if (sortBy === 'target') {
      const targetResult = left.target.localeCompare(right.target)
      return targetResult === 0 ? 0 : targetResult * direction
    }

    const leftValue = sortBy === 'count' ? Number(left.time) || 0 : Number(left[sortBy]) || 0
    const rightValue = sortBy === 'count' ? Number(right.time) || 0 : Number(right[sortBy]) || 0
    if (leftValue === rightValue) {
      return left.target.localeCompare(right.target)
    }
    return (leftValue - rightValue) * direction
  }
}

function toCounterListItem(item) {
  return {
    target: item.target,
    count: item.time,
    created_at: item.created_at,
    updated_at: item.updated_at
  }
}

async function checkOriginAllowed(request, store) {
  const origin = request.headers.get('origin')
  if (!origin) {
    return true
  }

  const state = await loadSystemState(store)
  const allowedDomains = state.allowedDomains
  if (!allowedDomains || allowedDomains.length === 0) {
    return true
  }

  for (const domain of allowedDomains) {
    if (domain === '*' || origin === domain) {
      return true
    }
    if (domain.startsWith('*.') && origin.endsWith(domain.slice(2))) {
      return true
    }
  }

  return false
}

export default { onRequest }
