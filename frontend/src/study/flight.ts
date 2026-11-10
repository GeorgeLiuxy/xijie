import type { WorldId } from '../i18n'
import { routes, type Route, type Images } from './journeys'

const unit = (x: number) => Math.max(0, Math.min(1, x))
function step(a: number, b: number, t: number) { const v = unit((t-a)/(b-a)); return v*v*(3-2*v) }
const mix = (a: number,b: number,p: number) => a+(b-a)*p
const tau = Math.PI*2
type Ctx = CanvasRenderingContext2D
function cover(c: Ctx, img: Images['arrival'], w: number,h: number, zoom=1, u=.5,v=.5) {
  const s = Math.max(w/img.width,h/img.height)*zoom
  c.drawImage(img,w*.5-img.width*s*u,h*.5-img.height*s*v,img.width*s,img.height*s)
}
function glow(c: Ctx,x: number,y: number,r: number, rgb: string, a: number) {
  if (r < .1 || a <= 0) return
  const g=c.createRadialGradient(x,y,0,x,y,r)
  g.addColorStop(0,`rgba(${rgb},${a})`);g.addColorStop(.19,`rgba(${rgb},${a*.42})`);g.addColorStop(1,`rgba(${rgb},0)`)
  c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2)
}
function bracket(c: Ctx,x: number,y: number,r: number,alpha: number) {
  if (alpha<=0) return
  c.save(); c.translate(x,y); c.strokeStyle=`rgba(251,226,183,${alpha})`; c.lineWidth=1.25
  for(let i=0;i<4;i++) { c.beginPath();c.moveTo(-r,-r+6);c.lineTo(-r,-r);c.lineTo(-r+6,-r);c.stroke();c.rotate(Math.PI/2) }
  c.restore()
}
function randomField(seed: number) {
  let n=seed
  const rand=() => {n=n*16807%2147483647;return n/2147483647}
  return Array.from({length:390},()=>({x:(rand()-.5)*3.6,y:(rand()-.5)*4.7,z:rand()*2.5,l:.35+rand()*.65}))
}
const stars=[randomField(701),randomField(3059),randomField(9631),randomField(8041)]
function movingStars(c: Ctx,w: number,h: number,t: number,seed: number, bend: number, intensity: number) {
  const travel=.16*t+.18*Math.sin(t*.7)
  for(const s of stars[seed]) {
    const z=.12+((s.z-travel)%2.5+2.5)%2.5
    const x=(s.x+bend*z*.36)*w/z, y=s.y*w/z
    const px=w*.5+x,py=h*.48+y
    if(px < -4 || px>w+4 || py < -4 || py>h+4) continue
    c.strokeStyle=`rgba(220,231,228,${intensity*s.l*Math.min(1,1.18/z)})`
    c.lineWidth=Math.min(2.5,.43+.47/z)
    c.beginPath();c.moveTo(px,py);c.lineTo(px-x*.005/z,py-y*.005/z+.55);c.stroke()
  }
}
function drawGalaxy(c: Ctx,img: HTMLImageElement,x: number,y: number,size: number,angle: number,alpha=1) {
  c.save();c.globalCompositeOperation='screen';c.globalAlpha*=alpha
  c.translate(x,y);c.rotate(angle);c.drawImage(img,-size/2,-size/2,size,size);c.restore()
}

