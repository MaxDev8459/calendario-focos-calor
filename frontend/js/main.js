// Boot, hash router and section choreography. AI-assisted code — see README "Use of AI".
import { gsap, ScrollTrigger, Lenis } from "../vendor/motion.js";
import { T, REGION_NAMES } from "./i18n/en.js";
import { PILOT_BBOX, USE_MOCK } from "./config.js";
import { state, set, on, listen, emit, reducedMotion } from "./state.js";
import { loadWorld, countryByIso, isActiveRegion, geoCentroid } from "./util/geo.js";
import { getMetadata, getGlobe, getSeries, getFactors } from "./api/client.js";
import { renderTopbar } from "./ui/topbar.js";
import { initWaves } from "./globe/waves.js";
import { initGlobe } from "./globe/globe.js";
import { renderExplore, initExplore } from "./globe/explore.js";
import { renderHero, playIntro } from "./story/hero.js";
import { renderStory, initStory, CHAPTER_POV } from "./story/horizontal.js";
import { initComingSoon } from "./ui/comingsoon.js";
import { initCountryView } from "./country/view.js";
import { renderMethod, fillMethod, renderData, fillDataThrough, renderAbout, renderFooter } from "./sections.js";
import { toast } from "./ui/toast.js";

gsap.registerPlugin(ScrollTrigger);
const $ = (s) => document.querySelector(s);

const AMERICAS_POV = { lat: 14, lng: -78 };
const REGION_POV = { europe: { lat: 50, lng: 12 }, africa: { lat: 4, lng: 20 }, asia: { lat: 32, lng: 95 }, oceania: { lat: -22, lng: 140 }, antarctica: { lat: -75, lng: 0 }, other: { lat: 20, lng: 0 } };
const WAVES = { hero: 1, story: 0.25, explore: 0.25, page: 0.16, country: 0.12, coming: 0.3 };

// sample-data badge (§12): visible whenever any value on screen is simulated
const badge = document.createElement("p");
badge.className = "sample-badge mono";
badge.title = T.sampleDataTitle;
badge.innerHTML = `<span class="sb-dot" aria-hidden="true"></span>${T.sampleData}`;
badge.hidden = true;
document.body.append(badge);
const onSample = (flag) => { if (flag) badge.hidden = false; };

