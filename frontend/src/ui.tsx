import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { useI18n } from './i18n'
import { useNativeBack } from './mobile/back'
import {
  ChatsCircle, Aperture, Planet, UserCircle, Broadcast, Signature, UserFocus, Waveform, BookOpenText, HourglassMedium, MapPin,
  Microphone, MicrophoneSlash, Keyboard, Phone, PhoneDisconnect, VideoCamera, Image as ImageGlyph, Camera, EnvelopeSimple, BookmarkSimple,
  UsersThree, Plus, X, CaretLeft, CaretRight, GearSix, DotsThree, PaperPlaneRight, Copy, Trash, SpeakerHigh, ClosedCaptioning, Stop,
  Check, Globe, ListBullets, Play, Heart, ChatCircle, Sparkle, CalendarHeart, Images, Mailbox,
  type Icon, type IconWeight,
} from '@phosphor-icons/react'

/* ------------------------------------------------------------------ *
 * 通用 UI：图标（Phosphor）· 触感/音效 · 玻璃面板 · 开关 · 状态栏明暗
 * ------------------------------------------------------------------ */

/* --------------------------------- icons -------------------------------- */
/* Phosphor 图标：以双色调为主（主体 + 20% 底色层），选中与强调处用实心 */
export type IP = { className?: string; weight?: IconWeight }
const mk = (C: Icon, base: IconWeight = 'duotone') => (p: IP) => <C className={p.className} weight={p.weight ?? base} aria-hidden />
export const I = {
  Meet: mk(ChatsCircle), Space: mk(Aperture), Atlas: mk(Planet), Me: mk(UserCircle),
  Beacon: mk(Broadcast), Name: mk(Signature), Face: mk(UserFocus), Voice: mk(Waveform), Story: mk(BookOpenText), Time: mk(HourglassMedium), Place: mk(MapPin),
  Mic: mk(Microphone), MicOff: mk(MicrophoneSlash), Keyboard: mk(Keyboard), Phone: mk(Phone), Hangup: mk(PhoneDisconnect, 'fill'), Video: mk(VideoCamera),
  Photo: mk(ImageGlyph), Photos: mk(Images), Camera: mk(Camera), Mail: mk(EnvelopeSimple), Keep: mk(BookmarkSimple), Gather: mk(UsersThree),
  Plus: mk(Plus, 'bold'), X: mk(X, 'bold'), Back: mk(CaretLeft, 'bold'), Chevron: mk(CaretRight, 'bold'), Gear: mk(GearSix), More: mk(DotsThree, 'bold'),
  Send: mk(PaperPlaneRight, 'fill'), Copy: mk(Copy), Trash: mk(Trash), Speaker: mk(SpeakerHigh), Captions: mk(ClosedCaptioning), Stop: mk(Stop, 'fill'),
  Check: mk(Check, 'bold'), Globe: mk(Globe), List: mk(ListBullets), Play: mk(Play, 'fill'), Heart: mk(Heart), Comment: mk(ChatCircle),
  Spark: mk(Sparkle, 'fill'), Calendar: mk(CalendarHeart),
  PaperBird: mk(PaperPlaneRight), Signal: mk(Broadcast), Mailbox: mk(Mailbox),
}

/* ------------------------------ 触感 · 音效 ----------------------------- */
export const fxPrefs = { haptics: true, sound: false, calm: false }

export function haptic(p: number | number[]) {
  if (!fxPrefs.haptics) return
  try { (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(p) } catch { /* 不支持时忽略 */ }
}

type Note = { f: number; at: number; len: number; vol: number; to?: number }
const CHIMES: Record<'rise' | 'arrive' | 'connect' | 'tick' | 'depart' | 'transit', Note[]> = {
  depart: [{ f: 164, at: 0, len: .12, vol: .025, to: 83 }, { f: 51, at: .16, len: 1.25, vol: .048, to: 73 }],
  transit: [{ f: 116, at: 0, len: 1.1, vol: .027, to: 47 }, { f: 231, at: .04, len: .72, vol: .012, to: 91 }],
  rise: [{ f: 110, at: 0, len: 2.4, vol: 0.05, to: 330 }],
  arrive: [{ f: 523.25, at: 0, len: 1.8, vol: 0.05 }, { f: 783.99, at: 0.2, len: 2.2, vol: 0.04 }],
  connect: [{ f: 659.25, at: 0, len: 1.4, vol: 0.045 }, { f: 987.77, at: 0.14, len: 1.8, vol: 0.035 }],
  tick: [{ f: 1568, at: 0, len: 0.09, vol: 0.02 }],
}
let actx: AudioContext | null = null
export function chime(kind: keyof typeof CHIMES) {
  if (!fxPrefs.sound) return
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    actx = actx ?? new AC()
    const now = actx.currentTime
    for (const n of CHIMES[kind]) {
      const o = actx.createOscillator(); const g = actx.createGain()
      o.type = 'sine'; o.frequency.setValueAtTime(n.f, now + n.at)
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, now + n.at + n.len)
      g.gain.setValueAtTime(0.0001, now + n.at)
      g.gain.exponentialRampToValueAtTime(n.vol, now + n.at + 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.len)
      o.connect(g).connect(actx.destination)
      o.start(now + n.at); o.stop(now + n.at + n.len + 0.05)
    }
  } catch { /* 环境不支持时忽略 */ }
}

