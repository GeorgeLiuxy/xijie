import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { isZh, useI18n } from '../i18n'
import { fxPrefs } from '../ui'
import type { WorldId } from '../i18n'
import type { GoalKind } from './types'

type Props = { kind: GoalKind; current: number; target: number; parts: string[]; world: WorldId }
type Part = { root: THREE.Group; home: THREE.Vector3; progress: number; present: boolean }
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const ease = (value: number) => value * value * (3 - 2 * value)

export function GiftGoalScene({ kind, current, target, parts, world }: Props) {
  const { lang } = useI18n(), zh = isZh(lang)
  const canvas = useRef<HTMLCanvasElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const state = useRef({ current, target, parts })
  state.current = { current, target, parts }
  const invalidate = useRef<() => void>(() => {})
  const keyboard = useRef<(key: string) => void>(() => {})
  const [unavailable, setUnavailable] = useState(false)
  const [interacted, setInteracted] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const element = canvas.current, host = container.current
    if (!element || !host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: element, alpha: true, antialias: true, powerPreference: 'low-power' })
    } catch { setUnavailable(true); return }
    setUnavailable(false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setClearColor(0x101a20, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, .05, 45)
    const collection = new THREE.Group()
    scene.add(collection)
    const isWarm = world === 'courtyard'
    const cool = world === 'tide' ? 0x84b6bd : 0xa7b8be
    scene.add(new THREE.HemisphereLight(cool, 0x25251f, 1.45))
    const key = new THREE.DirectionalLight(isWarm ? 0xffd5a0 : 0xffdbb2, 3)
    key.position.set(-3, 6, 5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = key.shadow.camera.bottom = -4
    key.shadow.camera.right = key.shadow.camera.top = 4
    key.shadow.camera.near = .3; key.shadow.camera.far = 18
    key.shadow.camera.updateProjectionMatrix()
    key.shadow.normalBias = .025; key.shadow.bias = -.0002
    scene.add(key)
    const fill = new THREE.DirectionalLight(cool, .8)
    fill.position.set(4, 2, -3); scene.add(fill)

    function surface(kind: 'wood' | 'paper' | 'stone') {
      const side = 64, data = new Uint8Array(side * side * 4)
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const noise = ((x * 43 + y * 79 + x * y * 13) % 41) / 41
        const value = kind === 'wood' ? 120 + Math.sin(x * .72 + Math.sin(y * .14) * 1.8) * 40 + noise * 18
          : kind === 'paper' ? 140 + (x % 2) * 13 + (y % 2) * 12 + noise * 24 : 100 + noise * 90
        const index = (y * side + x) * 4
        data[index] = data[index + 1] = data[index + 2] = value
        data[index + 3] = 255
      }
      const texture = new THREE.DataTexture(data, side, side)
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true
      return texture
    }
    const textures = [surface('wood'), surface('paper'), surface('stone')]
    const m = {
      wood: new THREE.MeshStandardMaterial({ color: isWarm ? 0xa27c53 : 0x8c7556, roughness: .84, bumpMap: textures[0], bumpScale: .026 }),
      woodLight: new THREE.MeshStandardMaterial({ color: 0xbba17c, roughness: .87, bumpMap: textures[0], bumpScale: .014 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x354247, metalness: .6, roughness: .54 }),
      bronze: new THREE.MeshStandardMaterial({ color: 0xbda16a, metalness: .72, roughness: .42 }),
      wall: new THREE.MeshStandardMaterial({ color: isWarm ? 0x777365 : 0x53666b, roughness: .91, bumpMap: textures[2], bumpScale: .025 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x607076, roughness: .9, bumpMap: textures[2], bumpScale: .03 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x506f79, metalness: .23, roughness: .15, transparent: true, opacity: .76, clearcoat: .85, side: THREE.DoubleSide }),
      warm: new THREE.MeshStandardMaterial({ color: 0xffd9a8, emissive: 0xffbb64, emissiveIntensity: 2.4, roughness: .4 }),
      green: new THREE.MeshStandardMaterial({ color: 0x63754c, roughness: .83 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x8e9c64, roughness: .85 }),
      petal: new THREE.MeshStandardMaterial({ color: 0xe1c5aa, roughness: .87 }),
      soil: new THREE.MeshStandardMaterial({ color: 0x3a372e, roughness: 1 }),
      paper: new THREE.MeshPhysicalMaterial({ color: 0xe8dfca, roughness: .89, sheen: .15, bumpMap: textures[1], bumpScale: .006, side: THREE.DoubleSide }),
      ink: new THREE.MeshStandardMaterial({ color: 0x77897e, roughness: .95 }),
      leather: new THREE.MeshStandardMaterial({ color: isWarm ? 0x74503f : 0x385861, roughness: .81, bumpMap: textures[2], bumpScale: .015 }),
    }
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>(Object.values(m))
    const sphere = new THREE.SphereGeometry(1, 12, 8)
    geometries.add(sphere)
    function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
      geometries.add(geometry); materials.add(material)
      const object = new THREE.Mesh(geometry, material)
      object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true
      parent.add(object)
      return object
    }
    function box(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
      return mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z)
    }
    function rod(parent: THREE.Object3D, from: number[], to: number[], radius: number, material: THREE.Material) {
      const a = new THREE.Vector3(...from as [number, number, number]), b = new THREE.Vector3(...to as [number, number, number])
      const delta = b.clone().sub(a)
      const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material)
      object.position.copy(a).add(b).multiplyScalar(.5)
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
      return object
    }
    function oval(parent: THREE.Object3D, material: THREE.Material, position: number[], scale: number[]) {
      const object = mesh(parent, sphere, material, position[0], position[1], position[2])
      object.scale.set(scale[0], scale[1], scale[2]); return object
    }

    const partModels = new Map<string, Part>()
    const cells: { material: THREE.MeshStandardMaterial; charge: number }[] = []
    const pages: { root: THREE.Group; angle: number; destination: number }[] = []
    let portal: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> | undefined
    let gate: THREE.Group | undefined
    let portalLight: THREE.PointLight | undefined
    let houseLight: THREE.PointLight | undefined
    let portalAmount = 0
    const finishAngles: number[] = []

    if (kind !== 'flight') {
      const pedestal = mesh(collection, new THREE.CylinderGeometry(2.35, 2.45, .13, 48), m.dark, 0, -.09, 0)
      pedestal.receiveShadow = true
      const rim = mesh(collection, new THREE.TorusGeometry(2.36, .012, 6, 64), m.bronze, 0, -.015, 0)
      rim.rotation.x = Math.PI / 2
    }

    if (kind === 'home') {
      box(collection, 3.25, .16, 2.7, m.stone, 0, .08, .16)
      box(collection, 3.08, .08, .42, m.wood, 0, .20, 1.19)
      box(collection, 2.96, 1.65, .12, m.wall, 0, 1.02, -.91)
      box(collection, .11, 1.64, 1.93, m.wall, -1.48, 1.02, 0)
      box(collection, .11, 1.64, 1.93, m.wall, 1.48, 1.02, 0)
      for (const x of [-1.05, 1.05]) box(collection, .88, 1.64, .11, m.wall, x, 1.02, .91)
      box(collection, 1.18, .22, .11, m.wood, 0, 1.73, .91)
      box(collection, .78, 1.36, .045, m.dark, 0, .88, .89)
      for (const x of [-1.48, 1.48]) for (const z of [-.91, .91]) box(collection, .105, 1.93, .105, m.wood, x, 1.14, z)
      for (const z of [-.94, .94]) box(collection, 3.14, .10, .12, m.woodLight, 0, 2.045, z)
      for (const x of [-.43, .43]) box(collection, .055, 1.44, .14, m.woodLight, x, .93, .99)
      box(collection, .91, .07, .15, m.woodLight, 0, 1.66, .99)

      function part(name: string, build: (group: THREE.Group) => void) {
        const group = new THREE.Group()
        group.name = 'home-part:' + name
        group.userData.part = name; build(group); collection.add(group)
        group.visible = false
        partModels.set(name, { root: group, home: group.position.clone(), progress: 0, present: false })
      }
      part('门牌', group => {
        box(group, .43, .19, .035, m.bronze, .77, 1.42, 1.005)
        for (let line = 0; line < 3; line++) box(group, .18 - line * .03, .009, .003, m.dark, .77, 1.47 - line * .045, 1.025)
        for (const x of [.59, .95]) for (const y of [1.36, 1.48]) oval(group, m.dark, [x, y, 1.027], [.008, .008, .004])
      })
      part('窗', group => {
        box(group, .73, .69, .095, m.woodLight, -1.02, 1.16, 1.0)
        box(group, .62, .58, .025, m.glass, -1.02, 1.16, 1.06)
        box(group, .025, .60, .035, m.bronze, -1.02, 1.16, 1.083)
        box(group, .64, .025, .035, m.bronze, -1.02, 1.16, 1.083)
        box(group, .84, .045, .21, m.wood, -1.02, .80, 1.07)
        const reflection = box(group, .02, .48, .002, m.paper, -1.17, 1.19, 1.077)
        reflection.rotation.z = -.1
      })
      part('灯', group => {
        box(group, .07, .24, .13, m.dark, 1.25, 1.57, 1.04)
        const bulb = mesh(group, new THREE.CylinderGeometry(.065, .065, .17, 12), m.warm, 1.25, 1.56, 1.16)
        bulb.castShadow = false
        mesh(group, new THREE.ConeGeometry(.15, .075, 16), m.dark, 1.25, 1.70, 1.16)
        for (const dx of [-.07, .07]) rod(group, [1.25 + dx, 1.46, 1.16], [1.25 + dx, 1.66, 1.16], .009, m.bronze)
        houseLight = new THREE.PointLight(0xffbf78, 1.5, 3, 2)
        houseLight.position.set(1.25, 1.56, 1.32); group.add(houseLight)
      })
      part('长椅', group => {
        for (const x of [-1.27, -.48]) {
          for (const z of [1.12, 1.45]) box(group, .035, .34, .035, m.dark, x, .38, z)
          box(group, .035, .35, .035, m.dark, x, .69, 1.10)
        }
        for (let slat = 0; slat < 3; slat++) box(group, 1.10, .035, .095, m.woodLight, -.87, .55, 1.14 + slat * .12)
        for (const y of [.70, .82]) box(group, 1.10, .085, .035, m.woodLight, -.87, y, 1.10)
      })
      part('花箱', group => {
        box(group, .68, .29, .38, m.wood, 1.06, .40, 1.22)
        box(group, .62, .025, .32, m.soil, 1.06, .55, 1.22)
        for (let plank = 0; plank < 5; plank++) box(group, .006, .27, .012, m.dark, .79 + plank * .135, .40, 1.416)
        for (let stem = 0; stem < 5; stem++) {
          const x = .83 + stem * .115, z = 1.22 + Math.sin(stem * 2) * .065, y = .82 + stem % 2 * .08
          rod(group, [x, .55, z], [x + .025, y, z], .009, m.green)
          for (const side of [-1, 1]) {
            const leaf = oval(group, m.leaf, [x + side * .052, .68, z], [.07, .017, .035])
            leaf.rotation.z = side * .4
          }
          for (let petal = 0; petal < 5; petal++) {
            const angle = petal * Math.PI * 2 / 5
            const flower = oval(group, m.petal, [x + .025 + Math.cos(angle) * .027, y, z + Math.sin(angle) * .027], [.035, .012, .023])
            flower.rotation.y = -angle
          }
          oval(group, m.bronze, [x + .025, y + .006, z], [.015, .012, .015])
        }
      })
      part('屋顶', group => {
        const panel = new THREE.Group(); panel.position.y = 2.15; panel.rotation.z = -.065; group.add(panel)
        box(panel, 3.42, .09, 2.43, m.dark)
        for (let seam = 0; seam < 18; seam++) box(panel, .018, .025, 2.44, m.bronze, -1.62 + seam * .19, .055, 0)
        for (const x of [-1.70, 1.70]) box(panel, .035, .12, 2.46, m.dark, x, -.01, 0)
        for (const z of [-1.23, 1.23]) box(panel, 3.45, .07, .035, m.bronze, 0, -.035, z)
      })
    }

    if (kind === 'flight') {
      gate = new THREE.Group(); collection.add(gate)
      const shell = mesh(gate, new THREE.TorusGeometry(1.43, .13, 12, 80), m.dark)
      shell.rotation.z = .08
      mesh(gate, new THREE.TorusGeometry(1.29, .032, 8, 80), m.bronze, 0, 0, .07)
      mesh(gate, new THREE.TorusGeometry(1.58, .025, 8, 80), m.bronze, 0, 0, -.015)
      for (let index = 0; index < 20; index++) {
        const angle = index / 20 * Math.PI * 2 + Math.PI / 2
        const cell = new THREE.Group()
        cell.position.set(Math.cos(angle) * 1.44, Math.sin(angle) * 1.44, .12)
        cell.rotation.z = angle - Math.PI / 2
        gate.add(cell)
        const glow = new THREE.MeshStandardMaterial({ color: 0x344f54, emissive: 0x80d1c8, emissiveIntensity: 0, roughness: .35, metalness: .28 })
        box(cell, .095, .24, .09, m.dark)
        box(cell, .068, .15, .042, glow, 0, 0, .06)
        for (const y of [-.105, .105]) box(cell, .103, .025, .102, m.bronze, 0, y, 0)
        cells.push({ material: glow, charge: 0 })
      }
      for (let index = 0; index < 4; index++) {
        const angle = index / 4 * Math.PI * 2 + Math.PI / 4
        const brace = box(gate, .20, .11, .32, m.dark, Math.cos(angle) * 1.44, Math.sin(angle) * 1.44, -.18)
        brace.rotation.z = angle
      }
      for (let depth = 1; depth <= 4; depth++) {
        const material = new THREE.MeshStandardMaterial({ color: 0x406f74, emissive: 0x407e88, emissiveIntensity: .17, metalness: .52, roughness: .5 })
        mesh(gate, new THREE.TorusGeometry(1.23 - depth * .045, .018, 6, 64), material, 0, 0, -depth * .25)
      }
      const portalMaterial = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { time: { value: 0 }, amount: { value: 0 } },
        vertexShader: 'varying vec2 portalUv; void main(){portalUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 portalUv; uniform float time; uniform float amount;
          void main(){vec2 p=portalUv*2.-1.;float r=length(p);float a=atan(p.y,p.x);
            float wave=sin(a*7.+r*23.-time*1.6+sin(a*3.-time*.4)*1.4);
            float thread=pow(max(0.,sin(r*45.-a*3.+time*1.7)),12.);
            float rim=pow(clamp(r,0.,1.),7.);float core=pow(1.-clamp(r,0.,1.),2.);
            vec3 colour=mix(vec3(.035,.12,.18),vec3(.38,.79,.82),rim*.7+thread*.23);
            colour+=vec3(.19,.29,.45)*core+vec3(.10,.32,.36)*wave*wave*.18;
            float alpha=(1.-smoothstep(.92,1.,r))*amount;
            gl_FragColor=vec4(colour*amount*1.7,alpha);}`,
      })
      portal = mesh(gate, new THREE.CircleGeometry(1.245, 80), portalMaterial, 0, 0, -.22) as THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
      portal.visible = false; portal.castShadow = false; portal.receiveShadow = false
      portalLight = new THREE.PointLight(0x7dcdd4, 0, 5, 2)
      portalLight.position.z = .7; gate.add(portalLight)
      // A narrow backing rim makes the passage read as a volume from the side.
      const back = mesh(gate, new THREE.CylinderGeometry(1.46, 1.46, .16, 80, 1, true), m.dark, 0, 0, -.1)
      back.rotation.x = Math.PI / 2
    }

    if (kind === 'album') {
      for (const side of [-1, 1]) {
        const cover = box(collection, 1.58, .095, 2.20, m.leather, side * .81, .08, 0)
        cover.rotation.z = side * -.012
        for (const z of [-1.015, 1.015]) box(collection, 1.42, .007, .012, m.bronze, side * .81, .132, z)
      }
      const spine = mesh(collection, new THREE.CylinderGeometry(.075, .075, 2.24, 16), m.leather, 0, .14, 0)
      spine.rotation.x = Math.PI / 2
      for (const z of [-.72, 0, .72]) mesh(collection, new THREE.TorusGeometry(.085, .012, 6, 20), m.bronze, 0, .17, z)
      for (let index = 0; index < 6; index++) {
        const page = new THREE.Group(); page.name = 'memory-page:' + (index + 1)
        page.position.set(0, .18 + index * .018, 0); collection.add(page)
        const geometry = new THREE.PlaneGeometry(1.45, 1.94, 18, 14)
        const positions = geometry.attributes.position
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const x = positions.getX(vertex) + .725, z = positions.getY(vertex)
          positions.setXYZ(vertex, x, .012 + Math.sin(x / 1.45 * Math.PI) * .045, z)
        }
        geometry.computeVertexNormals(); mesh(page, geometry, m.paper)
        for (const side of [-1, 1]) {
          // Quiet embossed rules and numbered dots suggest a bound page; the
          // actual contributed text stays in the accessible story list below.
          for (let line = 0; line < 6; line++) box(page, .91 - line % 3 * .09, .002, .009, m.ink, .78, side * .018, -.41 + line * .15)
          for (let dot = 0; dot <= index; dot++) oval(page, m.bronze, [.22 + dot * .052, side * .018, -.76], [.012, .006, .012])
        }
        const edge = box(page, .012, .006, 1.92, m.paper, 1.44, .015, 0)
        edge.castShadow = false
        const destination = Math.PI - .018 * (5 - index)
        finishAngles.push(destination)
        pages.push({ root: page, angle: 0, destination: 0 })
      }
    }

    let disposed = false, lost = false, frame = 0, previous = 0, onscreen = true
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = motion.matches || fxPrefs.calm
    const initialYaw = kind === 'flight' ? .14 : kind === 'home' ? .51 : .47
    const initialPitch = kind === 'flight' ? .12 : kind === 'home' ? .39 : .63
    let yaw = initialYaw, pitch = initialPitch, aimYaw = yaw, aimPitch = pitch
    const focus = new THREE.Vector3(0, kind === 'home' ? 1.02 : kind === 'album' ? .35 : 0, 0)
    const distance = kind === 'home' ? 6.2 : kind === 'album' ? 5.7 : 5.8
    let pointer: { id: number; x: number; y: number } | null = null
    const background = document.visibilityState === 'hidden'
    let hidden = background

    function render(now: number) {
      frame = 0
      if (disposed || lost || hidden || !onscreen) return
      const delta = previous ? Math.min((now - previous) / 1000, .05) : 1 / 60
      previous = now
      let changing = false
      const live = state.current
      const count = Number.isFinite(live.current) ? Math.max(0, live.current) : 0
      const total = Number.isFinite(live.target) ? Math.max(0, live.target) : 0
      const ratio = total > 0 ? clamp(count / total) : 0
      const present = new Set(live.parts)

      for (const [name, part] of partModels) {
        const exists = present.has(name)
        if (exists && !part.present) part.progress = reduced ? 1 : 0
        part.present = exists; part.root.visible = exists
        if (!exists) { part.progress = 0; continue }
        part.progress = reduced ? 1 : Math.min(1, part.progress + delta * 2.1)
        const t = ease(part.progress)
        part.root.position.copy(part.home); part.root.position.y += (1 - t) * .4
        part.root.scale.setScalar(.9 + t * .1)
        if (part.progress < 1) changing = true
      }
      if (houseLight) houseLight.intensity = present.has('灯') ? 1.5 * ease(partModels.get('灯')!.progress) : 0

      const activeCells = Math.floor(ratio * 20 + 1e-6)
      cells.forEach((cell, index) => {
        const destination = index < activeCells ? 1 : 0
        cell.charge = reduced ? destination : THREE.MathUtils.damp(cell.charge, destination, 7, delta)
        if (Math.abs(cell.charge - destination) > .003) changing = true
        cell.material.emissiveIntensity = cell.charge * 2.3
        cell.material.color.setHex(index < activeCells ? 0x9fc8be : 0x344f54)
      })
      const completed = total > 0 && count >= total
      portalAmount = reduced ? Number(completed) : THREE.MathUtils.damp(portalAmount, Number(completed), 4.5, delta)
      if (portal) {
        portal.visible = completed && portalAmount > .005
        portal.material.uniforms.time.value = reduced ? 0 : now / 1000
        portal.material.uniforms.amount.value = portalAmount
      }
      if (portalLight) portalLight.intensity = completed ? portalAmount * 3 : 0
      if (gate) gate.rotation.z = reduced ? 0 : Math.sin(now / 6500) * .025

      const openPages = Math.floor(ratio * 6 + 1e-6)
      pages.forEach((page, index) => {
        page.destination = index < openPages ? finishAngles[index] : 0
        page.angle = reduced ? page.destination : THREE.MathUtils.damp(page.angle, page.destination, 3.7, delta)
        if (Math.abs(page.angle - page.destination) > .002) changing = true
        page.root.rotation.z = page.angle
      })
      yaw = reduced ? aimYaw : THREE.MathUtils.damp(yaw, aimYaw, 11, delta)
      pitch = reduced ? aimPitch : THREE.MathUtils.damp(pitch, aimPitch, 11, delta)
      if (Math.abs(yaw - aimYaw) + Math.abs(pitch - aimPitch) > .001) changing = true
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, focus.y + Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance)
      camera.lookAt(focus)
      renderer.render(scene, camera)
      if (!reduced && (changing || kind === 'flight')) schedule()
    }
    function schedule() {
      if (!frame && !disposed && !lost && !hidden && onscreen) frame = requestAnimationFrame(render)
    }
    invalidate.current = schedule
    keyboard.current = key => {
      if (key === 'ArrowLeft') aimYaw -= .16
      if (key === 'ArrowRight') aimYaw += .16
      if (key === 'ArrowUp') aimPitch = clamp(aimPitch + .10, -.16, 1.05)
      if (key === 'ArrowDown') aimPitch = clamp(aimPitch - .10, -.16, 1.05)
      if (key === 'Home') { aimYaw = initialYaw; aimPitch = initialPitch }
      schedule()
    }
    function resize() {
      const width = Math.max(host!.clientWidth, 1), height = Math.max(host!.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height; camera.updateProjectionMatrix(); schedule()
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(host)
    window.addEventListener('resize', resize)
    const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      onscreen = entries[0]?.isIntersecting ?? true
      if (onscreen) { previous = 0; schedule() }
      else { cancelAnimationFrame(frame); frame = 0 }
    }, { rootMargin: '80px' }) : null
    intersection?.observe(host)
    const visibility = () => {
      hidden = document.visibilityState === 'hidden'
      if (hidden) { cancelAnimationFrame(frame); frame = 0 }
      else { previous = 0; schedule() }
    }
    const motionChanged = () => { reduced = motion.matches || fxPrefs.calm; schedule() }
    document.addEventListener('visibilitychange', visibility)
    motion.addEventListener('change', motionChanged)
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
      element.setPointerCapture(event.pointerId); element.style.cursor = 'grabbing'; setInteracted(true)
    }
    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return
      aimYaw += (event.clientX - pointer.x) * .008
      if (event.pointerType === 'mouse') aimPitch = clamp(aimPitch + (event.clientY - pointer.y) * .006, -.16, 1.05)
      pointer.x = event.clientX; pointer.y = event.clientY; schedule()
    }
    const up = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return
      pointer = null
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
      element.style.cursor = 'grab'
    }
    const contextLost = (event: Event) => {
      event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; setUnavailable(true)
    }
    const contextRestored = () => setRevision(value => value + 1)
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up)
    element.addEventListener('webglcontextlost', contextLost); element.addEventListener('webglcontextrestored', contextRestored)
    resize()
    return () => {
      disposed = true; cancelAnimationFrame(frame)
      invalidate.current = () => {}; keyboard.current = () => {}
      observer?.disconnect(); intersection?.disconnect(); window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', motionChanged)
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up)
      element.removeEventListener('webglcontextlost', contextLost); element.removeEventListener('webglcontextrestored', contextRestored)
      if (pointer && element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id)
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose())
      textures.forEach(texture => texture.dispose()); key.shadow.map?.dispose(); renderer.dispose()
      scene.clear()
    }
  }, [kind, world, revision])

  useEffect(() => { invalidate.current() }, [current, target, parts])
  const description = kind === 'home'
    ? (zh ? `小屋已安放${parts.length}个部件：${parts.join('、')}` : `A shared home with ${parts.length} installed parts`)
    : kind === 'flight' ? (zh ? `航班补给 ${current}/${target}${current >= target && target > 0 ? '，通道已开启' : '，等待补给'}` : `Flight supplies ${current}/${target}`)
      : (zh ? `共同回忆册，已收入 ${current}/${target} 段回忆` : `Shared memory book, ${current}/${target} memories`)
  return <div ref={container} data-goal-scene={kind} style={{ height: 220, width: '100%', position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 35%, #263940 0%, #142229 62%, #111d23 100%)' }}>
    <canvas ref={canvas} tabIndex={unavailable ? -1 : 0} role="img" aria-label={description}
      title={zh ? '拖动或使用方向键查看，Home 键复位' : 'Drag or use arrow keys to look around; Home resets the view'}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
        event.preventDefault(); setInteracted(true); keyboard.current(event.key)
      }} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'pan-y', opacity: unavailable ? 0 : 1 }} />
    {unavailable
      ? <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', padding: 24, textAlign: 'center', color: '#d2d9d1', fontSize: 13, lineHeight: 1.7 }}>{description}<br /><span style={{ color: '#91a4a5', fontSize: 11 }}>{zh ? '立体预览暂不可用，心愿进度已保留' : '3D preview unavailable. Your progress is preserved.'}</span></div>
      : !interacted && <span aria-hidden="true" style={{ position: 'absolute', bottom: 12, left: 16, color: '#bac7c3', fontSize: 10, letterSpacing: '.06em', pointerEvents: 'none', opacity: .8 }}>{zh ? '左右拖动 · 看看另一面' : 'DRAG TO LOOK AROUND'}</span>}
  </div>
}
