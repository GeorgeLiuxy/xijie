import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { isZh, useI18n, type WorldId } from '../i18n'
import type { Person } from '../model'
import ball from '../post/assets/ball.webp'
import cloth from '../post/assets/cloth.webp'
import cliff from '../study/assets/isles/landfall.webp'
import boat from '../study/assets/tide/landfall.webp'
import { I } from '../ui'
import { getGift } from './catalog'
import { useArrivalClock, useGiftState } from './GiftLedger'
import { hasArrived, receiptMatchesPerson } from './store'
import type { GiftDefinition, GiftLine, GiftReceipt } from './types'
import './personal-gift-scene.css'
import { decoration, type Zone, type Shape } from './placement'

type Placed = { zone: Zone; shape: Shape; line: GiftLine; receipt: GiftReceipt }
type Spot = [x: number, y: number, width: number, cn: string, en: string]

// Coordinates mark the base of an object in the 318px cover, not its centre.
const anchors: Record<WorldId, Record<Zone, Spot>> = {
  courtyard: {
    flowers: [17, 56.3, 38, '院子的窗沿上', 'On the courtyard sill'],
    seat: [5.6, 56.3, 31, '窗沿左侧', 'On the left end of the sill'],
    door: [83, 47, 38, '拱门旁的墙钩上', 'On the hook beside the archway'],
  },
  tide: {
    flowers: [17, 76.8, 37, '船头的木扶手上', 'On the bow rail'],
    seat: [41, 77.2, 36, '船舷扶手上', 'On the gunwale'],
    door: [67, 77.9, 36, '船舷内侧', 'On the inner rail'],
  },
  isles: {
    flowers: [12, 93, 36, '观云的岩沿上', 'On the cloud lookout'],
    seat: [29, 93.6, 34, '山径旁的石沿上', 'On the ledge by the path'],
    door: [48, 94.1, 35, '山径边的岩台上', 'On the rock beside the path'],
  },
}

export function giftPlacementLabel(world: WorldId, giftId: string, zh: boolean): string | undefined {
  const gift = getGift(giftId)
  const item = gift && decoration(gift)
  return item ? anchors[world][item[0]][zh ? 3 : 4] : undefined
}

export function selectSceneGifts(receipts: GiftReceipt[], person: Person, now: number, focusReceiptId?: string): Placed[] {
  const spots = new Map<Zone, Placed>()
  for (const receipt of receipts) {
    if (!receiptMatchesPerson(receipt, person) || receipt.target.world !== person.world || !hasArrived(receipt, now)) continue
    for (const line of receipt.lines) {
      const item = decoration(line.snapshot)
      if (!item || line.quantity <= 0) continue
      const [zone, shape] = item
      const previous = spots.get(zone)?.receipt
      if (previous && previous.id === focusReceiptId) continue
      if (!previous || receipt.id === focusReceiptId || receipt.createdAt >= previous.createdAt) {
        spots.set(zone, { zone, shape, line, receipt })
      }
    }
  }
  return Array.from(spots.values())
}

function Foreground({ world }: { world: WorldId }) {
  const id = useId()
  const rim = world === 'tide'
    ? 'M-6 242 Q92 243 176 245 T400 252 L400 263 Q288 257 175 255 T-6 253Z'
    : 'M-2 302 Q15 294 30 294 L44 293 62 295 Q75 298 91 296 L106 295 124 297 139 297 Q161 295 174 297 L187 297 204 300 Q235 300 249 306 L267 308 284 318 H-2Z'
  return <svg className="pgs-foreground" viewBox="0 0 393 318" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id={id}><path d={rim}/></clipPath></defs>
    {world === 'tide' && <g stroke="#566667" strokeWidth="3" opacity=".82"><path d="m28 250-4 70m323-61 5 61"/></g>}
    <path d={rim} fill={world === 'tide' ? '#80776b' : '#888694'}/>
    <g clipPath={`url(#${id})`}>
      {world === 'tide' ? <>
        <image href={boat} x="-380" y="-124" width="980" height="686" preserveAspectRatio="none" opacity=".78"/>
        <path fill="none" stroke="#d8c7a5" opacity=".64" strokeWidth="2" d="M-6 242Q92 243 176 245T400 252"/>
        <path fill="none" stroke="#d6c6a5" opacity=".31" d="M-6 245Q96 247 176 248T400 256"/>
      </> : <>
        <image href={cliff} x="-133" y="-28" width="735" height="499" preserveAspectRatio="none" opacity=".86"/>
        <path d={rim} fill="#8d98b5" opacity=".21"/>
      </>}
    </g>
  </svg>
}

