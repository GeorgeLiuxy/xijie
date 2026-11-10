import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

/** Real geometry throughout. The loader and hold share a two-metre cargo datum. */
type Material = THREE.MeshStandardMaterial
const up = new THREE.Vector3(0, 1, 0)
let metalGrain: THREE.DataTexture | undefined
let metalAlbedo: THREE.CanvasTexture | undefined
let metalRoughness: THREE.CanvasTexture | undefined

function surfaceTextures() {
  if (metalGrain && metalAlbedo && metalRoughness) return { grain: metalGrain, albedo: metalAlbedo, roughness: metalRoughness }
  const size = 512, data = new Uint8Array(size * size * 4)
  const paint = document.createElement("canvas")
  const rough = document.createElement("canvas")
  paint.width = paint.height = rough.width = rough.height = size
  const ctx = paint.getContext("2d")!, rctx = rough.getContext("2d")!
  const colour = ctx.createImageData(size, size), roughData = rctx.createImageData(size, size)
  let seed = 71839
  const next = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mottling = Math.sin(x * .028 + Math.sin(y * .017) * 4) * 14 + Math.sin(y * .047 - x * .012) * 8
      const offset = (y * size + x) * 4
      const value = 190 + mottling + next() * 22
      const grain = 132 + next() * 35 + Math.sin(y * 2.3) * 15
      const roughness = 142 + mottling + next() * 38
      for (let channel = 0; channel < 3; channel++) {
        colour.data[offset + channel] = value
        roughData.data[offset + channel] = roughness
        data[offset + channel] = grain
      }
      data[offset + 3] = colour.data[offset + 3] = roughData.data[offset + 3] = 255
    }
  }
  ctx.putImageData(colour, 0, 0)
  rctx.putImageData(roughData, 0, 0)
  // Mottled paint, lengthwise grime and sparse worn scratches remain visible
  // in the close loading shot without a separate mesh for each surface mark.
  for (let streak = 0; streak < 32; streak++) {
    const x = next() * size, width = 1 + next() * 8
    ctx.fillStyle = `rgba(49,43,34,${.03 + next() * .10})`
    ctx.fillRect(x, next() * 170, width, 140 + next() * 240)
    rctx.fillStyle = "#d6d6d6"
    rctx.fillRect(x, 0, width, size)
  }
  for (let scratch = 0; scratch < 210; scratch++) {
    const x = next() * size, y = next() * size
    ctx.strokeStyle = scratch % 3 ? "rgba(240,235,214,.19)" : "rgba(27,30,28,.34)"
    ctx.lineWidth = .4 + next() * 1.3
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2 + next() * 19, y - next() * 3); ctx.stroke()
  }
  metalAlbedo = new THREE.CanvasTexture(paint)
  metalAlbedo.colorSpace = THREE.SRGBColorSpace
  metalRoughness = new THREE.CanvasTexture(rough)
  metalGrain = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  for (const map of [metalAlbedo, metalRoughness, metalGrain]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.needsUpdate = true
    map.anisotropy = 4
  }
  return { grain: metalGrain, albedo: metalAlbedo, roughness: metalRoughness }
}

/** Batch only rigid geometry. Articulation handles retain their own transforms. */
function batchRigid(parent: THREE.Object3D, articulated: THREE.Object3D[] = []) {
  const excluded = new Set(articulated)
  const batches = new Map<THREE.Material, { geometry: THREE.BufferGeometry[]; objects: THREE.Mesh[] }>()
  parent.updateMatrixWorld(true)
  const inverse = parent.matrixWorld.clone().invert()
  function visit(object: THREE.Object3D) {
    if (excluded.has(object)) return
    if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
      const batch = batches.get(object.material) ?? { geometry: [], objects: [] }
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld))
      batch.geometry.push(geometry)
      batch.objects.push(object)
      batches.set(object.material, batch)
    }
    for (const child of object.children) visit(child)
  }
  for (const child of parent.children) visit(child)
  for (const [material, batch] of batches) {
    if (batch.objects.length < 2) { batch.geometry.forEach(g => g.dispose()); continue }
    const geometry = mergeGeometries(batch.geometry)
    batch.geometry.forEach(g => g.dispose())
    if (!geometry) continue
    const merged = new THREE.Mesh(geometry, material)
    merged.name = "rigid-" + (material.name || "surface")
    merged.castShadow = batch.objects.some(o => o.castShadow)
    merged.receiveShadow = true
    for (const object of batch.objects) { object.parent?.remove(object); object.geometry.dispose() }
    parent.add(merged)
  }
}

