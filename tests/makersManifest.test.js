import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createScheduledCleanupToken } from '../cloud-functions/api/_scheduledCleanupAuth.js'
import { buildMakersManifest } from '../scripts/build-makers-manifest.mjs'

const repository = fileURLToPath(new URL('../', import.meta.url))
const nativeSchedule = {
  name: 'passkey-challenge-cleanup', cron: '0 3 * * *', timezone: 'Asia/Shanghai',
  path: '/api/maintenance/challenges', method: 'POST'
}
const publicConfig = {
  buildCommand: 'npm run build:makers', outputDirectory: 'dist', nodeVersion: '22', framework: 'vite',
  schedules: [nativeSchedule]
}
const secret = () => randomBytes(32).toString('base64url')

function write(root, name, value) {
  const filename = path.join(root, name)
  mkdirSync(path.dirname(filename), { recursive: true })
  writeFileSync(filename, value)
}

function fixture(t, { actualFunctions = false, config = publicConfig } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'open-kounter-manifest-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  write(cwd, 'edgeone.json', `${JSON.stringify(config, null, 2)}\n`)
  write(cwd, 'dist/index.html', '<!doctype html><title>Open Kounter</title>')
  write(cwd, 'dist/favicon.png', 'fixture favicon')
  write(cwd, 'dist/assets/app.js', 'console.info("app")')
  if (actualFunctions) {
    cpSync(path.join(repository, 'cloud-functions'), path.join(cwd, 'cloud-functions'), { recursive: true })
    cpSync(path.join(repository, 'edge-functions'), path.join(cwd, 'edge-functions'), { recursive: true })
  } else {
    write(cwd, 'cloud-functions/api/maintenance/challenges.js', 'export async function onRequest() {}')
    write(cwd, 'cloud-functions/api/auth.js', 'export async function onRequest() {}\nexport default { onRequest }')
    write(cwd, 'edge-functions/legacy-api/migrate.js', 'export async function onRequest() {}')
  }
  const logs = []
  return {
    cwd, logs,
    build: env => buildMakersManifest({ cwd, env, log: message => logs.push(message) }),
    manifest: () => JSON.parse(readFileSync(path.join(cwd, '.edgeone/routes.json'), 'utf8')),
    config: () => readFileSync(path.join(cwd, 'edgeone.json'), 'utf8')
  }
}

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(root, entry.name)
    return entry.isDirectory() ? files(filename) : [filename]
  })
}

test('all current function endpoints are registered; helper modules and static assets remain separate', t => {
  const app = fixture(t, { actualFunctions: true })
  const result = app.build({ OPEN_KOUNTER_CLEANUP_SECRET: secret() })
  const { routes, schedules } = app.manifest()
  const expectedCloud = [
    '/api/auth', '/api/counter', '/api/init', '/api/passkey', '/api/oidc/login',
    '/api/oidc/callback', '/api/oidc/status', '/api/maintenance/challenges'
  ]
  assert.equal(result.routeCount, expectedCloud.length + 1)
  assert.equal(result.scheduleCount, 1)
  assert.equal(schedules[0].path, '/api/maintenance/challenges')
  for (const endpoint of expectedCloud) {
    const matching = routes.filter(route => route['server-name'] === 'api-node' && new RegExp(route.src).test(endpoint))
    assert.equal(matching.length, 1, endpoint)
    assert.ok(matching[0].methods.includes('POST'))
    assert.ok(new RegExp(matching[0].src).test(`${endpoint}/`))
  }
  const edge = routes.find(route => route['server-name'] === 'edge')
  assert.ok(new RegExp(edge.src).test('/legacy-api/migrate'))
  assert.ok(!new RegExp(edge.src).test('/legacy-api/migrate/extra'))
  assert.deepEqual(routes[0], { handle: 'filesystem' })
  assert.deepEqual(routes.at(-1), { src: '/.*', dest: '/index.html', 'server-name': 'file' })
  const functions = routes.filter(route => ['edge', 'api-node'].includes(route['server-name']))
  for (const asset of ['/favicon.png', '/assets/app.js', '/api/_blobStore', '/api/_scheduledCleanupAuth']) {
    assert.equal(functions.some(route => new RegExp(route.src).test(asset)), false)
  }
  assert.ok(new RegExp(routes.at(-1).src).test('/some-client-page'))
})

test('only the scoped proof enters a private 0600 manifest; config, assets, and logs contain no credentials', t => {
  const app = fixture(t)
  const cleanupSecret = secret()
  const proof = createScheduledCleanupToken(cleanupSecret)
  const configBefore = app.config()
  const result = app.build({ OPEN_KOUNTER_CLEANUP_SECRET: cleanupSecret })
  assert.equal(app.config(), configBefore)
  assert.deepEqual(JSON.parse(configBefore).schedules, [nativeSchedule])
  assert.equal(Object.hasOwn(JSON.parse(configBefore).schedules[0], 'payload'), false)
  assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600)
  assert.deepEqual(app.manifest().schedules, [{ ...nativeSchedule, payload: { cleanupToken: proof } }])
  for (const filename of files(app.cwd)) {
    const contents = readFileSync(filename, 'utf8')
    assert.equal(contents.includes(cleanupSecret), false)
    assert.equal(contents.includes(proof), filename === result.manifestPath)
  }
  assert.equal(app.logs.join('\n').includes(proof), false)
  assert.equal(app.logs.join('\n').includes(cleanupSecret), false)
  assert.deepEqual(readdirSync(path.join(app.cwd, '.edgeone')), ['routes.json'])
})

