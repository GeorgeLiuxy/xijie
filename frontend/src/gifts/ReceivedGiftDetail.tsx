import { useContext, useEffect, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { I, NightCtx, useStatusTone } from '../ui'
import { ContextSheet } from '../mobile/ContextSheet'
import { useGiftState } from './GiftLedger'
import { ParcelArt } from './GiftMessageCard'
import { canDisplayReceivedGift } from './placement'
import { openReceivedGift, placeReceivedGift } from './store'
import './gift-messages.css'

export function ReceivedGiftDetail({ owner, id, onClose, onVisitSpace, onReturnGift }: {
  owner: string; id: string
  onClose: () => void; onVisitSpace: () => void; onReturnGift?: () => void
}) {
  const { t, lang } = useI18n()
  const zh = isZh(lang)
  useStatusTone(useContext(NightCtx) ? 'light' : 'dark')
  const gift = useGiftState(owner).received?.find(item => item.id === id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [id, owner])
  async function act(action: 'open' | 'display' | 'record') {
    if (lock.current || !gift) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'open') await openReceivedGift(owner, id)
      else await placeReceivedGift(owner, id, action === 'display' ? 'space' : 'record')
    } catch {
      if (active.current) setError(zh ? '未能保存。请再试一次。' : 'Could not save this change. Please try again.')
    } finally {
      lock.current = false
      if (active.current) setBusy(false)
    }
  }
  const first = gift?.lines[0]
  const opened = gift?.openedAt != null
  const displayed = gift?.placement === 'space'
  const canDisplay = !!gift && canDisplayReceivedGift(gift)
  return <ContextSheet label={zh ? '收到的礼物' : 'Received gift'} onClose={onClose} closeDisabled={busy} className="gm-received-sheet" backPriority={40}>
  <div className="gm-detail gm-detail-sheet">
    <header className="gm-detail-head"><button data-context-close disabled={busy} onClick={onClose} aria-label={t('common.close')}><I.X/></button><span>{zh ? '收到的礼物' : 'Received gift'}</span></header>
    {!gift || !first ? <main className="gm-detail-missing"><p>{zh ? '这份礼物的记录暂时无法读取。' : 'This gift record is unavailable.'}</p><button className="btn-dark" onClick={onClose}>{t('common.back')}</button></main> : <>
      <main className="gm-detail-scroll scroll-quiet">
        <div className="gm-detail-art" data-world={gift.from.world} data-opened={opened}>
          <ParcelArt key={String(opened)} id={first.giftId} sealed={!opened}/>
        </div>
        <div className="gm-detail-copy">
          <p className="gm-sender">{zh ? `来自${gift.from.name}的剧情回礼` : `A story gift from ${gift.from.name}`}</p>
          <h1>{zh ? first.snapshot.name : first.snapshot.en}{first.quantity > 1 && ` ×${first.quantity}`}</h1>
          <time dateTime={new Date(gift.createdAt).toISOString()}>{new Date(gift.createdAt).toLocaleDateString(lang, { year:'numeric', month:'long', day:'numeric' })}</time>
          {gift.note && <blockquote>{gift.note}</blockquote>}
          <p className="gm-where" role="status">{!opened ? (zh ? '待拆开' : 'Waiting to be opened') : displayed ? (zh ? '已陈列在我的空间' : 'On display in your space') : (zh ? '已收进礼物记录' : 'Saved in your gift records')}</p>
        </div>
      </main>
      <footer className="gm-detail-actions">
        {error && <p className="gm-error" role="alert">{error}</p>}
        {!opened ? <button className="btn-dark" disabled={busy} onClick={() => act('open')}>{zh ? '拆开礼物' : 'Unwrap gift'}</button> :
          displayed ? <><button className="btn-dark" disabled={busy} onClick={onVisitSpace}>{zh ? '查看我的空间' : 'View my space'}</button><button disabled={busy} onClick={() => act('record')}>{zh ? '收回礼物记录' : 'Remove from display'}</button></> :
          canDisplay ? <><button className="btn-dark" disabled={busy} onClick={() => act('display')}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '放到我的空间' : 'Display in my space')}</button><button disabled={busy} onClick={onClose}>{zh ? '先收进礼物记录' : 'Keep in gift records'}</button></> :
          <button className="btn-dark" disabled={busy} onClick={onClose}>{zh ? '收好了' : 'Done'}</button>}
        {opened && onReturnGift && <button disabled={busy} onClick={onReturnGift}>{zh ? '也寄一份心意' : 'Send a gift back'}</button>}
      </footer>
    </>}
  </div>
  </ContextSheet>
}