function palette() {
  const { grain, albedo, roughness } = surfaceTextures()
  return {
    armour: new THREE.MeshStandardMaterial({ color: 0x657279, metalness: 0.72, roughness: 0.72, map: albedo, roughnessMap: roughness, bumpMap: grain, bumpScale: 0.043 }),
    edge: new THREE.MeshStandardMaterial({ color: 0xa0a79f, metalness: 0.84, roughness: 0.53, map: albedo, roughnessMap: roughness, bumpMap: grain, bumpScale: 0.021 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x202c32, metalness: 0.64, roughness: 0.85, map: albedo, roughnessMap: roughness, bumpMap: grain, bumpScale: 0.032 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x13191a, metalness: 0.08, roughness: 0.93 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xb18a4d, metalness: 0.7, roughness: 0.42 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xc3a258, metalness: 0.3, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x122931, metalness: 0.72, roughness: 0.13, emissive: 0x1d4b59, emissiveIntensity: 0.38 }),
  }
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: Material, position: [number, number, number]) {
  const object = new THREE.Mesh(geometry, material)
  object.position.set(...position)
  object.castShadow = true
  object.receiveShadow = true
  parent.add(object)
  return object
}

function box(parent: THREE.Object3D, size: [number, number, number], material: Material, position: [number, number, number], radius = 0.04) {
  return mesh(parent, new RoundedBoxGeometry(...size, 2, radius), material, position)
}

function cylinder(parent: THREE.Object3D, radius: number, length: number, material: Material, position: [number, number, number], axis: "x" | "y" | "z" = "y", segments = 12) {
  const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, length, segments), material, position)
  if (axis === "x") object.rotation.z = Math.PI / 2
  if (axis === "z") object.rotation.x = Math.PI / 2
  return object
}

function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: Material) {
  const delta = b.clone().sub(a)
  const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, [0, 0, 0])
  object.position.copy(a).lerp(b, 0.5)
  object.quaternion.setFromUnitVectors(up, delta.normalize())
  return object
}

function lamp(parent: THREE.Object3D, colour: number, size: [number, number, number], position: [number, number, number], intensity = 2) {
  const material = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: intensity, metalness: 0.3, roughness: 0.25 })
  const object = box(parent, size, material, position, 0.015)
  object.castShadow = false
  return object
}

function label(text: string, width = 1, height = 0.3) {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 160
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#d5c4a0"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#363c3c"
  ctx.font = "bold 50px monospace"
  ctx.fillText(text, 20, 70)
  ctx.font = "18px monospace"
  ctx.fillText("ELY / SHARED POST", 22, 108)
  for (let i = 0; i < 45; i++) ctx.fillRect(22 + i * 7, 124, i % 3 === 0 ? 4 : 2, 19)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.86, metalness: 0.08 })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  plane.receiveShadow = true
  return plane
}