export function Florals({ green, crowded }: { green: boolean; crowded: boolean }) {
  const id = useId()
  const buds = [[20, 24, -20], [33, 14, 15], [44, 22, 27], [27, 29, 8], [39, 30, -22], ...(crowded ? [[12, 26, -30], [48, 16, 21]] : [])]
  return <svg viewBox="0 0 64 76" aria-hidden="true">
    <defs><linearGradient id={id}><stop stopColor="#526966"/><stop offset=".22" stopColor="#a5b7a4"/><stop offset=".46" stopColor="#e1e1c5"/><stop offset=".8" stopColor="#92a895"/><stop offset="1" stopColor="#5a7163"/></linearGradient></defs>
    <g fill="none" stroke="#405943" strokeWidth="1.4">
      {buds.map(([x,y]) => <path key={x} d={`M32 56 Q${x + 3} 35 ${x} ${y}`}/>)}
    </g>
    <g fill="#779663" stroke="#476344" strokeWidth=".45">
      <path d="M30 43Q18 42 12 33Q24 30 30 43ZM33 40Q43 29 54 31Q47 41 33 40ZM27 34Q18 33 17 24Q26 25 27 34ZM37 32Q39 22 49 20Q47 29 37 32Z"/>
    </g>
    {!green && buds.map(([x,y,r],i) => <g key={x} transform={`translate(${x} ${y}) rotate(${r})`}>
      <path fill={i % 2 === 0 ? '#e9ce99' : '#d9a092'} stroke="#9d796f" strokeWidth=".6" d="M-1 3C-6 5-8 0-5-2C-7-6-2-8 0-4C3-9 8-6 6-2C11-1 9 4 5 4C4 8-1 7-1 3Z"/>
      <circle r="1.8" fill="#ac7740"/><circle cx="-.45" cy="-.55" r=".75" fill="#f8daa3"/>
    </g>)}
    <path fill={`url(#${id})`} stroke="#68796a" strokeWidth=".8" d="M26 44Q32 46 38 44L37 50C38 55 45 58 43 65Q42 72 37 73L27 73Q20 70 21 62Q21 57 26 51Z"/>
    <ellipse cx="32" cy="44.7" rx="6.4" ry="1.8" fill="#6c8272"/><path d="M24 60Q22.5 66 26 69" fill="none" stroke="#f4ecce" strokeWidth="1.1" opacity=".72"/>
  </svg>
}

export function Lamp({ path, beacon, onWall }: { path: boolean; beacon: boolean; onWall: boolean }) {
  const id = useId()
  return <svg viewBox={onWall ? '0 0 68 65' : '0 0 60 80'} aria-hidden="true">
    <defs><radialGradient id={id}><stop stopColor="#fff3c2"/><stop offset=".36" stopColor="#ffe3a0"/><stop offset="1" stopColor="#d59c52"/></radialGradient></defs>
    {onWall ? <g>
      <rect x="57" y="3" width="5" height="23" rx="1.7" fill="#646960"/>
      <path d="M59 7Q43 7 30 8Q27 8 28 12M37 8 58 23" fill="none" stroke="#4c524a" strokeWidth="2.4"/>
      <path d="m57.5 6 2 0m-2 17h2" stroke="#bec0a9" strokeWidth="1"/>
    </g> : path && <g fill="#405050"><path d="M26 47h7l-1 27h-5z"/><path d="m23 73 12-.5 4 4-21 .5z"/></g>}
    <g transform={onWall ? undefined : path ? 'translate(0 -5)' : 'translate(0 20)'}>
      <path fill="none" stroke="#4c5047" strokeWidth="2" d="M22 24C21 5 37 5 38 24"/>
      <path d="m16 28 13-10 14 10-1 3H17Z" fill={beacon ? '#476964' : '#596155'}/>
      <path fill={`url(#${id})`} stroke="#8c785b" strokeWidth="1.1" d="m18 31 22-.5-3 24-16 1Z"/>
      <path d="M21 32l3 21m13-21-2 21m-6-22 .5 23" stroke="#8b795a" strokeWidth="1.2" opacity=".9"/>
      <path d="m20 54 18-.5 2 4-21 1Z" fill="#596256"/><path d="m20 56 17-.4" stroke="#c3b487"/>
      <path d="M27 23l3-2.6 4.2 2.5" stroke="#c7c2a1" fill="none"/>
    </g>
  </svg>
}

function Prop({ item, world }: { item: Placed; world: WorldId }) {
  switch (item.shape) {
    case 'bouquet':
    case 'plant': return <Florals green={item.shape === 'plant'} crowded={item.line.quantity > 1}/>
    case 'lantern': return <Lamp path={item.line.giftId === 'path-lamp'} beacon={item.line.giftId === 'beacon'} onWall={world === 'courtyard'}/>
    case 'ball':
    case 'cloth': return <img src={item.shape === 'ball' ? ball : cloth} alt="" draggable={false}/>
    default: return <svg viewBox="0 0 72 46" aria-hidden="true">
      <path d="M4 28Q12 13 27 5Q42 3 66 11L61 28 43 40Q19 39 4 33Z" fill={item.shape === 'mat' ? '#bc9c6e' : '#91a69b'} stroke="#60766d" strokeWidth=".8"/>
      <path d="M6 29Q21 32 42 34L64 13M42 34l1 5" fill="none" stroke="#d6cbb6" strokeWidth="1.6"/>
      <path d="m19 19 29 5m-22-12 29 5" stroke="#e7dec4" opacity=".6" strokeWidth="2"/>
    </svg>
  }
}