// Stars in the second universe are only visible through the curved boundary until the eye crosses it.
function sky(c: Ctx,images: Images,route: Route,w: number,h: number,t: number,matching: boolean,bearing: number) {
  const skyLight=c.createLinearGradient(0,0,w*.35,h)
  skyLight.addColorStop(0,matching?'#17374c':'#293548')
  skyLight.addColorStop(.56,matching?'#174754':'#334857')
  skyLight.addColorStop(1,matching?'#102b3d':'#1a3043')
  c.fillStyle=skyLight;c.fillRect(0,0,w,h)
  const pan = step(6.2,8.4,t)
  const approach=step(7.3,11.25,t)
  const size=w*.79*Math.exp(4.15*approach)
  const angle=(route.index-1)*.16 + bearing*.12
  const dx=(route.arm[0]-.5)*Math.cos(angle)-(route.arm[1]-.5)*Math.sin(angle)
  const dy=(route.arm[0]-.5)*Math.sin(angle)+(route.arm[1]-.5)*Math.cos(angle)
  const steer=step(8.3,10.65,t)
  const x=w*(.68-.18*pan + bearing*.09*(1-pan))-size*dx*steer,y=h*.45-size*dy*steer
  glow(c,w*.22,h*.42,w*.71,matching?'106,174,172':'148,137,172',.48)
  if(matching) {
    drawGalaxy(c,images.galaxy,x,y,size,angle)
    bracket(c,x+size*dx,y+size*dy,15,.75*step(8.3,8.65,t)*(1-step(9.85,10.4,t)))
  } else {
    drawGalaxy(c,images.decoy,w*(.29-.43*step(4.2,7.4,t)),h*.34,w*.53,-.67,.93)
    drawGalaxy(c,images.decoy,w*(.89+.22*step(4,7,t)),h*.68,w*.29,1.06,.49)
    bracket(c,w*(.29-.43*step(4.2,7.4,t)),h*.34,19,.77*step(4.55,5.1,t)*(1-step(5.7,6.2,t)))
  }
  movingStars(c,w,h,t,matching?route.index+1:0,matching?.25*(1-pan):-.25,1)
}
// The tracked stars only become visible where the local law opens the boundary.
function crossBoundary(c: Ctx, images: Images, route: Route, w: number, h: number, t: number, bearing: number) {
  const p = step(5.4, 7.55, t)
  const gate = new Path2D()
  if (route.id === 'courtyard') {
    const radius = w*.08*Math.exp(3.65*step(6.18,7.55,t))
    const x = w*mix(.63 + bearing*.08,.5,p), y = h*mix(.41,.48,p)
    const separation = w*.29*(1-step(5.4,6.55,t))
    for (const side of [-1,1]) {
      const sx=x+side*separation*.5
      glow(c,sx,y,radius*1.35,'250,207,137',.48*(1-p))
      c.fillStyle=`rgba(255,225,161,${.8*(1-p)})`
      c.beginPath();c.arc(sx,y,radius,0,tau);c.fill()
    }
    if (separation >= 2*radius) return
    gate.arc(x-separation*.5,y,radius,0,tau)
    c.save();c.beginPath();c.arc(x+separation*.5,y,radius,0,tau);c.clip()
    c.clip(gate);sky(c,images,route,w,h,t,true,bearing);c.restore()
    return
  }
  if (route.id === 'tide') {
    const y = mix(h*1.06,-h*.09,p)
    for(let i=0;i<=60;i++) {
      const u=i/60
      const ripple = Math.sin(u*8+t*2)*h*.022 + Math.sin(u*17-t)*h*.006
      if(i===0) gate.moveTo(0,y+ripple); else gate.lineTo(w*u,y+ripple)
    }
    c.save();c.strokeStyle='rgba(193,222,215,.84)';c.lineWidth=2;c.stroke(gate);c.restore()
    gate.lineTo(w,h+8);gate.lineTo(-2,h+8);gate.closePath()
    c.save();c.clip(gate);sky(c,images,route,w,h,t,true,bearing)
    const sheen=c.createLinearGradient(0,y-8,0,y+h*.12)
    sheen.addColorStop(0,'rgba(185,221,211,.35)');sheen.addColorStop(1,'rgba(110,176,176,0)')
    c.fillStyle=sheen;c.fillRect(0,y-h*.03,w,h*.16);c.restore()
    return
  }
  const seam=w*(.54 + bearing*.08)
  const radius=(w+h)*(.015+1.12*p*p), lean=h*.34
  gate.moveTo(seam-lean-radius,0);gate.lineTo(seam-lean+radius,0)
  gate.lineTo(seam+lean+radius,h);gate.lineTo(seam+lean-radius,h);gate.closePath()
  c.save();c.clip(gate);sky(c,images,route,w,h,t,true,bearing)
  for (const side of [-1,1]) {
    c.save();c.beginPath()
    const edge=seam+side*radius, width=side*Math.min(14,radius)
    c.moveTo(edge-lean,0);c.lineTo(edge-lean-width,0);c.lineTo(edge+lean-width,h);c.lineTo(edge+lean,h);c.closePath();c.clip()
    c.translate(side*11*(1-p),-5*(1-p));sky(c,images,route,w,h,t,true,bearing);c.restore()
  }
  c.restore()
  c.strokeStyle='rgba(211,203,231,.72)';c.lineWidth=1;c.stroke(gate)
}
function space(c: Ctx,images: Images,route: Route,w: number,h: number,t: number,bearing: number) {
  if(t<7.55) {
    sky(c,images,route,w,h,t,false,bearing)
    crossBoundary(c,images,route,w,h,t,bearing)
  } else if(t<11.6) sky(c,images,route,w,h,t,true,bearing)
  if(t>=9.95 && t<16.35) {
    const opacity=step(9.95,11.05,t),zoom=1+2.3*step(10.3,13.7,t)
    c.save();c.globalAlpha=opacity;cover(c,images.nebula,w,h,zoom,mix(.5,route.star[0],step(10.3,12,t)),mix(.5,route.star[1],step(10.3,12,t)))
    movingStars(c,w,h,t*1.9,route.index+1,-.07,.65)
    c.fillStyle=`rgba(19,53,70,${.53*step(11.55,13.5,t)})`;c.fillRect(0,0,w,h);c.restore()
    const sunX=w*mix(.5,-.3,step(11.75,14.2,t)),sunY=h*.5
    const sunR=w*mix(.003,.14,step(11.1,14.3,t))
    glow(c,sunX,sunY,sunR*5,'255,212,140',step(10.5,12,t)*.75)
    if (route.id === 'courtyard') {
      const companion=sunX+sunR*2.5+w*.04
      glow(c,companion,sunY-h*.045,Math.max(1,sunR*2.4),'255,205,118',.78)
      c.fillStyle='#ffe9ae';c.beginPath();c.arc(companion,sunY-h*.045,Math.max(.4,sunR*.42),0,tau);c.fill()
    }
    c.fillStyle=`rgba(255,239,196,${step(10.9,12,t)})`;c.beginPath();c.arc(sunX,sunY,sunR,0,tau);c.fill()
  }
  if(t>=11.7 && t<16.4) {
    const approach=step(11.7,13.95,t),dive=step(13.65,16.35,t)
    const size=w*.018*Math.exp(4.15*approach+3.4*dive)
    const u=mix(.5,route.coast[0],step(13.75,15.55,t)),v=mix(.5,route.coast[1],step(13.75,15.55,t))
    const left=w*mix(.72,.5,approach)-size*u,top=h*mix(.49,.48,approach)-size*v
    c.save();c.beginPath();c.arc(left+size*.492,top+size*.495,size*(route.id === 'tide' ? .425 : .394),0,tau);c.clip()
    c.drawImage(images.planet,left,top,size,size);c.restore()
    bracket(c,left+size*route.coast[0],top+size*route.coast[1],13,.8*step(13.5,13.9,t)*(1-step(15,15.5,t)))
  }
}

