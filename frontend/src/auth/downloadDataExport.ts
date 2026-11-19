import { isNativeRuntime } from '../mobile/back'
import { RightsError, rightsFetch, uuid, type RightsContext } from './dataRightsClient'

const maximumBytes = 64 * 1024 * 1024
type SavedExport = { fileName: string; bytes: number; sha256: string }
type Bridge = { nativePromise?: (plugin: string, method: string, data: Record<string, unknown>) => Promise<unknown> }
export type ExportDownload = { kind: 'browser' } | ({ kind: 'saved' } & SavedExport)

/** The native bridge receives identifiers only, never an arbitrary URL, cookie or document body. */
export async function downloadDataExport(requestId: string, downloadUrl: string, context: RightsContext, signal: AbortSignal): Promise<ExportDownload> {
  const prefix = '/v1/accounts/me/data-requests/' + requestId + '/content?grant='
  const grantId = downloadUrl.startsWith(prefix) ? downloadUrl.slice(prefix.length) : ''
  if (!uuid.test(requestId) || !uuid.test(context.sessionId) || !uuid.test(grantId)) throw new RightsError(502, 'INVALID_RESPONSE')
  signal.throwIfAborted()
  if (!isNativeRuntime()) {
    const response = await rightsFetch(downloadUrl, signal, context)
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new RightsError(502, 'INVALID_RESPONSE')
    const blob = await response.blob()
    signal.throwIfAborted()
    if (!blob.size || blob.size > maximumBytes) throw new RightsError(413, 'EXPORT_TOO_LARGE')
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'xijie-data-' + requestId + '.json'; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    return { kind: 'browser' }
  }
  const bridge = (window as Window & { Capacitor?: Bridge }).Capacitor
  if (!bridge?.nativePromise) throw new RightsError(503, 'NATIVE_EXPORT_UNAVAILABLE')
  const operationId = crypto.randomUUID()
  const cancel = () => { void bridge.nativePromise!('DataExport', 'cancel', { operationId, expectedSessionId: context.sessionId }).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const value = await bridge.nativePromise('DataExport', 'save', { requestId, grantId, expectedSessionId: context.sessionId, operationId }) as SavedExport
    signal.throwIfAborted()
    if (!value || typeof value.fileName !== 'string' || !value.fileName.trim() || value.fileName.length > 255 || /[\p{C}/\\]/u.test(value.fileName)
      || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > maximumBytes || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new RightsError(502, 'INVALID_RESPONSE')
    return { kind: 'saved', fileName: value.fileName, bytes: value.bytes, sha256: value.sha256 }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof RightsError) throw error
    const failure = error as { code?: unknown; data?: { status?: unknown } }
    const code = typeof failure?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(failure.code) ? failure.code : 'NATIVE_EXPORT_UNAVAILABLE'
    if (code === 'EXPORT_WEBVIEW_OUTDATED') throw new RightsError(503, code)
    const status = Number.isInteger(failure?.data?.status) && Number(failure.data!.status) >= 400 && Number(failure.data!.status) <= 599 ? Number(failure.data!.status) : 503
    throw new RightsError(status, code)
  } finally { signal.removeEventListener('abort', cancel) }
}