export function PersonalGiftScene({ owner, person, focusReceiptId, onOpen }: {
  owner: string; person: Person; focusReceiptId?: string; onOpen: (receiptId: string) => void
}) {
  const { lang, t } = useI18n()
  const zh = isZh(lang)
  const state = useGiftState(owner)
  const receipts = state.receipts.filter(receipt => receiptMatchesPerson(receipt, person))
  const now = useArrivalClock(receipts)
  const [choice, setChoice] = useState<string | null>()
  const scene = useRef<HTMLDivElement>(null)
  const selectedId = choice === undefined ? focusReceiptId : choice ?? undefined
  const placed = selectSceneGifts(receipts, person, now, choice === undefined ? focusReceiptId : undefined)
  const selected = placed.find(item => item.receipt.id === selectedId)
  const focused = receipts.find(receipt => receipt.id === selectedId)
  const previousWorld = focused && focused.target.world !== person.world
  const pending = focused && !hasArrived(focused, now) ? focused : undefined
  const recordOnly = focused && hasArrived(focused, now) && (previousWorld || !focused.lines.some(line => decoration(line.snapshot)))
  const panelId = useId()
  useEffect(() => setChoice(undefined), [owner, person.id, person.localId, focusReceiptId])
  useEffect(() => {
    if (!selectedId) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !scene.current?.contains(event.target)) setChoice(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setChoice(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [selectedId])
  if (!placed.length && !pending && !recordOnly) return null
  const spot = selected && anchors[person.world][selected.zone]
  return <div className={`pgs-scene pgs-${person.world}`} ref={scene} role="group" aria-label={zh ? '空间里的礼物' : 'Gifts in this space'}>
    {placed.length > 0 && person.world !== 'courtyard' && <Foreground world={person.world}/>}
    {placed.map(item => {
      const [x,y,width,cn,en] = anchors[person.world][item.zone]
      const name = zh ? item.line.snapshot.name : item.line.snapshot.en
      const active = selected?.receipt.id === item.receipt.id
      return <button type="button" key={item.zone} className={`pgs-prop pgs-zone-${item.zone} pgs-${item.shape}`} style={{'--pgs-x':x+'%','--pgs-y':y+'%','--pgs-width':width+'px'} as CSSProperties}
        aria-label={zh ? `${person.name}的${name}，${cn}` : `${name} for ${person.name}, ${en}`}
        aria-expanded={active} aria-controls={active ? panelId : undefined} onClick={() => setChoice(active ? null : item.receipt.id)}>
        <span className="pgs-shadow"/><span className="pgs-object"><Prop item={item} world={person.world}/></span>
      </button>
    })}
    {selected && spot && <div id={panelId} className={'pgs-caption ' + (spot[0] < 46 ? 'pgs-end' : 'pgs-start')} role="region" aria-label={zh ? '礼物说明' : 'Gift details'}>
      <button type="button" className="pgs-dismiss" onClick={() => setChoice(null)} aria-label={zh ? '收起说明' : 'Close details'}><I.X/></button>
      <strong>{zh ? selected.line.snapshot.name : selected.line.snapshot.en}{selected.line.quantity > 1 && ` ×${selected.line.quantity}`}</strong>
      <p>{person.name} · {zh ? spot[3] : spot[4]}</p>
      {selected.receipt.note && <blockquote>{selected.receipt.note}</blockquote>}
      <button type="button" className="pgs-receipt" onClick={() => onOpen(selected.receipt.id)}>{zh ? '查看回执' : 'View receipt'}<I.Chevron/></button>
    </div>}
    {recordOnly && focused && <div id={panelId} className="pgs-caption pgs-start pgs-keepsake" role="region" aria-label={zh ? '礼物记录' : 'Gift record'}>
      <button type="button" className="pgs-dismiss" onClick={() => setChoice(null)} aria-label={zh ? '收起说明' : 'Close details'}><I.X/></button>
      <p>{previousWorld
        ? (zh ? `这份心意送往${t(`world.${focused.target.world}`)}，已保存在礼物记录里。` : `Sent to ${t(`world.${focused.target.world}`)} and saved in your gift records.`)
        : (zh ? '这份心意已收进礼物记录' : 'This keepsake is saved in your gift records.')}</p>
      <button type="button" className="pgs-receipt" onClick={() => onOpen(focused.id)}>{zh ? '查看回执' : 'View receipt'}<I.Chevron/></button>
    </div>}
    {pending && <div className="pgs-pending" role="status">{previousWorld
      ? (zh ? `正在送往${t(`world.${pending.target.world}`)}，寄件已保留在记录里。` : `On its way to ${t(`world.${pending.target.world}`)}. Your parcel is saved in your records.`)
      : pending.lines.some(line => decoration(line.snapshot))
      ? (zh ? '尚在投递，抵达后会出现在这里' : 'In transit. Your gift will appear here when it arrives.')
      : (zh ? '尚在投递，抵达后会收进礼物记录' : 'In transit. Your keepsake will be saved in your gift records.')}</div>}
  </div>
}
