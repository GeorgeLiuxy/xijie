import * as THREE from "three"
import type { WorldId } from "../../i18n"

const palettes = {
  isles: { sky: 0x8c9da5, fog: 0x8c9da5, concrete: 0x444b4c, metal: 0x39454b, rock: 0x575c59, sun: 0xffd8ab, fill: 0xa3c3d4 },
  tide: { sky: 0x607a80, fog: 0x607a80, concrete: 0x343e40, metal: 0x33474b, rock: 0x303f41, sun: 0xffd3a0, fill: 0x8bb6c3 },
  courtyard: { sky: 0x9c9b85, fog: 0x9c9b85, concrete: 0x4a4b42, metal: 0x535048, rock: 0x5b5b43, sun: 0xffd6a0, fill: 0xc0cebe },
} as const

// A fixed seed keeps the surface and the downwash particles stable on replay.
function random(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0
    return value / 4294967296
  }
}

function concreteTextures() {
  const side = 512
  const color = new Uint8Array(side * side * 4)
  const roughness = new Uint8Array(side * side * 4)
  const height = new Uint8Array(side * side * 4)
  const rng = random(73147)
  const layers = [4, 13, 41, 127].map(size => ({ size, values: Float32Array.from({ length: (size + 1) ** 2 }, () => rng()) }))
  const noise = (x: number, y: number, index: number) => {
    const layer = layers[index], size = layer.size
    const px = x / side * size, py = y / side * size
    const ix = Math.floor(px), iy = Math.floor(py)
    let dx = px - ix, dy = py - iy
    dx = dx * dx * (3 - 2 * dx)
    dy = dy * dy * (3 - 2 * dy)
    const row = size + 1, i = iy * row + ix
    const low = layer.values[i] * (1 - dx) + layer.values[i + 1] * dx
    const high = layer.values[i + row] * (1 - dx) + layer.values[i + row + 1] * dx
    return low * (1 - dy) + high * dy
  }
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const coarse = noise(x, y, 0), patch = noise(x, y, 1), grit = noise(x, y, 2), fine = noise(x, y, 3)
      const aggregate = rng() * 20 - 10
      const stain = Math.max(0, .46 - patch) * 95
      const diffuse = 155 + (coarse - .5) * 35 + (grit - .5) * 27 + aggregate - stain
      const wet = Math.min(1, Math.max(0, (patch - .22) * 2.5))
      const i = (y * side + x) * 4
      color[i] = Math.round(diffuse * 1.015)
      color[i + 1] = Math.round(diffuse)
      color[i + 2] = Math.round(diffuse * .965)
      roughness[i] = roughness[i + 1] = roughness[i + 2] = Math.round(80 + wet * 150)
      height[i] = height[i + 1] = height[i + 2] = Math.round(125 + (fine - .5) * 95 + (grit - .5) * 50 + aggregate * 1.4)
      color[i + 3] = roughness[i + 3] = height[i + 3] = 255
    }
  }
  // Scattered hairline cracks are irregular and do not turn the apron into a grid.
  for (let crack = 0; crack < 22; crack++) {
    let x = rng() * side, y = rng() * side, angle = rng() * Math.PI * 2
    const length = 16 + rng() * 70
    for (let step = 0; step < length; step++) {
      angle += (rng() - .5) * .5
      x += Math.cos(angle); y += Math.sin(angle)
      const ix = Math.floor(x), iy = Math.floor(y)
      if (ix < 1 || iy < 1 || ix >= side - 1 || iy >= side - 1) break
      const i = (iy * side + ix) * 4
      for (let channel = 0; channel < 3; channel++) {
        color[i + channel] = Math.max(45, color[i + channel] - 32)
        height[i + channel] = 65
      }
    }
  }
  const texture = (data: Uint8Array, srgb = false) => {
    const t = new THREE.DataTexture(data, side, side, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = 4
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  }
  return { color: texture(color, true), roughness: texture(roughness), height: texture(height) }
}

