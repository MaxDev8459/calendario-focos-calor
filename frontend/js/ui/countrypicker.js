// Country picker: a searchable combobox (ARIA 1.2 pattern) listing every active country with its
// 12-month hotspot total. Large in Explore, compact inside the country view to jump to another country.
import { T } from "../i18n/en.js";
import { icons } from "./icons.js";
import { allCountries } from "../util/geo.js";
import { fmtInt } from "../util/format.js";

let uid = 0;
const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function countryPicker(host, { compact = false, current = null, totals = () => ({}), onPick }) {
  const id = `cp${++uid}`;
  const t = T.picker;
  const list = allCountries().filter((f) => f.properties.active).map((f) => ({ iso: f.properties.iso2, name: f.properties.name })).sort((a, b) => a.name.localeCompare(b.name));
  host.classList.add("cpick", compact ? "cpick-compact" : "cpick-big");
  host.innerHTML = `
    ${compact ? "" : `<span class="cpick-kicker label" id="${id}-label">${t.kicker}</span><p class="cpick-title serif">${t.title}</p>`}
    <div class="cpick-box">
      ${icons.globe}
      <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" ${compact ? `aria-label="${t.switchLabel}"` : `aria-labelledby="${id}-label"`}
        placeholder="${compact ? t.switchPlaceholder : innerWidth < 480 ? t.placeholderShort : t.placeholder}" autocomplete="off" spellcheck="false">
      <button type="button" class="cpick-toggle" tabindex="-1" aria-label="${t.showAll}">${icons.chevron}</button>
    </div>
    <ul class="cpick-list" role="listbox" id="${id}-list" hidden></ul>
    ${compact ? "" : `<div class="cpick-chips" data-chips aria-label="${t.top}"></div>`}`;
  const input = host.querySelector("input");
  const ul = host.querySelector("ul");
  let items = [], active = -1;

  const totalOf = (iso) => totals()?.[iso];
  function render(q = "") {
    const nq = norm(q.trim());
    items = list.filter((c) => !nq || norm(c.name).includes(nq));
    const max = Math.max(1, ...items.map((c) => totalOf(c.iso) ?? 0));
    ul.innerHTML = items.length
      ? items.map((c, i) => {
          const v = totalOf(c.iso);
          return `<li role="option" id="${id}-o${i}" data-iso="${c.iso}" aria-selected="false"${c.iso === current ? ' aria-current="true"' : ""}>
            <span class="cp-name">${c.name}</span>
            ${v != null ? `<span class="cp-bar" aria-hidden="true"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></span><span class="cp-val num">${fmtInt(v)}</span>` : ""}
          </li>`;
        }).join("")
      : `<li class="cp-none" role="presentation">${t.none}</li>`;
    active = -1;
  }
  function openList() { render(input.value); ul.hidden = false; input.setAttribute("aria-expanded", "true"); host.classList.add("is-open"); }
  function closeList() { ul.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); host.classList.remove("is-open"); }
  function highlight(i) {
    const opts = ul.querySelectorAll('[role="option"]');
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, k) => o.setAttribute("aria-selected", String(k === active)));
    opts[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", opts[active].id);
  }
  function pick(iso) { if (!iso) return; closeList(); input.value = ""; input.blur(); onPick(iso); }

  input.addEventListener("focus", openList);
  input.addEventListener("input", () => { openList(); if (items.length === 1) highlight(0); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (ul.hidden) openList(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = ul.querySelectorAll('[role="option"]')[active < 0 ? 0 : active]; pick(o?.dataset.iso); }
    else if (e.key === "Escape") { if (!ul.hidden) { e.stopPropagation(); closeList(); } }
  });
  ul.addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus in the input
  ul.addEventListener("click", (e) => pick(e.target.closest("[data-iso]")?.dataset.iso));
  host.querySelector(".cpick-toggle").addEventListener("click", () => { if (ul.hidden) { input.focus(); openList(); } else closeList(); });
  input.addEventListener("blur", () => setTimeout(closeList, 120));

  // top 5 by recent activity, as one-tap shortcuts
  function chips() {
    const box = host.querySelector("[data-chips]");
    if (!box) return;
    const top = list.map((c) => ({ ...c, v: totalOf(c.iso) })).filter((c) => c.v != null).sort((a, b) => b.v - a.v).slice(0, 5);
    const pickTop = top.length ? top : list.filter((c) => ["MX", "BR", "BO", "CO", "US"].includes(c.iso));
    box.innerHTML = `<span class="label">${t.top}</span>` + pickTop.map((c) => `<button type="button" class="chip" data-iso="${c.iso}">${c.name}</button>`).join("");
    box.querySelectorAll("[data-iso]").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.iso)));
  }
  chips();
  return { refresh: chips, focus: () => input.focus() };
}
