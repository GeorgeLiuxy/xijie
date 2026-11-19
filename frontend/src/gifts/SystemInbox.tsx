import { useEffect, useId, useRef, useState } from 'react'
import { Bell, CaretDown, Ticket } from '@phosphor-icons/react'
import { isZh, useI18n } from '../i18n'
import { AccountPage } from './AssetWallet'
import { useGiftState } from './GiftLedger'
import { giftNoticeText, giftServiceMessage, useGiftService } from './giftServiceContext'
import type { GiftNotification } from '../serviceGifts'
import {reminderText,type ReminderNotice,type useServiceReminders} from '../serviceReminders'
import './assets.css'

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

function rewardSource(token: string, zh: boolean) {
  const [kind, referral, role] = token.split(':')
  if (kind === 'invite' && referral) {
    if (role === 'host') return zh ? '邀请回礼 · 你邀请的朋友已保存第一段记忆。' : 'Invitation reward · Your invited friend saved their first memory.'
    if (role === 'guest') return zh ? '受邀回礼 · 你通过邀请加入并保存了第一段记忆。' : 'Welcome reward · You joined by invitation and saved your first memory.'
  }
  const parts = token.split('.')
  if (parts.length === 2 && parts.every(part => uuid.test(part))) return zh ? '共同心愿回礼 · 感谢你参与这份心愿。' : 'Shared wish reward · Thank you for contributing.'
  return zh ? '系统回礼 · 已记入你的资产。' : 'System reward · Credited to your account.'
}

