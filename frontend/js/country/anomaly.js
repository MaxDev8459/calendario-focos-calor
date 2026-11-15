// Anomaly card (M14): count, multi-year mean & median, anomaly % vs both, percentile, rank.
// Formula: (current − baseline) / baseline × 100. Signed number always shown next to colour (M12).
import { DIVERGING } from "../config.js";
import { T, LABELS } from "../i18n/en.js";
import { fmtInt, fmtNum, fmtPct, monthName, ordinal, anomalyPct } from "../util/format.js";
import { icons } from "../ui/icons.js";

export function divergingColor(pct) {
  if (pct == null) return DIVERGING[3];
  const steps = [-50, -25, -10, 10, 25, 50]; // thresholds in %
  let i = 0;
  while (i < steps.length && pct >= steps[i]) i++;
  return DIVERGING[i];
}

// Fill missing v0.2 fields (mean, anomaly vs mean, percentile, rank) from the calendar when needed.
export function completeAnomaly(a, calendar) {
  const vals = calendar.celdas.filter((c) => c.mes === a.mes && c.conteo != null).map((c) => c.conteo);
  const out = { ...a };
  // Simulated anomaly but real calendar: derive everything from the calendar so both cards agree.
  if (a.sample && !calendar.sample && vals.length) {
    const cell = calendar.celdas.find((c) => c.anio === a.anio && c.mes === a.mes);
    const sorted = [...vals].sort((x, y) => x - y);
    const mid = sorted.length >> 1;
    out.conteo = cell?.conteo ?? null;
    out.fuente = cell?.fuente ?? null;
    out.preliminar = !!cell?.preliminar;
    out.mediana = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    out.anomalia = anomalyPct(out.conteo, out.mediana);
    for (const k of ["promedio", "anomalia_vs_promedio", "total_anios", "lugar", "percentil", "linea_base"]) out[k] = null;
    out.sample = false;
  }
  if (out.promedio == null && vals.length) out.promedio = vals.reduce((s, v) => s + v, 0) / vals.length;
  if (out.anomalia_vs_promedio == null && out.promedio) out.anomalia_vs_promedio = anomalyPct(out.conteo, out.promedio);
  if (out.total_anios == null) out.total_anios = vals.length;
  if (out.lugar == null && out.conteo != null) out.lugar = vals.filter((v) => v > out.conteo).length + 1;
  if (out.percentil == null && out.conteo != null) out.percentil = Math.round((vals.filter((v) => v <= out.conteo).length / vals.length) * 100);
  if (!out.linea_base) {
    const ys = calendar.celdas.filter((c) => c.mes === a.mes && c.conteo != null).map((c) => c.anio);
    out.linea_base = { desde: Math.min(...ys), hasta: Math.max(...ys) };
  }
  return out;
}

export function renderAnomaly(el, a) {
  const t = T.country.anomaly;
  if (!a || a.conteo == null) {
    el.innerHTML = `<div class="card-head"><h3 class="label">${t.title}</h3></div><p class="muted">${t.pick}</p>`;
    return;
  }
  const pct = a.anomalia;
  const pctMean = a.anomalia_vs_promedio;
  const word = pct == null ? "" : pct > 10 ? t.above : pct < -10 ? t.below : t.normal;
  const pos = pct == null ? 50 : Math.max(2, Math.min(98, 50 + Math.max(-100, Math.min(100, pct)) / 2));
  el.innerHTML = `
    <div class="card-head">
      <h3 class="label">${t.title}</h3>
      ${a.preliminar ? `<span class="sample-chip prelim-chip" title="${t.prelimNote}">${t.preliminary}</span>` : ""}
      <button type="button" class="icon-btn tip-btn" aria-describedby="anom-baseline" aria-label="${t.baselineShort}">${icons.info}</button>
      <span role="tooltip" id="anom-baseline" class="tip-pop">${t.baseline(monthName(a.mes), a.linea_base?.desde, a.linea_base?.hasta, a.total_anios)}</span>
    </div>
    <div class="anom-main">
      <span class="anom-big num" style="--dc:${divergingColor(pct)}">${pct == null ? "—" : fmtPct(pct)}</span>
      <div class="anom-lines">
        <p>${t.vsMedian(monthName(a.mes), a.anio, fmtNum(a.mediana))}</p>
        <p>${pctMean == null ? t.undefinedBaseline : t.vsMean(fmtPct(pctMean), fmtNum(a.promedio))}</p>
        <p class="muted">${t.count(fmtInt(a.conteo))}${word ? ` · ${word}` : ""}</p>
        ${a.preliminar ? `<p class="muted small">${a.incompleto && a.dias_con_datos != null ? t.prelimDays(a.dias_con_datos, a.dias_mes, fmtInt(a.conteo_proyectado ?? a.conteo)) : t.prelimNote}</p>` : ""}
      </div>
    </div>
    <div class="div-scale" aria-hidden="true">
      ${DIVERGING.map((c) => `<i style="background:${c}"></i>`).join("")}
      <span class="div-marker" style="left:${pos}%"></span>
    </div>
    <div class="div-scale-labels mono" aria-hidden="true"><span>−50%</span><span>0</span><span>+50%</span></div>
    <dl class="anom-stats">
      <div><dt class="label">${LABELS.percentil}</dt><dd class="num">${a.percentil != null ? ordinal(a.percentil) : "—"}</dd></div>
      <div><dt class="label">${LABELS.lugar}</dt><dd>${a.lugar != null ? t.rank(a.lugar, a.total_anios) : "—"}</dd></div>
      <div><dt class="label">${LABELS.mediana}</dt><dd class="num">${fmtNum(a.mediana)}</dd></div>
      <div><dt class="label">${LABELS.promedio}</dt><dd class="num">${fmtNum(a.promedio)}</dd></div>
    </dl>`;
}
