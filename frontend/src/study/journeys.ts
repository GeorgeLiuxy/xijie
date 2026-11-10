import { isZh, type Lang, type WorldId } from '../i18n'
import room from './assets/room.webp'
import gravity from './assets/gravity.webp'
import spiral from './assets/galaxy.webp'
import dust from './assets/nebula.webp'
import ocean from './assets/planet.webp'

const files = import.meta.glob<string>('./assets/*/*.webp', { eager: true, import: 'default', query: '?url' })
function film(folder: string, base: { threshold?: string; galaxy?: string; nebula?: string; planet?: string } = {}) {
  const shot = (name: string) => files[`./assets/${folder}/${name}.webp`]
  return {
    room, decoy: folder === 'tide' ? files['./assets/isles/galaxy.webp'] : spiral, gravity: base.threshold ?? shot('threshold'), galaxy: base.galaxy ?? shot('galaxy'),
    nebula: base.nebula ?? shot('nebula'), planet: base.planet ?? shot('planet'),
    air: shot('atmosphere'), land: shot('landfall'), close: shot('threshold-close'), arrival: shot('encounter'),
  }
}
export const routes = {
  courtyard: {
    id: 'courtyard', index: 0, world: '日光庭院', galaxy: '双晷星系', cloud: '金枝星云', planet: '熹明星', place: '扶桑树冠', door: '日环后的晒茶台',
    thresholdLine: '两道日影，正从相反方向移过桌面', gateLine: '等两轮太阳重合，沿光隙穿行',
    skyLine: '沿金色星环追踪回声', airLine: '穿过云海，循双重树影下降', approach: '听见竹匾里翻动茶叶的声音',
    landmark: '青铜日环', sampleGreeting: '这片叶子刚晒好。你闻闻，还是那个香味。',
    arm: [.76,.56], coast: [.57,.41], star: [.46,.49], airTarget: [.591,.38],
    far: [.606,.48,.145,.107], opening: [.49,.47,.74,.49], plates: film('sun'),
  },
  tide: {
    id: 'tide', index: 1, world: '潮汐回廊', galaxy: '潮生星系', cloud: '潮汐星云', planet: '望汐星', place: '幽水渡口', door: '灯下的船舱',
    thresholdLine: '茶水向上漂起，杯口接住了水滴', gateLine: '沉过倒悬的水面，追踪另一侧的灯火',
    skyLine: '沿旋臂追踪回声', airLine: '沿回流的海水，潜入玄武岩洞', approach: '在几道倒影里辨出一盏船灯',
    landmark: '船篷下的油灯', sampleGreeting: '船上有风。过来，我给你挡着灯。',
    arm: [.83,.397], coast: [.463,.387], star: [.598,.42], airTarget: [.5,.52],
    far: [.666,.475,.148,.093], opening: [.50,.52,.59,.685], plates: film('tide', {threshold: gravity, galaxy: spiral, nebula: dust, planet: ocean}),
  },
  isles: {
    id: 'isles', index: 2, world: '折光星屿', galaxy: '镜弧星系', cloud: '烟羽星云', planet: '岚屿星', place: '虹桥云站', door: '候车长椅',
    thresholdLine: '脚下的地面浮起，窗光折向云层', gateLine: '跟随三束折光，等桥面接合',
    skyLine: '沿星盘的暗带追踪回声', airLine: '掠过悬岛群，顺着桥轨下降', approach: '桥尽头，一把长椅正等着人',
    landmark: '旧站台的红色梁架', sampleGreeting: '等累了吧？坐这儿，喝口茶。',
    arm: [.59,.467], coast: [.42,.40], star: [.501,.463], airTarget: [.612,.463],
    far: [.894,.401,.09,.070], opening: [.505,.449,.48,.505], plates: film('isles'),
  },
} as const
export type Route = typeof routes[WorldId]
export type Images = Record<Exclude<keyof Route['plates'], 'arrival'>, HTMLImageElement> & {
  arrival: HTMLImageElement | HTMLCanvasElement
}
export const duration = 22.4
export const beats = [0,1.95,4.45,6.7,8.15,10.4,12.55,15.0,16.9,18.65,21.75]

const english = {
  courtyard: { galaxy: 'Twin Dial Galaxy', cloud: 'Golden Bough Nebula', planet: 'Daystar', place: 'Fusang Canopy', door: 'The tea terrace', landmark: 'The bronze sun ring', sampleGreeting: 'These leaves have just dried. Here, do you remember the scent?',
    thresholdLine: 'Two shadows cross the table in opposite directions.', gateLine: 'The suns align. A passage opens between them.', skyLine: 'The echo follows a golden arm.', airLine: 'Descend through clouds and twin shadows.', approach: 'Beyond the ring, bamboo tea trays catch the sun.' },
  tide: { galaxy: 'Tideborn Galaxy', cloud: 'Tidal Nebula', planet: 'Tidewatch', place: 'Stillwater Crossing', door: 'The lantern cabin', landmark: 'The ferry lantern', sampleGreeting: 'There’s a breeze on deck. Come closer, I’ll shield the lantern.',
    thresholdLine: 'Droplets rise back into the cup.', gateLine: 'Cross the inverted tide toward the lights.', skyLine: 'Follow the echo along the spiral arm.', airLine: 'A rising current leads into a basalt cavern.', approach: 'One lantern holds steady among the reflections.' },
  isles: { galaxy: 'Mirror Arc Galaxy', cloud: 'Plume Nebula', planet: 'Mist Isle', place: 'Cloudbridge Station', door: 'The platform bench', landmark: 'The old station arch', sampleGreeting: 'Tired of waiting? Sit here. Have some tea.',
    thresholdLine: 'The floor lifts. Window light bends toward the clouds.', gateLine: 'Three rays converge and the bridge meets the rail.', skyLine: 'Trace the echo along the dark stellar lane.', airLine: 'Follow the rails down through the floating islands.', approach: 'An empty bench waits at the end of the bridge.' },
}
export const destination = (world: WorldId, lang: Lang) => isZh(lang) ? routes[world] : english[world]

// Both the last camera frame and the recognition screen look through this very opening.
export function interiorCrop(r: Route) {
  const [cx, cy, width, height] = r.opening
  const w = width * .8, h = height * .8
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export function caption(beat: number, world: WorldId, lang: Lang, name: string, clue: string) {
  const r = destination(world, lang)
  const zh = isZh(lang)
  return [
    [zh ? '此岸' : 'This shore', clue || (zh ? '从这张照片出发' : 'The search begins with this photograph.')],
    [zh ? '越过第一道门' : 'Across the threshold', r.thresholdLine],
    [zh ? '搜寻平行宇宙' : 'Between worlds', zh ? '一道回声掠过，又渐渐远去' : 'One echo passes, then fades.'],
    [zh ? '追踪第二道回声' : 'A second echo', r.gateLine],
    [r.galaxy, r.skyLine], [r.cloud, zh ? '从星尘中辨认恒星的方位' : 'A star emerges from the dust.'],
    [r.planet, zh ? '记忆信号落在晨昏线附近' : 'The signal settles near the daybreak line.'],
    [r.place, r.airLine], [r.landmark, r.approach],
    [r.door, zh ? '回声就在前面' : 'The echo is just ahead.'],
    [name, [r.place, r.door].join(' · ')],
  ][beat]
}
