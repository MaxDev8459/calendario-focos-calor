// Explore (M23): pinned globe — the wheel rotates it instead of scrolling, drag spins, click a country zooms.
// "Continue" and Esc release the pin. Keyboard path: the country list.
import { T, REGION_NAMES } from "../i18n/en.js";
import { icons } from "../ui/icons.js";
import { legendHTML } from "../ui/legend.js";
import { countryPicker } from "../ui/countrypicker.js";
import { fmtInt } from "../util/format.js";
import { reducedMotion } from "../state.js";

export function renderExplore(el) {
  el.innerHTML = `
    <div class="explore-ui">
      <h2 id="explore-title" class="explore-title serif">${T.explore.title.replace("Americas", "<em>Americas</em>")}</h2>
      <div class="explore-legend">${legendHTML({ min: "<1", max: "2,000+", label: T.explore.legendTitle })}<p class="sample-note" data-sample-note hidden>${T.explore.sampleNote}</p></div>
      <div class="zoom-ctrl" role="group" aria-label="${T.explore.zoomGroup}">
        <button type="button" class="round-btn" data-zoom="in" aria-label="${T.explore.zoomIn}">${icons.plus}</button>
        <button type="button" class="round-btn" data-zoom="out" aria-label="${T.explore.zoomOut}">${icons.minus}</button>
      </div>
      <div class="country-pick" data-picker></div>
      <p class="explore-hint pill"><span>${T.explore.hint}</span><span class="hint-sep" aria-hidden="true">·</span><span>${T.explore.release}</span></p>
      <button type="button" class="btn btn-ghost continue" data-continue>${T.explore.continue}${icons.arrowDown}</button>
    </div>`;
}

export function initExplore(el, { globe, lenis, openCountry, totals }) {
  let locked = false;
  const tip = document.getElementById("globe-tip");

  // While locked the page does not scroll: over the globe the wheel zooms (MapLibre), elsewhere it spins it.
  const onWheel = (e) => {
    if (!locked || document.body.classList.contains("in-country")) return;
    if (e.target.closest?.(".cpick-list")) return;
    if (e.target.closest?.("#globe")) return; // the map zooms and prevents the page scroll itself
    e.preventDefault();
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    globe.rotateBy(d * (reducedMotion ? 0.05 : 0.12));
  };
  addEventListener("wheel", onWheel, { passive: false });

  const lock = () => {
    if (locked) return;
    locked = true;
    el.classList.add("is-locked");
    lenis?.stop();
  };
  const unlock = (scrollNext = false) => {
    if (!locked) return;
    locked = false;
    el.classList.remove("is-locked");
    lenis?.start();
    if (scrollNext) lenis ? lenis.scrollTo("#method", { duration: reducedMotion ? 0 : 1.2 }) : document.getElementById("method").scrollIntoView();
  };

  // lock when the section fills the viewport
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.intersectionRatio > 0.92 && !document.body.classList.contains("in-country")) lock();
      else if (e.intersectionRatio < 0.5) { locked = false; el.classList.remove("is-locked"); }
    },
    { threshold: [0, 0.5, 0.92, 1] },
  );
  io.observe(el);

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && locked) unlock(false);
  });
  el.querySelector("[data-continue]").addEventListener("click", () => unlock(true));
  el.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => globe.zoomBy(b.dataset.zoom === "in" ? 0.8 : 1.25)));
  const picker = countryPicker(el.querySelector("[data-picker]"), { totals, onPick: openCountry });

  // hover tooltip (HTML, translatable)
  let mouse = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (!tip.hidden) tip.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 14}px)`;
  });
  return {
    lock, unlock,
    refreshPicker: () => picker.refresh(),
    get locked() { return locked; },
    hover(feature) {
      if (!feature || !document.getElementById("globe-stage").classList.contains("is-interactive")) { tip.hidden = true; return; }
      const p = feature.properties;
      const total = totals()?.[p.iso2];
      tip.innerHTML = p.active
        ? `<b>${p.name}</b><span>${total != null ? T.explore.yearTotal(fmtInt(total)) : REGION_NAMES[p.region]}</span>`
        : `<b>${p.name}</b><span class="tip-soon">${T.explore.comingSoonShort} · ${REGION_NAMES[p.region]}</span>`;
      tip.hidden = false;
      tip.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 14}px)`;
    },
  };
}
