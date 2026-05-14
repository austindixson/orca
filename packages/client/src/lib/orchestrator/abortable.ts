/** Rejects with AbortError when `signal` aborts before `ms` elapses. */
export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!ms || ms <= 0) return
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  await new Promise<void>((resolve, reject) => {
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

/** Rejects when `signal` aborts (for `Promise.race` with other work). */
export function abortAsPromise(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
}
