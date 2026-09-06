// Abort saves work; the sequence also protects against transports that ignore abort.
export function createLatestRequest(timeoutMs = 15000) {
  let sequence = 0
  let active = null
  return {
    async run(task, { onStart, onSuccess, onError, onFinally }) {
      const id = ++sequence
      active?.abort()
      const controller = new AbortController()
      active = controller
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      onStart?.()
      try {
        const result = await task(controller.signal)
        if (id === sequence) {
          if (timedOut) throw new Error('请求超时，请重试')
          await onSuccess?.(result)
        }
      } catch (error) {
        if (id === sequence) onError?.(timedOut ? new Error('请求超时，请重试') : error)
      } finally {
        clearTimeout(timer)
        if (id === sequence) {
          active = null
          onFinally?.()
        }
      }
    },
    cancel() {
      sequence++
      active?.abort()
      active = null
    }
  }
}
