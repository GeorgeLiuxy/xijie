import type { WorldId } from './i18n'

/* ------------------------------------------------------------------ *
 * 三个首发世界。每个世界有自己的「物理法则」——平行世界感的来源。
 *  · 日光庭院：两轮柔和的太阳同在天上，第二道地平线横过天空
 *  · 潮汐回廊：潮水悬于天际，水光向上流
 *  · 折光星屿：岛屿悬浮于云海，棱镜光与光桥相连
 * 场景摄影来自 Unsplash（Brunxs / Clark Gu / Quentin Baret）。
 * ------------------------------------------------------------------ */

const U = (id: string, w: number, h: number) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format&q=75`

export type WorldDef = {
  id: WorldId
  code: string
  img: string
  thumb: string
  base: string        // 场景下方的可读底色
  glow: string
  accent: string
  shadow: string
  grade: string       // 调色层
  lensTint: string
  atlas: { x: number; y: number; size: number; sky: string; horizon: string }
}

export const WORLDS: Record<WorldId, WorldDef> = {
  courtyard: {
    id: 'courtyard', code: 'ELY·01',
    img: U('1765478212424-31ae078c7e9f', 900, 1500), thumb: U('1765478212424-31ae078c7e9f', 240, 240),
    base: '#f5f0e6', glow: 'rgba(255,224,168,0.95)', accent: '#e3bf86', shadow: 'rgba(150,110,50,0.45)',
    grade: 'linear-gradient(180deg, rgba(255,232,196,0.38) 0%, rgba(255,240,214,0.08) 42%, rgba(246,241,231,0) 70%)',
    lensTint: 'linear-gradient(160deg, rgba(255,236,200,0.28), rgba(90,64,28,0.18))',
    atlas: { x: 26, y: 54, size: 104, sky: '#293c36', horizon: '#737554' },
  },
  tide: {
    id: 'tide', code: 'ELY·02',
    img: U('1707489636403-c539c2cdc101', 900, 1500), thumb: U('1707489636403-c539c2cdc101', 240, 240),
    base: '#edf3f1', glow: 'rgba(186,230,224,0.95)', accent: '#8fc3bd', shadow: 'rgba(40,96,100,0.45)',
    grade: 'linear-gradient(180deg, rgba(246,214,224,0.22) 0%, rgba(214,236,232,0.08) 45%, rgba(20,60,64,0.12) 100%)',
    lensTint: 'linear-gradient(160deg, rgba(246,220,230,0.22), rgba(20,70,74,0.22))',
    atlas: { x: 74, y: 62, size: 92, sky: '#19384a', horizon: '#3a7883' },
  },
  isles: {
    id: 'isles', code: 'ELY·03',
    img: U('1764181691924-24489524c938', 900, 1500), thumb: U('1764181691924-24489524c938', 240, 240),
    base: '#f0eef4', glow: 'rgba(226,214,248,0.95)', accent: '#c9b9e6', shadow: 'rgba(84,70,130,0.45)',
    grade: 'linear-gradient(180deg, rgba(214,206,240,0.32) 0%, rgba(255,236,214,0.12) 45%, rgba(241,239,244,0) 100%)',
    lensTint: 'linear-gradient(160deg, rgba(226,214,248,0.26), rgba(60,50,100,0.2))',
    atlas: { x: 52, y: 25, size: 78, sky: '#353450', horizon: '#80769b' },
  },
}

/* 正弦波路径（用于潮面、丝线、信号）；周期整除平移量即可无缝循环 */
export function wave(x0: number, x1: number, y: number, amp: number, period: number, step = 4): string {
  let d = ''
  for (let x = x0; x <= x1; x += step) d += `${x === x0 ? 'M' : 'L'}${x} ${(y + Math.sin((x / period) * Math.PI * 2) * amp).toFixed(2)} `
  return d
}

/* ------------------------------ 世界场景 ------------------------------ */
export function WorldScene({ world, still, className = '' }: { world: WorldId; still?: boolean; className?: string }) {
  const w = WORLDS[world]
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <img src={w.img} alt="" className={`absolute inset-0 h-full w-full object-cover ${still ? '' : 'fx world-breathe'}`} />
      <div className="absolute inset-0" style={{ background: w.grade }} />
      {world === 'courtyard' && <CourtyardLaw still={still} />}
      {world === 'tide' && <TideLaw still={still} img={w.img} />}
      {world === 'isles' && <IslesLaw still={still} />}
      <div className="absolute inset-0 grain opacity-[0.04]" />
    </div>
  )
}

function CourtyardLaw({ still }: { still?: boolean }) {
  return (
    <>
      {/* 第二道地平线：天空里一道淡金色的弧 */}
      <svg className="absolute inset-x-0 top-[4%] h-[30%] w-full" viewBox="0 0 400 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cy-h" x1="0" x2="1"><stop offset="0" stopColor="#fff3dc" stopOpacity="0" /><stop offset="0.55" stopColor="#ffe2a8" stopOpacity="0.95" /><stop offset="1" stopColor="#fff3dc" stopOpacity="0" /></linearGradient>
        </defs>
        <path d="M-20 150 Q 200 36 420 118" stroke="url(#cy-h)" strokeWidth="1.3" fill="none" vectorEffect="non-scaling-stroke" />
        <path d="M-20 160 Q 200 48 420 128" stroke="url(#cy-h)" strokeWidth="0.7" fill="none" opacity="0.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* 两轮太阳 */}
      <span className={`absolute rounded-full ${still ? '' : 'fx sun-breathe'}`} style={{ right: '6%', top: '6%', width: 128, height: 128, background: 'radial-gradient(circle, rgba(255,255,250,1) 0%, rgba(255,242,210,0.95) 16%, rgba(255,214,150,0.4) 40%, rgba(255,214,150,0) 70%)' }} />
      <span className={`absolute rounded-full ${still ? '' : 'fx sun-drift'}`} style={{ right: '34%', top: '16%', width: 58, height: 58, background: 'radial-gradient(circle, rgba(255,250,240,0.95) 0%, rgba(255,226,180,0.5) 34%, rgba(255,226,180,0) 70%)' }} />
      {!still && <span className="absolute fx rays" style={{ right: '-40%', top: '-30%', width: '130%', height: '95%', background: 'conic-gradient(from 200deg at 72% 30%, rgba(255,236,196,0) 0deg, rgba(255,236,196,0.2) 7deg, rgba(255,236,196,0) 15deg, rgba(255,236,196,0) 38deg, rgba(255,236,196,0.14) 44deg, rgba(255,236,196,0) 52deg)' }} />}
      {!still && <span className="absolute fx leaf" style={{ left: '-12%', bottom: '6%', width: '62%', height: '30%', background: 'radial-gradient(closest-side, rgba(40,60,40,0.16), rgba(40,60,40,0))' }} />}
    </>
  )
}

function TideLaw({ still, img }: { still?: boolean; img: string }) {
  return (
    <>
      {/* 悬于天际的潮水：同一片海倒挂在天上 */}
      <div className="absolute inset-x-[-12%] top-0 h-[38%] overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, #000 0%, #000 38%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 38%, transparent 100%)' }}>
        <div className={`absolute inset-y-0 left-0 ${still ? '' : 'fx tide-drift'}`} style={{ width: '170%', backgroundImage: `url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center 88%', transform: 'scaleY(-1)', opacity: 0.9 }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(110,170,168,0.28), rgba(255,255,255,0))' }} />
      </div>
      <svg className="absolute inset-x-0 top-[25%] h-[6%] w-full overflow-visible" viewBox="0 0 400 40" preserveAspectRatio="none">
        <g className={still ? '' : 'fx silk'} style={{ animationDuration: '16s' }}>
          <path d={wave(-20, 820, 20, 5, 100, 6)} stroke="rgba(255,255,255,0.8)" strokeWidth="1.1" fill="none" vectorEffect="non-scaling-stroke" />
          <path d={wave(-20, 820, 26, 3, 50, 6)} stroke="rgba(214,240,236,0.55)" strokeWidth="0.8" fill="none" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      {/* 向上流的水光 */}
      {!still && Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="absolute rounded-full fx rise-up" style={{ left: `${8 + i * 10.5}%`, bottom: `${10 + (i % 3) * 7}%`, width: 3, height: 3, background: 'rgba(255,255,255,0.9)', boxShadow: '0 0 7px rgba(190,240,236,0.95)', animationDelay: `${i * 0.7}s`, animationDuration: `${6 + (i % 4)}s` }} />
      ))}
    </>
  )
}

