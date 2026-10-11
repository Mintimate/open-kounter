import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const deployScript = fileURLToPath(new URL('../scripts/deploy-makers.mjs', import.meta.url))
const secret = () => `test-${randomBytes(24).toString('base64url')}`

function fixture(t, { installCli = true } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'open-kounter-deploy-'))
  const capturePath = path.join(cwd, 'invocation.json')
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  if (installCli) {
    writeFileSync(path.join(cwd, 'edgeone'), `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(process.env.DEPLOY_TEST_CAPTURE, JSON.stringify({
  args: process.argv.slice(2),
  token: process.env.EDGEONE_PAGES_API_TOKEN,
  source: process.env.PAGES_SOURCE,
  ci: process.env.CI
}))
async function run() {
  for (const entry of JSON.parse(process.env.DEPLOY_TEST_OUTPUT || '[]')) {
    const stream = entry.stream === 'stderr' ? process.stderr : process.stdout
    for (const chunk of entry.chunks) {
      stream.write(chunk)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  if (process.env.DEPLOY_TEST_SIGNAL) process.kill(process.pid, process.env.DEPLOY_TEST_SIGNAL)
  else process.exitCode = Number(process.env.DEPLOY_TEST_EXIT || 0)
}
run().catch(() => { process.exitCode = 99 })
`, { mode: 0o700 })
  }
  return {
    invoked: () => existsSync(capturePath),
    invocation: () => JSON.parse(readFileSync(capturePath, 'utf8')),
    run: (env = {}, args = []) => {
      const result = spawnSync(process.execPath, [deployScript, ...args], {
        cwd,
        // Only the temporary CLI can be resolved. No real credentials or CLI
        // executable are inherited from the machine running these tests.
        env: { PATH: cwd, DEPLOY_TEST_CAPTURE: capturePath, ...env },
        encoding: 'utf8',
        timeout: 5000
      })
      assert.ifError(result.error)
      return result
    }
  }
}

test('missing and invalid tokens fail before invoking the CLI without logging credentials', async t => {
  for (const [name, token] of [
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['embedded space', `${secret()} invalid`],
    ['embedded newline', `${secret()}\ninvalid`]
  ]) {
    await t.test(name, child => {
      const app = fixture(child)
      const result = app.run(token === undefined ? {} : { EDGEONE_PAGES_API_TOKEN: token })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Token/)
      assert.equal(app.invoked(), false)
      if (token?.trim()) assert.equal(`${result.stdout}${result.stderr}`.includes(token), false)
    })
  }
})

test('invalid project names fail before invoking the CLI', async t => {
  for (const projectName of ['-option', '../project', 'two words', 'project;echo unsafe', 'project.example']) {
    await t.test(projectName, child => {
      const app = fixture(child)
      const result = app.run({ EDGEONE_PAGES_API_TOKEN: secret(), EDGEONE_MAKERS_PROJECT_NAME: projectName })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /项目名/)
      assert.equal(app.invoked(), false)
    })
  }
})

test('the default project is deployed to production with its token only in the environment', t => {
  const app = fixture(t)
  const token = secret()
  const result = app.run({ EDGEONE_PAGES_API_TOKEN: `  ${token}  ` })
  assert.equal(result.status, 0)
  assert.deepEqual(app.invocation(), {
    args: ['makers', 'deploy', '--name', 'open-kounter', '--env', 'production', '--json'],
    token,
    source: 'skills',
    ci: 'true'
  })
  assert.equal(app.invocation().args.some(arg => arg.includes(token)), false)
  assert.equal(`${result.stdout}${result.stderr}`.includes(token), false)
})

test('a custom project name is passed as a single argument', t => {
  const app = fixture(t)
  const result = app.run({ EDGEONE_PAGES_API_TOKEN: secret(), EDGEONE_MAKERS_PROJECT_NAME: '  My_Kounter-2  ' })
  assert.equal(result.status, 0)
  assert.deepEqual(app.invocation().args, ['makers', 'deploy', '--name', 'My_Kounter-2', '--env', 'production', '--json'])
})

test('validation mode checks parameters without starting deployment', t => {
  const app = fixture(t)
  const result = app.run({ EDGEONE_PAGES_API_TOKEN: secret() }, ['--validate'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /检查通过/)
  assert.equal(app.invoked(), false)
})

test('CLI failures preserve their exit status', t => {
  const app = fixture(t)
  const result = app.run({
    EDGEONE_PAGES_API_TOKEN: secret(),
    DEPLOY_TEST_EXIT: '23',
    DEPLOY_TEST_OUTPUT: JSON.stringify([{ stream: 'stderr', chunks: ['Deployment rejected\n'] }])
  })
  assert.equal(result.status, 23)
  assert.equal(result.stderr, 'Deployment rejected\n')
})

test('CLI signal termination remains a failed deployment with its signal status', t => {
  const app = fixture(t)
  const result = app.run({ EDGEONE_PAGES_API_TOKEN: secret(), DEPLOY_TEST_SIGNAL: 'SIGTERM' })
  assert.equal(result.status, 128 + os.constants.signals.SIGTERM)
})

test('an unavailable CLI produces a safe failure', t => {
  const app = fixture(t, { installCli: false })
  const token = secret()
  const result = app.run({ EDGEONE_PAGES_API_TOKEN: token })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /无法启动 EdgeOne CLI/)
  assert.equal(`${result.stdout}${result.stderr}`.includes(token), false)
})

test('raw, JSON-escaped and URL-encoded credentials are redacted across output chunks on both streams', t => {
  const app = fixture(t)
  const token = `${secret()}-"\\/+?=%&`
  const variants = [token, JSON.stringify(token).slice(1, -1), encodeURIComponent(token)]
  const output = ['stdout', 'stderr'].flatMap(stream => variants.map((variant, index) => {
    const midpoint = Math.floor(variant.length / 2)
    return {
      stream,
      chunks: [`value${index}=`, variant.slice(0, midpoint), variant.slice(midpoint), index === 2 ? '' : '\n']
    }
  }))
  const result = app.run({ EDGEONE_PAGES_API_TOKEN: token, DEPLOY_TEST_OUTPUT: JSON.stringify(output) })
  assert.equal(result.status, 0)
  const expected = 'value0=[REDACTED]\nvalue1=[REDACTED]\nvalue2=[REDACTED]\n'
  assert.equal(result.stdout, expected)
  assert.equal(result.stderr, expected)
  for (const variant of variants) assert.equal(`${result.stdout}${result.stderr}`.includes(variant), false)
})

test('deployment URLs retain their complete query strings in CLI output', t => {
  const app = fixture(t)
  const url = 'https://open-kounter.example.com/?token=temporary-preview-code&path=%2Fapi%2Fcounter&language=zh#overview'
  const json = JSON.stringify({ deploymentUrl: url })
  const result = app.run({
    EDGEONE_PAGES_API_TOKEN: secret(),
    DEPLOY_TEST_OUTPUT: JSON.stringify([
      { stream: 'stdout', chunks: [json.slice(0, 30), json.slice(30)] },
      { stream: 'stderr', chunks: [`Visit ${url}\n`] }
    ])
  })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, `${json}\n`)
  assert.equal(JSON.parse(result.stdout).deploymentUrl, url)
  assert.equal(result.stderr, `Visit ${url}\n`)
})
