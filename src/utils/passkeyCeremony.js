import { requestJson } from './requestJson.js'

// Each ceremony owns only its returned challenge, never another tab's challenge.
export function createPasskeyCeremony({ signal, pageTarget = window } = {}) {
  const controller = new AbortController()
  let challengeId = null
  let keepalive = false
  let completed = false
  let optionsRequested = false

  const cleanup = () => {
    if (!challengeId || completed) return
    const cancelledId = challengeId
    challengeId = null
    // Do not reuse the cancelled ceremony signal or block the next user attempt.
    void requestJson('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancelChallenge', data: { challengeId: cancelledId } }),
      timeoutMs: 5000,
      keepalive
    }).catch(() => {})
  }
  const detach = () => {
    signal?.removeEventListener('abort', onAbort)
    pageTarget.removeEventListener('pagehide', onPageHide)
  }
  const cancel = (options = {}) => {
    keepalive ||= options.keepalive === true
    controller.abort()
    cleanup()
    detach()
  }
  const onAbort = () => cancel()
  const onPageHide = () => cancel({ keepalive: true })
  signal?.addEventListener('abort', onAbort, { once: true })
  pageTarget.addEventListener('pagehide', onPageHide)
  if (signal?.aborted) cancel()

  // Also settle promptly when a browser implementation ignores the native signal.
  const wait = async (task) => {
    let onCancel
    const cancelled = new Promise((resolve, reject) => {
      onCancel = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onCancel, { once: true })
      if (controller.signal.aborted) onCancel()
    })
    try {
      return await Promise.race([task, cancelled])
    } finally {
      controller.signal.removeEventListener('abort', onCancel)
    }
  }

  return {
    signal: controller.signal,
    get active() { return !controller.signal.aborted },
    wait,
    async generate(action, data) {
      if (controller.signal.aborted) throw controller.signal.reason
      if (optionsRequested) throw new Error('请为每次 Passkey 请求创建独立流程')
      optionsRequested = true
      // Keep the bounded options request alive long enough to learn a late ID.
      // If no response arrives, server-side expiry cleanup remains the fallback.
      const pending = requestJson('/api/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data })
      }).then(result => {
        if (result.code !== 0) throw new Error(result.message || 'Passkey 请求失败')
        if (typeof result.data?.challengeId !== 'string' || !result.data.challengeId) {
          throw new Error('Passkey 响应格式异常')
        }
        challengeId = result.data.challengeId
        if (controller.signal.aborted) cleanup()
        return result.data
      })
      return await wait(pending)
    },
    complete() {
      completed = true
      challengeId = null
      detach()
    },
    cancel
  }
}