function IslesLaw({ still }: { still?: boolean }) {
  const beams = [
    { c: 'rgba(214,200,248,0.42)', r: -14, l: '26%' },
    { c: 'rgba(255,226,180,0.36)', r: 2, l: '46%' },
    { c: 'rgba(180,226,222,0.34)', r: 16, l: '62%' },
  ]
  return (
    <>
      {beams.map((b, i) => (
        <span key={i} className={`absolute top-[-12%] h-[78%] w-[18%] rounded-b-full ${still ? '' : 'fx prism-sway'}`} style={{ left: b.l, background: `radial-gradient(60% 100% at 50% 0%, ${b.c}, rgba(255,255,255,0))`, transform: `rotate(${b.r}deg)`, transformOrigin: 'top center', animationDelay: `${i * 1.3}s` }} />
      ))}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="is-b" x1="0" x2="1"><stop offset="0" stopColor="#ffe9c4" stopOpacity="0.05" /><stop offset="0.5" stopColor="#ffe2a8" stopOpacity="0.95" /><stop offset="1" stopColor="#ffe9c4" stopOpacity="0.05" /></linearGradient>
        </defs>
        <path d="M14 58 Q 31 45 49 54" stroke="url(#is-b)" strokeWidth="1.3" fill="none" vectorEffect="non-scaling-stroke" />
        <path d="M49 54 Q 67 43 86 57" stroke="url(#is-b)" strokeWidth="1.3" fill="none" vectorEffect="non-scaling-stroke" />
        {!still && <circle r="0.8" fill="#fff6e2"><animateMotion dur="6s" repeatCount="indefinite" path="M14 58 Q 31 45 49 54 Q 67 43 86 57" /></circle>}
      </svg>
      {!still && Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className="absolute rounded-full fx mote" style={{ left: `${6 + i * 9.3}%`, top: `${30 + ((i * 37) % 40)}%`, width: 2.5, height: 2.5, background: 'rgba(255,248,232,0.95)', boxShadow: '0 0 6px rgba(226,214,248,0.95)', animationDelay: `${i * 0.6}s`, animationDuration: `${7 + (i % 3) * 2}s` }} />
      ))}
      <span className={`absolute ${still ? '' : 'fx prism-spin'}`} style={{ left: '18%', top: '15%', width: 16, height: 16, background: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(214,200,248,0.7), rgba(180,226,222,0.7))', clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.9))' }} />
    </>
  )
}

