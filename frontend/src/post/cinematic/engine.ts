import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import type { WorldId } from "../../i18n"
import { createShip, createLoader, createPallet, createDrone, createRover } from "./models"
import { createWorld } from "./world"
import { createGiftEffects } from './giftEffects'

export const stages = [
  { start: 0, cn: "穿越虫洞", en: "Through the passage" },
  { start: 4, cn: "减速进场", en: "Final approach" },
  { start: 10.2, cn: "起落架承重", en: "Weight on gear" },
  { start: 12, cn: "打开后货舱", en: "Opening the hold" },
  { start: 15, cn: "升降车对接", en: "Loader docking" },
  { start: 19, cn: "整托卸载", en: "Pallet transfer" },
  { start: 23, cn: "转运车接运", en: "Loading the hauler" },
  { start: 29, cn: "驶往片区站", en: "District transfer" },
  { start: 34, cn: "无人机接件", en: "Last mile handover" },
  { start: 37, cn: "抵近收件处", en: "Final delivery" },
  { start: 42, cn: "寄件已放稳", en: "Parcel delivered" },
] as const
const duration = 44
const clamp = (x: number) => THREE.MathUtils.clamp(x, 0, 1)
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t) }
const leg = (time: number, start: number, length: number) => smooth((time - start) / length)
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
type Frame = { phase: number; time: number; progress: number }

