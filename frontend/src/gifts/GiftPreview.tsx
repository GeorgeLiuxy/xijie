import { useEffect, useRef, useState } from 'react'
import type { WorldId } from '../i18n'
import { fxPrefs } from '../ui'
import { GiftIcon } from './GiftIcon'

/** A local parcel opening, rendered from the same meshes as the optional journey. */
export function GiftPreview({ giftId, quantity, arrived, world, landscape = false }: {giftId:string;quantity:number;arrived:boolean;world:WorldId;landscape?:boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const redraw = useRef<(() => void) | null>(null)
  const delivery = useRef(arrived)
  delivery.current = arrived
  useEffect(() => { redraw.current?.() }, [arrived])
  const [failed,setFailed] = useState(false)
  const calm=fxPrefs.calm
  useEffect(()=>{
    let stopped=false,dispose=()=>{}
    setFailed(false)
    void Promise.all([import('three'),import('../post/cinematic/giftEffects')]).then(([T,{createGiftEffects}])=>{
      if(stopped||!canvas.current)return
      const el=canvas.current
      let renderer:InstanceType<typeof T.WebGLRenderer>
      try{renderer=new T.WebGLRenderer({canvas:el,antialias:true,alpha:true,powerPreference:'low-power'})}catch{setFailed(true);return}
      renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5))
      renderer.outputColorSpace=T.SRGBColorSpace
      renderer.toneMapping=T.ACESFilmicToneMapping
      renderer.toneMappingExposure=1.22
      renderer.shadowMap.enabled=true
      renderer.shadowMap.type=T.PCFSoftShadowMap
      const scene=new T.Scene(),camera=new T.PerspectiveCamera(35,1,.1,30)
      camera.position.set(2.2,2.4,4.8);camera.lookAt(0,.45,0)
      scene.background=new T.Color(world==='courtyard'?0x272c30:0x202c37)
      scene.fog=new T.Fog(scene.background,6,13)
      scene.add(new T.HemisphereLight(0xc6d9ed,0x1e222d,.95))
      const key=new T.DirectionalLight(0xffdfb3,4.5);key.position.set(-3,5,3);key.castShadow=true
      key.shadow.mapSize.set(512,512);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=3;key.shadow.camera.bottom=-3;key.shadow.normalBias=.035
      scene.add(key)
      const rim=new T.DirectionalLight(0xa4ccef,3);rim.position.set(4,2,-3);scene.add(rim)
      const platform=new T.Mesh(new T.BoxGeometry(3,.16,2.2),new T.MeshStandardMaterial({color:world==='courtyard'?0x675140:world==='tide'?0x425058:0x535953,roughness:.8,metalness:.12}))
      platform.position.y=-.1;platform.receiveShadow=true;platform.castShadow=true;scene.add(platform)
      const floor=new T.Mesh(new T.PlaneGeometry(30,30),new T.MeshStandardMaterial({color:0x1b2731,roughness:.94}));floor.rotation.x=-Math.PI/2;floor.position.y=-.48;floor.receiveShadow=true;scene.add(floor)
      if (landscape) { scene.background = null; scene.fog = null; floor.visible = false }
      const edges=new T.LineSegments(new T.EdgesGeometry(platform.geometry),new T.LineBasicMaterial({color:0x9b9a89,transparent:true,opacity:.18}));edges.position.copy(platform.position);scene.add(edges)
      const crate=new T.Group(),paper=new T.MeshStandardMaterial({color:0xd7c5a7,roughness:.7,metalness:.08})
      const body=new T.Mesh(new T.BoxGeometry(1.35,.68,1.02),paper);body.position.y=.34;body.castShadow=true;body.receiveShadow=true;crate.add(body)
      const lid=new T.Group();lid.position.set(0,.69,-.51)
      const top=new T.Mesh(new T.BoxGeometry(1.39,.055,1.06),paper);top.position.z=.51;top.castShadow=true;lid.add(top);crate.add(lid)
      const band=new T.Mesh(new T.BoxGeometry(.075,.695,1.035),new T.MeshStandardMaterial({color:0x4d667c,roughness:.6}));band.position.y=.35;crate.add(band)
      scene.add(crate)
      const goods=createGiftEffects([{giftId,quantity}]);goods.visible=false;scene.add(goods)
      const observer=new ResizeObserver(()=>{const rect=el.getBoundingClientRect();if(rect.width&&rect.height){renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();schedule()}})
      observer.observe(el)
      let frame=0,last=performance.now(),opening=0
      function schedule() { if (!stopped && !frame && !document.hidden) frame = requestAnimationFrame(render) }
      redraw.current = schedule
      function render(now:number){
        frame=0
        if(stopped || document.hidden || !el.getClientRects().length)return
        const dt=Math.min(.04,(now-last)/1000);last=now
        if(delivery.current)opening=calm?1:Math.min(1,opening+dt*.9)
        const p=opening*opening*(3-2*opening)
        lid.rotation.x=-p*1.95
        band.visible=opening<.12
        goods.visible=opening>.35
        goods.position.y=.72*(1-p)
        goods.scale.setScalar(.7+.3*p)
        crate.scale.setScalar(1-.98*Math.max(0,(p-.5)*2))
        crate.visible=p<.99
        renderer.render(scene,camera)
        if(delivery.current && opening < 1)schedule()
      }
      const lost=(event:Event)=>{event.preventDefault();cancelAnimationFrame(frame);setFailed(true)}
      el.addEventListener('webglcontextlost',lost)
      document.addEventListener('visibilitychange',schedule);schedule()
      dispose=()=>{redraw.current=null;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',schedule);el.removeEventListener('webglcontextlost',lost);const textures=new Set<InstanceType<typeof T.Texture>>();scene.traverse(obj=>{if(obj instanceof T.Mesh||obj instanceof T.LineSegments){obj.geometry.dispose();const materials=Array.isArray(obj.material)?obj.material:[obj.material];materials.forEach(m=>{Object.values(m).forEach(value=>{if(value instanceof T.Texture)textures.add(value)});m.dispose()})}});textures.forEach(t=>t.dispose());renderer.dispose()}
      if(stopped)dispose()
    }).catch(()=>{if(!stopped)setFailed(true)})
    return()=>{stopped=true;dispose()}
  },[giftId,quantity,world,calm,landscape])
  return <div className="gift-preview-scene" aria-hidden="true"><canvas ref={canvas} hidden={failed}/>{failed && <span className="gift-preview-fallback"><GiftIcon id={giftId}/></span>}</div>
}