export function SystemInbox({ owner, onClose, onAssets, onNavigate,reminders,onReminder }: { owner: string; onClose: () => void; onAssets: () => void; onNavigate?: (notification: GiftNotification) => Promise<void>;reminders?:ReturnType<typeof useServiceReminders>;onReminder?:(notice:ReminderNotice)=>void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const state = useGiftState(owner)
  const service = useGiftService()
  const rewards = state.usedRewards.slice().reverse()
  const balance = state.entitlements['return-stamp'] ?? 0
  const [expanded, setExpanded] = useState<string | null>(null)
  const detailId = useId()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [owner])
  async function act(item: GiftNotification, navigate = false) {
    if (!service || busy) return
    setBusy(item.id); setError('')
    try { if (navigate) await onNavigate?.(item); else await service.readNotification(item.id) }
    catch (failure) { if (active.current && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(giftServiceMessage((failure as { code?: string }).code, zh, 'save')) }
    finally { if (active.current) setBusy(null) }
  }
  async function actReminder(item:ReminderNotice,navigate=false){if(!reminders?.client||busy)return;setBusy(item.id);setError('');try{if(!item.readAt)await reminders.client.read(item);if(active.current&&navigate)onReminder?.(item)}catch{if(active.current)setError(zh?'暂时无法保存已读状态，请再试一次。':'The read status could not be saved. Please retry.')}finally{if(active.current)setBusy(null)}}
  if (service) return <AccountPage title={zh ? '系统通知' : 'System notices'} onClose={onClose}>
    {reminders?.snapshot.status==='error'&&<p className="asset-help" role="status">{zh?'纪念日提醒暂时无法读取。':'Anniversary reminders could not be loaded.'}<button onClick={()=>void reminders.client?.refresh()}>{zh?'重试':'Retry'}</button></p>}
    {reminders?.snapshot.notices.map(item=>{const open=expanded===item.id;return <article key={item.id} className="asset-notice"><button className="asset-notice-toggle" aria-expanded={open} aria-controls={open?detailId:undefined} onClick={()=>{setExpanded(open?null:item.id);setError('');if(!open)void actReminder(item)}}><span className="asset-glyph"><Bell weight="duotone" aria-hidden/></span><span className="asset-row-copy"><small>{zh?'西界系统':'Elysium system'}</small><b>{reminderText(item,zh)}</b></span><CaretDown className="asset-disclose" aria-hidden/></button>{open&&<div id={detailId} className="asset-notice-detail"><p>{zh?'留一点时间，和 TA 说说话吧。':'Take a moment to spend some time together.'}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(lang)}</time>{error&&<p role="alert">{error}<button disabled={!!busy} onClick={()=>void actReminder(item)}>{zh?'重试':'Retry'}</button></p>}<div className="asset-notice-balance"><span>{item.readAt?zh?'已读':'Read':zh?'未读':'Unread'}</span><button disabled={!!busy||!onReminder} onClick={()=>void actReminder(item,true)}>{zh?'查看 TA':'View profile'} ›</button></div></div>}</article>})}
    {service.notificationsStatus !== 'ready' && <p className="asset-help" role="status">{service.notificationsStatus === 'loading' ? zh ? '正在读取通知…' : 'Loading notices…' : giftServiceMessage(service.notificationsError, zh)}<button onClick={() => void service.refresh()}>{zh ? '重试' : 'Retry'}</button></p>}
    {service.notifications.map(item => {
      const open = expanded === item.id
      return <article key={item.id} className="asset-notice">
        <button className="asset-notice-toggle" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => { setExpanded(open ? null : item.id); setError(''); if (!open) void act(item) }}>
          <span className="asset-glyph"><Bell weight="duotone" aria-hidden /></span><span className="asset-row-copy"><small>{zh ? '西界系统' : 'Elysium system'}</small><b>{giftNoticeText(item.type, zh)}</b></span><CaretDown className="asset-disclose" aria-hidden />
        </button>
        {open && <div id={detailId} className="asset-notice-detail">
          <p>{item.type === 'gift_received' ? zh ? 'TA 捎来了一份心意，可以打开看看。' : 'A gift from them is ready for you to open.' : item.type === 'gift_failed' ? zh ? '这次投递未完成，可以查看寄件记录。' : 'This delivery was not completed. You can review its record.' : zh ? '这份心意已经送达，可以查看回执。' : 'Your gift has arrived. You can view its receipt.'}</p>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(lang)}</time>
          {error && <p role="alert">{error}<button disabled={!!busy} onClick={() => void act(item)}>{zh ? '重试' : 'Retry'}</button></p>}
          <div className="asset-notice-balance"><span>{item.readAt ? zh ? '已读' : 'Read' : zh ? '未读' : 'Unread'}</span><button disabled={!!busy || !onNavigate} onClick={() => void act(item, true)}>{item.target.kind === 'received_gift' ? zh ? '查看礼物' : 'View gift' : zh ? '查看回执' : 'View receipt'} ›</button></div>
        </div>}
      </article>
    })}
    {service.notificationsStatus === 'ready' && !service.notifications.length && (!reminders || reminders.snapshot.status === 'ready' && !reminders.snapshot.notices.length) && <div className="asset-empty asset-inbox-empty"><Bell size={31} weight="duotone" aria-hidden /><p>{zh ? '还没有系统通知。' : 'No system notices yet.'}</p></div>}
  </AccountPage>
  return <AccountPage title={zh ? '系统通知' : 'System notices'} onClose={onClose}>
    {rewards.map(token => {
      const open = expanded === token
      return <article key={token} className="asset-notice">
        <button className="asset-notice-toggle" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setExpanded(open ? null : token)}>
          <span className="asset-glyph asset-ticket"><Ticket weight="duotone" aria-hidden /></span>
          <span className="asset-row-copy"><small>{zh ? '西界系统' : 'Elysium system'}</small><b>{zh ? '基础赠礼券到账' : 'Gift voucher added'}</b></span>
          <span className="asset-grant">{zh ? '+1 张' : '+1'}</span><CaretDown className="asset-disclose" aria-hidden />
        </button>
        {open && <div id={detailId} className="asset-notice-detail">
          <p>{rewardSource(token, zh)}</p>
          <p>{zh ? '每张券可寄一件 1 至 8 邮资的基础礼物。选好一件可用的礼物后，选择「基础赠礼券」寄出。' : 'Each voucher covers one eligible gift worth 1–8 postage. Choose the voucher when sending a single gift.'}</p>
          <div className="asset-notice-balance"><span>{zh ? `当前可用 ${balance} 张` : `Vouchers available: ${balance}`}</span>
            <button onClick={() => onAssets()}>{zh ? '查看资产' : 'View assets'} ›</button></div>
        </div>}
      </article>
    })}
    {!rewards.length && <div className="asset-empty asset-inbox-empty"><Bell size={31} weight="duotone" aria-hidden /><p>{zh ? '还没有系统通知。' : 'No system notices yet.'}</p></div>}
  </AccountPage>
}