export function createCinematic(canvas: HTMLCanvasElement, worldId: WorldId, code: string, calm: boolean,
  onFrame: (frame: Frame) => void, onDone: (photo: string) => void, onError: () => void, items: {giftId:string;quantity:number}[] = []) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5))
  renderer.info.autoReset = false
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = .97
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene()
  const environment = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const reflection = pmrem.fromScene(environment, .05)
  scene.environment = reflection.texture
  scene.environmentIntensity = .48
  const world = createWorld(worldId)
  scene.add(world.root)
  const deliveredGifts = createGiftEffects(items)
  deliveredGifts.position.copy(world.receiver)
  deliveredGifts.visible = false
  scene.add(deliveredGifts)
  const background = new THREE.Color(worldId==="courtyard"?0x343944:worldId==="tide"?0x1d3039:0x283642)
  scene.background = background
  scene.fog = new THREE.FogExp2(background, .015)
  world.ambient.intensity=.72
  world.sun.intensity=3.3
  world.sun.color.set(0xffc98b)
  world.sun.position.set(-20,24,-16)
  world.sun.shadow.normalBias=.045
  world.sun.shadow.bias=-.00012
  const fill = new THREE.DirectionalLight(0xaccbdc,.85)
  fill.position.set(12,10,18)
  scene.add(fill)
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 260)
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene,camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(400,600),.26,.55,1.2)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  const grade = new ShaderPass({
    uniforms: {tDiffuse:{value:null}, time:{value:0}},
    vertexShader: "varying vec2 uvOut;void main(){uvOut=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `uniform sampler2D tDiffuse;uniform float time;varying vec2 uvOut;
      void main(){vec3 c=texture2D(tDiffuse,uvOut).rgb;
      c=(c-.5)*1.075+.5;
      float vig=1.-.27*pow(length((uvOut-.5)*vec2(1.,.85)),1.5);
      float noise=fract(sin(dot(uvOut*vec2(759.,1183.),vec2(12.9898,78.233))+floor(time*24.))*43758.5453)-.5;
      c=clamp(c*vig+noise*.012,0.,1.);
      gl_FragColor=vec4(c,1.);}`,
  })
  composer.addPass(grade)
  const cameraGoal = v(18, 12, 27), lookGoal = v(0, 3, 0), look = lookGoal.clone()
  const ship = createShip(), loader = createLoader(), rover = createRover(), drone = createDrone()
  const freight = createPallet(code.slice(0, 6).toUpperCase())
  ship.root.position.set(-22, 26, -39)
  freight.root.position.set(0, -.35, 3.0)
  ship.root.add(freight.root)
  loader.root.position.set(0, 0, 16)
  rover.root.position.set(8, 0, 16)
  drone.root.position.set(18, 1.25, 17)
  scene.add(ship.root, loader.root, rover.root, drone.root)
  const escorts: THREE.Object3D[] = []
  for (const side of [-1, 1]) {
    const escort = ship.root.clone()
    escort.scale.setScalar(.42)
    escort.position.set(-22 + side * 6, 27, -46)
    scene.add(escort)
    escorts.push(escort)
  }

  // A finite receiving bridge joins the cargo rollers to the loader deck.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.5, .12, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x68716c, metalness: .8, roughness: .47 }))
  bridge.position.set(0, 1.94, 5.7)
  bridge.visible = false
  bridge.castShadow = bridge.receiveShadow = true
  scene.add(bridge)
  const regionalBridge = bridge.clone()
  regionalBridge.position.set(8, 1.14, 14)
  regionalBridge.scale.z = 1.5
  regionalBridge.visible = false
  scene.add(regionalBridge)
  const portalMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, fade: { value: 1 } },
    vertexShader: "varying vec2 pos; void main(){pos=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec2 pos;uniform float time;uniform float fade;
      void main(){float r=length(pos);float a=atan(pos.y,pos.x);
      float ring=exp(-abs(r-.66)*34.);
      float strands=.65+.35*sin(a*19.+time*1.7+r*43.);
      float halo=exp(-abs(r-.68)*6.);
      float aperture=1.-smoothstep(.58,.645,r);
      vec3 color=vec3(1.32,.91,.48)*ring*strands+vec3(.21,.27,.31)*halo*.19;
      float opacity=max(aperture*.96,clamp(ring+halo*.2,0.,1.))*fade;
      gl_FragColor=vec4(color,opacity);}`,
  })
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(25, 25), portalMaterial)
  portal.position.set(-24, 27, -43)
  portal.lookAt(-20, 24, -31)
  scene.add(portal)
  const shipPath = new THREE.CatmullRomCurve3([v(-24,27,-43), v(-20,24,-32), v(-10,17,-15), v(-2,7,-3), v(0,2.35,0)])
  const loaderPath = new THREE.CatmullRomCurve3([v(0,0,7.7),v(0,0,11),v(3,0,12),v(8,0,12)])
  const roverPath = new THREE.CatmullRomCurve3([v(8,0,16),v(11,0,18),v(16,0,18.5),v(18,0,17)])
  const dronePath = new THREE.CatmullRomCurve3([v(18,2.8,17),v(18,3.4,18.5),v(18,3.2,20),v(18,2.185,22)])
  const parcel = freight.parcel
  let palletOwner: "ship" | "loader" | "rover" = "ship"
  let parcelOwner: "pallet" | "drone" | "shelf" = "pallet"
  let active = false, holding = false, paused = false, disposed = false, finished = false
  let time = 0, previous = 0, phase = -1, frame = 0, lastReport = -1, orbitX = 0, orbitY = 0
  const pickupDroneStart = drone.root.position.clone()
  let pickupParcelBase = v(0,0,0)
  let droneLiftFrom = v(0,0,0)
  const initialCamera = v(-4, 28, -13)
  camera.position.copy(initialCamera)
  const cameraBase = initialCamera.clone()
  look.copy(ship.root.position)
  const viewOffset = v(0,0,0), delta = v(0,0,0)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190,32,20), new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,
    vertexShader:"varying vec3 worldDir;void main(){worldDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:`varying vec3 worldDir;
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){vec3 d=normalize(worldDir);float h=max(0.,d.y);
      vec3 c=mix(vec3(.22,.26,.29),vec3(.025,.064,.1),pow(h,.42));
      float n=noise(d*9.0)+.5*noise(d*19.)+.25*noise(d*41.);
      float cloud=smoothstep(.68,1.25,n)*smoothstep(0.,.1,h)*(1.-smoothstep(.36,.8,h));
      c=mix(c,vec3(.31,.32,.32),cloud*.55);
      c+=vec3(.16,.09,.025)*pow(max(0.,dot(d,normalize(vec3(-1.,.2,-.8)))),12.);
      gl_FragColor=vec4(c,1.);}`,
  }))
  sky.renderOrder=-10
  scene.add(sky)
  const onceError = () => { if (!disposed) { paused = true; onError() } }
  canvas.addEventListener("webglcontextlost", onceError)
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false)
    composer.setSize(width,height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  function resetGear() {
    const extension = leg(time, 6.6, 2.1)
    ship.gears.forEach((gear, i) => { gear.rotation.x = (i % 2 ? -1 : 1) * (1 - extension) * 1.15 })
  }
  function pose() {
    const approach = leg(time, 0, 10.2)
    ship.root.position.copy(shipPath.getPoint(approach))
    const heading = shipPath.getTangent(Math.min(.999, approach))
    const yaw = Math.atan2(-heading.x, -heading.z)
    ship.root.rotation.set(.055 * Math.sin(time*.8) * (1 - approach), THREE.MathUtils.lerp(yaw, 0, leg(time, 7.4, 2.8)), .08*Math.sin(time*.58)*(1-approach))
    if (time >= 10.2) {
      ship.root.position.set(0, 2.35 - .085 * Math.exp(-(time-10.2)*4) * Math.sin((time-10.2)*12), 0)
      ship.root.rotation.set(0,0,0)
    }
    resetGear()
    const burn = (1-leg(time,9.6,1.6)) * (1.2+.15*Math.sin(time*53))
    ship.engines.forEach(engine => { (engine.material as THREE.MeshStandardMaterial).emissiveIntensity = burn * 4 })
    ship.lights.forEach(light => { light.intensity = 2 + burn * 8 })
    const opening = leg(time,12.6,2.4)
    ship.doors[0].rotation.y = -1.62*opening
    ship.doors[1].rotation.y = 1.62*opening
    escorts.forEach((escort,i) => {
      escort.visible = time < 11
      escort.position.copy(ship.root.position).add(v(i ? 9 : -9, 3, -9))
      escort.quaternion.copy(ship.root.quaternion)
    })
    portalMaterial.uniforms.time.value = time
    portalMaterial.uniforms.fade.value = 1-leg(time,2.2,3)
    portal.visible = time < 5.3
    // Actual dust billows away from the pad under the descending engines.
    const dustMaterial = world.dust.material as THREE.PointsMaterial
    dustMaterial.opacity = Math.max(0, Math.sin(Math.PI*clamp((time-7.1)/5.2))) * .32
    const particles = world.dust.geometry.getAttribute("position") as THREE.BufferAttribute
    for (let i=0;i<particles.count;i++) {
      const seed = i*3, spread = 1 + leg(time,7.5,4)*1.8
      particles.setXYZ(i,world.dustSeeds[seed]*spread,world.dustSeeds[seed+1]+.18*Math.sin(time*2+i),world.dustSeeds[seed+2]*spread)
    }
    particles.needsUpdate = true
    const docking = leg(time,15,2.5), lift = leg(time,17.5,1.5)
    loader.root.position.set(0,0,16-8.3*docking)
    loader.platform.position.y = .95+1.05*lift
    loader.arms.forEach((arm,i) => { arm.rotation.x = (i%2 ? -1 : 1)*Math.asin((loader.platform.position.y-.7)/2.1) })
    const transfer = leg(time,19,4)
    bridge.visible = time>=18.8 && time<23.4
    if (palletOwner === "ship" && time>=19) {
      scene.updateMatrixWorld(true)
      scene.attach(freight.root)
    }
    if (palletOwner === "ship" && time>=19) freight.root.position.set(0,2,3+4.7*transfer)
    if (time>=23 && palletOwner==="ship") {
      scene.updateMatrixWorld(true)
      loader.platform.attach(freight.root)
      palletOwner="loader"
    }
    if (time>=23) {
      const p=leg(time,23,3)
      loader.root.position.copy(loaderPath.getPoint(p))
      const tan=loaderPath.getTangent(Math.min(.999,p))
      loader.root.rotation.y = -Math.PI*.5*leg(time,23.9,.9)*(1-leg(time,25.2,.8))
      loader.platform.position.y = 2 - .8*leg(time,25.8,1)
      loader.arms.forEach((arm,i)=>{arm.rotation.x=(i%2?-1:1)*Math.asin((loader.platform.position.y-.7)/2.1)})
    }
    if (time>=26.9 && palletOwner==="loader") {
      scene.updateMatrixWorld(true)
      scene.attach(freight.root)
      palletOwner="rover"
    }
    regionalBridge.visible = time>=26.7 && time<29
    if (time>=26.9 && time<29) freight.root.position.set(8,1.2,12+4.68*leg(time,26.9,2.1))
    if (time>=29 && freight.root.parent !== rover.cargo) {
      scene.updateMatrixWorld(true)
      rover.cargo.attach(freight.root)
    }
    const drive = leg(time,29,5)
    rover.root.position.copy(roverPath.getPoint(drive))
    if (time>=29) {
      const tan=roverPath.getTangent(Math.min(.999,drive))
      rover.root.rotation.y=Math.atan2(-tan.x,-tan.z)*leg(time,29,1.1)
    }
    loader.wheels.forEach(w=>{w.rotation.x=(time<23?docking*8.3:8.3+leg(time,23,3)*14)/.43})
    rover.wheels.forEach(w=>{w.rotation.x=-drive*13/.49})
    const spin = leg(time,33.8,.9)
    drone.rotors.forEach((r,i)=>{r.rotation.y=(i%2?-1:1)*time*(8+130*spin)})
    if (time>=34 && parcelOwner==="pallet") {
      scene.updateMatrixWorld(true)
      parcel.getWorldPosition(pickupParcelBase)
      droneLiftFrom.copy(pickupParcelBase).add(v(0,1.085,0))
      parcelOwner="drone"
    }
    if (time>=34 && time<35.7) {
      // The lock descends to the box. The box stays on the truck until contact.
      drone.root.position.lerpVectors(pickupDroneStart,droneLiftFrom,leg(time,34,1.7))
    }
    if (time>=35.7 && parcel.parent!==drone.cargo && parcelOwner==="drone") {
      drone.root.position.copy(droneLiftFrom)
      scene.updateMatrixWorld(true)
      drone.cargo.attach(parcel)
      parcel.position.set(0,-.535,0)
    }
    if (time>=35.7 && time<37) {
      drone.root.position.lerpVectors(droneLiftFrom,dronePath.getPoint(0),leg(time,35.7,1.3))
    }
    if(time>=37) {
      const p=leg(time,37,4.6)
      drone.root.position.copy(dronePath.getPoint(p))
      drone.root.rotation.z = calm ? 0 : -.09*Math.sin(p*Math.PI)
    }
    if(time>=41.6 && parcelOwner==="drone") {
      scene.updateMatrixWorld(true)
      scene.attach(parcel)
      parcel.position.copy(world.receiver)
      parcelOwner="shelf"
    }
    if(time>=42) {
      drone.root.position.y += leg(time,42,2)*2.1
      if(items.length){parcel.visible=false;deliveredGifts.visible=true;deliveredGifts.scale.setScalar(.88+.12*leg(time,42,.9))}
    }
  }

  function cameraPose(dt:number) {
    const t=time
    if(t<9) {
      const p=leg(t,0,9)
      cameraGoal.copy(ship.root.position).add(v(10-2*p,5+3*p,17-1*p))
      lookGoal.copy(ship.root.position).add(v(0,.1,0))
    } else if(t<14) {
      const p=leg(t,9,5)
      const angle=.85+(2.7-.85)*p
      const radius=17-5*p
      cameraGoal.set(Math.sin(angle)*radius,7-2.6*p,-Math.cos(angle)*radius)
      lookGoal.set(0,2.5,3*p)
    } else if(t<23) {
      const p=leg(t,14,2)
      cameraGoal.set(5.1-.6*p,4.4-.3*p,10.9+1.1*p)
      lookGoal.set(0,2.7,4+1.7*leg(t,18,4))
    } else if(t<29) {
      cameraGoal.copy(loader.root.position).add(v(7,4.7,8))
      lookGoal.copy(loader.root.position).add(v(0,1.5,1))
    } else if(t<34) {
      cameraGoal.copy(rover.root.position).add(v(-8,5.5,5))
      lookGoal.copy(rover.root.position).add(v(0,1.1,0))
    } else if(t<37) {
      cameraGoal.set(12.5,5.5,20)
      lookGoal.set(18,2.0,17)
    } else if(t<41.5) {
      cameraGoal.copy(drone.root.position).add(v(-4.5,1.8,-5.5))
      lookGoal.copy(drone.root.position).add(v(0,-.4,0))
    } else {
      cameraGoal.set(14.8,3,26.0)
      lookGoal.copy(world.receiver).add(v(0,.25,0))
    }
    if(calm) {
      if(lastReport===phase) return
      cameraBase.copy(cameraGoal); look.copy(lookGoal)
    } else {
      cameraBase.lerp(cameraGoal,1-Math.exp(-dt*2.4))
      look.lerp(lookGoal,1-Math.exp(-dt*3.1))
    }
    viewOffset.copy(cameraBase).sub(look)
    viewOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP,orbitX)
    viewOffset.y += orbitY*viewOffset.length()*.23
    camera.position.copy(look).add(viewOffset)
    camera.lookAt(look)
  }

  function draw(now:number) {
    if(disposed)return
    frame=0
    const dt=previous?Math.min((now-previous)/1000,.06):.016
    previous=now
    if(active&&!paused&&!document.hidden&&!finished) time+=dt*(holding&&time>=19&&time<23?1.65:1)
    phase=stages.reduce((p,s,i)=>time>=s.start?i:p,0)
    pose()
    cameraPose(dt)
    renderer.info.reset()
    grade.uniforms.time.value=time
    if (!calm || lastReport !== phase) composer.render()
    if(lastReport!==phase || Math.floor(time*5)!==Number(canvas.dataset.tick)) {
      onFrame({phase,time,progress:clamp(time/duration)})
      canvas.dataset.tick=String(Math.floor(time*5))
      canvas.dataset.phase=String(phase)
      const position=v(0,0,0)
      freight.root.getWorldPosition(position)
      canvas.dataset.mechanics=JSON.stringify({door:ship.doors[0].rotation.y,deck:loader.platform.position.y,pallet:position.toArray(),owner:palletOwner,parcel:parcelOwner,wheel:rover.wheels[0].rotation.x,rotor:drone.rotors[0].rotation.y,support:freight.root.parent?.name||"scene",parcelSupport:parcel.parent?.name||"scene",shipY:ship.root.position.y,frames:renderer.info.render.frame,calls:renderer.info.render.calls})
      lastReport=phase
    }
    if(time>=duration&&!finished) {
      finished=true
      let photo=""
      try{photo=canvas.toDataURL("image/jpeg",.88)}catch{/* delivery can finish without an image */}
      onDone(photo)
    }
    if(!finished) frame=requestAnimationFrame(draw)
  }
  frame=requestAnimationFrame(draw)
  return {
    setActive(value:boolean){active=value},
    setHold(value:boolean){holding=value},
    setPaused(value:boolean){paused=value},
    setOrbit(x:number,y:number){orbitX=x;orbitY=y},
    dispose(){
      disposed=true; cancelAnimationFrame(frame); observer.disconnect()
      canvas.removeEventListener("webglcontextlost",onceError)
      const geometries=new Set<THREE.BufferGeometry>(), materials=new Set<THREE.Material>(), textures=new Set<THREE.Texture>()
      scene.traverse(obj=>{
        if(obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          geometries.add(obj.geometry)
          const mats=Array.isArray(obj.material)?obj.material:[obj.material]
          mats.forEach(m=>{materials.add(m);Object.values(m).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value)})})
        }
      })
      textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose())
      composer.passes.forEach(pass=>pass.dispose());composer.dispose();reflection.dispose();environment.dispose();pmrem.dispose();renderer.dispose()
    },
  }
}