/** Nose points along -Z. Cargo doors hinge outward at the +Z rear. */
export function createShip() {
  const root = new THREE.Group()
  root.name = "postal-carrier"
  const m = palette()
  const engines: THREE.Mesh[] = []
  const doors: THREE.Group[] = []
  const gears: THREE.Group[] = []
  const lights: THREE.PointLight[] = []

  const sections = [
    { z: -5.3, width: .43, top: -.02, bottom: -.40 },
    { z: -4.4, width: 1.16, top: .29, bottom: -.62 },
    { z: -2.5, width: 1.77, top: 1.19, bottom: -.64 },
    { z: -.6, width: 1.93, top: 1.39, bottom: -.70 },
    { z: 1.45, width: 1.54, top: 1.36, bottom: -.61 },
  ]
  const positions: number[] = [], indices: number[] = [], uvs: number[] = []
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i], w = section.width, top = section.top, bottom = section.bottom
    const ring = [[-w*.72,top],[w*.72,top],[w,top-.22],[w,bottom+.2],[w*.72,bottom],[-w*.72,bottom],[-w,bottom+.2],[-w,top-.22]]
    ring.forEach(([x,y],j) => { positions.push(x,y,section.z); uvs.push(j/8, (section.z+5.3)/6.75) })
    if (i) for (let j=0;j<8;j++) {
      const a=(i-1)*8+j,b=(i-1)*8+(j+1)%8,c=i*8+j,d=i*8+(j+1)%8
      indices.push(a,c,b,b,c,d)
    }
  }
  for (let j=1;j<7;j++) { indices.push(0,j,j+1); indices.push(32,32+j+1,32+j) }
  const hullGeometry = new THREE.BufferGeometry()
  hullGeometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3))
  hullGeometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2))
  hullGeometry.setIndex(indices)
  hullGeometry.computeVertexNormals()
  mesh(root,hullGeometry,m.armour,[0,0,0]).name="contoured-pressure-hull"

  // A long inset graphite spine follows the bow's slope, with bright worn
  // chamfers separating the modular armour plates from the pressure hull.
  for (const side of [-1,1]) {
    const shoulder=box(root,[.18,.22,3.35],m.dark,[side*1.33,.88,-1.05],.06)
    shoulder.rotation.y=side*.075
    shoulder.rotation.x=-.105
    const chine=box(root,[.12,.12,2.1],m.edge,[side*1.11,.15,-3.68],.035)
    chine.rotation.y=side*.32
    chine.rotation.x=-.22
    const bowPlate=box(root,[.82,.11,1.61],m.dark,[side*.51,.46,-3.82],.045)
    bowPlate.rotation.x=-.39
    bowPlate.rotation.z=side*-.08
    for (let i=0;i<3;i++) {
      const armour=box(root,[.76,.10,.69],i===1?m.edge:m.armour,[side*.72,1.36,-1.47+i*.83],.045)
      armour.rotation.z=side*-.07
      armour.rotation.x=-.025
    }
    const strip=box(root,[.11,.08,2.35],m.bronze,[side*1.65,.89,-.55],.025)
    strip.rotation.y=side*-.075
  }

  // A genuine rear cavity, with independent floor, walls and ceiling.
  box(root, [3.45, 0.22, 3.6], m.dark, [0, -0.46, 2.98], 0.08).name = "cargo-deck"
  box(root, [3.57, 0.35, 3.68], m.armour, [0, 1.38, 3.0], 0.1)
  box(root, [0.37, 1.7, 3.5], m.armour, [-1.62, 0.44, 3.0], 0.08)
  box(root, [0.37, 1.7, 3.5], m.armour, [1.62, 0.44, 3.0], 0.08)
  box(root, [2.95, 1.65, 0.12], m.dark, [0, 0.43, 1.28], 0.025)
  for (const z of [1.65, 2.28, 2.91, 3.54, 4.17]) {
    box(root, [3.0, 0.055, 0.045], m.edge, [0, -0.33, z], 0.012)
    box(root, [0.065, 1.46, 0.07], m.edge, [-1.4, 0.42, z], 0.02)
    box(root, [0.065, 1.46, 0.07], m.edge, [1.4, 0.42, z], 0.02)
  }
  box(root,[2.34,.09,2.72],m.dark,[0,1.59,2.84],.045)
  for (const side of [-1,1]) {
    box(root,[.69,.08,2.51],m.armour,[side*1.19,1.62,2.85],.035)
    for (let vent=0;vent<10;vent++) {
      const fin=box(root,[.79,.09,.055],m.edge,[side*.53,1.68,1.71+vent*.225],.013)
      fin.rotation.z=side*.16
    }
    for (let panel=0;panel<3;panel++) {
      const skirt=box(root,[.13,.54,.87],panel%2?m.dark:m.armour,[side*1.86,.42,1.91+panel*1.02],.045)
      skirt.rotation.z=side*.14
      box(root,[.14,.055,.62],m.bronze,[side*1.94,.13,1.91+panel*1.02],.015)
    }
    rod(root,new THREE.Vector3(side*1.93,-.04,1.45),new THREE.Vector3(side*1.93,-.04,4.29),.045,m.bronze)
  }
  lamp(root, 0xffd59b, [2.35, 0.035, 0.085], [0, 1.17, 3.88], 2.1)
  const cargoLight = new THREE.PointLight(0xffc68a, 3, 7, 2)
  cargoLight.position.set(0, 0.9, 3.8)
  root.add(cargoLight)
  lights.push(cargoLight)

  for (const side of [-1, 1]) {
    const hinge = new THREE.Group()
    hinge.name = side < 0 ? "port-cargo-door" : "starboard-cargo-door"
    hinge.position.set(side * 1.4, 0.425, 4.77)
    const panelX = -side * 0.7
    box(hinge, [1.38, 1.55, 0.15], m.armour, [panelX, 0, 0], 0.055)
    box(hinge, [1.18, 1.30, 0.08], m.dark, [panelX, 0, 0.105], 0.04)
    box(hinge, [1.04, 1.17, 0.07], m.armour, [panelX, 0, 0.15], 0.04)
    box(hinge, [0.1, 0.63, 0.1], m.edge, [panelX - side * 0.4, 0, 0.2], 0.025)
    for (const y of [-0.57, 0.57]) {
      cylinder(hinge, 0.09, 0.22, m.edge, [0, y, 0], "y")
      const hazard = box(hinge, [0.36, 0.055, 0.018], m.yellow, [panelX, y, 0.198], 0.012)
      hazard.rotation.z = -0.3
    }
    root.add(hinge)
    doors.push(hinge)
  }

  // Offset engine nacelles expose separate exhaust throats and turbine vanes.
  for (const side of [-1, 1]) {
    box(root, [1.5, 0.28, 2.3], m.dark, [side * 2.02, -0.18, 0.5], 0.08)
    cylinder(root, 0.64, 8.2, m.armour, [side * 2.7, 0.18, 0.35], "z", 16)
    box(root, [0.84, 0.15, 5.9], m.edge, [side * 2.7, 0.79, 0.25], 0.04)
    for (const z of [-3.5, -1.6, 0.3, 2.2, 4.5]) {
      cylinder(root, 0.69, 0.13, m.dark, [side * 2.7, 0.18, z], "z", 16)
    }
    cylinder(root, 0.51, 0.22, m.dark, [side * 2.7, 0.18, 4.62], "z", 20)
    const exhaustMaterial = new THREE.MeshStandardMaterial({ color: 0xaddcf2, emissive: 0x5cb4da, emissiveIntensity: 3.5, metalness: 0.05, roughness: 0.3 })
    const exhaust = cylinder(root, 0.39, 0.035, exhaustMaterial, [side * 2.7, 0.18, 4.75], "z", 24)
    exhaust.name = "main-engine-throat"
    engines.push(exhaust)
    const ring = mesh(root, new THREE.TorusGeometry(0.47, 0.055, 7, 24), m.bronze, [side * 2.7, 0.18, 4.77])
    ring.rotation.z = 0.4
    for (let blade = 0; blade < 8; blade++) {
      const a = blade * Math.PI / 4
      const vane = box(root, [0.06, 0.30, 0.06], m.dark, [side * 2.7 + Math.sin(a) * 0.32, 0.18 + Math.cos(a) * 0.32, 4.8], 0.015)
      vane.rotation.z = -a + 0.28
    }
    for (let rib = 0; rib < 8; rib++) {
      box(root, [0.055, 0.1, 0.35], m.dark, [side * 3.17, 0.25, -1.0 + rib * 0.48], 0.015)
    }
    for (let plate=0;plate<4;plate++) {
      const cowl=box(root,[.73,.12,1.4],plate===1?m.dark:m.armour,[side*2.7,.86,-2.43+plate*1.72],.055)
      cowl.rotation.z=side*.05
      box(root,[.13,.19,.84],m.bronze,[side*3.32,.32,-2.45+plate*1.72],.035)
    }
    rod(root,new THREE.Vector3(side*3.05,.67,-2.6),new THREE.Vector3(side*3.05,.67,3.9),.027,m.edge)
    const fin = box(root, [0.18, 1.15, 1.2], m.armour, [side * 2.7, 1.0, 2.5], 0.06)
    fin.rotation.z = side * -0.2
    lamp(root, side < 0 ? 0xc96146 : 0x7dd0c1, [0.12, 0.08, 0.2], [side * 3.31, 0.26, -1.9], 1.8)
    lamp(root, 0xffe0a1, [0.19, 0.13, 0.04], [side * 1.25, -0.16, -4.0], 1.5)
  }

  // Cockpit glazing follows the angled bow, with visible mullions.
  const cockpit = box(root, [1.67, 0.63, 1.34], m.dark, [0, 1.4, -2.48], 0.15)
  cockpit.rotation.x = -0.18
  for (const side of [-1, 1]) {
    const glass = box(root, [0.72, 0.35, 0.82], m.glass, [side * 0.39, 1.67, -2.72], 0.055)
    glass.rotation.x = -0.32
    box(root, [0.045, 0.39, 0.86], m.edge, [side * 0.81, 1.66, -2.7], 0.015).rotation.x = -0.32
  }
  box(root, [0.07, 0.42, 0.9], m.edge, [0, 1.65, -2.72], 0.02).rotation.x = -0.32
  for (let panel = 0; panel < 4; panel++) {
    const slab = box(root, [0.6, 0.065, 1.2], panel % 2 ? m.dark : m.edge, [-0.95 + panel * 0.63, 1.58, -0.47], 0.025)
    slab.rotation.z = (panel < 2 ? -1 : 1) * 0.03
  }
  const aerial = cylinder(root, 0.025, 0.75, m.edge, [0.7, 1.92, 0.42], "y", 6)
  aerial.rotation.z = -0.18
  const shipLabel = label("ELY–07", 1.1, 0.34)
  shipLabel.position.set(0, 0.25, -5.12)
  shipLabel.rotation.y = Math.PI
  root.add(shipLabel)

  for (const [x, z] of [[-1.15, -2.3], [1.15, -2.3], [-1.15, 3.4], [1.15, 3.4]]) {
    const pivot = new THREE.Group()
    pivot.name = "landing-strut"
    pivot.position.set(x, -0.8, z)
    cylinder(pivot, 0.17, 0.46, m.dark, [0, 0, 0], "x")
    cylinder(pivot, 0.09, 1.10, m.edge, [0, -0.6, 0], "y")
    cylinder(pivot, 0.145, 0.52, m.dark, [0, -0.46, 0], "y")
    rod(pivot, new THREE.Vector3(0.2, -0.08, 0), new THREE.Vector3(0.05, -1.24, 0.17), 0.045, m.bronze)
    box(pivot, [0.66, 0.15, 0.83], m.dark, [0, -1.475, 0.07], 0.08)
    box(pivot, [0.52, 0.045, 0.7], m.rubber, [0, -1.56, 0.07], 0.03)
    root.add(pivot)
    gears.push(pivot)
  }
  doors.forEach(door => batchRigid(door))
  gears.forEach(gear => batchRigid(gear))
  batchRigid(root, [...doors, ...gears, ...engines])
  return { root, doors, gears, engines, lights }
}