/* ---------------------------- 状态栏明暗 ----------------------------- */
export type BarTone = 'light' | 'dark'
export const ToneCtx = createContext<(t: BarTone) => () => void>(() => () => {})
/* 此岸是否处于夜间配色（界膜等装饰据此切换深浅） */
export const NightCtx = createContext(false)
/* 覆盖状态栏文字颜色：深色界面用 light（亮字），浅色界面用 dark */
export function useStatusTone(tone: BarTone | null, active = true) {
  const push = useContext(ToneCtx)
  useEffect(() => {
    if (!active || !tone) return
    return push(tone)
  }, [tone, active, push])
}

/* --------------------------------- sheet -------------------------------- */
const SheetBackDepth = createContext(0)
const sheetControls = 'button, input, textarea, select, a[href], [tabindex]'
export function Sheet({ onClose, children, title, dark, tall, footer }: {
  onClose: () => void; children: React.ReactNode; title?: React.ReactNode; dark?: boolean; tall?: boolean; footer?: React.ReactNode
}) {
  const { t } = useI18n()
  const titleId = useId()
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const backDepth = useContext(SheetBackDepth)
  useNativeBack(() => { onClose(); return true }, true, Math.min(50, 45 + backDepth), nativeBackRoot)
  useLayoutEffect(() => {
    const layer = nativeBackRoot.current
    if (!layer?.contains(document.activeElement)) closeButton.current?.focus({ preventScroll: true })
    return () => {
      requestAnimationFrame(() => {
        if (layer?.isConnected || document.activeElement !== document.body) return
        const target = opener.current
        if (target?.isConnected && !target.closest('[hidden], [inert]')) target.focus({ preventScroll: true })
      })
    }
  }, [])
  return (
    <SheetBackDepth.Provider value={backDepth + 1}>
    <div ref={nativeBackRoot} className="absolute inset-0 z-[85]">
      <div aria-hidden className={`absolute inset-0 animate-fade ${dark ? 'bg-black/45' : 'bg-ink/30'}`} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : t('common.close')}
        className={`absolute inset-x-0 bottom-0 rounded-t-[30px] animate-sheet flex flex-col ${tall ? 'top-[64px]' : 'max-h-[86%]'} ${dark ? 'glass-deep text-pearl' : 'bg-canvas text-ink shadow-2xl'}`}
        onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); onClose()
          }
          if (event.key !== 'Tab') return
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(sheetControls)].filter(element =>
            element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
          const edge = event.shiftKey ? controls.at(0) : controls.at(-1)
          if (document.activeElement === edge) {
            event.preventDefault()
            const opposite = event.shiftKey ? controls.at(-1) : controls.at(0)
            opposite?.focus()
          }
        }}>
        <div className="pt-3 flex justify-center shrink-0"><div className={`h-1 w-10 rounded-full ${dark ? 'bg-white/20' : 'bg-ink/15'}`} /></div>
        <div className="flex items-center gap-3 px-6 pt-1 pb-2 shrink-0">
          <div id={titleId} className="min-w-0 flex-1 font-serif text-[22px] leading-tight [overflow-wrap:anywhere]">{title}</div>
          <button ref={closeButton} onClick={onClose} aria-label={t('common.close')}
            className={`h-11 w-11 shrink-0 rounded-full grid place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 ${dark ? 'bg-white/10 focus-visible:outline-sun' : 'bg-cloud focus-visible:outline-sky-deep'}`}><I.X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-6 pb-6">{children}</div>
        {footer && <div className={`shrink-0 px-6 pt-3 pb-8 ${dark ? '' : 'border-t border-line'}`}>{footer}</div>}
      </div>
    </div>
    </SheetBackDepth.Provider>
  )
}

export function Toast({ text, dark }: { text: string; dark?: boolean }) {
  return (
    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[150px] z-[90] animate-toast">
      <div className={`rounded-full px-4 py-2.5 text-[13.5px] whitespace-nowrap ${dark ? 'glass-deep text-pearl' : 'btn-dark shadow-lg'}`}>{text}</div>
    </div>
  )
}

export function Switch({ on, onToggle, label, desc, dark }: { on: boolean; onToggle: () => void; label: string; desc?: string; dark?: boolean }) {
  return (
    <button onClick={onToggle} role="switch" aria-checked={on} className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${dark ? 'active:bg-white/5' : 'active:bg-cloud/50'}`}>
      <span className="flex-1 min-w-0">
        <span className={`block text-[15.5px] ${dark ? 'text-pearl' : 'text-ink'}`}>{label}</span>
        {desc && <span className={`block text-[12.5px] mt-0.5 ${dark ? 'text-pearl/55' : 'text-muted'}`}>{desc}</span>}
      </span>
      <span className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-sky' : dark ? 'bg-white/15' : 'bg-cloud'}`}>
        <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all duration-300 ${on ? 'left-[23px]' : 'left-[3px]'}`} />
        {on && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-sun" />}
      </span>
    </button>
  )
}

/* 小号等宽注记（坐标、编号等科幻点缀） */
export function Micro({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono text-[10.5px] tracking-[0.18em] uppercase ${className}`}>{children}</span>
}

export function AiBadge({ dark, label }: { dark?: boolean; label: string }) {
  return <span className={`inline-flex items-center rounded-full px-1.5 py-[1px] text-[10px] font-mono tracking-[0.12em] ring-1 ${dark ? 'text-pearl/80 ring-white/30' : 'text-sky-deep ring-sky/40'}`}>{label}</span>
}
