import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n, isZh } from '../i18n'
import { PostalFlight } from '../post/PostalFlight'
import { NightCtx, fxPrefs, useStatusTone } from '../ui'
import { GiftStudio } from './GiftStudio'
import { GoalComposer, GiftGoalView } from './GiftGoals'
import { rememberGiftGoal, saveGiftPhoto } from './store'
import type { GiftTarget, GiftReceipt, GiftOpenOptions, GoalKind } from './types'
import { giftPhotoMessage, useGiftService } from './giftServiceContext'
import { MediaError } from '../serviceMedia'
import {listAlbums} from '../serviceAlbums'
import type {ReferralContext} from '../serviceReferrals'
import type {GiftGoalLink} from './types'
import { useNativeBack } from '../mobile/back'
import { ContextSheet } from '../mobile/ContextSheet'
import '../post/star-post.css'
import './integration.css'

export function GiftExperience(props:Parameters<typeof ScopedGiftExperience>[0]){return <ScopedGiftExperience key={JSON.stringify([props.owner,props.serviceContext?.accountId,props.serviceContext?.sessionId,props.target.identity??props.target.id])} {...props}/>}

function ScopedGiftExperience({ owner, target, onClose, onVisitSpace, onBackToChat, onInvite, onPurchase, initialGoal, initialTab, initialGift, initialReceipt, initialSource, initialPresentation = 'full', onQuickSent, onReceipt, onReceived, onAdopt, adopted, large=false,serviceContext,onServiceAdopted }: {
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
  serviceContext?:ReferralContext
  onServiceAdopted?:()=>void
}) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const night = useContext(NightCtx)
  const service = useGiftService()
  const unavailable = () => setNotice(zh ? '这项能力尚未接通，暂时无法完成。' : 'This feature is not connected yet.')
  const [composer, setComposer] = useState<GoalKind | null>(null)
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [serviceGoals,setServiceGoals]=useState<GiftGoalLink[]>([])
  useEffect(()=>{if(!serviceContext)return;const controller=new AbortController();void listAlbums(serviceContext,controller.signal).then(items=>{if(!controller.signal.aborted)setServiceGoals(items.filter(item=>item.personId===target.identity).map(item=>({id:item.id,target,kind:item.kind??'album',createdAt:Date.parse(item.createdAt)})))}).catch(()=>{if(!controller.signal.aborted)setNotice(zh?'共同心愿暂时无法读取，请稍后重开。':'Shared wishes could not be loaded. Please reopen shortly.')});return()=>controller.abort()},[serviceContext?.accountId,serviceContext?.sessionId,target.identity,goal])
  const [watch, setWatch] = useState<GiftReceipt | null>(null)
  const [notice, setNotice] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const photoOperation = useRef(false), mounted = useRef(true)
  const photoOwner = useRef(owner); photoOwner.current = owner
  const photoService = useRef(service?.photos); photoService.current = service?.photos
  const watchPhoto = useRef({ version: 1, revision: 0 })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setWatch(null); setNotice('') }, [owner, service?.photos?.revision])
  async function watchJourney(receipt: GiftReceipt) {
    if (!service) { setWatch(receipt); return }
    const photos = service.photos
    if (!photos || photoOperation.current) return
    const current = () => mounted.current && photoOwner.current === owner && photoService.current?.save === photos.save && photoService.current.revision === photos.revision
    photoOperation.current = true; setPhotoBusy(true); setNotice('')
    try {
      if (photos.pending(receipt.id)) {
        await photos.retry(receipt.id)
        if (current()) setNotice(zh ? '这次投递留影已保存。' : 'Your arrival photo is saved.')
      } else {
        const fresh = await service.readDelivery(receipt.id)
        const photo = await photos.prepare(fresh)
        if (current()) { watchPhoto.current = { version: photo.version, revision: photos.revision }; setWatch(fresh) }
      }
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === 'AbortError')) setNotice(giftPhotoMessage(error instanceof Error && 'code' in error ? String(error.code) : undefined, zh))
    } finally { photoOperation.current = false; if (mounted.current) setPhotoBusy(false) }
  }
  async function saveJourney(receipt: GiftReceipt, photo: string) {
    const photos = service?.photos
    if (!photos) return
    const current = () => mounted.current && photoOwner.current === owner && photoService.current?.save === photos.save && photoService.current.revision === photos.revision
    photoOperation.current = true; setPhotoBusy(true)
    if (current()) setNotice(zh ? '正在保存这次投递留影…' : 'Saving your arrival photo…')
    try {
      await photos.save(receipt.id, watchPhoto.current.version, photo, watchPhoto.current.revision)
      if (current()) setNotice('')
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === 'AbortError')) setNotice(giftPhotoMessage(error instanceof MediaError ? error.code : undefined, zh))
    } finally { photoOperation.current = false; if (mounted.current) setPhotoBusy(false) }
  }
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
        if (compact && contextSession && receipt.status !== 'delivery_failed') (onQuickSent ?? onClose)()
      }} onReceived={onReceived} onClose={closeLayer} onVisitSpace={onVisitSpace} onBackToChat={onBackToChat} onInvite={onInvite} onPurchase={onPurchase} large={large}
        compact={compact} inContext={contextSession} onExpand={() => setCompact(false)} onBusyChange={setBusy}
        serviceGoals={serviceContext?serviceGoals:undefined} onGoal={kind=>{if(service&&!serviceContext){unavailable();return};setComposer(kind)}} onOpenGoal={service&&!serviceContext ? unavailable : setGoal} onWatch={receipt => void watchJourney(receipt)} watchBusy={photoBusy} />
  return <div ref={nativeBackRoot} className={'gift-experience' + (contextSession ? ' gift-experience-context' : '')} aria-label={zh ? '赠礼与共同心愿' : 'Gifts and shared wishes'}>
    <div hidden={detailed}>
      {contextSession ? <ContextSheet label={zh ? `给${target.name}送礼物` : `A gift for ${target.name}`} className="gift-context-sheet" expanded={!compact} closeDisabled={busy} onClose={closeLayer}>{studio}</ContextSheet> : studio}
    </div>
    {composer && <GoalComposer target={target} initialKind={composer} serviceContext={serviceContext} onClose={() => setComposer(null)} onCreated={created => {
      setComposer(null)
      setGoal(created.id)
      if(!serviceContext)void rememberGiftGoal(owner, target, created).catch(() => setNotice(zh ? '共同心愿已创建，请保留分享地址。' : 'The shared wish was created. Keep its share link.'))
    }} />}
    {goal && <GiftGoalView id={goal} owner={owner} adopted={adopted} onAdopt={onAdopt} serviceContext={serviceContext} onServiceAdopted={onServiceAdopted} onClose={() => { setGoal(''); setNotice('') }} />}
    {watch && <div className="gift-journey">
      <header><button onClick={() => setWatch(null)}>‹ {zh ? '返回寄件记录' : 'Back to parcel'}</button><span>{zh ? '自选旅途' : 'Journey'}</span></header>
      <div className="pp-game gift-journey-stage"><PostalFlight active zh={zh}
        calm={fxPrefs.calm}
        world={watch.target.world} parcelId={watch.id} items={watch.lines.map(line => ({ giftId: line.giftId, quantity: line.quantity }))}
        consignment={zh ? `随${watch.lines[0]?.snapshot.name ?? '寄件'}前往${target.name}的空间` : `Following your parcel to ${target.name}`}
        onLand={(_stamps, skipped, photo) => {
          setWatch(null)
          if (service) {
            if (photo) void saveJourney(watch, photo)
            else if (!skipped) setNotice(zh ? '这次投递留影未能生成，可以重新观看旅途。' : 'This arrival photo could not be captured. You can watch the journey again.')
          } else if (photo) void saveGiftPhoto(owner, watch.id, photo).catch(() => setNotice(zh ? '寄件回执已保存，这次投递留影未能存入本机。' : 'Your receipt is saved, but the arrival photo could not be stored.'))
        }} /></div>
    </div>}
    {notice && <p className="gift-integration-notice" role="status">{notice}</p>}
  </div>
}
