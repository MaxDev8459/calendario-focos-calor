// Before/after harmonization chart (M16) and small series charts. Labels are HTML (M2).
import { scaleLinear } from "../../vendor/geo.js";
import { line, curveMonotoneX, area } from "../../vendor/geo.js";
import { T } from "../i18n/en.js";
import { VIIRS_START_YEAR } from "../config.js";
import { fmtInt } from "../util/format.js";

export function annualize(serie) {
  const by = new Map();
  for (const s of serie) {
    const y = +s.fecha.slice(0, 4);
    const r = by.get(y) ?? { year: y, raw: 0, harm: 0, n: 0 };
    r.raw += y >= VIIRS_START_YEAR ? s.viirs ?? 0 : s.modis ?? 0;
    r.harm += s.armonizado ?? 0;
    r.n++;
    by.set(y, r);
  }
  return [...by.values()].filter((r) => r.n === 12).sort((a, b) => a.year - b.year);
}

// 12-month rolling means keep the monthly series legible at card size
function rolling(serie, key, w = 12) {
  const out = [];
  for (let i = 0; i < serie.length; i++) {
    const a = serie.slice(Math.max(0, i - w + 1), i + 1).map(key);
    out.push(a.reduce((s, v) => s + v, 0) / a.length);
  }
  return out;
}

/**
 * Render a before/after chart into `el`.
 * mode: "sensors" (raw only, highlighting the jump) | "both" (raw + harmonized)
 */
export function renderBeforeAfter(el, serie, { mode = "both", height = 120, axis = false } = {}) {
  const W = 600, H = height, padL = axis ? 44 : 6, padR = 6, padT = 10, padB = axis ? 22 : 8;
  const raw = rolling(serie, (s) => (+s.fecha.slice(0, 4) >= VIIRS_START_YEAR ? s.viirs ?? 0 : s.modis ?? 0));
  const harm = rolling(serie, (s) => s.armonizado ?? 0);
  const n = serie.length;
  const x = scaleLinear().domain([0, n - 1]).range([padL, W - padR]);
  const ymax = Math.max(...raw, ...harm) * 1.08 || 1;
  const y = scaleLinear().domain([0, ymax]).range([H - padB, padT]);
  const seamIdx = serie.findIndex((s) => +s.fecha.slice(0, 4) >= VIIRS_START_YEAR);
  const lr = line().x((_, i) => x(i)).y((d) => y(d)).curve(curveMonotoneX);
  const ar = area().x((_, i) => x(i)).y0(H - padB).y1((d) => y(d)).curve(curveMonotoneX);
  const sx = x(seamIdx);
  let ticks = "";
  if (axis) {
    const years = [2001, 2006, 2011, 2016, 2021, 2026];
    ticks = years
      .map((yr) => { const i = serie.findIndex((s) => s.fecha.startsWith(String(yr))); return i < 0 ? "" : `<line x1="${x(i)}" x2="${x(i)}" y1="${H - padB}" y2="${H - padB + 4}" class="tick"/><text x="${x(i)}" y="${H - 4}" class="tick-label" text-anchor="middle">${yr}</text>`; })
      .join("");
    const yt = y.ticks(4);
    ticks += yt.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 8}" y="${y(v) + 4}" class="tick-label" text-anchor="end">${fmtInt(v)}</text>`).join("");
  }
  const pre = line().x((_, i) => x(i)).y((d) => y(d)).curve(curveMonotoneX).defined((_, i) => i <= seamIdx);
  const post = line().x((_, i) => x(i)).y((d) => y(d)).curve(curveMonotoneX).defined((_, i) => i >= seamIdx);
  const rawPath = mode === "sensors"
    ? `<path d="${pre(raw)}" class="ln ln-raw-pre"/><path d="${post(raw)}" class="ln ln-raw-post"/>`
    : `<path d="${lr(raw)}" class="ln ln-raw"/>`;
  el.innerHTML = `
    <div class="ba-chart" style="--seam:${(sx / W) * 100}%">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        ${ticks}
        ${mode === "both" ? `<path d="${ar(harm)}" class="ar-harm"/>` : ""}
        ${rawPath}
        ${mode === "both" ? `<path d="${lr(harm)}" class="ln ln-harm"/>` : ""}
        <line x1="${sx}" x2="${sx}" y1="${padT - 6}" y2="${H - padB}" class="seam"/>
      </svg>
      <span class="seam-label mono">${axis ? T.method.seam : "VIIRS 2012"}</span>
      ${mode === "both" ? `<span class="key mono"><i class="k-raw"></i>${T.method.raw}<i class="k-harm"></i>${T.method.harmonized}</span>` : ""}
    </div>`;
}

// Annual bars for the area summary
export function renderYearBars(el, years, ramp) {
  const max = Math.max(...years.map((y) => y.value ?? 0)) || 1;
  el.innerHTML = `<div class="year-bars" role="img" aria-hidden="true">${years
    .map((y) => {
      const h = Math.max(2, ((y.value ?? 0) / max) * 100);
      const idx = Math.min(ramp.length - 1, Math.floor(((y.value ?? 0) / max) * (ramp.length - 1)));
      return `<span class="yb${y.year >= VIIRS_START_YEAR && y.year - 1 < VIIRS_START_YEAR ? " seam" : ""}" style="--h:${h}%;--c:${ramp[Math.max(2, idx)]}" title="${y.year}: ${fmtInt(y.value)}"></span>`;
    })
    .join("")}</div>`;
}
