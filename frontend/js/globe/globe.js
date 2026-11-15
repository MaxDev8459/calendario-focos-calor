// Holographic fire globe (M20, M23, M24, §4.3). globe.gl + Three.js.
// Text never lives in the canvas (M2): tooltips and markers are HTML overlays positioned from 3D coords.
// AI-assisted code — see README "Use of AI".
import * as THREE from "../../vendor/globe.js";
const { Globe, UnrealBloomPass } = THREE;
import { RAMP, INACTIVE_GREY, VIIRS_BLUE } from "../config.js";
import { state, on, reducedMotion, emit } from "../state.js";

const R = 100; // three-globe radius

// Camera altitude per layout (tuned so the globe radius ≈ 34% of the viewport height in the hero)
const LAYOUTS = {
  hero: { alt: 2.3, x: 0, y: 0.02 },
  story: { alt: 2.25, x: -0.22, y: 0.03 },
  explore: { alt: 1.75, x: 0, y: 0.03 },
  coming: { alt: 2.15, x: 0, y: 0.02 },
  country: { alt: 0.9, x: 0.0, y: 0 },
  page: { alt: 2.6, x: 0.26, y: 0.02 },
};
// Phones: the globe sits lower and further away so titles stay readable over it.
const LAYOUTS_MOBILE = {
  hero: { alt: 2.9, x: 0, y: 0.2 },
  story: { alt: 3.2, x: 0, y: 0.1 },
  explore: { alt: 2.5, x: 0, y: 0.04 },
  coming: { alt: 2.8, x: 0, y: 0 },
  page: { alt: 3.4, x: 0, y: 0.05 },
};
const layoutFor = (name) => (innerWidth < 768 && LAYOUTS_MOBILE[name]) || LAYOUTS[name] || LAYOUTS.hero;

const EMBER_VERT = `
attribute float aSize; attribute float aPhase; attribute float aFlicker; attribute vec3 aColor; attribute float aAlpha;
uniform float uTime; uniform float uPx; uniform float uDay;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float facing = dot(normalize(wp.xyz), normalize(cameraPosition));
  vec4 mv = viewMatrix * wp;
  float fl = 1.0 + aFlicker * 0.15 * sin(uTime * (6.2831 / (2.0 + 2.0 * fract(aPhase * 7.13))) + aPhase * 6.2831);
  vColor = aColor * fl;
  vAlpha = aAlpha * smoothstep(0.02, 0.22, facing);
  gl_PointSize = aSize * uPx * (320.0 / -mv.z) * (uDay > 0.5 ? 0.55 : 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const EMBER_FRAG = `