function makeCase(code: string, m: ReturnType<typeof palette>) {
  const root = new THREE.Group()
  box(root, [0.85, 0.49, 0.83], m.edge, [0, 0.245, 0], 0.065)
  box(root, [0.86, 0.08, 0.84], m.armour, [0, 0.485, 0], 0.035)
  // Webbing wraps across the lid and both faces; hardware casts its own shadow.
  box(root, [0.12, 0.012, 0.86], m.yellow, [-0.15, 0.535, 0], 0.005)
  for (const z of [-0.422, 0.422]) {
    box(root, [0.12, 0.49, 0.014], m.yellow, [-0.15, 0.25, z], 0.004)
    for (const x of [-0.3, 0.3]) box(root, [0.07, 0.13, 0.04], m.dark, [x, 0.38, z], 0.012)
  }
  for (const x of [-0.433, 0.433]) box(root, [0.035, 0.11, 0.27], m.dark, [x, 0.28, 0], 0.025)
  const tag = label(code, 0.37, 0.12)
  tag.position.set(0.17, 0.22, 0.435)
  root.add(tag)
  batchRigid(root)
  return root
}

export function createPallet(code: string) {
  const root = new THREE.Group()
  root.name = "cargo-pallet"
  const m = palette()
  box(root, [2.22, 0.1, 2.16], m.dark, [0, 0.12, 0], 0.025)
  for (const x of [-0.88, 0, 0.88]) box(root, [0.28, 0.16, 2.12], m.bronze, [x, 0.08, 0], 0.018)
  for (let slat = 0; slat < 5; slat++) box(root, [2.19, 0.045, 0.31], m.edge, [0, 0.19, -0.84 + slat * 0.42], 0.015)
  let parcel = new THREE.Group()
  for (let z = 0; z < 2; z++) {
    for (let x = 0; x < 2; x++) {
      const item = makeCase(x === 1 && z === 1 ? code : "ELY", m)
      item.position.set((x - 0.5) * 0.97, 0.215, (z - 0.5) * 0.98)
      root.add(item)
      if (x === 1 && z === 1) parcel = item
    }
  }
  const upper = makeCase("ELY", m)
  upper.position.set(-0.485, 0.76, -0.49)
  root.add(upper)
  batchRigid(root, [...root.children.filter(child => child instanceof THREE.Group)])
  return { root, parcel }
}