// The camera moves along the floor towards a photographed doorway. Horizontal strips
// below the back wall have shorter depth, so the tabletop and floor slip past before the jamb.
function doorway(c: Ctx,img: HTMLImageElement,w: number,h: number,p: number,reversedWater: boolean,t: number,outerScale=1) {
  if(p>=.955) return
  const sourceW=img.width,sourceH=img.height
  const baseW=Math.max(w,h*sourceW/sourceH)*outerScale,baseH=baseW*sourceH/sourceW
  const door=reversedWater?{l:.498,r:.723,top:.355,bottom:.705}:{l:.500,r:.722,top:.317,bottom:.670}
  const dx=(door.l+door.r)*.5,dy=(door.top+door.bottom)*.5
  const s=1/(1-p)
  const turn=step(0,.65,p)
  const camX=mix(.5,dx,turn)+.021*Math.sin(p*Math.PI*1.5)*(1-turn)
  const camY=mix(.5,dy,turn)
  const x=w*.5-camX*baseW*s, y=h*.5-camY*baseH*s
  c.save();c.translate(w*.5,h*.5);c.rotate((reversedWater?-.062:.023)*Math.sin(p*Math.PI));c.translate(-w*.5,-h*.5)
  const hole=new Path2D();hole.rect(x,y,baseW*s,baseH*s)
  hole.rect(x+door.l*baseW*s,y+door.top*baseH*s,(door.r-door.l)*baseW*s,(door.bottom-door.top)*baseH*s)
  c.clip(hole,'evenodd')
  c.drawImage(img,x,y,baseW*s,baseH*s)
  if(p>.001) {
    const floor=reversedWater?.727:.698, horizon=.50
    const project=(v:number) => {
      const depth=(floor-horizon)/(v-horizon)
      const mag=1/Math.max(.025,1-p/depth)
      return { y:h*.5+(v-camY)*baseH*mag, x:w*.5-camX*baseW*mag, width:baseW*mag }
    }
    for(let i=0;i<52;i++) {
      const v=floor+(1-floor)*i/52,next=floor+(1-floor)*(i+1)/52
      const a=project(v),b=project(next)
      if(a.y>h+16) break
      c.drawImage(img,0,v*sourceH,sourceW,(next-v)*sourceH,a.x,a.y,a.width,Math.max(1,b.y-a.y+1))
    }
  }
  if(reversedWater) {
    // Small highlights run upstream into the overturned cup.
    for(let i=0;i<8;i++){
      const f=((t*.43+i/8)%1+1)%1
      const gx=x+baseW*s*(.281+.014*Math.sin(f*6.2)),gy=y+baseH*s*(.79-.55*f)
      glow(c,gx,gy,Math.max(1,baseW*s*.005),'255,222,157',.7*Math.sin(f*Math.PI))
    }
  }
  c.restore()
}

