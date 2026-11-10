import { useEffect, useMemo, useRef } from 'react'
import type { WorldId } from './i18n'
import { WORLDS } from './worlds'

/* ------------------------------------------------------------------ *
 * 视觉原语：深界 · 界膜 · 透镜 · 光弧 · 记忆尘 · 信标
 * ------------------------------------------------------------------ */

/* 可复现的伪随机 */
function rng(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }

/* ------------------------------- 深界 ------------------------------- */
/* 真实的深空与光影摄影（Unsplash · Jr Korpa），统一调到深青 + 杏金 */
const UX = (id: string, w: number, h: number) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format&q=72`
export const COSMOS = {
  deep: UX('1607496220321-0c71c2fdbffb', 900, 1700),   // 深空：青色星云 + 金色星尘
  swirl: UX('1597557316367-5dd6a683e6dc', 900, 1700),  // 界隙：青色涡流 + 金色光迹
  warp: UX('1567400358647-c5c0600475b1', 900, 1700),   // 穿越：雾蓝 + 橙金光线
}
export type CosmosKind = keyof typeof COSMOS
export function DeepField({ variant = 'deep', stars = false, className = '', dim = 0.55 }: { variant?: CosmosKind; stars?: boolean; className?: string; dim?: number }) {
  return (
    <div className={`absolute inset-0 overflow-hidden bg-abyss ${className}`} aria-hidden>
      <img src={COSMOS[variant]} alt="" className="absolute inset-0 h-full w-full object-cover fx cosmos-drift" />
      <div className="absolute inset-0" style={{ background: `radial-gradient(130% 85% at 50% 18%, rgba(10,23,25,${dim * 0.25}) 0%, rgba(10,23,25,${dim}) 58%, rgba(7,16,18,${Math.min(0.96, dim + 0.38)}) 100%)` }} />
      {stars && <Stars count={26} />}
      <div className="absolute inset-0 grain opacity-[0.05]" />
    </div>
  )
}

function Stars({ count = 46, seed = 11 }: { count?: number; seed?: number }) {
  const stars = useMemo(() => {
    const r = rng(seed)
    return Array.from({ length: count }, () => ({ x: r() * 100, y: r() * 100, s: 0.8 + r() * 1.6, o: 0.25 + r() * 0.6, d: r() * 6, gold: r() < 0.35 }))
  }, [count, seed])
  return (
    <>
      {stars.map((st, i) => (
        <span key={i} className="absolute rounded-full fx twinkle" style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, opacity: st.o, background: st.gold ? '#ffe7bd' : '#e8f1ef', animationDelay: `${st.d}s`, animationDuration: `${4 + (i % 5)}s` }} />
      ))}
    </>
  )
}

/* ------------------------------- 界膜 -------------------------------- */
/* 两个世界之间的「膜」：一层光影摄影 + 缓慢掠过的光泽。深色用于界隙，浅色用于此岸 */
export function Veil({ tone = 'deep', className = '', style }: { tone?: 'deep' | 'light'; className?: string; lines?: number; style?: React.CSSProperties }) {
  const deep = tone === 'deep'
  return (
    <div className={`pointer-events-none absolute overflow-hidden ${className}`} style={style} aria-hidden>
      <img src={COSMOS.swirl} alt="" className="absolute inset-0 h-full w-full object-cover fx cosmos-drift" style={{ opacity: deep ? 0.9 : 0.42, filter: deep ? 'none' : 'saturate(0.85) brightness(1.25)' }} />
      {!deep && <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(247,245,239,0.55) 0%, rgba(247,245,239,0.25) 45%, rgba(247,245,239,0.7) 100%)' }} />}
      {deep && <div className="absolute inset-0" style={{ background: 'radial-gradient(90% 70% at 50% 50%, rgba(10,23,25,0) 0%, rgba(10,23,25,0.45) 100%)' }} />}
      <div className="absolute inset-y-0 -left-1/2 w-1/2 fx sheen" style={{ background: `linear-gradient(100deg, rgba(255,243,220,0) 0%, rgba(255,243,220,${deep ? 0.16 : 0.45}) 50%, rgba(255,243,220,0) 100%)` }} />
    </div>
  )
}

/* ------------------------------- 透镜 -------------------------------- */
/* 每位联系人的入口：镜中是 TA 所在的世界，人像叠在其中 */
export function Lens({ world, avatar, name, size = 52, arcs, className = '', style, dark, glow }: {
  world: WorldId; avatar?: string; name?: string; size?: number; arcs?: boolean[]; className?: string; style?: React.CSSProperties; dark?: boolean; glow?: boolean
}) {
  const w = WORLDS[world]
  const inset = Math.round(size * 0.15)
  return (
    <span className={`relative inline-block shrink-0 rounded-full ${className}`} style={{ width: size, height: size, ...style }}>
      {glow && <span className="absolute -inset-3 rounded-full fx lens-glow" style={{ background: `radial-gradient(circle, ${w.glow}, transparent 68%)` }} />}
      <span className="absolute inset-0 rounded-full overflow-hidden" style={{ boxShadow: `0 8px 20px -10px ${w.shadow}` }}>
        <img src={w.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: 'translate(calc(var(--tx, 0) * -3px), calc(var(--ty, 0) * -3px)) scale(1.18)' }} />
        <span className="absolute inset-0" style={{ background: w.lensTint }} />
        {avatar
          ? <img src={avatar} alt={name ?? ''} className="absolute rounded-full object-cover" style={{ inset, width: size - inset * 2, height: size - inset * 2, maskImage: 'radial-gradient(circle, #000 64%, transparent 71%)', WebkitMaskImage: 'radial-gradient(circle, #000 64%, transparent 71%)' }} />
          : <span className="absolute inset-0 flex items-center justify-center font-serif text-white drop-shadow" style={{ fontSize: size * 0.38 }}>{name?.slice(0, 1)}</span>}
        <span className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at calc(30% + var(--tx, 0) * 14%) calc(24% + var(--ty, 0) * 14%), rgba(255,255,255,0.6), transparent 40%)', mixBlendMode: 'screen' }} />
        <span className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${dark ? 'rgba(235,201,149,0.6)' : 'rgba(235,201,149,0.7)'}, inset 0 0 ${Math.round(size / 5)}px rgba(255,243,220,0.35)` }} />
      </span>
      {arcs && <ArcRing size={size + 12} lit={arcs} track={dark ? 'rgba(247,245,239,0.16)' : 'rgba(41,69,66,0.12)'} className="absolute" style={{ left: -6, top: -6 }} />}
    </span>
  )
}