function wheel(parent: THREE.Group, x: number, z: number, radius: number, m: ReturnType<typeof palette>) {
  const group = new THREE.Group()
  group.position.set(x, radius, z)
  cylinder(group, radius, 0.28, m.rubber, [0, 0, 0], "x", 18)
  const outer = x < 0 ? -0.15 : 0.15
  cylinder(group, radius * 0.58, 0.036, m.edge, [outer, 0, 0], "x", 12)
  cylinder(group, radius * 0.21, 0.065, m.dark, [outer * 1.15, 0, 0], "x", 8)
  for (let spoke = 0; spoke < 6; spoke++) {
    const a = spoke * Math.PI / 3
    const lug = cylinder(group, 0.026, 0.048, m.dark, [outer * 1.14, Math.sin(a) * radius * 0.38, Math.cos(a) * radius * 0.38], "x", 6)
    lug.castShadow = false
  }
  batchRigid(group)
  parent.add(group)
  return group
}

export function createLoader() {
  const root = new THREE.Group()
  root.name = "scissor-loader"
  const m = palette()
  box(root, [2.35, 0.32, 3.2], m.armour, [0, 0.53, 0], 0.08)
  box(root, [2.5, 0.13, 3.45], m.dark, [0, 0.68, 0], 0.04)
  const wheels: THREE.Object3D[] = []
  for (const x of [-1.18, 1.18]) {
    for (const z of [-1.13, 1.13]) wheels.push(wheel(root, x, z, 0.43, m))
  }
  const platform = new THREE.Group()
  platform.name = "loader-deck"
  platform.position.y = 0.95
  box(platform, [2.65, 0.16, 3.25], m.edge, [0, -0.08, 0], 0.04)
  for (const side of [-1, 1]) {
    box(platform, [0.06, 0.09, 3.2], m.yellow, [side * 1.29, 0.015, 0], 0.012)
    box(platform, [0.12, 0.08, 0.75], m.edge, [side * 0.7, -0.02, -1.88], 0.02)
  }
  const arms: THREE.Object3D[] = []
  // Each cross member is a separate pivot. The animation can rotate these as
  // platform height changes, rather than scaling the entire truck photograph.
  for (const x of [-0.8, 0.8]) {
    for (const direction of [-1, 1]) {
      const arm = new THREE.Group()
      arm.position.set(x, 0.7, direction * -0.94)
      const bar = box(arm, [0.11, 0.14, 2.1], m.dark, [0, 0, direction * 1.0], 0.035)
      bar.rotation.x = 0
      cylinder(arm, 0.13, 0.2, m.bronze, [0, 0, 0], "x", 10)
      root.add(arm)
      arms.push(arm)
    }
  }
  const control = box(root, [0.42, 0.7, 0.42], m.dark, [0.93, 0.91, 1.28], 0.06)
  control.rotation.x = -0.12
  lamp(root, 0x7abdc8, [0.25, 0.15, 0.02], [0.92, 1.12, 1.06], 0.8)
  for (const x of [-0.91, 0.91]) {
    lamp(root, 0xf0bf77, [0.15, 0.08, 0.045], [x, 0.66, -1.75], 1.5)
    lamp(root, 0xc56740, [0.15, 0.08, 0.045], [x, 0.66, 1.75], 1.5)
  }
  root.add(platform)
  batchRigid(platform)
  arms.forEach(arm=>batchRigid(arm))
  batchRigid(root,[platform,...wheels,...arms])
  return { root, platform, wheels, arms }
}

