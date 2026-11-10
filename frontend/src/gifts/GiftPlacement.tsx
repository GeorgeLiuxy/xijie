import { useEffect, useState, useSyncExternalStore } from 'react'
import { useI18n, isZh } from '../i18n'
import { getGiftState, subscribeGifts, hasArrived, receiptMatchesPerson, targetMatchesPerson } from './store'
import { GiftIcon } from './GiftIcon'
import { getGiftGoal } from './client'
import type { GiftGoal } from './types'
import type { Person } from '../model'
import './integration.css'

export function GiftPlacement({ owner, person, onOpen }: { owner: string; person: Person; onOpen: (goal?:string) => void }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const state = useSyncExternalStore(callback => subscribeGifts(owner, callback), () => getGiftState(owner))
  const [now, setNow] = useState(Date.now)
  const [goal,setGoal]=useState<GiftGoal|null>(null)
  const link=state.goals?.filter(item=>targetMatchesPerson(item.target,person)).slice(-1)[0]
  useEffect(()=>{let live=true;setGoal(null);const read=()=>{if(link&&!document.hidden)void getGiftGoal(link.id).then(value=>{if(live)setGoal(value)}).catch(()=>{})};read();const timer=setInterval(read,3000);return()=>{live=false;clearInterval(timer)}},[link?.id])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const parcels = state.receipts.filter(receipt => receiptMatchesPerson(receipt, person) && hasArrived(receipt, now))
  const pieces = parcels.flatMap(parcel => parcel.lines.filter(line => line.snapshot.effect !== 'service').map(line => ({ ...line, parcel }))).slice(-4)
  return <><button className="gift-space-corner" onClick={()=>onOpen()} aria-label={zh ? `给${person.name}寄礼物` : `Send ${person.name} a gift`}>
    <div className="gift-space-corner-title"><span>{zh ? '留在这里的心意' : 'Gifts kept here'}</span><small>{zh ? '寄礼物 ↗' : 'Send a gift ↗'}</small></div>
    {pieces.length > 0 ? <div className="gift-space-pieces">{pieces.map((piece, index) => <span key={piece.parcel.id + '-' + index}>
      <GiftIcon id={piece.giftId} /><b>{zh ? piece.snapshot.name : piece.snapshot.en}</b>{piece.quantity > 1 && <em>×{piece.quantity}</em>}
    </span>)}</div> : <p>{zh ? '一件熟悉的小东西，也能让这里更像家。' : 'A familiar little object can make this place feel like home.'}</p>}
  </button>{link&&<button className="gift-space-goal" onClick={()=>onOpen(link.id)}><span>✧</span><span><b>{zh?(link.kind==='home'?'一起搭的住所':link.kind==='album'?'一起留下的回忆':'一起寄成的航票'):'Our shared wish'}</b><small>{goal?`${goal.current} / ${goal.target} · ${goal.completed?(zh?'已完成 · 查看成果':'Complete · View result'):(zh?'每份贡献都保留在这里':'Every contribution stays here')}`:(zh?'查看共同进展':'View shared progress')}</small></span><i>›</i></button>}</>
}
