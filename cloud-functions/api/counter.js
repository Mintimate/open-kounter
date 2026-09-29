import {
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
  jsonResponse,
  optionsResponse,
  requireAuth,
  RES_CODE,
  successResponse
} from './_api.js'
import {
  isCounterOriginAllowed,
  normalizeAllowedDomains,
  validateCounterTarget,
  validateCounterValue
} from './_counterValidation.js'
import { importLegacyBundle, migrateFromLegacy } from './_legacyMigration.js'

const STALE_COUNTER_DAYS = 30
const STALE_COUNTER_MS = STALE_COUNTER_DAYS * 24 * 60 * 60 * 1000
const SUMMARY_LIST_LIMIT = 8
const SITE_COUNTER_TARGETS = new Set(['site-pv', 'site-uv'])
const SORT_FIELDS = new Set(['count', 'created_at', 'target', 'updated_at'])
const MAX_BATCH_SIZE = 100

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return optionsResponse(request)
  }

  const store = createStore(context)

  try {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const target = validateCounterTarget(url.searchParams.get('target'))

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
      validateCounterTarget(target)

      if (!await checkOriginAllowed(request, store)) {
        throw new Error('Origin not allowed')
      }

      const next = await incrementCounter(store, target)
      return successResponse(request, { time: next.time, target })
    }

    if (action === 'set') {
      await requireAuth(request, store, env)
      validateCounterTarget(target)
      const parsedValue = validateCounterValue(value)

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
      validateCounterTarget(target)

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
        sortOrder,
        ...(body.includeSummary === true ? { summary: createCounterSummary(counters) } : {})
      })
    }

    if (action === 'get_config') {
      const { state } = await requireAuth(request, store, env)
      return successResponse(request, {
        allowedDomains: state.allowedDomains
      })
    }

    if (action === 'set_config') {
      await requireAuth(request, store, env)
      const allowedDomains = normalizeAllowedDomains(body.allowedDomains)

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
      const { state } = await requireAuth(request, store, env)
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

      const allowedDomains = body.data.allowedDomains === undefined
        ? undefined : normalizeAllowedDomains(body.data.allowedDomains)
      const imported = await replaceAllCounterRecords(store, body.data.counters)
      if (allowedDomains !== undefined) {
        await updateSystemState(store, (current) => ({
          ...current,
          allowedDomains,
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
      const targets = validateBatchTargets(requests)

      if (!await checkOriginAllowed(request, store)) {
        throw new Error('Origin not allowed')
      }

      const results = await incrementCountersBatch(store, targets)

      return successResponse(request, results)
    }

    if (target !== undefined) {
      validateCounterTarget(target)
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
      time: validateCounterValue(validateCounterValue(current?.time ?? 0) + 1),
      created_at: current?.created_at || now,
      updated_at: now
    }
  })
}

function validateBatchTargets(requests) {
  if (!Array.isArray(requests) || requests.length > MAX_BATCH_SIZE) {
    throw new Error(`requests must be an array with at most ${MAX_BATCH_SIZE} items`)
  }
  return requests.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid batch item')
    const target = item.target !== undefined ? item.target
      : typeof item.path === 'string' ? item.path.match(/\/classes\/Counter\/(.+)$/)?.[1] : undefined
    return validateCounterTarget(target)
  })
}

async function incrementCountersBatch(store, targets) {
  if (targets.length === 0) return []
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

    for (const target of targets) {
      const record = Object.hasOwn(next.items, target) ? next.items[target] : {
        target,
        time: 0,
        created_at: now,
        updated_at: now
      }

      const updated = {
        target,
        time: validateCounterValue(validateCounterValue(record.time) + 1),
        created_at: record.created_at || now,
        updated_at: now
      }

      Object.defineProperty(next.items, target, {
        value: updated, enumerable: true, configurable: true, writable: true
      })
      results.push({
        target,
        time: updated.time
      })
    }

    return next
  })

  return results
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

  const topPages = selectTopCounters(pageCounters, 'count')
  const recentlyActive = selectTopCounters(pageCounters, 'updated_at')

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

function selectTopCounters(counters, sortBy) {
  const compare = createCounterComparator(sortBy, 'desc')
  const selected = []
  for (const item of counters) {
    const index = selected.findIndex((current) => compare(item, current) < 0)
    if (index >= 0) selected.splice(index, 0, item)
    else if (selected.length < SUMMARY_LIST_LIMIT) selected.push(item)
    if (selected.length > SUMMARY_LIST_LIMIT) selected.pop()
  }
  return selected.map(toCounterListItem)
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
  return isCounterOriginAllowed(origin, state.allowedDomains)
}

export default { onRequest }