export function createDrone() {
  const root = new THREE.Group()
  root.name = "last-mile-drone"
  const m = palette()
  const hull = box(root, [0.83, 0.26, 1.3], m.armour, [0, 0, 0], 0.12)
  hull.rotation.z = 0
  box(root, [0.55, 0.12, 0.77], m.bronze, [0, 0.18, 0.1], 0.05)
  const rotors: THREE.Group[] = []
  for (const z of [-0.6, 0.15, 0.7]) {
    for (const side of [-1, 1]) {
      rod(root, new THREE.Vector3(side * 0.22, 0, z * 0.72), new THREE.Vector3(side * 1.08, 0.08, z), 0.055, m.dark)
      cylinder(root, 0.115, 0.18, m.edge, [side * 1.08, 0.08, z], "y", 12)
      const rotor = new THREE.Group()
      rotor.position.set(side * 1.08, 0.19, z)
      for (let blade = 0; blade < 3; blade++) {
        const foil = box(rotor, [0.62, 0.018, 0.065], m.dark, [0, 0, 0], 0.016)
        foil.rotation.y = blade * Math.PI / 3
      }
      root.add(rotor)
      rotors.push(rotor)
      const guard = mesh(root, new THREE.TorusGeometry(0.41, 0.018, 5, 30), m.armour, [side * 1.08, 0.18, z])
      guard.rotation.x = Math.PI / 2
    }
  }
  for (const side of [-1, 1]) {
    rod(root, new THREE.Vector3(side * 0.35, -0.12, -0.43), new THREE.Vector3(side * 0.57, -0.61, -0.43), 0.025, m.edge)
    rod(root, new THREE.Vector3(side * 0.35, -0.12, 0.48), new THREE.Vector3(side * 0.57, -0.61, 0.48), 0.025, m.edge)
    box(root, [0.055, 0.045, 1.1], m.dark, [side * 0.57, -0.62, 0], 0.025)
  }
  const cargo = new THREE.Group()
  cargo.name = "drone-parcel-hook"
  cargo.position.y = -0.55
  root.add(cargo)
  lamp(root, 0xd7dfbc, [0.12, 0.045, 0.04], [0, -0.08, -0.67], 1.5)
  lamp(root, 0x74c8bc, [0.07, 0.045, 0.06], [-0.45, 0.08, -0.5], 1.7)
  rotors.forEach(rotor=>batchRigid(rotor))
  batchRigid(root,[...rotors,cargo])
  return { root, rotors, cargo }
}

