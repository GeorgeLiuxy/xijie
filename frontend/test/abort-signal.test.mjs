import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const code = ts.transpileModule(await readFile(new URL('../src/platform/abortSignal.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText

async function harness(nativeAny) {
  // A distinct constructor lets the VM emulate a WebView without changing
  // Node's real AbortSignal.any or other tests running in this process.
  function Signal() {}
  Signal.prototype = AbortSignal.prototype
  if (nativeAny) Signal.any = nativeAny
  const context = vm.createContext({ AbortSignal: Signal, AbortController })
  const module = new vm.SourceTextModule(code, { context })
  await module.link(() => assert.fail('Unexpected platform import'))
  await module.evaluate()
  return Signal
}

function observed(controller = new AbortController()) {
  const signal = controller.signal, listeners = new Set()
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal)
  let adds = 0, removes = 0
  signal.addEventListener = (type, listener, options) => { if (type === 'abort') { adds++; listeners.add(listener) }; return add(type, listener, options) }
  signal.removeEventListener = (type, listener, options) => { if (type === 'abort') { removes++; listeners.delete(listener) }; return remove(type, listener, options) }
  return { controller, signal, listeners, get adds() { return adds }, get removes() { return removes } }
}

test('missing any uses the first already-aborted input in sequence order and creates no listeners', async () => {
  const Signal = await harness(), a = observed(), b = observed(), earlier = { origin: 'second input, aborted earlier' }, first = { origin: 'first input' }
  b.controller.abort(earlier); a.controller.abort(first)
  const result = Signal.any([a.signal, b.signal])
  assert.equal(result.aborted, true); assert.equal(result.reason, first)
  assert.equal(a.adds + b.adds, 0); assert.notEqual(result, a.signal)
})

test('the first subsequent cancellation preserves its exact reason and removes every source listener', async () => {
  const Signal = await harness(), a = observed(), b = observed(), reason = new Error('the original timeout or scope reason')
  const result = Signal.any([a.signal, b.signal]); let events = 0
  result.addEventListener('abort', () => events++)
  assert.equal(result.aborted, false); assert.equal(a.listeners.size + b.listeners.size, 2)
  b.controller.abort(reason); a.controller.abort('later reason'); b.controller.abort('duplicate reason')
  assert.equal(result.reason, reason); assert.equal(events, 1)
  assert.equal(a.listeners.size + b.listeners.size, 0); assert.equal(a.removes, 1); assert.equal(b.removes, 1)
})

test('empty inputs stay active and duplicate sources register and remove just one listener', async () => {
  const Signal = await harness(), empty = Signal.any([]), a = observed()
  assert.equal(empty.aborted, false); assert.equal(empty.reason, undefined)
  const result = Signal.any([a.signal, a.signal]); assert.equal(a.adds, 1)
  a.controller.abort('once'); assert.equal(result.reason, 'once'); assert.equal(a.removes, 1); assert.equal(a.listeners.size, 0)
})

test('invalid input or element throws before any source listener is registered, even after an aborted input', async () => {
  const Signal = await harness(), a = observed(); a.controller.abort('not an early validation escape')
  for (const input of [undefined, null, '', {}, { 0: a.signal, length: 1 }, [a.signal, {}], [a.signal, null]]) {
    assert.throws(() => Signal.any(input), error => error.name === 'TypeError')
  }
  assert.equal(a.adds, 0)
  let closed = false
  function* invalidSequence() { try { yield a.signal; yield {} } finally { closed = true } }
  assert.throws(() => Signal.any(invalidSequence()), error => error.name === 'TypeError'); assert.equal(closed, true)
})

test('synthetic abort events do not cancel a source that has not been aborted', async () => {
  const Signal = await harness(), a = new AbortController(), b = new AbortController(), result = Signal.any([a.signal, b.signal])
  a.signal.dispatchEvent(new Event('abort')); assert.equal(result.aborted, false)
  a.abort('actual cancellation'); b.abort('later cancellation')
  assert.equal(result.aborted, true); assert.equal(result.reason, 'actual cancellation')
})

test('an existing native any is never replaced and the compatibility module is the first startup import', async () => {
  const native = () => 'native result', Signal = await harness(native)
  assert.equal(Signal.any, native); assert.equal(Signal.any(), 'native result')
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('main.tsx', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(ast.statements[0].moduleSpecifier.text, './platform/abortSignal')
})
