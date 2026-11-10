import { useId, useState } from 'react'
import { Bell, CaretDown, Ticket } from '@phosphor-icons/react'
import { isZh, useI18n } from '../i18n'
import { AccountPage } from './AssetWallet'
import { useGiftState } from './GiftLedger'
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

export function SystemInbox({ owner, onClose, onAssets }: { owner: string; onClose: () => void; onAssets: () => void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const state = useGiftState(owner)
  const rewards = state.usedRewards.slice().reverse()
  const balance = state.entitlements['return-stamp'] ?? 0
  const [expanded, setExpanded] = useState<string | null>(null)
  const detailId = useId()
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
