import { useContext, useLayoutEffect, useRef, useState } from 'react'
import { useI18n, isZh } from '../i18n'
import { PostalFlight } from '../post/PostalFlight'
import { NightCtx, fxPrefs, useStatusTone } from '../ui'
import { GiftStudio } from './GiftStudio'
import { GoalComposer, GiftGoalView } from './GiftGoals'
import { rememberGiftGoal, saveGiftPhoto } from './store'
import type { GiftTarget, GiftReceipt, GiftOpenOptions, GoalKind } from './types'
import { useNativeBack } from '../mobile/back'
import { ContextSheet } from '../mobile/ContextSheet'
import '../post/star-post.css'
import './integration.css'

export function GiftExperience({ owner, target, onClose, onVisitSpace, onBackToChat, onInvite, onPurchase, initialGoal, initialTab, initialGift, initialReceipt, initialSource, initialPresentation = 'full', onQuickSent, onReceipt, onReceived, onAdopt, adopted, large=false }: {
  owner: string
  target: GiftTarget
  onClose: () => void
  onVisitSpace?: (receipt?: GiftReceipt) => void
  onBackToChat?: () => void
  onInvite?: () => void
  onPurchase?: () => void
  initialGoal?: string
  initialTab?: GiftOpenOptions['tab']
  initialGift?: string
  initialReceipt?: string
  initialSource?: GiftOpenOptions['source']
  initialPresentation?: 'compact' | 'full'
  onQuickSent?: () => void
  onReceipt?: (receipt: GiftReceipt) => void
  onReceived?: (id: string) => void
  onAdopt?: (goalId: string, seat: number, text: string) => void
  adopted?: string[]
  large?: boolean
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const night = useContext(NightCtx)
  const [composer, setComposer] = useState<GoalKind | null>(null)
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [watch, setWatch] = useState<GiftReceipt | null>(null)
  const [notice, setNotice] = useState('')
  // Keep the frame and Studio mounted while expanding; initial gift props must
  // not run again and overwrite the in-progress quantity, note or payment source.
  const [contextSession] = useState(initialPresentation === 'compact')
  const [compact, setCompact] = useState(initialPresentation === 'compact')
  const [busy, setBusy] = useState(false)
  const closeLayer = () => {
    if (busy) return
    if (watch) setWatch(null)
    else if (goal) { setGoal(''); setNotice('') }
    else if (composer) setComposer(null)
    else if (contextSession && !compact) setCompact(true)
    else onClose()
  }
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  const detailed = !!composer || !!goal || !!watch
  const wasDetailed = useRef(detailed)
  useLayoutEffect(() => {
    const returning = wasDetailed.current && !detailed
    wasDetailed.current = detailed
    if (!returning) return
    const frame = requestAnimationFrame(() => {
      const button = nativeBackRoot.current?.querySelector<HTMLButtonElement>('.gs-back')
      if (button && !button.disabled && !button.closest('[hidden], [inert]') && button.getClientRects().length) {
        button.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [detailed])
  useNativeBack(() => {
    if (watch) setWatch(null)
    else if (goal) { setGoal(''); setNotice('') }
    else if (composer) setComposer(null)
    else return false
    return true
  }, detailed, 30, nativeBackRoot)
  useStatusTone(watch || night ? 'light' : 'dark')
  const studio = <GiftStudio owner={owner} target={target} initialTab={initialTab} initialGift={initialGift} initialReceipt={initialReceipt} initialSource={initialSource} onReceipt={receipt => {
        onReceipt?.(receipt)
        if (compact && contextSession) (onQuickSent ?? onClose)()
      }} onReceived={onReceived} onClose={closeLayer} onVisitSpace={onVisitSpace} onBackToChat={onBackToChat} onInvite={onInvite} onPurchase={onPurchase} large={large}
        compact={compact} inContext={contextSession} onExpand={() => setCompact(false)} onBusyChange={setBusy}
        onGoal={setComposer} onOpenGoal={setGoal} onWatch={setWatch} />
  return <div ref={nativeBackRoot} className={'gift-experience' + (contextSession ? ' gift-experience-context' : '')} aria-label={zh ? '赠礼与共同心愿' : 'Gifts and shared wishes'}>
    <div hidden={detailed}>
      {contextSession ? <ContextSheet label={zh ? `给${target.name}送礼物` : `A gift for ${target.name}`} className="gift-context-sheet" expanded={!compact} closeDisabled={busy} onClose={closeLayer}>{studio}</ContextSheet> : studio}
    </div>
    {composer && <GoalComposer target={target} initialKind={composer} onClose={() => setComposer(null)} onCreated={created => {
      setComposer(null)
      setGoal(created.id)
      void rememberGiftGoal(owner, target, created).catch(() => setNotice(zh ? '共同心愿已创建，请保留分享地址。' : 'The shared wish was created. Keep its share link.'))
    }} />}
    {goal && <GiftGoalView id={goal} owner={owner} adopted={adopted} onAdopt={onAdopt} onClose={() => { setGoal(''); setNotice('') }} />}
    {watch && <div className="gift-journey">
      <header><button onClick={() => setWatch(null)}>‹ {zh ? '返回寄件记录' : 'Back to parcel'}</button><span>{zh ? '自选旅途' : 'Journey'}</span></header>
      <div className="pp-game gift-journey-stage"><PostalFlight active zh={zh}
        calm={fxPrefs.calm}
        world={watch.target.world} parcelId={watch.id} items={watch.lines.map(line => ({ giftId: line.giftId, quantity: line.quantity }))}
        consignment={zh ? `随${watch.lines[0]?.snapshot.name ?? '寄件'}前往${target.name}的空间` : `Following your parcel to ${target.name}`}
        onLand={(_stamps, _skipped, photo) => {
          setWatch(null)
          if (photo) void saveGiftPhoto(owner, watch.id, photo).catch(() => setNotice(zh ? '寄件回执已保存，这次投递留影未能存入本机。' : 'Your receipt is saved, but the arrival photo could not be stored.'))
        }} /></div>
    </div>}
    {notice && <p className="gift-integration-notice" role="status">{notice}</p>}
  </div>
}
