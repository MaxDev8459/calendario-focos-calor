// Burn calendar (M13): years × months, coloured by harmonized count with the contract's 7 cuts (8 colours).
// role="grid" with roving tabindex and arrow keys. null = grey hatch, 0 = lowest colour (0 ≠ null).
import { VIIRS_START_YEAR } from "../config.js";
import { ramp } from "../util/ramp.js";
import { T, MONTHS_INITIAL, MONTHS_SHORT } from "../i18n/en.js";
import { fmtInt, fmtNum, monthName, fmtPct, anomalyPct } from "../util/format.js";
import { stepLegendHTML } from "../ui/legend.js";
import { icons } from "../ui/icons.js";

// 8 colours picked from the 10-step ramp, lightness still monotonic (M12)
export const calColors = () => [0, 1, 2, 4, 5, 6, 8, 9].map((i) => ramp()[i]);

export function binColor(v, cuts) {
  if (v == null) return null;
  let i = 0;
  while (i < cuts.length && v >= cuts[i]) i++;
  return calColors()[i];
}

/**
 * @param el container
 * @param data /api/calendario response
 * @param opts { from:"YYYY-MM", to:"YYYY-MM", focus:{y,m}, onPick(y,m), expanded }
 */
export function renderCalendar(el, data, opts) {
  const cuts = data.escala?.cortes ?? [1, 5, 10, 25, 50, 100, 200];
  const cells = new Map(data.celdas.map((c) => [`${c.anio}-${c.mes}`, c]));
  const years = [...new Set(data.celdas.map((c) => c.anio))].sort((a, b) => b - a);
  const med = data.mediana_mensual ?? [];
  const peakCol = data.mes_pico;
  // record cell
  let max = null;
  for (const c of data.celdas) if (c.conteo != null && (!max || c.conteo > max.conteo)) max = c;
  const [fy, fm] = opts.from.split("-").map(Number);
  const [ty, tm] = opts.to.split("-").map(Number);
  const inRange = (y, m) => (y > fy || (y === fy && m >= fm)) && (y < ty || (y === ty && m <= tm));
  const expanded = !!opts.expanded;

  const head = `<div class="cal-row cal-head" role="row">
      <span class="cal-y label" role="columnheader">${T.country.calendar.yearCol}</span>
      ${MONTHS_INITIAL.map((m, i) => `<span role="columnheader" class="cal-m mono${i + 1 === peakCol ? " is-peak" : ""}" title="${monthName(i + 1)}"><span aria-hidden="true">${expanded ? MONTHS_SHORT[i] : m}</span><span class="sr-only">${monthName(i + 1)}</span></span>`).join("")}
    </div>`;
  const rows = years
    .map((y) => {
      const seam = y === VIIRS_START_YEAR - 1 ? " seam-below" : "";
      const tds = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const c = cells.get(`${y}-${m}`);
        const v = c?.conteo ?? null;
        const col = binColor(v, cuts);
        const isFocus = opts.focus && opts.focus.y === y && opts.focus.m === m;
        const isMax = max && max.anio === y && max.mes === m;
        const cls = ["cal-c", v == null ? "is-null" : "", inRange(y, m) ? "" : "is-out", isMax ? "is-max" : "", isFocus ? "is-focus" : ""].filter(Boolean).join(" ");
        const label = v == null ? T.country.calendar.readoutNull(monthName(m), y) : T.country.calendar.readout(monthName(m), y, fmtInt(v), med[i] ? fmtPct(anomalyPct(v, med[i])) : "");
        return `<span role="gridcell" class="${cls}" tabindex="${isFocus ? 0 : -1}" data-y="${y}" data-m="${m}" aria-label="${label}" aria-selected="${isFocus}" ${col ? `style="--c:${col}"` : ""}>${expanded && v != null ? `<span class="v num">${fmtNum(v)}</span>` : ""}</span>`;
      }).join("");
      return `<div class="cal-row${seam}" role="row"><span class="cal-y mono" role="rowheader">${y}</span>${tds}</div>`;
    })
    .join("");

  const summary = max ? T.country.calendar.summary(monthName(peakCol), monthName(max.mes), max.anio, fmtInt(max.conteo)) : T.empty;
  el.innerHTML = `
    <div class="cal-wrap${expanded ? " is-expanded" : ""}">
      <div class="cal-scroll">
        <div class="cal" role="grid" aria-label="${T.country.calendar.gridLabel}" aria-describedby="cal-summary-${expanded ? "x" : "c"}">
          ${head}${rows}
        </div>
        <span class="cal-seam-label mono" aria-hidden="true">${T.country.calendar.viirs}</span>
      </div>
      <p class="cal-readout mono" aria-live="polite" data-readout></p>
      <p class="sr-only" id="cal-summary-${expanded ? "x" : "c"}">${summary}</p>
      ${stepLegendHTML(cuts, calColors())}
      <p class="cal-null-key mono"><i class="hatch" aria-hidden="true"></i>${T.country.calendar.noData}</p>
    </div>`;

  // seam label position (between 2011 and 2012 rows)
  const seamRow = el.querySelector(".seam-below");
  const lbl = el.querySelector(".cal-seam-label");
  if (seamRow && lbl) {
    requestAnimationFrame(() => {
      const top = seamRow.offsetTop;
      lbl.style.top = `${top - 2}px`;
    });
  } else if (lbl) lbl.hidden = true;

  const grid = el.querySelector(".cal");
  const readout = el.querySelector("[data-readout]");
  const all = [...grid.querySelectorAll(".cal-c")];
  if (!grid.querySelector('[tabindex="0"]') && all.length) all[0].tabIndex = 0;
  const show = (cell) => (readout.textContent = cell.getAttribute("aria-label"));
  const focusCell = opts.focus ? grid.querySelector(`[data-y="${opts.focus.y}"][data-m="${opts.focus.m}"]`) : null;
  if (focusCell) show(focusCell);

  grid.addEventListener("pointerover", (e) => { const c = e.target.closest(".cal-c"); if (c) show(c); });
  grid.addEventListener("focusin", (e) => { const c = e.target.closest(".cal-c"); if (c) show(c); });
  grid.addEventListener("click", (e) => { const c = e.target.closest(".cal-c"); if (c && !c.classList.contains("is-null")) opts.onPick(+c.dataset.y, +c.dataset.m); });
  grid.addEventListener("keydown", (e) => {
    const c = e.target.closest(".cal-c");
    if (!c) return;
    const y = +c.dataset.y, m = +c.dataset.m;
    let ny = y, nm = m;
    if (e.key === "ArrowRight") nm++;
    else if (e.key === "ArrowLeft") nm--;
    else if (e.key === "ArrowUp") ny++;
    else if (e.key === "ArrowDown") ny--;
    else if (e.key === "Home") nm = 1;
    else if (e.key === "End") nm = 12;
    else if (e.key === "Enter" || e.key === " ") { if (!c.classList.contains("is-null")) opts.onPick(y, m); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    nm = Math.max(1, Math.min(12, nm));
    const next = grid.querySelector(`[data-y="${ny}"][data-m="${nm}"]`);
    if (next) { c.tabIndex = -1; next.tabIndex = 0; next.focus(); }
  });
  return { maxCell: max };
}

export function calendarHeader({ peak, scope }) {
  return `<div class="card-head">
      <h3 class="label">${T.country.calendar.title}</h3>
      <span class="label peak">${peak ? T.country.calendar.peak(MONTHS_SHORT[peak - 1].toUpperCase()) : ""}</span>
      <button type="button" class="icon-btn" data-cal-expand aria-label="${T.country.calendar.expand}" title="${T.country.calendar.expand}">${icons.expand}</button>
    </div>
    <p class="scope mono">${scope}</p>`;
}
