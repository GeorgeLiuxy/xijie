export type SpeechResult = ArrayLike<{ transcript: string }> & {
  isFinal: boolean
}
export type BrowserRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null
}
export type RecognitionConstructor = new () => BrowserRecognition
export class VoiceInputError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
export function browserRecognition(): RecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}
// stop() can deliver its final result asynchronously. Interim text is never sent.
// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop
export function startVoiceInput(options: {
  Recognition?: RecognitionConstructor
  language: string
  onInterim: (text: string) => void
  onError?: (code: string) => void
  maximumMs?: number
  finishMs?: number
}) {
  if (!options.Recognition) throw new VoiceInputError("RECOGNITION_UNAVAILABLE")
  const recognition = new options.Recognition()
  let done = false,
    canceled = false,
    finishing = false,
    finalText = "",
    finishTimer: ReturnType<typeof setTimeout> | undefined,
    maximumTimer: ReturnType<typeof setTimeout> | undefined
  let complete: (value: { text: string; error?: string }) => void
  const result = new Promise<{ text: string; error?: string }>((resolve) => {
    complete = resolve
  })
  const abort = () => {
    try {
      recognition.abort()
    } catch {
      /* A late onstart also aborts canceled permission prompts. */
    }
  }
  const settle = (value: { text: string; error?: string }) => {
    if (done) return
    done = true
    clearTimeout(maximumTimer)
    clearTimeout(finishTimer)
    complete(value)
  }
  recognition.lang = options.language
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  recognition.onstart = () => {
    if (done) abort()
    else if (finishing)
      try {
        recognition.stop()
      } catch {
        abort()
        settle({ text: "", error: "RECOGNITION_CANCELED" })
      }
  }
  recognition.onresult = (event) => {
    if (done) return
    let final = "",
      interim = ""
    for (let i = 0; i < event.results.length; i++) {
      const part = event.results[i]?.[0]?.transcript ?? ""
      if (event.results[i].isFinal) final += part
      else interim += part
    }
    finalText = final
    options.onInterim(final + interim)
  }
  recognition.onerror = (event) => {
    if (done) return
    // A refused speech service does not establish missing microphone permission.
    // https://webaudio.github.io/web-speech-api/#speechrecognitionerrorevent
    const code = event.error === "not-allowed"
      ? "MICROPHONE_DENIED"
      : event.error === "service-not-allowed"
        ? "RECOGNITION_UNAVAILABLE"
        : event.error === "network"
          ? "RECOGNITION_NETWORK_ERROR"
          : event.error === "no-speech"
            ? "NO_SPEECH"
            : "RECOGNITION_FAILED"
    settle({ text: "", error: code })
    abort()
    options.onError?.(code)
  }
  recognition.onend = () => settle({ text: finalText.trim() })
  try {
    recognition.start()
  } catch {
    settle({ text: "", error: "RECOGNITION_FAILED" })
    abort()
    throw new VoiceInputError("RECOGNITION_FAILED")
  }
  if (!done)
    maximumTimer = setTimeout(() => {
      if (done) return
      settle({ text: "", error: "RECOGNITION_TIMEOUT" })
      abort()
      options.onError?.("RECOGNITION_TIMEOUT")
    }, options.maximumMs ?? 60000)
  return {
    cancel() {
      canceled = true
      settle({ text: "", error: "RECOGNITION_CANCELED" })
      abort()
    },
    async finish() {
      if (!done && !finishing) {
        finishing = true
        finishTimer = setTimeout(() => {
          settle({ text: finalText.trim() })
          abort()
        }, options.finishMs ?? 2500)
        try {
          recognition.stop()
        } catch {
          settle({ text: "", error: "RECOGNITION_FAILED" })
          abort()
        }
      }
      const value = await result
      if (canceled) throw new VoiceInputError("RECOGNITION_CANCELED")
      if (value.error) throw new VoiceInputError(value.error)
      if (!value.text) throw new VoiceInputError("NO_SPEECH")
      return value.text
    },
  }
}