function woodTexture() {
  const side = 128, data = new Uint8Array(side * side * 4), rng = random(875)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const grain = Math.sin(x * .58 + Math.sin(y * .07) * 2) * 14 + rng() * 11
      const i = (y * side + x) * 4
      data[i] = 102 + grain
      data[i + 1] = 76 + grain * .8
      data[i + 2] = 49 + grain * .5
      data[i + 3] = 255
    }
  }
  const t = new THREE.DataTexture(data, side, side)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function dustTexture() {
  const side = 32, data = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const d = Math.hypot((x + .5) / side * 2 - 1, (y + .5) / side * 2 - 1)
      const i = (y * side + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.max(0, 1 - d) ** 2 * 120)
    }
  }
  const texture = new THREE.DataTexture(data, side, side)
  texture.needsUpdate = true
  return texture
}

export function createWorld(world: WorldId) {
  const p = palettes[world]
  const root = new THREE.Group()
  root.name = "Receiving spaceport"
  const surface = concreteTextures()
  const concrete = new THREE.MeshStandardMaterial({ color: p.concrete, roughness: world === "tide" ? .71 : .9, metalness: .08, map: surface.color, bumpMap: surface.height, bumpScale: .19, roughnessMap: surface.roughness })
  const steel = new THREE.MeshStandardMaterial({ color: p.metal, metalness: .78, roughness: .48 })
  const edge = new THREE.MeshStandardMaterial({ color: 0x6c706b, metalness: .78, roughness: .48 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x202b30, metalness: .48, roughness: .7 })
  const bronze = new THREE.MeshStandardMaterial({ color: 0x81704e, metalness: .7, roughness: .48 })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xc49b53, metalness: .24, roughness: .84 })
  const warm = new THREE.MeshStandardMaterial({ color: 0xffd395, emissive: 0xffb75f, emissiveIntensity: 2.8, roughness: .4 })
  const cool = new THREE.MeshStandardMaterial({ color: 0xc0d5cf, emissive: 0xadcbd3, emissiveIntensity: 1.8, roughness: .5 })

  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) {
    const object = new THREE.Mesh(geometry, material)
    object.position.set(x, y, z)
    object.castShadow = true
    object.receiveShadow = true
    parent.add(object)
    return object
  }
  function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) {
    return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent)
  }
  function pipe(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, parent: THREE.Object3D = root) {
    const direction = b.clone().sub(a)
    const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material, 0, 0, 0, parent)
    object.position.copy(a).add(b).multiplyScalar(.5)
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    return object
  }

  // The apron is a continuous surface so shadows and wheel contact do not jump
  // as the camera moves from the ship to the local delivery area.
  const ground = mesh(new THREE.PlaneGeometry(60, 80), concrete, 0, -.015, 7)
  ground.name = "Apron ground"
  ground.rotation.x = -Math.PI / 2
  ground.castShadow = false
  const slab = box(60, .8, 80, dark, 0, -.43, 7)
  slab.name = "Floating foundation"
  box(60.3, .12, .2, edge, 0, -.08, -33)
  box(60.3, .12, .2, edge, 0, -.08, 47)
  box(.2, .12, 80, edge, -30, -.08, 7)
  box(.2, .12, 80, edge, 30, -.08, 7)

  // Broken paint arcs and inset fixtures belong to the physical landing pad.
  // They carry no movement path or HUD decoration.
  const ringGeometry = new THREE.TorusGeometry(8.7, .035, 4, 24, Math.PI / 3.4)
  for (let i = 0; i < 6; i++) {
    const ring = mesh(ringGeometry, yellow, 0, .008, 0)
    ring.rotation.set(-Math.PI / 2, 0, i * Math.PI / 3)
  }
  for (const x of [-5.8, 5.8]) {
    box(.16, .012, 1.3, yellow, x, .014, -4.6)
    box(1.3, .012, .16, yellow, x + (x > 0 ? -.57 : .57), .014, -5.18)
    box(.16, .012, 1.3, yellow, x, .014, 4.6)
    box(1.3, .012, .16, yellow, x + (x > 0 ? -.57 : .57), .014, 5.18)
  }
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4
    const x = Math.cos(angle) * 9.2, z = Math.sin(angle) * 9.2
    const fixture = mesh(new THREE.CylinderGeometry(.16, .19, .08, 12), dark, x, .03, z)
    fixture.name = "Flush landing light"
    mesh(new THREE.CylinderGeometry(.11, .11, .015, 12), i % 2 ? warm : cool, x, .076, z)
  }

  const hangar = new THREE.Group()
  hangar.name = "Freight terminal hangar"
  hangar.position.set(-16, 0, -8)
  root.add(hangar)
  const arch = new THREE.Shape()
  arch.moveTo(-7.5, 0)
  arch.lineTo(-7.5, 5.7)
  arch.quadraticCurveTo(-7.5, 9, 0, 9)
  arch.quadraticCurveTo(7.5, 9, 7.5, 5.7)
  arch.lineTo(7.5, 0)
  arch.lineTo(6.95, 0)
  arch.lineTo(6.95, 5.7)
  arch.quadraticCurveTo(6.95, 8.4, 0, 8.4)
  arch.quadraticCurveTo(-6.95, 8.4, -6.95, 5.7)
  arch.lineTo(-6.95, 0)
  arch.closePath()
  const shellGeometry = new THREE.ExtrudeGeometry(arch, { depth: 11, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .08, bevelThickness: .06, curveSegments: 40 })
  shellGeometry.computeVertexNormals()
  mesh(shellGeometry, steel, 0, 0, -6, hangar)
  const ribGeometry = new THREE.ExtrudeGeometry(arch, { depth: .2, bevelEnabled: false, steps: 1, curveSegments: 40 })
  ribGeometry.computeVertexNormals()
  for (const z of [-5.9, -3.2, -.5, 2.2, 5]) mesh(ribGeometry, edge, 0, 0, z, hangar)
  box(14.8, 7, .25, dark, 0, 3.5, -6, hangar)
  box(13.8, .15, 11, steel, 0, .02, -.5, hangar)
  box(12.8, .09, .24, warm, 0, 6.0, 4.8, hangar)
  box(12.8, .09, .24, warm, 0, 6.0, -.2, hangar)
  for (const x of [-6.5, 6.5]) {
    box(.48, .65, .42, bronze, x, .34, 5.3, hangar)
    box(.52, .1, .46, yellow, x, .71, 5.3, hangar)
  }
  const terminalLight = new THREE.PointLight(0xffc48a, 65, 15, 2)
  terminalLight.position.set(-16, 5, -3.5)
  root.add(terminalLight)
  for (const x of [-19, -13]) {
    box(2.4, 1.15, 2.2, dark, x, .6, -11)
    box(2.4, .09, 2.25, bronze, x, 1.2, -11)
  }

  const yard = new THREE.Group()
  yard.name = "Container yard and terminal services"
  root.add(yard)
  const containerLocations = [
    [-24.7, 1.1, 5.5], [-21.8, 1.1, 5.5], [-18.9, 1.1, 5.5],
    [-24.7, 3.3, 5.5], [-21.8, 3.3, 5.5], [-24.7, 1.1, 12.1],
  ]
  const containerMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6867, roughness: .8, metalness: .5, bumpMap: surface.height, bumpScale: .045 })
  const containers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.65, 2.1, 5.7), containerMaterial, containerLocations.length)
  containers.name = "Stacked freight containers"
  const transform = new THREE.Matrix4()
  for (let i = 0; i < containerLocations.length; i++) {
    const [x,y,z] = containerLocations[i]
    transform.makeTranslation(x,y,z)
    containers.setMatrixAt(i, transform)
    containers.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0x697678 : i % 3 === 1 ? 0x62675b : 0x8a7761))
  }
  containers.castShadow = containers.receiveShadow = true
  yard.add(containers)
  const corrugations = new THREE.InstancedMesh(new THREE.BoxGeometry(.07, 1.95, 5.75), steel, containerLocations.length * 8)
  for (let i = 0; i < containerLocations.length; i++) {
    const [x,y,z] = containerLocations[i]
    for (let rib = 0; rib < 8; rib++) {
      transform.makeTranslation(x - 1.18 + rib * .34,y,z)
      corrugations.setMatrixAt(i * 8 + rib, transform)
    }
  }
  corrugations.castShadow = corrugations.receiveShadow = true
  yard.add(corrugations)
  for (const x of [-23.3, -22.7]) {
    pipe(new THREE.Vector3(x, .5, -12), new THREE.Vector3(x, 5.7, -12), .15, bronze)
    pipe(new THREE.Vector3(x, 5.7, -12), new THREE.Vector3(x, 5.7, 1.4), .15, bronze)
  }
  const parapets = new THREE.InstancedMesh(new THREE.BoxGeometry(3.5, 1.15, .42), concrete, 80)
  let wallIndex = 0
  for (const z of [-32.5, 46.5]) {
    for (let i = 0; i < 17; i++) {
      transform.makeTranslation(-28 + i * 3.5, .55, z)
      parapets.setMatrixAt(wallIndex++, transform)
    }
  }
  const rotation = new THREE.Matrix4().makeRotationY(Math.PI / 2)
  for (const x of [-29.5, 29.5]) {
    for (let i = 0; i < 23; i++) {
      transform.makeTranslation(x, .55, -31 + i * 3.5)
      transform.multiply(rotation)
      parapets.setMatrixAt(wallIndex++, transform)
    }
  }
  parapets.name = "Apron perimeter parapet"
  parapets.castShadow = parapets.receiveShadow = true
  root.add(parapets)

  const utility = new THREE.Group()
  utility.name = "Communications mast"
  utility.position.set(13, 0, -16)
  root.add(utility)
  const mast = mesh(new THREE.CylinderGeometry(.14, .3, 10.5, 10), steel, 0, 5.25, 0, utility)
  mast.name = "Mast spine"
  box(2.6, .45, 2.6, dark, 0, .22, 0, utility)
  const dish = mesh(new THREE.SphereGeometry(1.55, 24, 10, 0, Math.PI * 2, Math.PI * .37, Math.PI * .34), edge, 0, 8.6, 0, utility)
  dish.rotation.z = -.55
  pipe(new THREE.Vector3(-1.8, 0, 0), new THREE.Vector3(0, 8.5, 0), .045, steel, utility)
  pipe(new THREE.Vector3(1.8, 0, 0), new THREE.Vector3(0, 8.5, 0), .045, steel, utility)
  mesh(new THREE.SphereGeometry(.09, 8, 6), warm, 0, 10.55, 0, utility)

  const road = box(5.3, .018, 20, new THREE.MeshStandardMaterial({ color: 0x343c3d, roughness: .66, metalness: .12, map: surface.color, bumpMap: surface.height, roughnessMap: surface.roughness, bumpScale: .12 }), 14.8, -.001, 16.5)
  road.name = "District service road"
  road.rotation.y = -.58
  for (const [x, z] of [[11.3, 11.4], [18.1, 24.1], [23.2, 24.1], [-8.8, -1.6]]) {
    mesh(new THREE.CylinderGeometry(.14, .22, .8, 10), dark, x, .4, z)
    mesh(new THREE.CylinderGeometry(.15, .15, .10, 10), warm, x, .82, z)
  }

  const receiverIron = new THREE.MeshStandardMaterial({ color: world === "isles" ? 0x593d33 : 0x4f4840, roughness: .7, metalness: .5, bumpMap: surface.height, bumpScale: .035 })
  const wood = new THREE.MeshStandardMaterial({ color: 0xb6a487, map: woodTexture(), roughness: .86, metalness: .03 })
  const station = new THREE.Group()
  station.name = "District delivery station"
  station.position.set(18, 0, 22)
  root.add(station)
  box(7, .12, 6.2, steel, 0, .015, 0, station)
  for (const x of [-2.6, 2.6]) {
    box(.3, world === "isles" ? 3.7 : 4.4, .35, receiverIron, x, world === "isles" ? 1.85 : 2.2, .65, station)
    box(.75, .18, .75, dark, x, .12, .65, station)
    pipe(new THREE.Vector3(x, 3.25, .65), new THREE.Vector3(x, 4.5, -1), .06, edge, station)
  }
  if (world === "isles") {
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4342, metalness: .65, roughness: .65, side: THREE.DoubleSide })
    const canopy = mesh(new THREE.CylinderGeometry(2.58, 2.58, 3.0, 40, 1, true, -Math.PI / 2, Math.PI), canopyMaterial, 0, 3.7, -.5, station)
    canopy.rotation.x = -Math.PI / 2
    box(3.8, .06, .12, warm, 0, 5.3, -.6, station)
  } else {
    box(6.25, .28, 3.5, receiverIron, 0, 4.4, .1, station)
    box(5.5, .1, .15, warm, 0, 4.18, 1.72, station)
  }
  const shelf = box(3.8, .08, 1.25, dark, 0, 1.0, 0, station)
  box(.15, .98, .6, receiverIron, -1.5, .49, .1, station)
  box(.15, .98, .6, receiverIron, 1.5, .49, .1, station)
  const receiver = new THREE.Vector3(18, 1.1, 22)
  shelf.name = "Delivery bench top y1.1"
  const benchSlats = new THREE.InstancedMesh(new THREE.BoxGeometry(3.75, .06, .2), wood, 5)
  benchSlats.name = "Worn wooden bench seat"
  const slatMatrix = new THREE.Matrix4()
  for (let i = 0; i < 5; i++) {
    slatMatrix.makeTranslation(0, 1.07, -.48 + i * .24)
    benchSlats.setMatrixAt(i, slatMatrix)
  }
  benchSlats.castShadow = benchSlats.receiveShadow = true
  station.add(benchSlats)
  const backSlats = new THREE.InstancedMesh(new THREE.BoxGeometry(3.75, .19, .07), wood, 4)
  backSlats.name = "Bench backrest"
  for (let i = 0; i < 4; i++) {
    slatMatrix.makeTranslation(0, 1.32 + i * .23, -.59)
    backSlats.setMatrixAt(i, slatMatrix)
  }
  backSlats.castShadow = backSlats.receiveShadow = true
  station.add(backSlats)
  pipe(new THREE.Vector3(-1.54, .7, -.57), new THREE.Vector3(-1.54, 2.18, -.57), .045, receiverIron, station)
  pipe(new THREE.Vector3(1.54, .7, -.57), new THREE.Vector3(1.54, 2.18, -.57), .045, receiverIron, station)
  const bridgeArch = mesh(new THREE.TorusGeometry(2.6, .13, 8, 40, Math.PI), receiverIron, 0, 3.7, .65, station)
  bridgeArch.name = "Red iron station arch"
  for (const x of [-2.6, 2.6]) box(.42, .48, .17, receiverIron, x, 3.5, .86, station)
  box(1.4, 1.05, .3, dark, 3.85, 1.3, -.9, station)
  box(1.12, .06, .1, warm, 3.85, 1.4, -.72, station)
  const lantern = mesh(new THREE.CylinderGeometry(.17, .21, .42, 10), warm, -2.25, 3.15, .7, station)
  lantern.name = "Receiving lamp"
  pipe(new THREE.Vector3(-2.25, 3.5, .7), new THREE.Vector3(-2.25, 4.2, .7), .025, bronze, station)
  const deliveryLight = new THREE.PointLight(0xffc983, 18, 6.5, 2)
  deliveryLight.position.set(16.2, 3, 22.6)
  root.add(deliveryLight)

  const rock = new THREE.MeshStandardMaterial({ color: p.rock, roughness: 1, metalness: .02, flatShading: true })
  const horizon = new THREE.Group()
  horizon.name = "Distant terrain"
  root.add(horizon)
  const terrainNoise = random(3774)
  if (world === "isles") {
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? -1 : 1
      const x = side * (37 + terrainNoise() * 26)
      const z = -27 + i * 8
      const height = 5 + terrainNoise() * 14
      const island = mesh(new THREE.ConeGeometry(7 + terrainNoise() * 5, height, 6, 1), rock, x, -height * .65 - 4, z, horizon)
      island.rotation.z = Math.PI
      island.rotation.y = i * 1.6
      const rim = mesh(new THREE.CylinderGeometry(7.1, 6.5, 1.2, 7), concrete, x, -4, z, horizon)
      rim.rotation.y = island.rotation.y
    }
    const archMaterial = new THREE.MeshStandardMaterial({ color: 0x6a6860, roughness: .86, metalness: .2 })
    for (const [x, z, size] of [[-32, 34, 12], [33, -21, 15]]) {
      const distantArch = mesh(new THREE.TorusGeometry(size, .5, 6, 42, Math.PI), archMaterial, x, size * .26, z, horizon)
      distantArch.rotation.y = x < 0 ? .35 : -.4
    }
    for (const x of [-23, 23]) box(2, 10, 3, dark, x, -5.7, -17, horizon)
  } else if (world === "tide") {
    const water = mesh(new THREE.PlaneGeometry(230, 220, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1c424c, metalness: .45, roughness: .24, bumpMap: surface.height, bumpScale: .12 }), 0, -1.7, 6, horizon)
    water.rotation.x = -Math.PI / 2
    water.castShadow = false
    for (let i = 0; i < 9; i++) {
      const x = (i % 2 ? -1 : 1) * (33 + terrainNoise() * 20)
      const z = -35 + i * 12
      const height = 7 + terrainNoise() * 17
      const cliff = mesh(new THREE.ConeGeometry(7, height, 5, 1), rock, x, height * .35 - 2, z, horizon)
      cliff.rotation.y = i
      cliff.scale.x = 1.6
    }
  } else {
    const trunk = new THREE.MeshStandardMaterial({ color: 0x453f2b, roughness: 1 })
    const foliage = new THREE.MeshStandardMaterial({ color: 0x4d5a3b, roughness: 1, flatShading: true })
    for (let i = 0; i < 10; i++) {
      const x = (i % 2 ? -1 : 1) * (33 + terrainNoise() * 20)
      const z = -28 + i * 9
      const height = 16 + terrainNoise() * 14
      mesh(new THREE.CylinderGeometry(.7, 1.9, height, 8), trunk, x, height / 2 - 3, z, horizon)
      const crown = mesh(new THREE.IcosahedronGeometry(7.5, 1), foliage, x, height - 2, z, horizon)
      crown.scale.set(1.7, .68, 1.3)
    }
  }

  const sun = new THREE.DirectionalLight(p.sun, 3.2)
  sun.name = "Low sun"
  sun.position.set(-15, 29, -13)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -30
  sun.shadow.camera.right = 30
  sun.shadow.camera.top = 35
  sun.shadow.camera.bottom = -25
  sun.shadow.camera.near = .5
  sun.shadow.camera.far = 90
  sun.shadow.normalBias = .035
  sun.shadow.bias = -.00015
  root.add(sun)
  root.add(sun.target)
  const ambient = new THREE.HemisphereLight(p.fill, 0x3a3931, 1.8)
  ambient.name = "Open sky fill"
  root.add(ambient)

  const particleNoise = random(93341)
  const dustSeeds = new Float32Array(150 * 3)
  for (let i = 0; i < 150; i++) {
    const angle = particleNoise() * Math.PI * 2
    const radius = 2.3 + particleNoise() * 8
    dustSeeds[i * 3] = Math.cos(angle) * radius
    dustSeeds[i * 3 + 1] = .05 + particleNoise() * 1.3
    dustSeeds[i * 3 + 2] = Math.sin(angle) * radius
  }
  const dustGeometry = new THREE.BufferGeometry()
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustSeeds.slice(), 3))
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xb9b8ab, size: .55, map: dustTexture(), transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }))
  dust.name = "Rotor wash dust"
  root.add(dust)

  return { root, receiver, sun, ambient, dust, dustSeeds, ground, palette: { background: p.sky, fog: p.fog } }
}