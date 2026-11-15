// Horizontal scrollytelling (M22): pinned section, card track moves sideways, the globe stays.
// Each chapter rotates the globe to the region it talks about. Mobile: vertical cards.
// AI-assisted code — see README "Use of AI".
import { gsap, ScrollTrigger } from "../../vendor/motion.js";
import { T } from "../i18n/en.js";
import { icons } from "../ui/icons.js";
import { reducedMotion, emit } from "../state.js";
import { renderBeforeAfter } from "../country/chart.js";
import { legendHTML } from "../ui/legend.js";

gsap.registerPlugin(ScrollTrigger);

export const CHAPTER_POV = [
  { lat: 21, lng: -97 },   // 01 hotspots — central Mexico
  { lat: 4, lng: -62 },    // 02 two sensors — Amazon arc
  { lat: 8, lng: -78 },    // 03 harmonize — the Americas
  { lat: 18, lng: -88 },   // 04 explore
  { lat: 20, lng: -99 },   // 05 download — pilot area
];

export function renderStory(el) {
  const c = T.story.chapters;
  el.innerHTML = `
    <h2 id="story-title" class="sr-only">${T.story.label}</h2>
    <div class="story-pin">
      <div class="story-legend">${legendHTML({ min: "<1", max: "2,000+", label: "Hotspots" })}</div>
      <p class="story-hint">${icons.arrowRight}<span>${T.story.hint}</span></p>
      <div class="story-viewport">
        <ol class="story-track" role="list">
          <li class="story-card" id="story-1" data-ch="0">
            <span class="ch-num mono" aria-hidden="true">01</span>
            <h3 class="serif">${c[0].title}</h3>
            <p>${c[0].body}</p>
            <div class="pixel-diagram" aria-hidden="true">${Array.from({ length: 25 }, (_, i) => `<i class="${i === 12 ? "hot" : [7, 11, 13, 17].includes(i) ? "warm" : ""}"></i>`).join("")}</div>
            <ul class="is-isnot">
              <li><span class="dot dot-yes" aria-hidden="true"></span>${c[0].is}</li>
              <li><span class="dot dot-no" aria-hidden="true"></span>${c[0].isNot}</li>
            </ul>
          </li>
          <li class="story-card" id="story-2" data-ch="1">
            <span class="ch-num mono" aria-hidden="true">02</span>
            <h3 class="serif">${c[1].title}</h3>
            <p>${c[1].body}</p>
            <div class="mini-chart" data-chart="sensors"></div>
            <ul class="sensor-key mono">
              <li><i class="k-modis" aria-hidden="true"></i>${c[1].modis}</li>
              <li><i class="k-viirs" aria-hidden="true"></i>${c[1].viirs}</li>
            </ul>
          </li>
          <li class="story-card" id="story-3" data-ch="2">
            <span class="ch-num mono" aria-hidden="true">03</span>
            <h3 class="serif">${c[2].title}</h3>
            <p>${c[2].body}</p>
            <div class="mini-chart" data-chart="both"></div>
            <p class="chart-summary" data-chart-summary></p>
          </li>
          <li class="story-card" id="story-4" data-ch="3">
            <span class="ch-num mono" aria-hidden="true">04</span>
            <h3 class="serif">${c[3].title}</h3>
            <p>${c[3].body}</p>
            <a class="btn btn-primary" href="#explore">${icons.globe}<span>${c[3].cta}</span></a>
          </li>
          <li class="story-card" id="story-5" data-ch="4">
            <span class="ch-num mono" aria-hidden="true">05</span>
            <h3 class="serif">${c[4].title}</h3>
            <p>${c[4].body}</p>
            <div class="card-actions">
              <a class="btn btn-primary" href="#calendar">${icons.download}<span>${c[4].cta}</span></a>
              <a class="btn btn-ghost" href="#method">${c[4].method}</a>
            </div>
          </li>
        </ol>
      </div>
      <div class="story-nav">
        <button type="button" class="round-btn" data-prev aria-label="${T.story.prev}">${icons.arrowLeft}</button>
        <button type="button" class="round-btn" data-next aria-label="${T.story.next}">${icons.arrowRight}</button>
      </div>
      <nav class="story-progress" aria-label="${T.story.progress}">
        <ol>${c.map((ch, i) => `<li><button type="button" data-goto="${i}"><span class="mono">0${i + 1}</span> ${ch.short}</button></li>`).join("")}</ol>
        <div class="bar" aria-hidden="true"><span class="fill"></span></div>
      </nav>
    </div>`;
}

export function initStory(el, { globe, series }) {
  const track = el.querySelector(".story-track");
  const cards = [...el.querySelectorAll(".story-card")];
  const fill = el.querySelector(".fill");
  const gotoBtns = [...el.querySelectorAll("[data-goto]")];
  let active = -1;
  let st = null;

  if (series) {
    renderBeforeAfter(el.querySelector('[data-chart="sensors"]'), series.serie, { mode: "sensors", height: 90 });
    renderBeforeAfter(el.querySelector('[data-chart="both"]'), series.serie, { mode: "both", height: 110 });
  }

  const setActive = (i, { fromScroll = true } = {}) => {
    if (i === active) return;
    active = i;
    cards.forEach((c, k) => { c.classList.toggle("is-active", k === i); c.classList.toggle("is-past", k < i); });
    gotoBtns.forEach((b, k) => b.toggleAttribute("aria-current", k === i));
    const p = CHAPTER_POV[i];
    if (globe.layout === "story") globe.pov(p.lat, p.lng, undefined, 1600);
    emit("story-chapter", i);
  };

  const mm = gsap.matchMedia();
  mm.add("(min-width: 768px)", () => {
    const dist = () => Math.max(0, track.scrollWidth - el.querySelector(".story-viewport").clientWidth + 40);
    const tween = gsap.to(track, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: el,
        pin: el.querySelector(".story-pin"),
        start: "top top",
        end: () => `+=${dist() * 1.15 + innerHeight * 0.3}`,
        scrub: reducedMotion ? true : 0.6,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          fill.style.transform = `scaleX(${0.06 + self.progress * 0.94})`;
          setActive(Math.min(cards.length - 1, Math.round(self.progress * (cards.length - 1))));
        },
      },
    });
    st = tween.scrollTrigger;
    return () => { st = null; };
  });
  mm.add("(max-width: 767px)", () => {
    // vertical cards: observe which one is in view
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(+e.target.dataset.ch)), { threshold: 0.6 });
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  });
  setActive(0);

  const goTo = (i, lenis) => {
    i = Math.max(0, Math.min(cards.length - 1, i));
    if (st) {
      const y = st.start + (st.end - st.start) * (i / (cards.length - 1));
      lenis ? lenis.scrollTo(y, { duration: reducedMotion ? 0 : 1.2 }) : scrollTo({ top: y });
    } else {
      cards[i].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    }
  };

  return {
    goTo,
    get active() { return active; },
    bind(lenis) {
      gotoBtns.forEach((b) => b.addEventListener("click", () => goTo(+b.dataset.goto, lenis)));
      el.querySelector("[data-prev]").addEventListener("click", () => goTo(active - 1, lenis));
      el.querySelector("[data-next]").addEventListener("click", () => goTo(active + 1, lenis));
      el.addEventListener("keydown", (e) => {
        if (e.target.closest("input, select")) return;
        if (e.key === "ArrowRight") { goTo(active + 1, lenis); e.preventDefault(); }
        if (e.key === "ArrowLeft") { goTo(active - 1, lenis); e.preventDefault(); }
      });
    },
    count: cards.length,
  };
}