/* ------------------------------- 光弧 -------------------------------- */
function arcPath(c: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)]
  const [x0, y0] = p(a0); const [x1, y1] = p(a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
/* 六段光弧：对应六类坐标；seq 为依次点亮（环形锁定） */
export function ArcRing({ size, lit, seq, step = 120, stroke = 1.6, track = 'rgba(247,245,239,0.16)', className = '', style }: {
  size: number; lit: boolean[] | number; seq?: boolean; step?: number; stroke?: number; track?: string; className?: string; style?: React.CSSProperties
}) {
  const total = 6; const gap = 12; const c = size / 2; const r = c - stroke - 1
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`pointer-events-none ${className}`} style={style} aria-hidden>
      {Array.from({ length: total }).map((_, i) => {
        const a0 = -90 + i * 60 + gap / 2; const a1 = a0 + 60 - gap
        const d = arcPath(c, r, a0, a1)
        const on = typeof lit === 'number' ? i < lit : !!lit[i]
        return (
          <g key={i}>
            <path d={d} stroke={track} strokeWidth={stroke} fill="none" strokeLinecap="round" />
            {on && <path d={d} stroke="#ebc995" strokeWidth={stroke} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray="1"
              style={{ filter: 'drop-shadow(0 0 3px rgba(235,201,149,0.85))', ...(seq ? { strokeDashoffset: 1, animation: `draw 0.34s cubic-bezier(0.16,1,0.3,1) ${i * step}ms forwards` } : {}) }} />}
          </g>
        )
      })}
    </svg>
  )
}