/* --------------------- 生成中：地平线上的世界信号 --------------------- */
export function HorizonSignal({ world, label }: { world: WorldId; label: string }) {
  return (
    <div className="flex items-center gap-2.5 animate-fade" role="status" aria-live="polite">
      {world === 'courtyard' && (
        <span className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="h-2.5 w-2.5 rounded-full fx leaf-pulse" style={{ background: 'radial-gradient(circle, #ffe2a8 0%, rgba(255,226,168,0) 72%)', animationDelay: `${i * 0.22}s` }} />)}</span>
      )}
      {world === 'tide' && (
        <svg width="56" height="12" viewBox="0 0 56 12" className="overflow-hidden"><g className="fx wave-run"><path d={wave(0, 112, 6, 3.6, 18, 2)} stroke="#6fb0aa" strokeWidth="1.4" fill="none" /></g></svg>
      )}
      {world === 'isles' && (
        <span className="relative h-4 w-4"><span className="absolute inset-0 fx prism-spin" style={{ clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', background: 'linear-gradient(135deg, #fff, #c6b3ec, #9fd2cc)' }} /><span className="absolute -inset-2 rounded-full fx leaf-pulse" style={{ background: 'radial-gradient(circle, rgba(214,200,248,0.6), transparent 70%)' }} /></span>
      )}
      <span className="font-mono text-[10.5px] tracking-[0.2em] uppercase text-ink-soft">{label}</span>
    </div>
  )
}

/* ---------------------- 发送：光抵达地平线时的效果 ---------------------- */
export function Arrival({ world }: { world: WorldId }) {
  if (world === 'tide') return <span className="block h-4 w-20 rounded-[50%] border border-white fx ripple-out" style={{ boxShadow: '0 0 12px rgba(190,240,236,0.9)' }} />
  if (world === 'isles') return <span className="block h-10 w-10 fx flare" style={{ background: 'radial-gradient(circle, #fff 0%, rgba(214,200,248,0.7) 26%, transparent 62%)', clipPath: 'polygon(50% 0, 56% 44%, 100% 50%, 56% 56%, 50% 100%, 44% 56%, 0 50%, 44% 44%)' }} />
  return <span className="block h-12 w-12 rounded-full fx glow-pop" style={{ background: 'radial-gradient(circle, rgba(255,244,214,1), rgba(255,226,170,0) 70%)' }} />
}

/* ------------------------ 各世界的收信方式 ------------------------ */
export function LetterGlyph({ world, className }: { world: WorldId; className?: string }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (world === 'tide') return <svg {...common}><path d="M10 3h4M10.5 3v3.2c0 .8-.6 1.3-1.3 1.9C7.6 9.3 7 10.6 7 12.4V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6.6c0-1.8-.6-3.1-2.2-4.3-.7-.6-1.3-1.1-1.3-1.9V3" /><path d="M9.5 14h5M9.5 16.5h3.5" /></svg>
  if (world === 'isles') return <svg {...common}><path d="M2.5 13.5l7.5-2.2 3.6-6.8 1.2 7.6 6.7 1.2-6.6 2-2.4 5.6-3.1-5.4z" /><path d="M10 11.3l3.9 2.2" /></svg>
  return <svg {...common}><path d="M5 20V11a5 5 0 0 1 10 0v9" /><path d="M15 11h3.5a1.5 1.5 0 0 1 1.5 1.5V20H5" /><path d="M10 6V3h3" /><path d="M8 13h4" /></svg>
}

/* ---------------------------- 居民的位置 ---------------------------- */
type Spot = [number, number]
export const RESIDENT_SPOTS: Record<WorldId, Spot[]> = {
  courtyard: [[30, 64], [70, 58], [50, 74], [16, 72]],
  tide: [[26, 68], [68, 63], [48, 76], [84, 72]],
  isles: [[20, 60], [52, 52], [80, 60], [38, 70]],
}
