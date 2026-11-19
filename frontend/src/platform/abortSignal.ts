// Older Android WebViews have AbortController and timeout(), but lack any().
// Keep cancellation scopes intact without replacing supported browser methods.
if (typeof AbortSignal !== 'undefined' && typeof AbortController !== 'undefined' && typeof AbortSignal.any !== 'function') {
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!

  Object.defineProperty(AbortSignal, 'any', {
    configurable: true,
    writable: true,
    enumerable: true,
    value: function any(signals: Iterable<AbortSignal>): AbortSignal {
      if (signals === null || !['object', 'function'].includes(typeof signals) || typeof signals[Symbol.iterator] !== 'function') {
        throw new TypeError('AbortSignal.any requires an iterable of AbortSignal objects')
      }
      const sources = new Set<AbortSignal>()
      // Validate the complete sequence before observing already-aborted inputs.
      // The native getter checks the signal brand, including other realms.
      for (const source of signals) { aborted.call(source); sources.add(source) }

      const controller = new AbortController()
      for (const source of sources) {
        if (aborted.call(source)) { controller.abort(source.reason); return controller.signal }
      }

      const listeners = new Map<AbortSignal, () => void>()
      const clear = () => {
        for (const [source, listener] of listeners) source.removeEventListener('abort', listener)
        listeners.clear()
      }
      for (const source of sources) {
        const listener = () => {
          // A synthetic abort event must not cancel a still-active source.
          if (!aborted.call(source) || controller.signal.aborted) return
          clear()
          controller.abort(source.reason)
        }
        listeners.set(source, listener)
        source.addEventListener('abort', listener)
      }
      return controller.signal
    },
  })
}

export {}