type Aim = readonly [number, number]

function frame(img: HTMLImageElement,w: number,h: number,zoom: number,aim: Aim,at: Aim=[.5,.5]) {
  const scale = Math.max(w/img.width,h/img.height)*zoom
  const width=img.width*scale,height=img.height*scale
  const x=Math.max(w-width,Math.min(0,w*at[0]-width*aim[0]))
  const y=Math.max(h-height,Math.min(0,h*at[1]-height*aim[1]))
  return {x,y,width,height}
}
function shot(c: Ctx,img: HTMLImageElement,w: number,h: number,zoom: number,aim: Aim,at?: Aim) {
  const box=frame(img,w,h,zoom,aim,at)
  c.drawImage(img,box.x,box.y,box.width,box.height)
  return box
}

// Feather the actual atmospheric boundary rather than dissolving the whole viewport at once.
const terrainBuffers=new WeakMap<Ctx,HTMLCanvasElement>()
function passTerrain(c: Ctx,w: number,h: number,p: number,route: Route,at: Aim,paint: (layer: Ctx)=>void) {
  if(p<=0) return
  if(p>=1) { paint(c); return }
  let buffer=terrainBuffers.get(c)
  if(!buffer) { buffer=document.createElement('canvas');terrainBuffers.set(c,buffer) }
  if(buffer.width!==c.canvas.width || buffer.height!==c.canvas.height) {
    buffer.width=c.canvas.width;buffer.height=c.canvas.height
  }
  const layer=buffer.getContext('2d')
  if(!layer) { c.save();c.globalAlpha=p;paint(c);c.restore();return }
  layer.save();layer.setTransform(buffer.width/w,0,0,buffer.height/h,0,0)
  layer.clearRect(0,0,w,h);paint(layer)
  let mask: CanvasGradient
  if(route.id==='tide') {
    const radius=Math.max(1,p*Math.hypot(w,h)*1.18)
    mask=layer.createRadialGradient(at[0],at[1],radius*.67,at[0],at[1],radius)
    mask.addColorStop(0,'#fff');mask.addColorStop(1,'transparent')
  } else if(route.id==='courtyard') {
    const edge=mix(w+h*.45,-w*.36,p)
    mask=layer.createLinearGradient(edge,0,edge+w*.26,h*.10)
    mask.addColorStop(0,'transparent');mask.addColorStop(1,'#fff')
  } else {
    const edge=mix(h*1.26,-h*.27,p)
    mask=layer.createLinearGradient(0,edge,w*.11,edge+h*.22)
    mask.addColorStop(0,'transparent');mask.addColorStop(1,'#fff')
  }
  layer.globalCompositeOperation='destination-in';layer.fillStyle=mask;layer.fillRect(0,0,w,h);layer.restore()
  c.drawImage(buffer,0,0,w,h)
}