export function createRover() {
  const root = new THREE.Group()
  root.name = "district-freight-rover"
  const m = palette()
  box(root, [2.05, 0.42, 3.95], m.dark, [0, 0.64, 0], 0.09)
  box(root, [2.15, 0.25, 2.55], m.armour, [0, 1.065, 0.63], 0.05)
  const cab = box(root, [1.99, 1.1, 1.38], m.armour, [0, 1.28, -1.21], 0.15)
  cab.rotation.x = 0.04
  const screen = box(root, [1.6, 0.47, 0.045], m.glass, [0, 1.56, -1.91], 0.045)
  screen.rotation.x = -0.15
  for (const side of [-1, 1]) {
    const window = box(root, [0.045, 0.43, 0.76], m.glass, [side * 1.006, 1.55, -1.17], 0.035)
    window.rotation.y = side * 0.04
    box(root, [0.06, 0.35, 2.5], m.edge, [side * 1.04, 1.35, 0.68], 0.025)
    rod(root, new THREE.Vector3(side * 1.06, 0.9, -1.75), new THREE.Vector3(side * 1.06, 1.78, -1.75), 0.035, m.dark)
    lamp(root, 0xffdf9c, [0.24, 0.1, 0.05], [side * 0.75, 0.98, -1.98], 1.4)
    lamp(root, 0xc85432, [0.13, 0.08, 0.05], [side * 0.85, 0.9, 2.0], 1.3)
  }
  for (const x of [-0.78, 0.78]) {
    for (const z of [-0.18, 1.5]) box(root, [0.08, 0.65, 0.08], m.dark, [x, 1.55, z], 0.025)
  }
  box(root, [1.65, 0.07, 0.08], m.edge, [0, 1.87, 1.5], 0.025)
  const wheels: THREE.Object3D[] = []
  for (const x of [-1.11, 1.11]) for (const z of [-1.28, 0.14, 1.38]) wheels.push(wheel(root, x, z, 0.49, m))
  const cargo = new THREE.Group()
  cargo.name = "rover-cargo-deck"
  cargo.position.set(0, 1.2, 0.68)
  root.add(cargo)
  batchRigid(root,[...wheels,cargo])
  return { root, wheels, cargo }
}
