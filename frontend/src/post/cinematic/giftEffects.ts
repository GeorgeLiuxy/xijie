import * as THREE from 'three'
import { getGift } from '../../gifts/catalog'
import type { GiftDefinition } from '../../gifts/types'

type Material = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial

// Small, lit sculptures sit inside the delivery scene. All detail is geometry
// or generated surface grain; these gifts do not contain billboard pictures.
export function createGiftEffects(items: { giftId: string; quantity: number }[]): THREE.Group {
  const root = new THREE.Group()
  root.name = 'delivered-gift-effects'

  function grain(kind: 'fabric' | 'wood' | 'rubber') {
    const side = 64, pixels = new Uint8Array(side * side * 4)
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const index = (y * side + x) * 4
      const noise = ((x * 37 + y * 71 + x * y * 11) % 31) / 31
      const value = kind === 'fabric' ? 104 + (x % 2) * 30 + (y % 2) * 25 + noise * 22
        : kind === 'wood' ? 120 + Math.sin(x * .8 + Math.sin(y * .12) * 1.5) * 37 + noise * 15
          : 120 + noise * 70
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value
      pixels[index + 3] = 255
    }
    const texture = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    return texture
  }

  const fabricGrain = grain('fabric'), woodGrain = grain('wood'), rubberGrain = grain('rubber')
  const materials = {
    paper: new THREE.MeshStandardMaterial({ color: 0xe6ddc6, roughness: .96, side: THREE.DoubleSide }),
    paperEdge: new THREE.MeshStandardMaterial({ color: 0xc2b69b, roughness: .92 }),
    ink: new THREE.MeshStandardMaterial({ color: 0x4f5d57, roughness: .9 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9f302b, roughness: .83, bumpMap: rubberGrain, bumpScale: .006 }),
    seam: new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: .9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8b6746, roughness: .86, bumpMap: woodGrain, bumpScale: .012 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x303c3d, roughness: .58, metalness: .67 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xb1925b, roughness: .4, metalness: .76 }),
    cotton: new THREE.MeshPhysicalMaterial({ color: 0x7c9187, roughness: .95, sheen: .65, sheenColor: 0xb3c3b3, bumpMap: fabricGrain, bumpScale: .009, side: THREE.DoubleSide }),
    stripe: new THREE.MeshPhysicalMaterial({ color: 0xddd6bd, roughness: .94, sheen: .55, bumpMap: fabricGrain, bumpScale: .005, side: THREE.DoubleSide }),
    green: new THREE.MeshStandardMaterial({ color: 0x465c35, roughness: .83, side: THREE.DoubleSide }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x6b7b48, roughness: .79, side: THREE.DoubleSide }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: 0xbca98c, roughness: .4, clearcoat: .3 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x443b2d, roughness: 1 }),
    petal: new THREE.MeshStandardMaterial({ color: 0xcfae9f, roughness: .72, side: THREE.DoubleSide }),
    petalLight: new THREE.MeshStandardMaterial({ color: 0xe6d4b8, roughness: .8, side: THREE.DoubleSide }),
    pollen: new THREE.MeshStandardMaterial({ color: 0xc59b48, roughness: .84 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffd8a1, emissive: 0xffb75e, emissiveIntensity: 2.1, roughness: .43 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd2ded1, roughness: .15, transparent: true, opacity: .24, metalness: .08, depthWrite: false, side: THREE.DoubleSide }),
    cell: new THREE.MeshStandardMaterial({ color: 0x72b8b1, emissive: 0x478d89, emissiveIntensity: .7, roughness: .39, metalness: .35 }),
  }
  const unitSphere = new THREE.SphereGeometry(1, 12, 8)

  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: Material, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material)
    object.position.set(x, y, z)
    object.castShadow = true
    object.receiveShadow = true
    parent.add(object)
    return object
  }
  function box(parent: THREE.Object3D, width: number, height: number, depth: number, material: Material, x = 0, y = 0, z = 0) {
    return mesh(parent, new THREE.BoxGeometry(width, height, depth), material, x, y, z)
  }
  function ellipsoid(parent: THREE.Object3D, material: Material, position: number[], scale: number[]) {
    const object = mesh(parent, unitSphere, material, position[0], position[1], position[2])
    object.scale.set(scale[0], scale[1], scale[2])
    return object
  }
  function rod(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: Material) {
    const delta = to.clone().sub(from)
    const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material)
    object.position.copy(from).add(to).multiplyScalar(.5)
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
    return object
  }
  function ring(parent: THREE.Object3D, radius: number, tube: number, material: Material, y: number) {
    const object = mesh(parent, new THREE.TorusGeometry(radius, tube, 6, 24), material, 0, y, 0)
    object.rotation.x = Math.PI / 2
    return object
  }

  function ball(group: THREE.Group) {
    mesh(group, new THREE.SphereGeometry(.25, 28, 20), materials.red, 0, .25, 0)
    const points = Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2
      const twist = Math.sin(angle * 2) * .7
      return new THREE.Vector3(.251 * Math.cos(angle), .251 * Math.sin(angle) * Math.cos(twist), .251 * Math.sin(angle) * Math.sin(twist))
    })
    const seam = mesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 64, .0035, 5, true), materials.seam, 0, .25, 0)
    seam.rotation.z = .42
    const valve = mesh(group, new THREE.CircleGeometry(.009, 8), materials.dark, 0, .25, .2505)
    valve.rotation.z = .2
  }

  function cloth(group: THREE.Group, giftId: string) {
    const width = giftId === 'camera-strap' ? .26 : .76
    const depth = .61
    const heightAt = (x: number, z: number) => .07 + Math.sin(x * 11 + z * 2) * .024 + Math.sin(z * 16) * .015 + .045 * Math.exp(-((x + .2) ** 2) * 48)
    const surface = new THREE.PlaneGeometry(width, depth, 28, 24)
    const points = surface.attributes.position
    for (let index = 0; index < points.count; index++) {
      const x = points.getX(index), z = points.getY(index)
      points.setXYZ(index, x, heightAt(x, z), z)
    }
    surface.computeVertexNormals()
    mesh(group, surface, materials.cotton)
    // Sewn bands follow the actual folds, rather than floating above a flat card.
    for (const x of [-width * .32, width * .32]) {
      const stripe = new THREE.PlaneGeometry(.028, depth - .025, 1, 24)
      const vertices = stripe.attributes.position
      for (let index = 0; index < vertices.count; index++) {
        const px = vertices.getX(index) + x, z = vertices.getY(index)
        vertices.setXYZ(index, px, heightAt(px, z) + .002, z)
      }
      stripe.computeVertexNormals()
      mesh(group, stripe, materials.stripe)
    }
    for (const sign of [-1, 1]) {
      const edge = Array.from({ length: 25 }, (_, index) => {
        const x = -width / 2 + index / 24 * width, z = sign * depth / 2
        return new THREE.Vector3(x, heightAt(x, z) + .002, z)
      })
      mesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 24, .004, 4), materials.stripe)
    }
    group.rotation.y = -.28
  }

  function flowers(group: THREE.Group) {
    const profile = [[.075, 0], [.11, .025], [.135, .13], [.095, .27], [.09, .3]].map(([radius, y]) => new THREE.Vector2(radius, y))
    mesh(group, new THREE.LatheGeometry(profile, 20), materials.ceramic)
    ring(group, .09, .008, materials.bronze, .3)
    for (let flower = 0; flower < 3; flower++) {
      const angle = flower * Math.PI * 2 / 3
      const head = new THREE.Vector3(Math.cos(angle) * .15, .59 + (flower === 1 ? .08 : 0), Math.sin(angle) * .12)
      rod(group, new THREE.Vector3(0, .2, 0), head, .008, materials.green)
      for (const side of [-1, 1]) {
        const leaf = ellipsoid(group, materials.leaf, [head.x * .5 + side * .05, .42, head.z * .5], [.075, .019, .035])
        leaf.rotation.z = side * .45
      }
      const blossom = new THREE.Group()
      blossom.position.copy(head)
      blossom.rotation.set(.14 * flower, 0, .13 * (flower - 1))
      group.add(blossom)
      for (let petal = 0; petal < 7; petal++) {
        const direction = petal / 7 * Math.PI * 2
        const petalMesh = ellipsoid(blossom, flower === 1 ? materials.petalLight : materials.petal, [Math.cos(direction) * .064, .006, Math.sin(direction) * .064], [.07, .022, .043])
        petalMesh.rotation.y = -direction
        petalMesh.rotation.z = Math.cos(direction) * -.2
      }
      ellipsoid(blossom, materials.pollen, [0, .025, 0], [.034, .025, .034])
    }
  }

  function plant(group: THREE.Group, feather = false) {
    if (!feather) {
      mesh(group, new THREE.CylinderGeometry(.15, .105, .21, 18), materials.ceramic, 0, .105, 0)
      mesh(group, new THREE.CylinderGeometry(.139, .139, .012, 18), materials.soil, 0, .207, 0)
      ring(group, .148, .011, materials.ceramic, .21)
    }
    for (let branch = 0; branch < (feather ? 1 : 3); branch++) {
      const angle = branch * Math.PI * 2 / 3
      const tip = new THREE.Vector3(Math.cos(angle) * .10, feather ? .67 : .54 + branch * .04, Math.sin(angle) * .08)
      const start = new THREE.Vector3(0, feather ? 0 : .2, 0)
      rod(group, start, tip, .008, feather ? materials.bronze : materials.green)
      for (let leaf = 0; leaf < (feather ? 8 : 4); leaf++) {
        const progress = .34 + leaf / (feather ? 14 : 7)
        const position = start.clone().lerp(tip, progress)
        const side = leaf % 2 ? 1 : -1
        const blade = ellipsoid(group, feather ? materials.petal : leaf % 2 ? materials.green : materials.leaf,
          [position.x + side * .05, position.y, position.z], [feather ? .072 : .08, .022, feather ? .018 : .033])
        blade.rotation.z = side * .48
        blade.rotation.y = angle
      }
    }
  }

  function lamp(group: THREE.Group) {
    mesh(group, new THREE.CylinderGeometry(.16, .18, .06, 18), materials.dark, 0, .03, 0)
    mesh(group, new THREE.CylinderGeometry(.12, .12, .32, 18, 1, true), materials.glass, 0, .23, 0)
    mesh(group, new THREE.CylinderGeometry(.043, .055, .23, 12), materials.glow, 0, .205, 0)
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI / 4 + index * Math.PI / 2
      const x = Math.cos(angle) * .13, z = Math.sin(angle) * .13
      rod(group, new THREE.Vector3(x, .06, z), new THREE.Vector3(x, .41, z), .009, materials.bronze)
    }
    ring(group, .135, .013, materials.bronze, .07)
    ring(group, .135, .013, materials.bronze, .4)
    mesh(group, new THREE.ConeGeometry(.18, .105, 18), materials.dark, 0, .45, 0)
    const handle = mesh(group, new THREE.TorusGeometry(.045, .008, 6, 16), materials.bronze, 0, .55, 0)
    handle.rotation.y = .3
  }

  function paperCard(group: THREE.Group) {
    box(group, .4, .31, .013, materials.paper, 0, .2, 0)
    box(group, .37, .006, .016, materials.paperEdge, 0, .054, 0)
    for (let line = 0; line < 4; line++) box(group, .19 - line * .025, .006, .002, materials.ink, -.045, .27 - line * .035, .008)
    ellipsoid(group, materials.red, [.124, .104, .018], [.027, .027, .009])
    const seal = mesh(group, new THREE.TorusGeometry(.016, .002, 4, 14), materials.bronze, .124, .104, .027)
    seal.rotation.z = .2
    group.rotation.x = -.12
  }

  function frame(group: THREE.Group, giftId: string) {
    const width = .52, height = giftId === 'nameplate' ? .25 : .45
    box(group, width, height, .045, materials.dark, 0, height / 2 + .055, 0)
    box(group, width - .055, height - .055, .01, materials.paper, 0, height / 2 + .055, .028)
    for (const side of [-1, 1]) {
      box(group, .027, height, .065, materials.wood, side * width / 2, height / 2 + .055, .008)
      box(group, width, .027, .065, materials.wood, 0, height / 2 + .055 + side * height / 2, .008)
    }
    for (let line = 0; line < 3; line++) box(group, .24 - line * .035, .007, .003, materials.ink, -.025, height / 2 + .09 - line * .031, .035)
    box(group, .25, .025, .22, materials.wood, 0, .013, -.025)
    const support = box(group, .055, height * .75, .025, materials.wood, 0, height * .35, -.075)
    support.rotation.x = -.25
    group.rotation.y = -.12
  }

  function furniture(group: THREE.Group, giftId: string) {
    if (giftId === 'station-clock') {
      mesh(group, new THREE.CylinderGeometry(.045, .07, .46, 12), materials.dark, 0, .25, 0)
      box(group, .25, .04, .19, materials.dark, 0, .02, 0)
      const dial = mesh(group, new THREE.CylinderGeometry(.19, .19, .045, 28), materials.bronze, 0, .59, 0)
      dial.rotation.x = Math.PI / 2
      const face = mesh(group, new THREE.CircleGeometry(.167, 28), materials.paper, 0, .59, .024)
      face.rotation.z = 0
      box(group, .007, .12, .004, materials.dark, 0, .635, .028)
      const hand = box(group, .09, .007, .004, materials.dark, .032, .586, .029)
      hand.rotation.z = -.35
      for (let mark = 0; mark < 12; mark++) {
        const angle = mark / 12 * Math.PI * 2
        const tick = box(group, .007, .018, .003, materials.ink, Math.sin(angle) * .143, .59 + Math.cos(angle) * .143, .027)
        tick.rotation.z = -angle
      }
      return
    }
    if (giftId === 'umbrella') {
      rod(group, new THREE.Vector3(0, .025, 0), new THREE.Vector3(0, .63, 0), .012, materials.bronze)
      const canopy = mesh(group, new THREE.SphereGeometry(.35, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.cotton, 0, .54, 0)
      canopy.scale.y = .42
      for (let rib = 0; rib < 8; rib++) {
        const angle = rib / 8 * Math.PI * 2
        rod(group, new THREE.Vector3(0, .676, 0), new THREE.Vector3(Math.cos(angle) * .35, .54, Math.sin(angle) * .35), .003, materials.bronze)
      }
      return
    }
    if (giftId === 'scratch-tree') {
      box(group, .44, .04, .37, materials.cotton, 0, .02, 0)
      mesh(group, new THREE.CylinderGeometry(.055, .055, .47, 14), materials.wood, -.08, .275, 0)
      for (let wrap = 0; wrap < 13; wrap++) ring(group, .056, .004, materials.seam, .08 + wrap * .029).position.x = -.08
      box(group, .32, .045, .29, materials.cotton, -.08, .53, 0)
      return
    }
    if (giftId === 'bookshelf' || giftId === 'record-rack') {
      for (const side of [-1, 1]) box(group, .035, .57, .23, materials.wood, side * .25, .285, 0)
      for (const y of [.035, .28, .55]) box(group, .52, .03, .23, materials.wood, 0, y, 0)
      for (let book = 0; book < 6; book++) {
        const volume = box(group, .035, .16 + (book % 3) * .013, .15, book % 2 ? materials.ink : materials.paperEdge, -.18 + book * .064, .135, .015)
        volume.rotation.z = book === 4 ? -.11 : 0
      }
      return
    }
    for (const x of [-.23, .23]) {
      for (const z of [-.12, .12]) box(group, .035, .27, .035, materials.dark, x, .135, z)
      box(group, .035, .28, .035, materials.dark, x, .37, -.13)
    }
    for (let slat = 0; slat < 4; slat++) box(group, .59, .028, .055, materials.wood, 0, .28, -.1 + slat * .068)
    for (const y of [.41, .49]) box(group, .59, .055, .025, materials.wood, 0, y, -.13)
  }

  function keepsake(group: THREE.Group, giftId: string) {
    if (giftId !== 'paper-crane') { paperCard(group); return }
    const a = new THREE.Vector3(0, .13, -.08), b = new THREE.Vector3(0, .16, .16)
    const triangles = [
      [a, new THREE.Vector3(-.36, .35, .01), b],
      [a, b, new THREE.Vector3(.36, .35, .01)],
      [a, new THREE.Vector3(0, .25, .02), b],
      [a, new THREE.Vector3(0, .06, .015), b],
      [new THREE.Vector3(0, .13, -.06), new THREE.Vector3(.018, .39, -.19), new THREE.Vector3(-.018, .36, -.17)],
      [new THREE.Vector3(.018, .39, -.19), new THREE.Vector3(0, .37, -.27), new THREE.Vector3(-.018, .36, -.17)],
      [b, new THREE.Vector3(0, .29, .33), new THREE.Vector3(.025, .18, .14)],
    ]
    const positions = new Float32Array(triangles.flatMap(triangle => triangle.flatMap(vertex => vertex.toArray())))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    mesh(group, geometry, materials.paper)
  }

  function parcel(group: THREE.Group, fuel: boolean) {
    if (fuel) {
      mesh(group, new THREE.CylinderGeometry(.12, .12, .41, 18), materials.dark, 0, .24, 0)
      mesh(group, new THREE.CylinderGeometry(.122, .122, .23, 18), materials.cell, 0, .24, 0)
      for (const y of [.055, .425]) mesh(group, new THREE.CylinderGeometry(.14, .14, .045, 18), materials.bronze, 0, y, 0)
      for (const x of [-.045, .045]) box(group, .027, .055, .025, materials.dark, x, .48, 0)
      return
    }
    box(group, .43, .3, .32, materials.paperEdge, 0, .15, 0)
    box(group, .45, .035, .34, materials.wood, 0, .315, 0)
    box(group, .047, .302, .325, materials.cotton, -.08, .151, 0)
    box(group, .432, .302, .041, materials.cotton, 0, .151, .06)
    box(group, .11, .07, .003, materials.paper, .08, .21, .162)
  }

  function scene(group: THREE.Group) {
    mesh(group, new THREE.CylinderGeometry(.27, .29, .065, 24), materials.dark, 0, .033, 0)
    mesh(group, new THREE.CylinderGeometry(.25, .25, .025, 24), materials.soil, 0, .077, 0)
    const garden = new THREE.Group()
    garden.scale.setScalar(.55); garden.position.y = .08
    plant(garden)
    group.add(garden)
    mesh(group, new THREE.SphereGeometry(.27, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), materials.glass, 0, .085, 0)
    ring(group, .27, .008, materials.bronze, .085)
    ellipsoid(group, materials.glow, [.1, .27, .025], [.025, .025, .025])
  }

  function sculpture(gift: GiftDefinition) {
    const group = new THREE.Group()
    group.name = 'gift:' + gift.id
    switch (gift.render) {
      case 'ball': ball(group); break
      case 'cloth': cloth(group, gift.id); break
      case 'flower': flowers(group); break
      case 'plant': plant(group, gift.id === 'feather'); break
      case 'lamp': lamp(group); break
      case 'frame': frame(group, gift.id); break
      case 'furniture': furniture(group, gift.id); break
      case 'keepsake': keepsake(group, gift.id); break
      case 'scene': scene(group); break
      case 'package': parcel(group, gift.effect === 'fuel'); break
    }
    const bounds = new THREE.Box3().setFromObject(group)
    const size = bounds.getSize(new THREE.Vector3())
    const scale = Math.min(.61 / size.x, .8 / size.y, .5 / size.z)
    group.scale.setScalar(scale)
    group.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2)
    group.userData = { giftId: gift.id, render: gift.render, templateVersion: gift.version }
    return group
  }

  const quantities = new Map<string, number>()
  for (const item of items) {
    if (!getGift(item.giftId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) continue
    quantities.set(item.giftId, Math.min(Number.MAX_SAFE_INTEGER, (quantities.get(item.giftId) ?? 0) + item.quantity))
  }
  const manifest = [...quantities].map(([giftId, quantity]) => ({ giftId, quantity, displayed: Math.min(quantity, 3), render: getGift(giftId)!.render }))
  const count = manifest.reduce((sum, entry) => sum + entry.displayed, 0)
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))))
  let index = 0
  for (const entry of manifest) for (let copy = 0; copy < entry.displayed; copy++) {
    const object = sculpture(getGift(entry.giftId)!)
    const slot = new THREE.Group()
    slot.name = entry.giftId + ':' + (copy + 1)
    slot.add(object)
    slot.position.set((index % columns - (Math.min(columns, count) - 1) / 2) * .66, 0, Math.floor(index / columns) * .57)
    root.add(slot)
    index++
  }
  if (count) {
    const bounds = new THREE.Box3().setFromObject(root)
    const size = bounds.getSize(new THREE.Vector3())
    const scale = Math.min(1.6 / size.x, 1 / size.y, 1.3 / size.z)
    const center = bounds.getCenter(new THREE.Vector3())
    for (const child of root.children) {
      child.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z)).multiplyScalar(scale)
      child.scale.multiplyScalar(scale)
    }
  }
  root.userData = {
    manifest,
    representation: 'lit-procedural-template-geometry',
    maxCopiesPerGift: 3,
    displayedCopies: count,
    bounds: { maxWidth: 1.6, maxHeight: 1, maxDepth: 1.3, floor: 0 },
  }
  return root
}
