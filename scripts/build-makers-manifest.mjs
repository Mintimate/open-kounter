import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { babelParse } from '@vue/compiler-sfc'

import { createScheduledCleanupToken } from '../cloud-functions/api/_scheduledCleanupAuth.js'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
const HANDLERS = new Map([
  ['onRequest', METHODS],
  ...METHODS.map(method => [`onRequest${method[0]}${method.slice(1).toLowerCase()}`, [method]])
])
const CLEANUP_NAME = 'passkey-challenge-cleanup'
const CLEANUP_PATH = '/api/maintenance/challenges'
const CONFIG_FIELDS = new Set([
  '$schema', 'buildCommand', 'installCommand', 'outputDirectory', 'nodeVersion', 'framework',
  'cloudFunctions', 'headers', 'redirects', 'rewrites', 'schedules'
])

function object(value, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${description}`)
  return value
}

function fields(value, allowed, description) {
  object(value, description)
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(`Unsupported ${description} field`)
}

function array(value, description) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${description}`)
  return value
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function handlerMethods(source, filename) {
  let ast
  try {
    ast = babelParse(source, { sourceType: 'module' })
  } catch {
    throw new Error(`Cannot parse function module: ${filename}`)
  }
  const methods = new Set()
  const exported = new Set()
  const defaults = []
  for (const statement of ast.program.body) {
    if (statement.type === 'ExportAllDeclaration') throw new Error(`Unsupported function re-export: ${filename}`)
    if (statement.type === 'ExportDefaultDeclaration') {
      defaults.push(statement.declaration)
      continue
    }
    if (statement.type !== 'ExportNamedDeclaration') continue
    if (statement.source || statement.specifiers.length > 0) throw new Error(`Unsupported function re-export: ${filename}`)
    const declaration = statement.declaration
    const declarations = declaration?.type === 'VariableDeclaration' ? declaration.declarations : [declaration]
    for (const item of declarations) {
      const name = item?.id?.name
      if (!HANDLERS.has(name)) continue
      if (item.type !== 'FunctionDeclaration'
        && !['ArrowFunctionExpression', 'FunctionExpression'].includes(item.init?.type)) {
        throw new Error(`Unsupported function handler: ${filename}`)
      }
      exported.add(name)
      HANDLERS.get(name).forEach(method => methods.add(method))
    }
  }
  for (const declaration of defaults) {
    // Existing modules also expose a redundant default { onRequest } object.
    if (declaration.type !== 'ObjectExpression' || !declaration.properties.every(property =>
      property.type === 'ObjectProperty' && property.shorthand && !property.computed && exported.has(property.key.name))) {
      throw new Error(`Unsupported default/framework function export: ${filename}`)
    }
  }
  return METHODS.filter(method => methods.has(method))
}

function functionRoutes(cwd, directory, serverName) {
  const base = path.join(cwd, directory)
  if (!existsSync(base)) return []
  const routes = []
  const paths = new Set()
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      const filename = path.join(folder, entry.name)
      const relative = path.relative(base, filename).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`Unsupported function symlink: ${directory}/${relative}`)
      if (entry.isDirectory()) { visit(filename); continue }
      if (!entry.isFile()) continue
      if (/\.(?:ts|tsx|jsx|mjs|cjs|mts|cts|py|go)$/.test(entry.name)) throw new Error(`Unsupported function runtime: ${directory}/${relative}`)
      if (!entry.name.endsWith('.js')) continue
      const methods = handlerMethods(readFileSync(filename, 'utf8'), `${directory}/${relative}`)
      if (methods.length === 0) continue
      if (!/^[A-Za-z0-9_./-]+$/.test(relative)) throw new Error(`Unsupported dynamic function route: ${directory}/${relative}`)
      const segments = relative.slice(0, -3).split('/')
      if (segments.at(-1) === 'index') segments.pop()
      const routePath = `/${segments.join('/')}`
      if (paths.has(routePath)) throw new Error(`Duplicate function route: ${routePath}`)
      paths.add(routePath)
      routes.push({ src: routePath === '/' ? '^/$' : `^${escapeRegex(routePath)}/?$`, methods, 'server-name': serverName })
    }
  }
  visit(base)
  return routes
}

