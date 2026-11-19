export type VoiceRecorderState = "idle" | "requesting" | "recording"
type Track = { stop: () => void }
type Stream = { getTracks: () => Track[] }
type Recorder = Pick<MediaRecorder,'state'|'mimeType'|'start'|'stop'|'ondataavailable'|'onstop'|'onerror'>
export type VoiceRecorderConstructor = {
  new (stream: any, options?: { mimeType: string }): Recorder
  isTypeSupported?: (mime: string) => boolean
}
export function createPersonVoiceRecorder(options: {
  mediaDevices?: {
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<any>
  }
  Recorder?: VoiceRecorderConstructor
  onState: (state: VoiceRecorderState) => void
  onBlob: (blob: Blob) => void
  onError: (code: string) => void
  maximumMs?: number
}) {
  type Take = {
    stream?: Stream
    recorder?: Recorder
    chunks: Blob[]
    commit: boolean
    stopping: boolean
    timer?: ReturnType<typeof setTimeout>
    stoppedTracks?: boolean
  }
  let active = true,
    current: Take | undefined
  const clean = (take: Take) => {
    clearTimeout(take.timer)
    if(take.stream&&!take.stoppedTracks){take.stoppedTracks=true;take.stream.getTracks().forEach((track) => track.stop())}
  }
  function stop(commit = true) {
    const take = current
    if (!take) return
    take.commit = commit
    take.stopping = true
    clearTimeout(take.timer)
    if (take.recorder) {
      if (take.recorder.state !== "inactive")
        try {
          take.recorder.stop()
        } catch {
          clean(take)
          take.chunks = []
          current = undefined
          options.onState("idle")
          if (active) options.onError("RECORDING_FAILED")
        }
    } else {
      current = undefined
      clean(take)
      if (active) options.onState("idle")
    }
  }
  return {
    async start() {
      if (!active || current) return
      if (!options.mediaDevices || !options.Recorder) {
        options.onError("RECORDING_UNAVAILABLE")
        return
      }
      const take: Take = { chunks: [], commit: false, stopping: false }
      current = take
      options.onState("requesting")
      try {
        const stream = await options.mediaDevices.getUserMedia({
          audio: { channelCount: 1 },
          video: false,
        })
        take.stream = stream
        if (!active || current !== take || take.stopping) {
          clean(take)
          return
        }
        const format = [
            "audio/webm;codecs=opus",
            "audio/ogg;codecs=opus",
            "audio/mp4",
          ].find((type) => options.Recorder!.isTypeSupported?.(type)),
          recorder = new options.Recorder(
            stream,
            format ? { mimeType: format } : undefined,
          )
        take.recorder = recorder
        recorder.ondataavailable = (event) => {
          if (active && current === take && event.data.size)
            take.chunks.push(event.data)
        }
        recorder.onstop = () => {
          clean(take)
          if (!active || current !== take) {
            take.chunks = []
            return
          }
          current = undefined
          options.onState("idle")
          if (take.commit) {
            const type = recorder.mimeType || take.chunks[0]?.type || "",
              blob = new Blob(take.chunks, { type })
            if (blob.size) options.onBlob(blob)
            else options.onError("NO_AUDIO_CAPTURED")
          }
          take.chunks = []
        }
        recorder.onerror = () => {
          take.commit = false
          take.chunks = []
          clean(take)
          if (current === take) {
            current = undefined
            if (active) {
              options.onState("idle")
              options.onError("RECORDING_FAILED")
            }
          }
          try {
            if (recorder.state !== "inactive") recorder.stop()
          } catch {}
        }
        recorder.start(250)
        options.onState("recording")
        take.timer = setTimeout(() => {
          if (current === take) stop(true)
        }, options.maximumMs ?? 30000)
      } catch (error) {
        clean(take)
        if (current !== take || !active) return
        current = undefined
        options.onState("idle")
        options.onError(
          error instanceof Error &&
            ["NotAllowedError", "SecurityError"].includes(error.name)
            ? "MICROPHONE_DENIED"
            : "RECORDING_FAILED",
        )
      }
    },
    stop,
    cancel() {
      stop(false)
    },
    dispose() {
      active = false
      const take = current
      current = undefined
      if (take) {
        take.commit = false
        clean(take)
        try {
          if (take.recorder?.state !== "inactive") take.recorder?.stop()
        } catch {}
        take.chunks = []
      }
    },
  }
}
