// Heat-wave background (M20, §4.3.6): slow domain-warped noise in fire colours, rendered at low
// resolution and scaled up by CSS. Opacity is driven by the current section (M22).
// AI-assisted code — see README "Use of AI".
import { state, on, reducedMotion } from "../state.js";

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDay;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(uRes.x/uRes.y, 1.0) * 1.6;
  float t = uTime * 0.035; // ~ one slow cycle every 25 s
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t*0.8)));
  vec2 r = vec2(fbm(p + 3.0*q + vec2(1.7, 9.2) + t*0.6), fbm(p + 3.0*q + vec2(8.3, 2.8) - t*0.5));
  float f = fbm(p + 3.2*r);
  // fire palette
  vec3 c0 = vec3(0.012, 0.027, 0.118);   // #03071E
  vec3 c1 = vec3(0.38, 0.03, 0.04);      // deep red
  vec3 c2 = vec3(0.80, 0.25, 0.02);      // ember orange
  vec3 c3 = vec3(0.98, 0.55, 0.10);      // flame
  vec3 col = mix(c0, c1, smoothstep(0.25, 0.6, f));
  col = mix(col, c2, smoothstep(0.5, 0.82, f) * 0.85);
  col = mix(col, c3, smoothstep(0.72, 0.95, f) * 0.55);
  // vignette toward the right/bottom so text stays legible
  float v = smoothstep(1.25, 0.15, length((uv - vec2(0.32, 0.62)) * vec2(1.1, 1.3)));
  col = mix(c0, col, v);
  if (uDay > 0.5) {
    vec3 s0 = vec3(0.961, 0.925, 0.882);  // #F5ECE1
    vec3 s1 = vec3(0.97, 0.78, 0.62);
    vec3 s2 = vec3(0.98, 0.62, 0.38);
    vec3 d = mix(s0, s1, smoothstep(0.35, 0.7, f) * v);
    d = mix(d, s2, smoothstep(0.62, 0.95, f) * v * 0.55);
    col = d;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

export function initWaves(canvas) {
  const SCALE = 0.18; // render at 18% resolution — it is blurry by design
  let gl = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" }); } catch { gl = null; }
  if (!gl || reducedMotion) {
    canvas.classList.add("waves-fallback");
    return { setOpacity: (o) => (canvas.style.opacity = o), pause() {}, resume() {} };
  }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uDay = gl.getUniformLocation(prog, "uDay");

  const resize = () => {
    canvas.width = Math.max(64, Math.round(innerWidth * SCALE));
    canvas.height = Math.max(64, Math.round(innerHeight * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener("resize", resize);
  resize();

  let running = true, raf = 0, t0 = performance.now(), last = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // ~30 fps is plenty for a slow fluid
    last = now;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) / 1000 + 40);
    gl.uniform1f(uDay, state.theme === "day" ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  raf = requestAnimationFrame(frame);
  const api = {
    setOpacity: (o) => (canvas.style.opacity = o),
    pause() { if (running) { cancelAnimationFrame(raf); running = false; } },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? api.pause() : api.resume()));
  on("theme", () => {});
  return api;
}
