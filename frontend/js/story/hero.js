// Hero + intro sequence (M20, §4.4): frame lights, hologram draws itself, title reveals word by word.
// AI-assisted code — see README "Use of AI".
import { geoOrthographic, geoPath } from "../../vendor/geo.js";
import { T } from "../i18n/en.js";
import { icons } from "../ui/icons.js";
import { reducedMotion } from "../state.js";

export function renderHero(el) {
  const words = T.siteName.split(" ");
  const first = words.shift();
  const rest = words.join(" ") || T.hero.word2;
  el.innerHTML = `
    <div class="hero-inner">
      <h1 id="hero-title" class="hero-title">
        <span class="w w1">${first}</span>
        <span class="w w2"><em>${rest}</em><span class="sparkle" aria-hidden="true">${icons.sparkle}</span></span>
      </h1>
      <p class="tagline mono">${T.hero.tagline}</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#story-1" data-enter>${T.hero.enter}</a>
        <button type="button" class="btn btn-ghost" data-watch>${icons.play}<span>${T.hero.watch}</span></button>
      </div>
    </div>
    <p class="hero-credit mono">${T.hero.credit}</p>
    <a class="hero-scroll mono" href="#story-1">${T.hero.scroll}${icons.arrowDown}</a>
    <div class="beam" aria-hidden="true"></div>`;
}

// Draw the land outlines as an SVG hologram over the globe position, then hand over to WebGL.
export function playIntro({ world, globe, svg, onArcs }) {
  const root = document.documentElement;
  root.classList.remove("intro-0", "intro-1", "intro-2", "intro-done");
  void root.offsetWidth;
  const canvas = globe.canvas;
  if (reducedMotion) {
    root.classList.add("intro-done");
    canvas.style.opacity = "1";
    onArcs?.();
    return Promise.resolve();
  }
  root.classList.add("intro-0");
  canvas.style.transition = "none";
  canvas.style.opacity = "0";

  return globe.ready.then(() => {
    // match the live globe: same centre, radius and rotation as the MapLibre camera
    const pov = globe.getPov();
    const r = globe.radiusPx();
    const [cx, cy] = globe.centerPx();
    const W = innerWidth, H = innerHeight;
    const proj = geoOrthographic().scale(r).translate([cx, cy]).rotate([-pov.lng, -pov.lat]).clipAngle(90);
    const path = geoPath(proj);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const paths = world.features
      .map((f) => path(f))
      .filter(Boolean)
      .map((dd, i) => `<path d="${dd}" style="--i:${i % 24}" pathLength="1"/>`)
      .join("");
    svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" pathLength="1" class="holo-rim"/>${paths}`;
    svg.classList.add("is-drawing");
    globe.setAutoRotate(false); // hold still while the hologram matches the globe
    return new Promise((resolve) => {
      setTimeout(() => { canvas.style.transition = "opacity 0.9s cubic-bezier(.16,1,.3,1)"; canvas.style.opacity = "1"; svg.classList.add("is-fading"); }, 900);
      setTimeout(() => root.classList.replace("intro-0", "intro-1"), 1000);
      setTimeout(() => { root.classList.replace("intro-1", "intro-2"); onArcs?.(); globe.setAutoRotate(true); }, 1800);
      setTimeout(() => { svg.classList.remove("is-drawing", "is-fading"); svg.innerHTML = ""; root.classList.replace("intro-2", "intro-done"); resolve(); }, 2900);
    });
  });
}