// Place the same destination behind both photographed apertures. Its projected size
// grows with the opening until the arriving viewer and the final still share a frame.
function throughOpening(c: Ctx,img: Images['arrival'],w: number,h: number,cx: number,cy: number,
  rx: number,ry: number,round: boolean) {
  const opening=new Path2D()
  if (round) opening.ellipse(cx,cy,rx,ry,0,0,tau)
  else {
    opening.moveTo(cx-rx*.98,cy-ry);opening.lineTo(cx+rx*.98,cy-ry)
    opening.lineTo(cx+rx,cy+ry);opening.lineTo(cx-rx,cy+ry);opening.closePath()
  }
  const full=Math.max(w/img.width,h/img.height)
  const scale=Math.min(full,Math.max(2*rx/img.width,2*ry/img.height)*1.08)
  const settled=step(.78,1,scale/full)
  const px=mix(cx,w*.5,settled),py=mix(cy,h*.5,settled)
  c.save();c.clip(opening)
  const width=img.width*scale,height=img.height*scale
  c.drawImage(img,px-width*.5,py-height*.5,width,height)
  c.restore()
}

function land(c: Ctx,images: Images,r: Route,w: number,h: number,t: number,bearing: number) {
  // Terrain, structure, threshold and portrait are registered to the same physical landmark.
  const air=step(14.7,15.95,t), fly=step(15.15,17.55,t)
  const aerial=frame(images.air,w,h,1+fly*1.9,[mix(.5,r.airTarget[0],fly),mix(.5,r.airTarget[1],fly)])
  if (t<17.52) {
    c.save();c.globalAlpha=air
    c.drawImage(images.air,aerial.x,aerial.y,aerial.width,aerial.height)
    c.restore()
  }
  if (t<16.45) return

  const settle=step(16.45,17.52,t), track=step(16.92,19.45,t)
  const [farX,farY,farWidth,farHeight]=r.far
  const [nearX,nearY,nearWidth,nearHeight]=r.opening
  const matchZoom=nearWidth/farWidth
  const sway=r.id==='tide' ? .016*Math.sin(t*2.2) : .012*bearing
  const closeFrame=frame(images.close,w,h,1,[nearX,nearY])
  const anchorX=(closeFrame.x+nearX*closeFrame.width)/w, anchorY=(closeFrame.y+nearY*closeFrame.height)/h
  if(t<19.48) passTerrain(c,w,h,settle,r,[aerial.x+r.airTarget[0]*aerial.width,aerial.y+r.airTarget[1]*aerial.height],layer=>{
    const wide=shot(layer,images.land,w,h,mix(1,matchZoom,track),
      [mix(.5,farX,track)+sway*(1-track),mix(.5,farY,track)], [mix(.5,anchorX,track),mix(.5,anchorY,track)])
    throughOpening(layer,images.arrival,w,h,wide.x+farX*wide.width,wide.y+farY*wide.height,
      farWidth*wide.width/2,farHeight*wide.height/2,r.id==='courtyard')
    bracket(layer,wide.x+farX*wide.width,wide.y+farY*wide.height,16,.8*step(17.2,17.6,t)*(1-step(18.05,18.6,t)))
  })
  if(t<18.68) return

  // Match the apparent width before changing lenses. The near jamb stays in front of the person.
  const cut=step(18.68,19.48,t),through=step(19.42,22.03,t)
  const zoom=1/(1-.92*through)
  c.save();c.globalAlpha=cut
  const near=shot(c,images.close,w,h,zoom,[nearX,nearY])
  const cx=near.x+nearX*near.width,cy=near.y+nearY*near.height
  const rx=near.width*nearWidth/2,ry=near.height*nearHeight/2
  throughOpening(c,images.arrival,w,h,cx,cy,rx,ry,r.id==='courtyard')
  c.restore()
}

export function drawFrame(c: Ctx,images: Images,w: number,h: number,t: number,id: WorldId,bearing=0) {
  const route=routes[id]
  c.fillStyle='#091619';c.fillRect(0,0,w,h)
  if(t>=22.03) { cover(c,images.arrival,w,h);return }
  if(t<15.95 && t>.12) space(c,images,route,w,h,t,bearing)
  if(t<5.3) {
    const a=step(.12,2.75,t)*.96,b=step(3.26,5.3,t)*.96
    doorway(c,images.gravity,w,h,b,id==='tide',t,.68+.32*step(0,2.65,t))
    doorway(c,images.room,w,h,a,false,t)
    if(t<.64) {c.save();c.globalAlpha=1-step(.12,.64,t);cover(c,images.room,w,h);c.restore()}
  }
  if(t>=14.7) land(c,images,route,w,h,t,bearing)
}
