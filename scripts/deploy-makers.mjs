import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { createInterface } from 'node:readline'

const token = process.env.EDGEONE_PAGES_API_TOKEN?.trim()
const projectName = process.env.EDGEONE_MAKERS_PROJECT_NAME?.trim() || 'open-kounter'

if (!token || /\s/.test(token)) {
  console.error('请填写有效的 EdgeOne Makers Token（EDGEONE_PAGES_API_TOKEN），不能包含空白字符。')
  process.exitCode = 1
} else if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectName)) {
  console.error('项目名须以字母或数字开头，且仅包含字母、数字、下划线或连字符。')
  process.exitCode = 1
} else if (process.argv.includes('--validate')) {
  console.log('部署参数检查通过。')
} else {
  // Keep credentials out of shell scripts and command-line arguments. Read lines
  // before redacting so a token split across stdout/stderr chunks is still hidden.
  const secrets = [token, JSON.stringify(token).slice(1, -1), encodeURIComponent(token)]
  const redact = line => secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), line)
  const child = spawn('edgeone', ['makers', 'deploy', '--name', projectName, '--env', 'production', '--json'], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, EDGEONE_PAGES_API_TOKEN: token, PAGES_SOURCE: 'skills', CI: 'true' }
  })
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    lines.on('line', line => output.write(`${redact(line)}\n`))
  }
  child.on('error', () => {
    console.error('无法启动 EdgeOne CLI，请确认已安装流水线指定的 edgeone 版本。')
    process.exitCode = 1
  })
  child.on('close', (code, signal) => {
    process.exitCode = code !== null && code >= 0 ? code : (signal ? 128 + (constants.signals[signal] || 0) : 1)
  })
}