uniform float uDay;
varying vec3 vColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float a = uDay > 0.5 ? smoothstep(0.5, 0.36, d) : pow(core, 1.6);
  vec3 c = uDay > 0.5 ? vColor : vColor + vec3(0.35, 0.22, 0.08) * pow(core, 6.0);
  gl_FragColor = vec4(c, a * vAlpha);
}`;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function initGlobe(container, world, { onCountryClick, onCountryHover } = {}) {
  const stage = container.parentElement;
  const g = new Globe(container, { animateIn: false, rendererConfig: { antialias: true, alpha: true, powerPreference: "high-performance" } });
  const renderer = g.renderer();
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); // §10 cap DPR at 2

  // --- materials (night / day)
  const nightMat = new THREE.MeshPhongMaterial({ color: 0x9a3a10, emissive: 0x4a1304, emissiveIntensity: 1, transparent: true, opacity: 0.62, shininess: 18, specular: 0x552200 });
  const dayMat = new THREE.MeshPhongMaterial({ color: 0xf2b48c, emissive: 0xe7a77f, emissiveIntensity: 0.55, transparent: true, opacity: 0.72, shininess: 4 });

  let hoverPoly = null;
  const capColor = (d) => {
    const day = state.theme === "day";
    if (d === hoverPoly) return day ? "rgba(194,65,12,0.28)" : "rgba(255,186,8,0.22)";
    if (!d.properties.active) return day ? "rgba(122,91,78,0.08)" : "rgba(80,40,30,0.18)";
    return day ? "rgba(214,120,70,0.16)" : "rgba(255,120,40,0.07)";
  };
  const strokeColor = (d) => {
    const day = state.theme === "day";
    if (day) return d.properties.active ? "rgba(150,60,20,0.85)" : "rgba(150,60,20,0.4)";
    return d.properties.active ? "rgba(255,170,80,0.78)" : "rgba(255,170,80,0.35)";
  };

  g.backgroundColor("rgba(0,0,0,0)")
    .showAtmosphere(true)
    .atmosphereColor("#FF6A1A")
    .atmosphereAltitude(0.2)
    .showGraticules(true)
    .globeMaterial(nightMat)
    .polygonsData(world.features)
    .polygonCapColor(capColor)
    .polygonSideColor(() => "rgba(0,0,0,0)")
    .polygonStrokeColor(strokeColor)
    .polygonAltitude((d) => (d === hoverPoly ? 0.018 : 0.006))
    .polygonsTransitionDuration(reducedMotion ? 0 : 300)
    .polygonLabel(() => null)
    .onPolygonHover((d) => {
      hoverPoly = d;
      g.polygonCapColor(capColor).polygonAltitude((p) => (p === hoverPoly ? 0.018 : 0.006));
      container.style.cursor = d ? "pointer" : "grab";
      onCountryHover?.(d);
    })
    .onPolygonClick((d) => onCountryClick?.(d))
    .onGlobeClick(() => onCountryHover?.(null));

  // lights: warm key light so the glass reads as amber
  const scene = g.scene();
  scene.children.filter((c) => c.isLight).forEach((l) => scene.remove(l));
  scene.add(new THREE.AmbientLight(0xffd2a8, 1.6));
  const key = new THREE.DirectionalLight(0xffb070, 1.4);
  key.position.set(-1, 0.6, 1);
  scene.add(key);

  // --- bloom (night only)
  let bloom = null;
  try {
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.95, 0.55, 0.12);
    g.postProcessingComposer().addPass(bloom);
  } catch (e) { bloom = null; }

  // --- embers (custom points layer)
  const emberMat = new THREE.ShaderMaterial({
    vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uDay: { value: 0 } },
  });
  let embers = null;

  function setHotspots(cells) {
    if (embers) { scene.remove(embers); embers.geometry.dispose(); }
    const n = cells.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), flick = new Float32Array(n), alpha = new Float32Array(n);
    const active = cells.filter((c) => c.active).map((c) => c.conteo).sort((a, b) => a - b);
    const q = (v) => { let lo = 0, hi = active.length; while (lo < hi) { const m = (lo + hi) >> 1; if (active[m] < v) lo = m + 1; else hi = m; } return active.length ? lo / active.length : 0; };
    const grey = hexToRgb(INACTIVE_GREY);
    cells.forEach((c, i) => {
      const p = g.getCoords(c.lat, c.lon, 0.008);
      pos.set([p.x, p.y, p.z], i * 3);
      if (c.active) {
        const t = q(c.conteo);
        const idx = Math.min(RAMP.length - 1, 2 + Math.floor(t * (RAMP.length - 2)));
        col.set(hexToRgb(RAMP[idx]), i * 3);
        size[i] = 1.6 + t * 3.4;
        flick[i] = reducedMotion ? 0 : 1;
        alpha[i] = 0.55 + 0.45 * t;
      } else {
        col.set(grey, i * 3);
        size[i] = 1.5;
        flick[i] = 0;
        alpha[i] = 0.55; // §5.2 grey at 55%
      }
      phase[i] = Math.random();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aFlicker", new THREE.BufferAttribute(flick, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    embers = new THREE.Points(geo, emberMat);
    embers.renderOrder = 5;
    scene.add(embers);
  }

  // --- light arcs between the 8 most active regions (§4.3.2)
  function setArcs(cells) {
    const bins = new Map();
    for (const c of cells) {
      if (!c.active) continue;
      const k = `${Math.round(c.lat / 7)}_${Math.round(c.lon / 7)}`;
      const b = bins.get(k) ?? { lat: 0, lon: 0, w: 0 };
      b.lat += c.lat * c.conteo; b.lon += c.lon * c.conteo; b.w += c.conteo;
      bins.set(k, b);
    }
    const top = [...bins.values()].sort((a, b) => b.w - a.w).slice(0, 8).map((b) => ({ lat: b.lat / b.w, lng: b.lon / b.w }));
    const arcs = top.map((a, i) => ({ s: a, e: top[(i + 3) % top.length] }));
    g.arcsData(reducedMotion ? [] : arcs)
      .arcStartLat((d) => d.s.lat).arcStartLng((d) => d.s.lng).arcEndLat((d) => d.e.lat).arcEndLng((d) => d.e.lng)
      .arcColor(() => (state.theme === "day" ? ["rgba(194,65,12,0.1)", "rgba(194,65,12,0.85)", "rgba(194,65,12,0.1)"] : ["rgba(255,186,8,0.08)", "rgba(255,240,200,1)", "rgba(255,186,8,0.08)"]))
      .arcStroke(0.32).arcAltitudeAutoScale(0.32)
      .arcDashLength(0.28).arcDashGap(1.1).arcDashInitialGap(() => Math.random() * 1.4).arcDashAnimateTime(2800);
  }

  // --- orbital rings (§4.3.3): kept facing the viewer so they read as ellipses
  const ringGroup = new THREE.Group();
  const mkRing = (r, dashed) => {
    const pts = [];
    for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.32, dashSize: 3, gapSize: 4 })
      : new THREE.LineBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.38 });
    const line = new THREE.Line(geo, mat);
    if (dashed) line.computeLineDistances();
    return line;
  };
  const ringA = mkRing(R * 1.52, false);
  const ringB = mkRing(R * 1.74, true);
  const tiltA = new THREE.Group(); tiltA.rotation.set(1.28, 0.22, 0); tiltA.add(ringA);
  const tiltB = new THREE.Group(); tiltB.rotation.set(1.36, -0.16, 0); tiltB.add(ringB);
  ringGroup.add(tiltA, tiltB);
  scene.add(ringGroup);

  // --- "You are here" marker (HTML overlay outside the blended stage)
  const markers = [];
  function addMarker(el, lat, lng) { markers.push({ el, lat, lng }); document.body.append(el); }
  function clearMarkers() { markers.splice(0).forEach((m) => m.el.remove()); g.ringsData([]); }

  // --- controls
  const controls = g.controls();
  controls.enableZoom = false; // wheel is handled by Explore (M23)
  controls.autoRotate = true;
  const BASE_SPEED = (5 / 12) * 2; // OrbitControls: 2.0 ≈ 12°/s at 60 fps → 5°/s
  controls.autoRotateSpeed = reducedMotion ? BASE_SPEED * 0.2 : BASE_SPEED;
  controls.rotateSpeed = 0.6;
  controls.minDistance = R * 1.25;
  controls.maxDistance = R * 5;
  let resumeTimer = 0;
  let autoAllowed = true;
  const pauseRotation = () => { controls.autoRotate = false; clearTimeout(resumeTimer); resumeTimer = setTimeout(() => (controls.autoRotate = autoAllowed), 3000); };
  container.addEventListener("pointermove", pauseRotation);
  container.addEventListener("pointerdown", pauseRotation);

  // --- frame loop for uniforms, rings and overlays
  let t0 = performance.now();
  const tmp = new THREE.Vector3();
  const loop = () => {
    requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    emberMat.uniforms.uTime.value = t;
    const cam = g.camera();
    ringGroup.quaternion.copy(cam.quaternion);
    if (!reducedMotion) { ringA.rotation.z = t * 0.05; ringB.rotation.z = -t * 0.035; }
    if (markers.length) {
      const rect = container.getBoundingClientRect();
      for (const m of markers) {
        const c = g.getCoords(m.lat, m.lng, 0.01);
        tmp.set(c.x, c.y, c.z);
        const facing = tmp.clone().normalize().dot(cam.position.clone().normalize());
        const s = g.getScreenCoords(m.lat, m.lng, 0.01);
        m.el.style.transform = `translate(${rect.left + s.x}px, ${rect.top + s.y}px)`;
        m.el.style.opacity = facing > 0.15 ? "1" : "0";
      }
    }
  };
  loop();

  // --- theme
  const applyTheme = () => {
    const day = state.theme === "day";
    g.globeMaterial(day ? dayMat : nightMat);
    g.atmosphereColor(day ? "#F48C06" : "#FF6A1A").atmosphereAltitude(day ? 0.14 : 0.2);
    g.polygonCapColor(capColor).polygonStrokeColor(strokeColor);
    emberMat.uniforms.uDay.value = day ? 1 : 0;
    emberMat.blending = day ? THREE.NormalBlending : THREE.AdditiveBlending;
    emberMat.needsUpdate = true;
    if (bloom) bloom.enabled = !day;
    g.backgroundColor(day ? "rgba(0,0,0,0)" : "#000000");
    ringA.material.color.set(day ? 0xb4501c : 0xff8a2a);
    ringB.material.color.set(day ? 0xb4501c : 0xff9a3c);
    stage.classList.toggle("is-day", day);
    if (g.arcsData().length) g.arcColor(g.arcColor());
  };
  on("theme", applyTheme);
  applyTheme();

  // --- size
  const resize = () => { g.width(innerWidth).height(innerHeight); bloom?.setSize(innerWidth, innerHeight); };
  addEventListener("resize", resize);
  resize();

  // --- visibility (§10: pause when hidden)
  let paused = false;
  document.addEventListener("visibilitychange", () => { if (document.hidden) g.pauseAnimation(); else if (!paused) g.resumeAnimation(); });

  let layout = "hero";
  const api = {
    g,
    get layout() { return layout; },
    setHotspots,
    setArcs,
    pov: (lat, lng, alt, ms = 1400) => g.pointOfView({ lat, lng, altitude: alt ?? g.pointOfView().altitude }, reducedMotion ? 0 : ms),
    getPov: () => g.pointOfView(),
    rotateBy(dLng, dLat = 0) {
      const p = g.pointOfView();
      g.pointOfView({ lat: Math.max(-70, Math.min(70, p.lat + dLat)), lng: p.lng + dLng, altitude: p.altitude }, 0);
      pauseRotation();
    },
    zoomBy(f) { const p = g.pointOfView(); g.pointOfView({ ...p, altitude: Math.max(0.6, Math.min(4, p.altitude * f)) }, reducedMotion ? 0 : 500); },
    setLayout(name, { ms = 1100, keepPov = false } = {}) {
      layout = name;
      const L = layoutFor(name);
      stage.dataset.layout = name;
      stage.style.setProperty("--gx", `${L.x * 100}vw`);
      stage.style.setProperty("--gy", `${L.y * 100}vh`);
      if (!keepPov) { const p = g.pointOfView(); g.pointOfView({ lat: p.lat, lng: p.lng, altitude: L.alt }, reducedMotion ? 0 : ms); }
    },
    setInteractive(on) { stage.classList.toggle("is-interactive", on); },
    setAutoRotate(on) { autoAllowed = on; controls.autoRotate = on; },
    youAreHere(lat, lng, label) {
      clearMarkers();
      g.ringsData([{ lat, lng }]).ringColor(() => (t) => `rgba(124,198,255,${1 - t})`).ringMaxRadius(4.5).ringPropagationSpeed(2.2).ringRepeatPeriod(reducedMotion ? 0 : 1100).ringAltitude(0.012);
      const el = document.createElement("div");
      el.className = "you-are-here";
      el.innerHTML = `<span class="yah-dot" aria-hidden="true"></span><span class="yah-label"></span>`;
      el.querySelector(".yah-label").textContent = label;
      el.style.setProperty("--viirs", VIIRS_BLUE);
      addMarker(el, lat, lng);
    },
    clearMarkers,
    pause() { paused = true; g.pauseAnimation(); },
    resume() { paused = false; g.resumeAnimation(); },
  };
  return api;
}
