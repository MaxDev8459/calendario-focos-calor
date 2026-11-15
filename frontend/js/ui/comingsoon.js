// "Coming soon" card for regions outside ACTIVE_REGIONS (M24). AI-assisted code — see README "Use of AI".
import { T, REGION_NAMES } from "../i18n/en.js";

export function initComingSoon(el, { onBack }) {
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "false");
  el.setAttribute("aria-labelledby", "cs-title");
  let lastFocus = null;
  const api = {
    open(region) {
      const name = REGION_NAMES[region] ?? REGION_NAMES.other;
      lastFocus = document.activeElement;
      el.innerHTML = `
        <div class="cs-card">
          <span class="cs-tag mono">${T.comingSoon.tag}</span>
          <h2 id="cs-title" class="serif">${name}</h2>
          <p>${T.comingSoon.body(name)}</p>
          <button type="button" class="btn btn-primary" data-cs-back>${T.comingSoon.back}</button>
        </div>`;
      el.hidden = false;
      document.body.classList.add("is-coming");
      requestAnimationFrame(() => el.classList.add("is-open"));
      el.querySelector("[data-cs-back]").addEventListener("click", () => { api.close(); onBack(); });
      el.querySelector("[data-cs-back]").focus({ preventScroll: true });
    },
    close() {
      el.classList.remove("is-open");
      document.body.classList.remove("is-coming");
      setTimeout(() => (el.hidden = true), 300);
      lastFocus?.focus?.({ preventScroll: true });
    },
    get isOpen() { return !el.hidden; },
  };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && api.isOpen) { api.close(); onBack(); } });
  return api;
}