/* ------------------------------ 记忆尘 ------------------------------- */
/* 粒子从四面汇聚成环（TA 的轮廓显现） */
export function Dust({ cx, cy, r, count = 150, duration = 1400, className = '' }: { cx: number; cy: number; r: number; count?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cvs = ref.current; if (!cvs) return
    const ctx = cvs.getContext('2d'); if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = cvs.clientWidth; const H = cvs.clientHeight
    cvs.width = W * dpr; cvs.height = H * dpr; ctx.scale(dpr, dpr)
    const parts = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2
      const tr = r * (0.78 + Math.random() * 0.28)
      const far = 0.6 + Math.random() * 0.6
      return { sx: cx + Math.cos(a) * W * far, sy: cy + Math.sin(a) * H * far * 0.6, tx: cx + Math.cos(a) * tr, ty: cy + Math.sin(a) * tr, s: 0.6 + Math.random() * 1.7, d: Math.random() * 0.35, gold: Math.random() < 0.6 }
    })
    let raf = 0; const t0 = performance.now()
    const ease = (x: number) => 1 - Math.pow(1 - x, 3)
    const tick = (now: number) => {
      const t = (now - t0) / duration
      ctx.clearRect(0, 0, W, H)
      for (const p of parts) {
        const k = Math.min(1, Math.max(0, (t - p.d) / (1 - p.d)))
        const e = ease(k)
        const x = p.sx + (p.tx - p.sx) * e; const y = p.sy + (p.ty - p.sy) * e
        const alpha = t <= 1 ? 0.2 + 0.8 * e : Math.max(0, 1 - (t - 1) * 1.6)
        ctx.shadowBlur = 6; ctx.shadowColor = p.gold ? 'rgba(255,226,170,0.9)' : 'rgba(200,236,232,0.9)'
        ctx.fillStyle = p.gold ? `rgba(255,238,206,${alpha})` : `rgba(226,242,240,${alpha})`
        ctx.beginPath(); ctx.arc(x, y, p.s, 0, Math.PI * 2); ctx.fill()
      }
      if (t < 1.7) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cx, cy, r, count, duration])
  return <canvas ref={ref} className={`absolute inset-0 h-full w-full pointer-events-none ${className}`} aria-hidden />
}

/* ------------------------------- 信标 -------------------------------- */
/* 寻找的中心：同心环 + 光核；clarity 0–1 决定亮度，children 为全息轮廓 */
export function Beacon({ size = 128, clarity = 0, children, contract }: { size?: number; clarity?: number; children?: React.ReactNode; contract?: boolean }) {
  return (
    <div className={`seek-beacon relative rounded-full transition-transform duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] ${contract ? 'scale-[0.42]' : ''}`} style={{ width: size, height: size, background: 'var(--beacon-surface)' }}>
      <span className="absolute -inset-10 rounded-full fx breathe-slow" style={{ background: `radial-gradient(circle, rgba(var(--beacon-glow), ${0.08 + clarity * 0.16}), transparent 66%)` }} />
      <span className="absolute inset-0 rounded-full border" style={{ borderColor: 'var(--beacon-ring)' }} />
      <span className="absolute inset-[14%] rounded-full border" style={{ borderColor: 'var(--beacon-ring)', opacity: 0.55 }} />
      <svg className="absolute -inset-3 fx spin-slow" viewBox="0 0 100 100" style={{ width: size + 24, height: size + 24, animationDuration: '40s' }}>
        <circle cx="50" cy="50" r="48" fill="none" stroke="var(--seek-signal-gold)" strokeOpacity="0.7" strokeWidth="0.4" strokeDasharray="0.6 3.4" />
      </svg>
      <span className="absolute inset-[22%] rounded-full overflow-hidden">{children}</span>
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full fx breathe" style={{ width: 14 + clarity * 10, height: 14 + clarity * 10, background: 'radial-gradient(circle, var(--color-core) 5%, var(--seek-signal-gold) 45%, transparent 72%)', boxShadow: `0 0 ${12 + clarity * 24}px rgba(var(--beacon-glow), ${0.32 + clarity * 0.38})` }} />
    </div>
  )
}

/* 二次贝塞尔曲线路径 */
export function curve(x1: number, y1: number, x2: number, y2: number, bend = 0.18): string {
  const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2
  const dx = x2 - x1; const dy = y2 - y1
  return `M${x1} ${y1} Q${(mx - dy * bend).toFixed(1)} ${(my + dx * bend).toFixed(1)} ${x2} ${y2}`
}
