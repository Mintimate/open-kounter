// Bound the complete response, including body reads and transports that ignore abort.
export async function requestJson(url, { timeoutMs = 15000, signal, ...options } = {}) {
  const controller = new AbortController()
  let rejectCancelled
  const cancelled = new Promise((resolve, reject) => { rejectCancelled = reject })
  const cancel = (reason) => {
    controller.abort(reason)
    rejectCancelled(reason)
  }
  const onAbort = () => cancel(signal.reason || new DOMException('请求已取消', 'AbortError'))
  const timer = setTimeout(() => cancel(new Error('请求超时，请重试')), timeoutMs)
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (signal?.aborted) onAbort()
    const response = (async () => {
      if (controller.signal.aborted) throw controller.signal.reason
      const res = await fetch(url, { ...options, signal: controller.signal })
      if (!res.ok) throw new Error(`服务暂时不可用（HTTP ${res.status}），请重试`)
      let data
      try {
        data = await res.json()
      } catch {
        throw new Error('服务响应格式异常，请重试')
      }
      if (!data || ![0, 1000, 1404].includes(data.code)) {
        throw new Error('服务响应格式异常，请重试')
      }
      return data
    })()
    return await Promise.race([response, cancelled])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
