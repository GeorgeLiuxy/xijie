import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react"
import { Sheet as BaseSheet } from "./ui"
import { isZh, useI18n } from "./i18n"
import {
  createReportClient,
  ContentReportError,
  type ReportContext,
  type ReportTarget,
  type ContentReport,
} from "./serviceReports"
const Reports = createContext<{
  open: (target: ReportTarget) => void
  history: () => void
} | undefined>(undefined)
function Sheet(props: ComponentProps<typeof BaseSheet>) {
  return (
    <div className="absolute inset-0 z-[155]">
      <BaseSheet {...props} />
    </div>
  )
}
export const useContentReports = () => useContext(Reports)
export function ReportHistoryButton() {
  const reports = useContentReports(),
    { lang } = useI18n()
  return reports ? (
    <button
      onClick={reports.history}
      className="my-3 w-full rounded-xl ring-1 ring-line px-4 py-3 text-left text-sm text-ink"
    >
      {isZh(lang) ? "举报记录与处理进度" : "Your reports and progress"}
    </button>
  ) : null
}
export function ContentReports({
  context,
  children,
}: {
  context?: ReportContext
  children: ReactNode
}) {
  const { lang } = useI18n(),
    zh = isZh(lang),
    client = useMemo(
      () => (context ? createReportClient(context) : undefined),
      [context?.accountId, context?.sessionId],
    ),
    alive = useRef(true), stateOwner = useRef(client), currentClient = useRef(client)
  currentClient.current = client
  const [target, setTarget] = useState<ReportTarget | null>(null),
    [showHistory, setHistory] = useState(false),
    [reason, setReason] = useState("other"),
    [note, setNote] = useState(""),
    [pending, setPending] = useState(false),
    [frozen, setFrozen] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<ContentReport | null>(null),
    [rows, setRows] = useState<ContentReport[]>([]),
    [cursor, setCursor] = useState<string | null>(null)
  // Reset only report UI during render, without remounting the application's children.
  if (stateOwner.current !== client) {
    stateOwner.current = client
    setTarget(null); setHistory(false); setReason('other'); setNote(''); setPending(false)
    setFrozen(false); setError(''); setSaved(null); setRows([]); setCursor(null)
  }
  const current = () => alive.current && currentClient.current === client
  useEffect(() => {
    alive.current = true
    client?.activate()
    return () => {
      alive.current = false
      client?.dispose()
    }
  }, [client])
  const load = async (append = false) => {
    if (!client) return
    setPending(true)
    setError("")
    try {
      const result = await client.list(
        append ? (cursor ?? undefined) : undefined,
      )
      if (current()) {
        setRows((old) => (append ? [...old, ...result.data] : result.data))
        setCursor(result.nextCursor)
      }
    } catch (problem) {
      if (current())
        setError(
          problem instanceof ContentReportError && problem.status === 401
            ? zh ? '登录已过期，请重新登录后查看举报进度。' : 'Your session expired. Sign in again to view report progress.'
            : zh ? '暂时没能打开举报记录，请点「刷新进度」再试一次。' : 'Reports could not be opened. Select Refresh progress to try again.',
        )
    } finally {
      if (current()) setPending(false)
    }
  }
  const api = useMemo(
    () =>
      client
        ? {
            open(t: ReportTarget) {
              setTarget(t)
              setHistory(false)
              setSaved(null)
              setError("")
              try {
                const old = client.pending(t)
                setReason(old?.body.reason ?? "other")
                setNote(old?.body.note ?? "")
                setFrozen(!!old)
              } catch {
                setFrozen(true)
                setError(
                  zh
                    ? "暂时无法恢复提交记录，请稍后重试。"
                    : "The pending report could not be recovered. Please retry later.",
                )
              }
            },
            history() {
              setTarget(null)
              setHistory(true)
              void load()
            },
          }
        : undefined,
    [client, zh],
  )
  const submit = async () => {
    if (!client || !target || pending) return
    setPending(true)
    setError("")
    setFrozen(true)
    try {
      const result = await client.submit(target, reason, note)
      if (current()) setSaved(result)
    } catch (problem) {
      if (current()) {
        try { setFrozen(!!client.pending(target)) } catch { setFrozen(true) }
        setError(
          problem instanceof ContentReportError && problem.status === 400
            ? zh ? '请检查举报原因和补充说明，再试一次。' : 'Review the reason and note, then submit again.'
            : problem instanceof ContentReportError && problem.status === 401
              ? zh ? '登录已过期，说明已保留，请重新登录后再试。' : 'Your session expired. Your note is kept; sign in again and retry.'
              : problem instanceof ContentReportError && problem.status === 404
                ? zh ? '这条内容已无法打开，说明已保留。请返回后查看举报记录。' : 'This content is unavailable. Your note is kept; go back and check your reports.'
                : zh ? '还没收到提交结果，说明已保留。点「重试这次提交」即可，不会重复提交。' : 'Submission is not yet confirmed. Your note is kept. Select Retry submission; it will not create a duplicate report.',
        )
      }
    } finally {
      if (current()) setPending(false)
    }
  }
  const close = () => {
    if (!pending) {
      setTarget(null)
      setHistory(false)
    }
  }
  return (
    <Reports.Provider value={api}>
      <div className="contents" inert={!!target || showHistory}>
        {children}
      </div>
      {client && target && (
        <Sheet
          title={zh ? "举报与反馈" : "Report content"}
          onClose={close}
          footer={
            !saved ? (
              <button
                disabled={pending}
                onClick={() => void submit()}
                className="w-full rounded-full bg-ink py-3 text-paper disabled:opacity-50"
              >
                {pending
                  ? zh
                    ? "正在提交…"
                    : "Submitting…"
                  : frozen
                    ? zh
                      ? "重试这次提交"
                      : "Retry submission"
                    : zh
                      ? "提交"
                      : "Submit"}
              </button>
            ) : (
              <button
                onClick={() => {
                  setTarget(null)
                  api?.history()
                }}
                className="w-full rounded-full bg-ink py-3 text-paper"
              >
                {zh ? "查看处理进度" : "View progress"}
              </button>
            )
          }
        >
          {saved ? (
            <p role="status" className="text-sm leading-relaxed text-ink-soft">
              {zh
                ? "已收到，会依据内容与相关规则处理。你可以在举报记录中查看进度。"
                : "Received. You can follow its progress in your reports."}
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                {zh
                  ? "请选择原因。补充说明仅用于处理本次反馈。"
                  : "Choose a reason. Your note is used to review this report."}
              </p>
              <label className="block text-sm text-ink">
                {zh ? "原因" : "Reason"}
                <select
                  aria-label={zh ? "原因" : "Reason"}
                  disabled={frozen || pending}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-cloud p-3"
                >
                  {[
                    ["harmful", zh ? "有害内容" : "Harmful content"],
                    ["privacy", zh ? "隐私问题" : "Privacy"],
                    ["impersonation", zh ? "冒用身份" : "Impersonation"],
                    ["spam", zh ? "垃圾内容" : "Spam"],
                    ["other", zh ? "其他" : "Other"],
                  ].map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-ink">
                {zh ? "补充说明（选填）" : "Note (optional)"}
                <textarea
                  aria-label={zh ? "补充说明（选填）" : "Note (optional)"}
                  disabled={frozen || pending}
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-2 min-h-28 w-full rounded-xl bg-cloud p-3"
                />
              </label>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-coral">
              {error}
            </p>
          )}
        </Sheet>
      )}
      {client && showHistory && (
        <Sheet title={zh ? "举报记录" : "Your reports"} onClose={close} tall>
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="border-b border-line py-3">
                <p className="text-sm text-ink">
                  {row.status === "resolved"
                    ? zh
                      ? "已处理"
                      : "Resolved"
                    : row.status === "reviewing"
                      ? zh
                        ? "处理中"
                        : "In review"
                      : zh
                        ? "已收到"
                        : "Received"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {new Date(row.createdAt).toLocaleString(lang)}
                </p>
                {row.resolution && (
                  <p className="mt-2 text-sm text-ink-soft">{row.resolution}</p>
                )}
              </div>
            ))}
            {!pending && !rows.length && !error && (
              <p className="text-sm text-muted">
                {zh ? "还没有举报记录。" : "No reports yet."}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-coral">
                {error}
              </p>
            )}
            {cursor && <button
              disabled={pending}
              onClick={() => void load(true)}
              className="w-full min-h-11 rounded-full ring-1 ring-line py-3 text-sm text-ink disabled:opacity-50"
            >{zh ? '查看更多记录' : 'Load more reports'}</button>}
            <button
              disabled={pending}
              onClick={() => void load(false)}
              className="w-full rounded-full ring-1 ring-line py-3 text-sm text-ink disabled:opacity-50"
            >
              {pending
                ? zh
                  ? "正在读取…"
                  : "Loading…"
                : zh ? '刷新进度' : 'Refresh progress'}
            </button>
          </div>
        </Sheet>
      )}
    </Reports.Provider>
  )
}
