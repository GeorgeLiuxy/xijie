// The reference plate establishes the optics. Only the mouth and its immediate
// surroundings refract; the distant star field stays stable when the ship banks.
const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = vec2(position.x, -position.y) * .5 + .5;
  gl_Position = vec4(position, 0., 1.);
}`

const fragmentSource = `
precision highp float;
varying vec2 uv;
uniform sampler2D sky;
uniform sampler2D beyond;
uniform vec2 aspect;  // plate width / height
uniform float frameAspect;
uniform float t;
uniform float bank;
uniform float convoy;
vec2 cover(float a) {
  return vec2(min(1.,frameAspect/a),min(1.,a/frameAspect));
}
void main() {
  float approach = smoothstep(.12,.80,t);
  float closeUp = smoothstep(.66,.95,t);
  float magnification = 1.02 + .62*approach + 5.5*closeUp*closeUp;
  vec2 lens = vec2(.5,.45);
  vec2 axis = vec2(.5-bank*.023, .42+.045*approach);
  vec2 loc = (uv-axis)*cover(aspect.x)/magnification + lens;
  // A co-ordinated opening starts as a small optical anomaly, then expands locally.
  vec2 initial = loc-lens;
  float dist = length(initial*vec2(1.,1./aspect.x));
  loc += initial * convoy * (1.-smoothstep(.025,.36,t)) *
    (1.-smoothstep(.10,.37,dist)) * .95;
  vec2 offset = (loc-lens)*vec2(1.,1./aspect.x);
  float r = length(offset);
  vec2 direction = offset/max(.001,r);
  float mouth = .046 + .091*closeUp;
  float rim = exp(-abs(r-mouth)*33.) * smoothstep(.04,.55,t);
  vec2 displaced = loc + direction*vec2(1.,aspect.x)*rim*
    (.007+.012*closeUp+.0015*sin(atan(offset.y,offset.x)*6.+t*8.));
  vec3 light = texture2D(sky,clamp(displaced,0.,1.)).rgb;
  // The exit opens above the receiving world. Fit the whole planetary disc
  // even in a portrait viewport so the first view cannot read as a ground port.
  vec2 fit = vec2(max(1.,frameAspect/aspect.y), max(1.,aspect.y/frameAspect));
  vec2 exitUV = vec2(.5) + (uv-vec2(.5))*fit/.78 +
    direction*.04*(1.-smoothstep(.78,.99,t));
  exitUV.x += bank*.014*(1.-smoothstep(.83,1.,t));
  vec3 destination = texture2D(beyond,clamp(exitUV,0.,1.)).rgb;
  if(any(lessThan(exitUV,vec2(0.))) || any(greaterThan(exitUV,vec2(1.)))) destination = vec3(0.);
  float inside = (1.-smoothstep(mouth*.80,mouth,r))*smoothstep(.55,.91,t);
  inside = max(inside,smoothstep(.84,.985,t));
  vec3 color = mix(light,destination,inside);
  color += vec3(.12,.084,.039)*rim*(1.-inside)*closeUp;
  gl_FragColor=vec4(color,1.);
}`

/** A photographic CSS background remains visible if GPU or texture loading fails. */
export function createPassage(
  canvas: HTMLCanvasElement,
  skyUrl: string,
  exitUrl: string,
  convoy: boolean,
) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  })
  if (!gl) return
  const shaders: WebGLShader[] = []
  const textures: WebGLTexture[] = []
  const program = gl.createProgram(),
    buffer = gl.createBuffer()
  let disposed = false,
    ready = 0,
    lost = false
  const aspects = [1, 1]
  function contextLost() {
    lost = true
    canvas.style.opacity = "0"
  }
  canvas.addEventListener("webglcontextlost", contextLost)
  function dispose() {
    disposed = true
    canvas.removeEventListener("webglcontextlost", contextLost)
    canvas.style.opacity = "0"
    textures.forEach((tex) => gl!.deleteTexture(tex))
    shaders.forEach((shader) => gl!.deleteShader(shader))
    gl!.deleteBuffer(buffer)
    gl!.deleteProgram(program)
  }
  if (!program || !buffer) {
    dispose()
    return
  }
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type)
    if (!shader) {
      dispose()
      return
    }
    shaders.push(shader)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose()
    return
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  )
  const pos = gl.getAttribLocation(program, "position")
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
  const at = (key: string) => gl.getUniformLocation(program, key)
  const time = at("t"),
    steering = at("bank"),
    frameAspect = at("frameAspect"),
    aspect = at("aspect")
  gl.uniform1i(at("sky"), 0)
  gl.uniform1i(at("beyond"), 1)
  gl.uniform1f(at("convoy"), convoy ? 1 : 0)
  ;[skyUrl, exitUrl].forEach((url, unit) => {
    const texture = gl.createTexture()
    if (!texture) return
    textures.push(texture)
    const img = new Image()
    img.onload = () => {
      if (disposed || lost) return
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
      aspects[unit] = img.naturalWidth / img.naturalHeight
      ready++
    }
    img.src = url
  })
  return {
    resize(width: number, height: number) {
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        1.35,
        900 / Math.max(1, height),
      )
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      gl.viewport(0, 0, canvas.width, canvas.height)
    },
    draw(progress: number, bank: number) {
      if (ready !== 2 || lost) return
      gl.uniform2f(aspect, aspects[0], aspects[1])
      gl.uniform1f(frameAspect, canvas.width / canvas.height)
      gl.uniform1f(time, progress)
      gl.uniform1f(steering, bank)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (canvas.style.opacity !== "1") canvas.style.opacity = "1"
    },
    dispose,
  }
}
