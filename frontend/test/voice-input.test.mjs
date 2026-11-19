import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import ts from "../../node_modules/typescript/lib/typescript.js"
const code = ts.transpileModule(
  await readFile(new URL("../src/voiceInput.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText
const { startVoiceInput } = await import(
  "data:text/javascript," + encodeURIComponent(code)
)
function fixture(options = {}) {
  let engine
  class Recognition {
    constructor() {
      engine = this
      this.stops = 0
      this.aborts = 0
    }
    start() {
      options.start?.(this)
    }
    stop() {
      this.stops++
      options.stop?.(this)
    }
    abort() {
      this.aborts++
    }
    result(text, isFinal) {
      const value = [{ transcript: text }]
      value.isFinal = isFinal
      this.onresult({ results: [value] })
    }
  }
  const interim = [],
    errors = [],
    recording = startVoiceInput({
      Recognition,
      language: "zh-CN",
      onInterim: (text) => interim.push(text),
      onError: (code) => errors.push(code),
      ...options,
    })
  return {
    recording,
    interim,
    errors,
    get engine() {
      return engine
    },
  }
}
test("release waits for the actual asynchronous final result, and interim text never becomes sent content", async () => {
  const f = fixture()
  f.engine.result("未完成的临时句子", false)
  let finished = false
  const pending = f.recording.finish().then((text) => {
    finished = true
    return text
  })
  await Promise.resolve()
  assert.equal(finished, false)
  assert.equal(f.engine.stops, 1)
  f.engine.result("真实识别的最终文字", true)
  assert.equal(finished, false)
  f.engine.onend()
  assert.equal(await pending, "真实识别的最终文字")
  assert.deepEqual(f.interim, ["未完成的临时句子", "真实识别的最终文字"])
})
test("slide cancellation fences late results and a delayed permission start aborts instead of opening the microphone", async () => {
  const f = fixture()
  f.recording.cancel()
  f.engine.onstart()
  f.engine.result("迟到文字", true)
  f.engine.onend()
  await assert.rejects(
    f.recording.finish(),
    (e) => e.code === "RECOGNITION_CANCELED",
  )
  assert(f.engine.aborts >= 2)
  assert.equal(f.interim.length, 0)
})
test("empty or interim-only recognition sends no fallback sentence", async () => {
  for (const interim of [false, true]) {
    const f = fixture()
    if (interim) f.engine.result("只有临时结果", false)
    f.engine.onend()
    await assert.rejects(f.recording.finish(), (e) => e.code === "NO_SPEECH")
  }
})
test("denied microphone, refused speech service and failed network discard even a previously recognized final segment", async () => {
  for (const [error, code] of [
    ["not-allowed", "MICROPHONE_DENIED"],
    ["service-not-allowed", "RECOGNITION_UNAVAILABLE"],
    ["network", "RECOGNITION_NETWORK_ERROR"],
  ]) {
    const f = fixture()
    f.engine.result("尚未确认的文字", true)
    f.engine.onerror({ error })
    f.engine.result("迟到的识别结果", true)
    await assert.rejects(f.recording.finish(), (e) => e.code === code)
    assert.deepEqual(f.errors, [code])
    assert.deepEqual(f.interim, ["尚未确认的文字"])
    assert(f.engine.aborts > 0)
  }
})
test("a finished engine remains cancelable before the user releases, and repeated finishes stop the engine once", async () => {
  const f = fixture()
  f.engine.result("最终文字", true)
  const a = f.recording.finish(),
    b = f.recording.finish()
  assert.equal(f.engine.stops, 1)
  f.engine.onend()
  assert.equal(await a, "最终文字")
  assert.equal(await b, "最终文字")
  f.recording.cancel()
  await assert.rejects(
    f.recording.finish(),
    (e) => e.code === "RECOGNITION_CANCELED",
  )
})
test("unsupported, synchronous failure and finite microphone timeout fail without fabricated content", async () => {
  assert.throws(
    () => startVoiceInput({ language: "zh-CN", onInterim() {} }),
    (e) => e.code === "RECOGNITION_UNAVAILABLE",
  )
  assert.throws(
    () =>
      fixture({
        start() {
          throw Error("device")
        },
      }),
    (e) => e.code === "RECOGNITION_FAILED",
  )
  const f = fixture({ maximumMs: 10 })
  await new Promise((r) => setTimeout(r, 25))
  await assert.rejects(
    f.recording.finish(),
    (e) => e.code === "RECOGNITION_TIMEOUT",
  )
  assert.deepEqual(f.errors, ["RECOGNITION_TIMEOUT"])
})
