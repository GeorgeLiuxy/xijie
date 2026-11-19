import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import ts from "../../node_modules/typescript/lib/typescript.js"
const code = ts.transpileModule(
    await readFile(
      new URL("../src/personVoiceRecorder.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText,
  { createPersonVoiceRecorder } = await import(
    "data:text/javascript," + encodeURIComponent(code)
  )
const deferred = () => {
  let resolve
  return {
    promise: new Promise((r) => (resolve = r)),
    resolve: (v) => resolve(v),
  }
}
function fixture(options = {}) {
  const states = [],
    blobs = [],
    errors = [],
    engines = []
  let stopped = 0
  const stream = {
    getTracks: () => [
      {
        stop() {
          stopped++
        },
      },
    ],
  }
  class Recorder {
    static isTypeSupported(type) {
      return type === "audio/webm;codecs=opus"
    }
    constructor() {
      this.state = "inactive"
      this.mimeType = "audio/webm;codecs=opus"
      engines.push(this)
    }
    start() {
      this.state = "recording"
    }
    stop() {
      this.state = "inactive"
    }
    chunk(text) {
      this.ondataavailable({ data: new Blob([text], { type: this.mimeType }) })
    }
  }
  const recorder = createPersonVoiceRecorder({
    Recorder,
    mediaDevices: { getUserMedia: async () => stream },
    onState: (s) => states.push(s),
    onBlob: (b) => blobs.push(b),
    onError: (e) => errors.push(e),
    ...options,
  })
  return {
    recorder,
    states,
    blobs,
    errors,
    engines,
    stream,
    get stopped() {
      return stopped
    },
  }
}
test("confirmed recording contains only actual MediaRecorder chunks and stops every microphone track", async () => {
  const f = fixture()
  await f.recorder.start()
  f.engines[0].chunk("actual encoded chunk")
  f.recorder.stop()
  assert.equal(f.blobs.length, 0)
  f.engines[0].onstop()
  assert.equal(await f.blobs[0].text(), "actual encoded chunk")
  assert.equal(f.stopped, 1)
  assert.deepEqual(f.states, ["requesting", "recording", "idle"])
  f.recorder.dispose()
})
test("release while the permission prompt is open cannot start a late microphone or produce a saved clip", async () => {
  const wait = deferred(),
    f = fixture({ mediaDevices: { getUserMedia: () => wait.promise } }),
    starting = f.recorder.start()
  f.recorder.stop()
  wait.resolve(f.stream)
  await starting
  assert.equal(f.engines.length, 0)
  assert.equal(f.blobs.length, 0)
  assert.equal(f.stopped, 1)
  f.recorder.dispose()
})
test("cancel and unmount discard late encoded data and stop microphone tracks", async () => {
  for (const dispose of [false, true]) {
    const f = fixture()
    await f.recorder.start()
    f.engines[0].chunk("private capture")
    if (dispose) f.recorder.dispose()
    else f.recorder.cancel()
    f.engines[0].chunk("late private chunk")
    f.engines[0].onstop()
    assert.equal(f.blobs.length, 0)
    assert(f.stopped >= 1)
    f.recorder.dispose()
  }
})
test("denied permission, empty recording and unsupported platform never create synthetic samples", async () => {
  const denied = fixture({
    mediaDevices: {
      getUserMedia: async () => {
        const e = Error()
        e.name = "NotAllowedError"
        throw e
      },
    },
  })
  await denied.recorder.start()
  assert.deepEqual(denied.errors, ["MICROPHONE_DENIED"])
  const empty = fixture()
  await empty.recorder.start()
  empty.recorder.stop()
  empty.engines[0].onstop()
  assert.equal(empty.blobs.length, 0)
  assert.deepEqual(empty.errors, ["NO_AUDIO_CAPTURED"])
  const unavailable = fixture({ Recorder: undefined })
  await unavailable.recorder.start()
  assert.deepEqual(unavailable.errors, ["RECORDING_UNAVAILABLE"])
  denied.recorder.dispose()
  empty.recorder.dispose()
  unavailable.recorder.dispose()
})