function scheduledCleanup(config, env) {
  const schedules = array(config.schedules ?? [], 'schedules')
  if (schedules.length > 1) throw new Error('Only the Challenge cleanup schedule is supported')
  for (const schedule of schedules) {
    fields(schedule, new Set(['name', 'cron', 'timezone', 'path', 'method']), 'public schedule')
    if (schedule.name !== CLEANUP_NAME || schedule.path !== CLEANUP_PATH || schedule.method !== 'POST'
      || typeof schedule.cron !== 'string' || !/^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/.test(schedule.cron)
      || typeof schedule.timezone !== 'string' || !schedule.timezone) throw new Error('Unsupported Challenge cleanup schedule')
    try { new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }) } catch { throw new Error('Invalid schedule timezone') }
  }
  const secret = env.OPEN_KOUNTER_CLEANUP_SECRET
  if (secret === undefined || secret === '') return []
  const cleanupToken = createScheduledCleanupToken(secret)
  if (!cleanupToken) throw new Error('OPEN_KOUNTER_CLEANUP_SECRET must contain at least 32 characters')
  return schedules.map(schedule => ({ ...schedule, payload: { cleanupToken } }))
}

export function buildMakersManifest({ cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  const root = path.resolve(cwd)
  let config
  try {
    config = JSON.parse(readFileSync(path.join(root, 'edgeone.json'), 'utf8'))
  } catch {
    throw new Error('Cannot read edgeone.json as valid JSON')
  }
  fields(config, CONFIG_FIELDS, 'edgeone.json')
  for (const name of ['headers', 'redirects', 'rewrites']) {
    if (array(config[name] ?? [], name).length > 0) {
      throw new Error(`Custom ${name} require extending this manifest builder before deployment`)
    }
  }
  if (config.outputDirectory !== 'dist') throw new Error('This manifest builder requires outputDirectory: dist')
  if (config.framework !== undefined && config.framework !== 'vite') throw new Error('This manifest builder supports the Vite project only')
  if (!existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Build dist/index.html before generating the Makers manifest')
  if (lstatSync(path.join(root, 'dist')).isSymbolicLink()) throw new Error('dist must not be a symlink')
  if (existsSync(path.join(root, 'middleware.js')) || existsSync(path.join(root, 'middleware.ts'))
    || existsSync(path.join(root, 'agents')) || existsSync(path.join(root, 'node-functions'))) {
    throw new Error('Middleware, Agents, and legacy node-functions need a different manifest builder')
  }
  const cloudRoutes = functionRoutes(root, 'cloud-functions', 'api-node')
  const edgeRoutes = functionRoutes(root, 'edge-functions', 'edge')
  if (cloudRoutes.some(cloud => edgeRoutes.some(edge => edge.src === cloud.src))) throw new Error('Conflicting Cloud and Edge function routes')
  const schedules = scheduledCleanup(config, env)
  if ((config.schedules?.length || 0) > 0 && !cloudRoutes.some(route => new RegExp(route.src).test(CLEANUP_PATH)
    && route.methods.includes('POST'))) throw new Error('The Challenge cleanup schedule requires its POST Cloud Function')

  const manifest = {
    version: 3,
    routes: [
      { handle: 'filesystem' },
      ...edgeRoutes,
      ...cloudRoutes,
      { src: '/.*', dest: '/index.html', 'server-name': 'file' }
    ],
    ...(config.cloudFunctions ? { conf: { cloudFunctions: object(config.cloudFunctions, 'cloudFunctions') } } : {}),
    schedules
  }
  const privateDirectory = path.join(root, '.edgeone')
  if (existsSync(privateDirectory) && lstatSync(privateDirectory).isSymbolicLink()) throw new Error('.edgeone must not be a symlink')
  mkdirSync(privateDirectory, { recursive: true })
  const manifestPath = path.join(privateDirectory, 'routes.json')
  const temporaryPath = path.join(privateDirectory, `.routes-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, manifestPath)
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
  if ((config.schedules?.length || 0) > 0 && schedules.length === 0) {
    log('OPEN_KOUNTER_CLEANUP_SECRET is not configured; native Challenge cleanup scheduling is disabled.')
  } else {
    log(`Makers manifest generated with ${schedules.length} native Challenge cleanup schedule(s).`)
  }
  return { manifestPath, routeCount: cloudRoutes.length + edgeRoutes.length, scheduleCount: schedules.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildMakersManifest()
  } catch (error) {
    // Validation errors contain field/file names only; never print config or environment values.
    console.error(`Makers manifest generation failed: ${error.message}`)
    process.exitCode = 1
  }
}