async function boot() {
  renderTopbar($("#topbar"));
  renderHero($("#hero"));
  const waves = initWaves($("#waves"));
  document.title = `${T.siteName} — ${T.hero.tagline}`;

  const world = await loadWorld();
  renderStory($("#story"));
  renderExplore($("#explore"));
  renderMethod($("#method"));
  renderData($("#data"));
  renderAbout($("#about"));
  renderFooter($("#footer"));

  // ---------- globe
  let explore = null;
  const globe = initGlobe($("#globe"), world, {
    onCountryClick: (f) => routeTo(f.properties.active ? `#country=${f.properties.iso2}` : `#region=${f.properties.region}`),
    onCountryHover: (f) => explore?.hover(f),
  });
  $("#globe").setAttribute("aria-label", T.explore.globeLabel);
  globe.pov(AMERICAS_POV.lat + 6, AMERICAS_POV.lng, 2.3, 0);
  globe.setLayout("hero", { ms: 0 });

  // ---------- data
  let totals = {};
  const metaP = getMetadata().then((m) => { set("metadata", m); fillDataThrough($("#data"), m); return m; });
  const globeP = (async () => {
    const meta = await metaP;
    const to = meta?.ultimo_mes_completo ?? "2025-12";
    const [y, m] = to.split("-").map(Number);
    const from = `${m === 12 ? y : y - 1}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    const g = await getGlobe(from, to);
    onSample(g.sample);
    if (g.sample) $("[data-sample-note]")?.removeAttribute("hidden");
    totals = Object.fromEntries((g.paises ?? []).map((p) => [p.iso_a2, p.conteo]));
    explore?.refreshPicker?.();
    const cells = g.celdas.map((c) => ({ ...c, active: isActiveRegion(c.region ?? "north_america") }));
    globe.setHotspots(cells);
    return cells;
  })();

  // intro (§4.4): frame → hologram → title → arcs
  let arcsReady = false;
  const startArcs = async () => { const cells = await globeP; globe.setArcs(cells); arcsReady = true; };
  playIntro({ world, globe, svg: $("#holo-draw"), onArcs: startArcs });

  const story = initStory($("#story"), { globe, series: null });
  Promise.all([getSeries(PILOT_BBOX), getFactors()]).then(([series, factors]) => {
    onSample(series.sample);
    initStoryCharts(series);
    fillMethod($("#method"), { series, factors });
  });
  function initStoryCharts(series) {
    import("./country/chart.js").then(({ renderBeforeAfter }) => {
      renderBeforeAfter($('#story [data-chart="sensors"]'), series.serie, { mode: "sensors", height: 90 });
      renderBeforeAfter($('#story [data-chart="both"]'), series.serie, { mode: "both", height: 110 });
    });
  }

  // ---------- smooth scroll (Lenis) + ScrollTrigger
  const lenis = reducedMotion ? null : new Lenis({ lerp: 0.11, wheelMultiplier: 0.9 });
  if (lenis) {
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  story.bind(lenis);
  const scrollToEl = (el, opts = {}) => (lenis ? lenis.scrollTo(el, { duration: reducedMotion ? 0 : 1.3, ...opts }) : el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" }));

  // ---------- coming soon + country view
  const coming = initComingSoon($("#coming-soon"), {
    onBack: () => { globe.pov(AMERICAS_POV.lat, AMERICAS_POV.lng, undefined, 1400); applyLayout(state.section); history.replaceState(null, "", "#explore"); },
  });
  const country = initCountryView($("#country-view"), {
    globe, waves, getMeta: () => state.metadata, onSample,
    openCountry: (iso) => routeTo(`#country=${iso}`),
    totals: () => totals,
    onClose: (target) => {
      country.close();
      globe.setLayout("explore", { keepPov: true });
      globe.pov(AMERICAS_POV.lat, AMERICAS_POV.lng, innerWidth < 768 ? 2.5 : 1.75, 1600);
      routeTo(target === "hero" ? "#hero" : "#explore");
    },
  });
  explore = initExplore($("#explore"), { globe, lenis, openCountry: (iso) => routeTo(`#country=${iso}`), totals: () => totals });

  // ---------- section choreography (M22: waves 100% → 25% → 12%)
  function applyLayout(sec) {
    if (country.isOpen) return;
    const layout = sec === "hero" ? "hero" : sec === "story" ? "story" : sec === "explore" ? "explore" : "page";
    if (globe.layout !== layout) globe.setLayout(layout);
    globe.setInteractive(sec === "explore");
    waves.setOpacity(WAVES[layout] ?? 0.2);
    document.body.dataset.section = sec;
    if (layout === "story") { const p = CHAPTER_POV[Math.max(0, story.active)]; globe.pov(p.lat, p.lng, undefined, 1400); }
    if (layout === "explore" || layout === "hero") globe.pov(AMERICAS_POV.lat + (layout === "hero" ? 6 : 0), AMERICAS_POV.lng, undefined, 1400);
  }
  const sections = ["hero", "story", "explore", "method", "data", "about"].map((id) => document.getElementById(id));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) { set("section", e.target.id); }
    },
    { rootMargin: "-48% 0px -48% 0px" },
  );
  sections.forEach((s) => io.observe(s));
  on("section", (s) => { if (s !== "country") applyLayout(s); });
  applyLayout("hero");

  // ---------- router (M9 deep links: #hero, #story-2, #explore, #country=MX&bbox=…)
  function parse(hash) {
    const h = hash.replace(/^#/, "");
    if (h.includes("=")) return Object.fromEntries(new URLSearchParams(h));
    return { id: h || "hero" };
  }
  async function route(hash, { push = false } = {}) {
    if (push) history.pushState(null, "", hash);
    const p = parse(hash);
    if (p.country) {
      const f = countryByIso(p.country.toUpperCase());
      if (!f) return route("#explore");
      if (!f.properties.active) return route(`#region=${f.properties.region}`);
      if (coming.isOpen) coming.close();
      explore.unlock?.();
      lenis?.stop();
      set("section", "country");
      await country.open({ iso: f.properties.iso2, bbox: p.bbox?.split(",").map(Number), from: p.from, to: p.to, cell: p.cell, month: p.month });
      return;
    }
    if (country.isOpen) { country.close(); lenis?.start(); requestAnimationFrame(() => applyLayout(state.section === "country" ? "explore" : state.section)); }
    if (p.region) {
      scrollToEl(document.getElementById("explore"), { immediate: true });
      const pov = REGION_POV[p.region] ?? REGION_POV.other;
      globe.setLayout("coming");
      globe.pov(pov.lat, pov.lng, 2.4, 1400);
      waves.setOpacity(WAVES.coming);
      coming.open(p.region);
      return;
    }
    const id = p.id;
    if (id === "calendar") return route(`#country=MX&bbox=${PILOT_BBOX.join(",")}`, { push: false });
    const mStory = /^story(?:-(\d))?$/.exec(id);
    if (mStory) {
      lenis?.start();
      const n = mStory[1] ? +mStory[1] - 1 : 0;
      story.goTo(n, lenis);
      return;
    }
    const el = document.getElementById(id);
    if (el) { lenis?.start(); scrollToEl(el); }
  }
  const routeTo = (hash) => route(hash, { push: true });

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    stopTour();
    routeTo(a.getAttribute("href"));
  });
  addEventListener("popstate", () => route(location.hash));

  // ---------- Locate me (M21)
  listen("locate", ({ lat, lon, country: c, exact }) => {
    if (country.isOpen) { country.close(); lenis?.start(); }
    const name = c?.properties.name ?? T.topbar.unknownPlace;
    scrollToEl(document.getElementById("explore"));
    setTimeout(() => {
      globe.pov(lat, lon, 1.6, 1400);
      globe.youAreHere(lat, lon, T.topbar.youAreHere(name));
      if (c && !isActiveRegion(c.properties.region)) coming.open(c.properties.region);
    }, reducedMotion ? 0 : 600);
    void exact;
  });

  // ---------- "Watch intro": replay + guided tour for the demo video (M9)
  let touring = false, tourTimers = [];
  const watchBtn = $("[data-watch]");
  function stopTour() {
    if (!touring) return;
    touring = false;
    tourTimers.forEach(clearTimeout);
    tourTimers = [];
    watchBtn.querySelector("span").textContent = T.hero.watch;
  }
  watchBtn.addEventListener("click", async () => {
    if (touring) return stopTour();
    touring = true;
    watchBtn.querySelector("span").textContent = T.hero.stop;
    if (lenis) lenis.scrollTo(0, { immediate: true }); else scrollTo(0, 0);
    await playIntro({ world, globe, svg: $("#holo-draw"), onArcs: () => {} });
    const steps = [0, 1, 2, 3, 4].map((i) => () => story.goTo(i, lenis));
    steps.push(() => routeTo("#explore"));
    steps.forEach((fn, i) => tourTimers.push(setTimeout(() => touring && fn(), 900 + i * 3400)));
    tourTimers.push(setTimeout(stopTour, 900 + steps.length * 3400));
  });
  ["wheel", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, (e) => { if (touring && !(e.target.closest?.("[data-watch]"))) stopTour(); }, { passive: true }));

  // first route
  if (location.hash && location.hash !== "#hero") setTimeout(() => route(location.hash), reducedMotion ? 0 : 1200);
  if (USE_MOCK) console.info("[heat-atlas] running on sample data — set API_BASE in js/config.js or add ?api=… to the URL");
  window.__heat = { globe, story, country, route, lenis };
}

boot().catch((e) => {
  console.error(e);
  toast(T.errorBoot);
});