test('a missing or empty secret replaces stale schedules and rotating the secret changes only its proof', t => {
  const app = fixture(t)
  const firstSecret = secret()
  app.build({ OPEN_KOUNTER_CLEANUP_SECRET: firstSecret })
  const first = app.manifest()
  const secondSecret = secret()
  app.build({ OPEN_KOUNTER_CLEANUP_SECRET: secondSecret })
  const second = app.manifest()
  assert.notEqual(first.schedules[0].payload.cleanupToken, second.schedules[0].payload.cleanupToken)
  assert.deepEqual(first.routes, second.routes)
  assert.equal(second.schedules[0].payload.cleanupToken, createScheduledCleanupToken(secondSecret))
  assert.equal(readFileSync(path.join(app.cwd, '.edgeone/routes.json'), 'utf8').includes(first.schedules[0].payload.cleanupToken), false)
  app.build({})
  assert.deepEqual(app.manifest().schedules, [])
  assert.match(app.logs.at(-1), /not configured.*disabled/)
  app.build({ OPEN_KOUNTER_CLEANUP_SECRET: secondSecret })
  app.build({ OPEN_KOUNTER_CLEANUP_SECRET: '' })
  assert.deepEqual(app.manifest().schedules, [])
  assert.equal(statSync(path.join(app.cwd, '.edgeone/routes.json')).mode & 0o777, 0o600)
})

test('a short nonempty secret fails closed without publishing a manifest or logging its value', t => {
  const app = fixture(t)
  const shortSecret = randomBytes(8).toString('hex')
  assert.throws(() => app.build({ OPEN_KOUNTER_CLEANUP_SECRET: shortSecret }), error =>
    /at least 32/.test(error.message) && !error.message.includes(shortSecret))
  assert.equal(existsSync(path.join(app.cwd, '.edgeone/routes.json')), false)
  assert.deepEqual(app.logs, [])
})

test('static index and method-specific handlers are recognized without executing source modules', t => {
  const app = fixture(t)
  write(app.cwd, 'cloud-functions/api/read/index.js', 'throw new Error("must not execute"); export const onRequestGet = () => new Response()')
  write(app.cwd, 'cloud-functions/api/helper.js', 'export const text = "export async function onRequest() {}"')
  write(app.cwd, 'cloud-functions/api/_private.js', 'export async function onRequest() {}')
  app.build({})
  const route = app.manifest().routes.find(item => item.src === '^/api/read/?$')
  assert.deepEqual(route.methods, ['GET'])
  assert.equal(app.manifest().routes.some(item => /helper|_private/.test(item.src ?? '')), false)
})

test('unsupported routing configuration is rejected instead of silently discarded', async t => {
  for (const key of ['headers', 'redirects', 'rewrites']) {
    await t.test(key, child => {
      const app = fixture(child, { config: { ...publicConfig, [key]: [{ source: '/example' }] } })
      assert.throws(() => app.build({}), new RegExp(`Custom ${key}`))
    })
  }
  const app = fixture(t, { config: { ...publicConfig, trailingSlash: true } })
  assert.throws(() => app.build({}), /Unsupported edgeone.json field/)
})

test('unsupported function modes and duplicate paths fail explicitly', async t => {
  for (const [name, filename, contents, expected] of [
    ['dynamic route', 'cloud-functions/api/[id].js', 'export function onRequest() {}', /dynamic/],
    ['other runtime', 'cloud-functions/api/example.ts', 'export function onRequest() {}', /runtime/],
    ['framework export', 'cloud-functions/api/example.js', 'const app = {}; export default app', /framework/],
    ['handler re-export', 'cloud-functions/api/example.js', 'export { onRequest } from "./auth.js"', /re-export/],
    ['duplicate index', 'cloud-functions/api/auth/index.js', 'export function onRequest() {}', /Duplicate/],
    ['middleware', 'middleware.js', 'export default {}', /Middleware/]
  ]) {
    await t.test(name, child => {
      const app = fixture(child)
      write(app.cwd, filename, contents)
      assert.throws(() => app.build({}), expected)
    })
  }
})

test('public schedules cannot carry a credential or target an unrelated endpoint', async t => {
  for (const update of [{ payload: { cleanupToken: secret() } }, { path: '/api/auth' }, { cron: '* * * * *' }, { timezone: 'invalid-zone' }]) {
    await t.test(Object.keys(update)[0], child => {
      const app = fixture(child, { config: { ...publicConfig, schedules: [{ ...nativeSchedule, ...update }] } })
      assert.throws(() => app.build({ OPEN_KOUNTER_CLEANUP_SECRET: secret() }), /schedule|timezone/)
    })
  }
})

test('the private manifest directory cannot redirect writes into public assets', t => {
  const app = fixture(t)
  symlinkSync(path.join(app.cwd, 'dist'), path.join(app.cwd, '.edgeone'), 'dir')
  assert.throws(() => app.build({ OPEN_KOUNTER_CLEANUP_SECRET: secret() }), /symlink/)
  assert.equal(existsSync(path.join(app.cwd, 'dist/routes.json')), false)
})
