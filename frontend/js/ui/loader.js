// Loading screen shown while a country opens: the map flies down and its data loads behind it.
import { T } from "../i18n/en.js";
import { reducedMotion } from "../state.js";

export function countryLoader() {
  const el = document.createElement("div");
  el.className = "cv-loader";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  el.innerHTML = `
    <div class="cvl-card">
      <div class="cvl-ring" aria-hidden="true"><i></i><i></i><b></b></div>
      <p class="cvl-kicker label">${T.loader.kicker}</p>
      <p class="cvl-name serif" data-name></p>
      <p class="cvl-step mono" data-step></p>
      <div class="cvl-bar" aria-hidden="true"><i></i></div>
    </div>`;
  document.body.append(el);
  const nameEl = el.querySelector("[data-name]");
  const stepEl = el.querySelector("[data-step]");
  let timers = [];
  let shownAt = 0;
  let seq = 0;

  function hide() {
    timers.forEach(clearTimeout);
    timers = [];
    el.classList.remove("is-on");
    timers.push(setTimeout(() => { if (!el.classList.contains("is-on")) el.hidden = true; }, reducedMotion ? 0 : 450));
  }

  return {
    // returns a "done" callback; the screen stays at least ~0.7 s so it never just flickers
    show(name) {
      const id = ++seq;
      timers.forEach(clearTimeout);
      timers = [];
      nameEl.textContent = name;
      stepEl.textContent = T.loader.steps[0];
      T.loader.steps.slice(1).forEach((txt, i) => timers.push(setTimeout(() => { stepEl.textContent = txt; }, 900 * (i + 1))));
      el.hidden = false;
      shownAt = performance.now();
      requestAnimationFrame(() => el.classList.add("is-on"));
      return () => {
        if (id !== seq) return;
        const wait = reducedMotion ? 0 : Math.max(0, 700 - (performance.now() - shownAt));
        setTimeout(() => { if (id === seq) hide(); }, wait);
      };
    },
    hide() { seq++; hide(); },
  };
}
