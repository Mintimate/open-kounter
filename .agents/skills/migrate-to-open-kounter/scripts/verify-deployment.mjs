#!/usr/bin/env node

const PROBE_TARGET = '__open_kounter_probe__'
const TIMEOUT_MS = 10_000

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function fail(message, details = {}) {
  printResult({
    ok: false,
    message,
    ...details
  })
  process.exitCode = 1
}

function parseArguments(argv) {
  const [rawBaseUrl, ...rest] = argv
  let origin = null

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== '--origin' || !rest[index + 1]) {
      throw new Error('Usage: verify-deployment.mjs <https-base-url> [--origin <https-origin>]')
    }
    origin = rest[index + 1]
    index += 1
  }

  if (!rawBaseUrl) {
    throw new Error('Missing Open Kounter base URL')
  }

  const parsedBaseUrl = new URL(rawBaseUrl)
  if (parsedBaseUrl.protocol !== 'https:') {
    throw new Error('The Open Kounter base URL must use HTTPS')
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new Error('The Open Kounter base URL must not contain credentials, a query, or a fragment')
  }
  if (parsedBaseUrl.pathname !== '/' && parsedBaseUrl.pathname !== '') {
    throw new Error('The Open Kounter base URL must not contain a path')
  }

  let normalizedOrigin = null
  if (origin) {
    const parsedOrigin = new URL(origin)
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin.replace(/\/$/, '')) {
      throw new Error('The website origin must be an HTTPS origin without a path')
    }
    normalizedOrigin = parsedOrigin.origin
  }

  return {
    baseUrl: parsedBaseUrl.origin,
    origin: normalizedOrigin
  }
}

async function main() {
  let input
  try {
    input = parseArguments(process.argv.slice(2))
  } catch (error) {
    fail(error.message)
    return
  }

  const endpoint = new URL('/api/counter', input.baseUrl)
  endpoint.searchParams.set('target', PROBE_TARGET)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(input.origin ? { Origin: input.origin } : {})
      },
      signal: controller.signal
    })

    const contentType = response.headers.get('content-type') || ''
    if (response.status !== 200) {
      fail('The public counter endpoint did not return HTTP 200', {
        baseUrl: input.baseUrl,
        status: response.status
      })
      return
    }
    if (!contentType.toLowerCase().includes('application/json')) {
      fail('The public counter endpoint did not return JSON', {
        baseUrl: input.baseUrl,
        contentType
      })
      return
    }

    const body = await response.json()
    if (
      body?.code !== 0 ||
      body?.data?.target !== PROBE_TARGET ||
      typeof body?.data?.time !== 'number'
    ) {
      fail('The response does not match the Open Kounter counter contract', {
        baseUrl: input.baseUrl,
        code: body?.code ?? null,
        target: body?.data?.target ?? null
      })
      return
    }

    const allowOrigin = response.headers.get('access-control-allow-origin')
    if (input.origin && allowOrigin !== '*' && allowOrigin !== input.origin) {
      fail('The endpoint did not allow the supplied website origin through CORS', {
        baseUrl: input.baseUrl,
        origin: input.origin,
        allowOrigin
      })
      return
    }

    printResult({
      ok: true,
      message: 'Verified Open Kounter public counter endpoint',
      baseUrl: input.baseUrl,
      endpoint: endpoint.toString(),
      corsOrigin: input.origin,
      allowOrigin,
      probe: {
        target: body.data.target,
        time: body.data.time
      }
    })
  } catch (error) {
    fail(
      error.name === 'AbortError'
        ? `The deployment probe timed out after ${TIMEOUT_MS}ms`
        : 'Unable to reach or parse the Open Kounter endpoint',
      {
        baseUrl: input.baseUrl,
        error: error.message
      }
    )
  } finally {
    clearTimeout(timeout)
  }
}

await main()
