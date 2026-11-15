// Country view (M11, M13–M19, M23): hex mesh + four floating cards with callout lines,
// plus the detected-vs-reported block. Full state lives in the URL hash (M17 shareable link).
import { T, REGION_NAMES, LABELS } from "../i18n/en.js";
import { FIRST_MONTH, LAST_MONTH_FALLBACK, VIIRS_START_YEAR } from "../config.js";
import { icons } from "../ui/icons.js";
import { countryByIso } from "../util/geo.js";
import { geoContains } from "../../vendor/geo.js";
import { getCells, getCalendar, getAnomaly, getLast7, getHotspots, downloadCsv } from "../api/client.js";
import { fmtInt, fmtNum, fmtPct, fmtLat, fmtLon, fmtDateTime, fmtAcq, monthName, fmtMonthKey } from "../util/format.js";
import { state, on, reducedMotion, emit } from "../state.js";
import { toast } from "../ui/toast.js";
import { createHexLayer, hexInfo, hexAt, cellId, parseCellId, hexTooltip } from "./hexmesh.js";
import { countryPicker } from "../ui/countrypicker.js";
import { renderCalendar, calendarHeader } from "./calendar.js";
import { renderAnomaly, completeAnomaly } from "./anomaly.js";
import { validateBbox, pointToBbox, validateMonthRange, validateDayRange, startDraw } from "./draw.js";
import { renderYearBars } from "./chart.js";
import { ramp } from "../util/ramp.js";
import { stepLegendHTML } from "../ui/legend.js";

let americasPromise = null;
const loadAmericas = () => (americasPromise ??= fetch("./data/americas-50m.json").then((r) => r.json()));

const lastDay = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export function initCountryView(el, { globe, waves, getMeta, onClose, onSample, openCountry, totals }) {
  let s = null; // view state
  let map = null; // hexagon mesh on the shared live map
  let token = 0;
  let cancelDraw = null;
  let calData = null;
  let anomaly = null;
  let lastPoints = null;

  const maxMonth = () => getMeta()?.ultimo_mes_completo ?? LAST_MONTH_FALLBACK;

  function buildHash() {
    const p = new URLSearchParams();
    p.set("country", s.iso);
    if (s.areaType !== "country") p.set("bbox", s.area.join(","));
    p.set("from", s.from);
    p.set("to", s.to);
    if (s.cell) p.set("cell", s.cellLabel);
    if (s.focus) p.set("month", `${s.focus.y}-${String(s.focus.m).padStart(2, "0")}`);
    return "#" + decodeURIComponent(p.toString());
  }
  const syncHash = () => history.replaceState(null, "", buildHash());

  function scopeBbox() {
    if (s.cell) return hexInfo(s.cell).bbox;
    return s.area;
  }
  function scopeLabel() {
    if (s.cell) return T.country.scopeCell(s.cellLabel);
    if (s.areaType !== "country") return T.country.scopeArea;
    return T.country.scopeCountry(s.name);
  }

  function shell() {
    const c = T.country;
    el.innerHTML = `
      <svg class="cv-callouts" aria-hidden="true"></svg>
      <div class="cv-head">
        <nav class="crumbs mono" aria-label="${c.breadcrumbLabel}">
          <button type="button" data-crumb="planet">${c.planet}</button><span aria-hidden="true">→</span>
          <button type="button" data-crumb="americas">${c.americas}</button><span aria-hidden="true">→</span>
          <span aria-current="page">${s.name}</span>
        </nav>
        <h2 class="cv-title serif" id="cv-title" tabindex="-1">${s.name} <em>· ${REGION_NAMES.americas}</em></h2>
        <div class="cv-switch" data-switch></div>
        <p class="cv-loading mono" data-loading>${c.loading}</p>
        <p class="sr-only">${c.mapLabel(s.name)}</p>
      </div>
      <div class="cv-tools">
        <button type="button" class="btn btn-ghost btn-sm" data-back>${icons.arrowLeft}<span>${c.back}</span></button>
        <div class="zoom-ctrl" role="group" aria-label="${T.country.zoomGroup}">
          <button type="button" class="round-btn" data-mz="in" aria-label="${c.zoomIn}">${icons.plus}</button>
          <button type="button" class="round-btn" data-mz="out" aria-label="${c.zoomOut}">${icons.minus}</button>
        </div>
      </div>
      <div class="cv-legend" data-legend></div>
      <div class="hex-tip" role="tooltip" hidden></div>
      <aside class="cv-cards" aria-labelledby="cv-title" data-cards>
        <button type="button" class="sheet-handle" data-sheet aria-expanded="false"><span aria-hidden="true"></span><span class="sr-only">${T.country.sheet}</span></button>
        <nav class="card-tabs" aria-label="${c.tabs.label}">${["cell", "calendar", "anomaly", "controls", "summary"].map((k) => `<button type="button" data-tab="${k}">${c.tabs[k]}</button>`).join("")}</nav>
        <section class="card" data-card="cell" aria-live="polite"></section>
        <section class="card" data-card="calendar"></section>
        <section class="card" data-card="anomaly" aria-live="polite"></section>
        <section class="card" data-card="controls"></section>
        <section class="card" data-card="summary"></section>
      </aside>
      <dialog class="cal-dialog" data-cal-dialog aria-labelledby="cal-dialog-title">
        <div class="cal-dialog-head"><h3 id="cal-dialog-title" class="serif">${c.calendar.expandedTitle} · <em>${s.name}</em></h3><button type="button" class="icon-btn" data-cal-close aria-label="${c.calendar.collapse}">${icons.close}</button></div>
        <p class="scope mono" data-cal-dialog-scope></p>
        <div data-cal-dialog-body></div>
      </dialog>`;
    renderControls();
    el.querySelector("[data-back]").addEventListener("click", () => onClose("explore"));
    el.querySelector('[data-crumb="planet"]').addEventListener("click", () => onClose("hero"));
    el.querySelector('[data-crumb="americas"]').addEventListener("click", () => onClose("explore"));
    el.querySelectorAll("[data-mz]").forEach((b) => b.addEventListener("click", () => (b.dataset.mz === "in" ? globe.map.zoomIn() : globe.map.zoomOut())));
    countryPicker(el.querySelector("[data-switch]"), { compact: true, current: s.iso, totals, onPick: (iso) => openCountry(iso) });
    el.querySelector("[data-sheet]").addEventListener("click", (e) => {
      const open = el.querySelector("[data-cards]").classList.toggle("is-open");
      e.currentTarget.setAttribute("aria-expanded", String(open));
    });
    el.querySelector("[data-cal-close]").addEventListener("click", () => el.querySelector("[data-cal-dialog]").close());
    const cardsBox = el.querySelector("[data-cards]");
    cardsBox.addEventListener("scroll", () => { drawCallouts(); syncTabs(); }, { passive: true });
    el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      const card = el.querySelector(`[data-card="${b.dataset.tab}"]`);
      cardsBox.scrollTo({ top: card.offsetTop - cardsBox.querySelector(".card-tabs").offsetHeight - 8, behavior: reducedMotion ? "auto" : "smooth" });
      card.querySelector("button, input, [tabindex]")?.focus({ preventScroll: true });
    }));
    function syncTabs() {
      const top = cardsBox.scrollTop + cardsBox.querySelector(".card-tabs").offsetHeight + 24;
      let cur = "cell";
      for (const k of ["cell", "calendar", "anomaly", "controls", "summary"]) if (el.querySelector(`[data-card="${k}"]`).offsetTop <= top) cur = k;
      el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.tab === cur)));
    }
    syncTabs();
  }

  // ---------- cards
  function renderCell() {
    const card = el.querySelector('[data-card="cell"]');
    const c = T.country.cell;
    if (!s.cell) {
      card.innerHTML = `<div class="card-head"><h3 class="label">${c.title}</h3></div><p class="muted">${c.empty}</p>`;
      return;
    }
    const info = hexInfo(s.cell);
    const total = s.cellTotal ?? 0;
    const [fy] = s.from.split("-").map(Number);
    const [ty] = s.to.split("-").map(Number);
    const src = ty < VIIRS_START_YEAR ? LABELS.MODIS_ajustado : fy >= VIIRS_START_YEAR ? LABELS.VIIRS : c.sourceMixed;
    card.innerHTML = `
      <div class="card-head"><h3 class="label">${c.title}</h3><span class="mono cell-id" translate="no">${s.cellLabel}</span>
        <button type="button" class="icon-btn" data-clear-cell aria-label="${T.country.clearCell}" title="${T.country.clearCell}">${icons.close}</button></div>
      <div class="kv-grid">
        <div class="kv"><span class="label">${c.lat}</span><span class="num big-num">${fmtLat(info.lat)}</span></div>
        <div class="kv"><span class="label">${c.lon}</span><span class="num big-num">${fmtLon(info.lon)}</span></div>
        <div class="kv"><span class="label">${c.hotspots}</span><span class="num big-num accent">${fmtInt(total)}</span></div>
        <div class="kv"><span class="label">${c.source}</span><span class="src">${src}</span></div>
      </div>
      <p class="muted small">${c.area(fmtInt(info.areaKm2))} · ${fmtMonthKey(s.from)} – ${fmtMonthKey(s.to)}</p>`;
    card.querySelector("[data-clear-cell]").addEventListener("click", () => selectCell(null));
  }

  function renderCalendarCard() {
    const card = el.querySelector('[data-card="calendar"]');
    if (!calData) { card.innerHTML = `<div class="card-head"><h3 class="label">${T.country.calendar.title}</h3></div><div class="skeleton" style="height:260px"></div>`; return; }
    card.innerHTML = calendarHeader({ peak: calData.mes_pico, scope: scopeLabel() }) + `<div data-cal></div>`;
    const r = renderCalendar(card.querySelector("[data-cal]"), calData, { from: s.from, to: s.to, focus: s.focus, onPick: pickMonth });
    s.maxCell = r.maxCell;
    card.querySelector("[data-cal-expand]").addEventListener("click", openCalendarDialog);
  }

  function openCalendarDialog() {
    const dlg = el.querySelector("[data-cal-dialog]");
    dlg.querySelector("[data-cal-dialog-scope]").textContent = scopeLabel();
    renderCalendar(dlg.querySelector("[data-cal-dialog-body]"), calData, { from: s.from, to: s.to, focus: s.focus, expanded: true, onPick: (y, m) => { pickMonth(y, m); dlg.close(); } });
    dlg.showModal();
  }

  function renderAnomalyCard() {
    renderAnomaly(el.querySelector('[data-card="anomaly"]'), anomaly);
  }

  function renderControls() {
    const c = T.country.controls;
    const card = el.querySelector('[data-card="controls"]');
    const [w, so, e, n] = s.area;
    card.innerHTML = `
      <div class="card-head"><h3 class="label">${c.title}</h3></div>
      <form class="ctl-form" data-range novalidate>
        <div class="field-row">
          <label class="field"><span class="label">${c.from}</span><span class="field-box">${icons.calendar}<input type="month" name="from" value="${s.from}" min="${FIRST_MONTH}" max="${maxMonth()}" required aria-describedby="range-err"></span></label>
          <label class="field"><span class="label">${c.to}</span><span class="field-box">${icons.calendar}<input type="month" name="to" value="${s.to}" min="${FIRST_MONTH}" max="${maxMonth()}" required aria-describedby="range-err"></span></label>
        </div>
        <p class="field-err" id="range-err" role="alert"></p>
        <details class="days">
          <summary>${c.days}</summary>
          <div class="field-row">
            <label class="field"><span class="label">${c.dayFrom}</span><span class="field-box"><input type="date" name="dfrom" value="${s.dayFrom}"></span></label>
            <label class="field"><span class="label">${c.dayTo}</span><span class="field-box"><input type="date" name="dto" value="${s.dayTo}"></span></label>
          </div>
        </details>
      </form>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" data-draw aria-pressed="false">${icons.draw}<span>${c.draw}</span></button>
        <button type="button" class="btn btn-primary" data-csv>${icons.download}<span>${c.csv}</span></button>
      </div>
      <p class="muted small" data-csv-note>${c.csvNote}</p>
      <form class="ctl-form" data-bbox novalidate>
        <fieldset>
          <legend class="label">${c.bbox}</legend>
          <div class="bbox-grid">
            ${[["west", c.west, c.westLong, w], ["south", c.south, c.southLong, so], ["east", c.east, c.eastLong, e], ["north", c.north, c.northLong, n]]
              .map(([k, short, long, v]) => `<label class="field"><span class="label" aria-hidden="true">${short}</span><span class="sr-only">${long}</span><span class="field-box"><input name="${k}" inputmode="decimal" value="${(+v).toFixed(5)}" aria-describedby="bbox-err" class="num"></span></label>`)
              .join("")}
          </div>
        </fieldset>
        <fieldset>
          <legend class="label">${c.point}</legend>
          <div class="field-row">
            <label class="field"><span class="label">${c.lat}</span><span class="field-box"><input name="plat" inputmode="decimal" placeholder="18.90000" class="num" aria-describedby="bbox-err"></span></label>
            <label class="field"><span class="label">${c.lon}</span><span class="field-box"><input name="plon" inputmode="decimal" placeholder="-99.20000" class="num" aria-describedby="bbox-err"></span></label>
          </div>
        </fieldset>
        <p class="field-err" id="bbox-err" role="alert"></p>
        <div class="btn-row">
          <button type="submit" class="btn btn-ghost btn-sm">${c.apply}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-point>${c.goPoint}</button>
          <button type="button" class="btn btn-text btn-sm" data-reset>${c.reset}</button>
        </div>
      </form>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost btn-sm" data-copy>${icons.link}<span>${c.copy}</span></button>
        <label class="toggle"><input type="checkbox" data-points><span>${T.country.points.toggle}</span></label>
      </div>`;

    const range = card.querySelector("[data-range]");
    const rangeErr = card.querySelector("#range-err");
    range.addEventListener("change", (ev) => {
      const f = range.elements;
      if (ev.target.name === "dfrom" || ev.target.name === "dto") {
        const v = validateDayRange(f.dfrom.value, f.dto.value);
        rangeErr.textContent = v.error ?? "";
        if (!v.error) { s.dayFrom = v.from; s.dayTo = v.to; }
        return;
      }
      const v = validateMonthRange(f.from.value, f.to.value, FIRST_MONTH, maxMonth());
      rangeErr.textContent = v.error ?? "";
      f.from.setAttribute("aria-invalid", String(!!v.error));
      f.to.setAttribute("aria-invalid", String(!!v.error));
      if (v.error) return;
      s.from = v.from; s.to = v.to;
      s.dayFrom = `${s.from}-01`; s.dayTo = lastDay(s.to);
      f.dfrom.value = s.dayFrom; f.dto.value = s.dayTo;
      loadAll({ hexes: true });
    });

    const bboxForm = card.querySelector("[data-bbox]");
    const bboxErr = card.querySelector("#bbox-err");
    bboxForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = bboxForm.elements;
      const v = validateBbox([f.west.value, f.south.value, f.east.value, f.north.value]);
      bboxErr.textContent = v.error ?? "";
      if (!v.error) setArea(v.bbox, "drawn");
    });
    card.querySelector("[data-point]").addEventListener("click", () => {
      const f = bboxForm.elements;
      const v = pointToBbox(f.plat.value, f.plon.value);
      bboxErr.textContent = v.error ?? "";
      if (!v.error) setArea(v.bbox, "point");
    });
    card.querySelector("[data-reset]").addEventListener("click", () => { bboxErr.textContent = ""; setArea(s.countryBbox, "country"); });

    const drawBtn = card.querySelector("[data-draw]");
    drawBtn.addEventListener("click", () => {
      if (cancelDraw) { cancelDraw(); cancelDraw = null; return; }
      drawBtn.setAttribute("aria-pressed", "true");
      drawBtn.querySelector("span").textContent = c.drawing;
      el.classList.add("is-drawing");
      cancelDraw = startDraw(globe, {
        onDone: (v) => { endDraw(); if (v.error) bboxErr.textContent = v.error; else setArea(v.bbox, "drawn"); },
        onCancel: endDraw,
      });
      function endDraw() { cancelDraw = null; el.classList.remove("is-drawing"); drawBtn.setAttribute("aria-pressed", "false"); drawBtn.querySelector("span").textContent = c.draw; }
    });

    card.querySelector("[data-csv]").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try { await downloadCsv(scopeBbox(), s.dayFrom, s.dayTo, s.name); } catch (e) { toast(e.message); }
      btn.disabled = false;
    });
    card.querySelector("[data-copy]").addEventListener("click", async () => {
      syncHash();
      try { await navigator.clipboard.writeText(location.href); toast(c.copied); } catch { toast(c.copyFailed); }
    });
    card.querySelector("[data-points]").addEventListener("change", async (ev) => {
      if (!ev.target.checked) { lastPoints = null; map.setPoints(null); return; }
      const end = new Date(getMeta()?.generado ?? Date.now());
      const start = new Date(end.getTime() - 6 * 86400000);
      try {
        const fc = await getHotspots(scopeBbox(), start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
        onSample(fc.sample);
        lastPoints = fc.features;
        map.setPoints(lastPoints, pointTip);
      } catch (e) { toast(e.message); }
    });
  }

  const pointTip = (p) => {
    const conf = LABELS.confianza[p.confianza] ?? p.confianza;
    // B4 may not send hora_utc / dia_noche (requested addition): fall back to the UTC date.
    const when = p.hora_utc ? fmtAcq(p.fecha, p.hora_utc) : T.country.points.utcDate(p.fecha);
    return T.country.points.tooltip(when, p.sensor, conf, fmtNum(p.frp_mw), LABELS.dia_noche[p.dia_noche] ?? "");
  };
  on("theme", () => { if (s && !el.hidden && calData) { renderCalendarCard(); renderSummary(); } });
  on("tz", () => { if (lastPoints && map) map.setPoints(lastPoints, pointTip); if (s && !el.hidden) renderSummary(); });

  function syncBboxInputs() {
    const f = el.querySelector("[data-bbox]")?.elements;
    if (!f) return;
    const [w, so, e, n] = s.area;
    f.west.value = w.toFixed(5); f.south.value = so.toFixed(5); f.east.value = e.toFixed(5); f.north.value = n.toFixed(5);
  }

  async function renderSummary() {
    const card = el.querySelector('[data-card="summary"]');
    if (!card || !calData) return;
    const t = T.country.summary;
    const inRange = calData.celdas.filter((c) => { const k = `${c.anio}-${String(c.mes).padStart(2, "0")}`; return k >= s.from && k <= s.to && c.conteo != null; });
    const total = inRange.reduce((acc, c) => acc + c.conteo, 0);
    // annual totals (complete years only) + linear trend
    const byYear = new Map();
    for (const c of calData.celdas) { if (c.conteo == null) continue; const r = byYear.get(c.anio) ?? { year: c.anio, value: 0, n: 0 }; r.value += c.conteo; r.n++; byYear.set(c.anio, r); }
    const years = [...byYear.values()].filter((r) => r.n === 12).sort((a, b) => a.year - b.year);
    let trendTxt = "";
    if (years.length >= 5) {
      const n = years.length, mx = years.reduce((a, r) => a + r.year, 0) / n, my = years.reduce((a, r) => a + r.value, 0) / n;
      const slope = years.reduce((a, r) => a + (r.year - mx) * (r.value - my), 0) / years.reduce((a, r) => a + (r.year - mx) ** 2, 0);
      const pct = my ? (slope / my) * 100 : 0;
      trendTxt = Math.abs(pct) < 0.5 ? t.trendFlat(years[0].year, years[n - 1].year) : t.trend(fmtPct(pct, 1), years[0].year, years[n - 1].year);
    }
    const maxY = years.reduce((a, r) => (!a || r.value > a.value ? r : a), null);
    const minY = years.reduce((a, r) => (!a || r.value < a.value ? r : a), null);
    const reported = anomaly?.reportados;
    card.innerHTML = `
      <div class="card-head"><h3 class="label">${t.title}</h3></div>
      <div class="dr-grid">
        <div class="dr">
          <span class="label">${t.detected}</span>
          <span class="num huge accent">${fmtInt(total)}</span>
          <span class="muted small">${t.detectedSub(fmtMonthKey(s.from), fmtMonthKey(s.to))}</span>
        </div>
        <div class="dr">
          <span class="label">${t.last7} <span class="sample-chip prelim-chip" title="${T.country.anomaly.prelimNote}">${t.preliminary}</span></span>
          <span class="num huge" data-last7>${s.last7 ? fmtInt(s.last7.total) + (s.last7.capped ? "+" : "") : "…"}</span>
          <span class="muted small">${s.last7 ? t.last7Sub(fmtDateTime(s.last7.actualizado)) : ""}</span>
        </div>
        <div class="dr dr-reported">
          <span class="label">${t.reported}</span>
          ${reported != null ? `<span class="num huge">${fmtInt(reported)}</span>` : `<span class="na">${t.reportedNone}</span>`}
          <span class="muted small">${t.reportedSub}</span>
        </div>
      </div>
      <p class="distinction">${icons.info}<span>${t.distinction}</span></p>
      <div class="years">
        <span class="label">${t.perYear}</span>
        <div data-years></div>
        <p class="trend mono">${trendTxt}</p>
        <p class="sr-only">${maxY ? t.yearChartSummary(maxY.year, fmtInt(maxY.value), minY.year, fmtInt(minY.value)) : ""}</p>
      </div>`;
    renderYearBars(card.querySelector("[data-years]"), years, ramp());
  }

  // ---------- callout lines (§4.4: 400 ms draw from the hexagon to the cards)
  function drawCallouts() {
    const svg = el.querySelector(".cv-callouts");
    if (!svg) return;
    if (!s?.cell || innerWidth < 900) { svg.innerHTML = ""; return; }
    const p = map.hexCenterPoint(s.cell);
    const mapRect = globe.map.getContainer().getBoundingClientRect();
    const x0 = mapRect.left + p.x, y0 = mapRect.top + p.y;
    const cards = ["cell", "calendar", "anomaly", "controls"].map((k) => el.querySelector(`[data-card="${k}"]`).getBoundingClientRect());
    // only the part of each card that is visible inside the scrolling card column
    const box = el.querySelector("[data-cards]").getBoundingClientRect();
    const vis = cards
      .map((r) => ({ left: r.left, top: Math.max(r.top, box.top), bottom: Math.min(r.bottom, box.bottom, innerHeight - 20) }))
      .filter((r) => r.bottom - r.top > 56);
    svg.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
    svg.innerHTML = vis
      .map((r, i) => {
        const x1 = r.left, y1 = (r.top + r.bottom) / 2;
        return `<path d="M${x0},${y0} L${x1},${y1}" class="callout" style="--i:${i}" pathLength="1"/><circle cx="${x1}" cy="${y1}" r="3" class="callout-dot"/>`;
      })
      .join("") + `<circle cx="${x0}" cy="${y0}" r="14" class="callout-ring"/>`;
  }

  // ---------- actions
  function pickMonth(y, m) {
    s.focus = { y, m };
    map?.reloadPoints();
    syncHash();
    renderCalendarCard();
    loadAnomaly(token);
    requestAnimationFrame(drawCallouts);
  }

  function selectCell(h) {
    s.cell = h;
    if (h) { const i = hexInfo(h); s.cellLabel = cellId(s.iso, i.lat, i.lon); s.cellTotal = map.countOf(h) ?? 0; }
    else { s.cellLabel = null; s.cellTotal = null; }
    map.select(h);
    renderCell();
    syncHash();
    loadAll({ hexes: false });
  }

  function setArea(bbox, type) {
    s.area = bbox;
    s.areaType = type;
    s.cell = null; s.cellLabel = null;
    map.select(null);
    map.setArea(type === "country" ? null : bbox);
    map.fitBbox(type === "country" ? s.countryBbox : bbox);
    syncBboxInputs();
    renderCell();
    syncHash();
    loadAll({ hexes: false });
  }

  async function loadAnomaly(tk) {
    if (!s.focus) { anomaly = null; renderAnomalyCard(); return; }
    try {
      const a = await getAnomaly(scopeBbox(), s.focus.y, s.focus.m);
      if (tk !== token) return;
      anomaly = calData ? completeAnomaly(a, calData) : a;
      onSample(anomaly.sample);
    } catch (e) { anomaly = null; toast(e.message); }
    renderAnomalyCard();
    renderSummary();
  }

  async function loadAll({ hexes }) {
    const tk = ++token;
    el.querySelector("[data-loading]")?.removeAttribute("hidden");
    const [fy] = s.from.split("-").map(Number);
    const [ty] = s.to.split("-").map(Number);
    const jobs = [
      getCalendar(scopeBbox(), FIRST_MONTH, `${ty}-12`).then((d) => { if (tk !== token) return; onSample(d.sample); calData = d; }),
      getLast7(scopeBbox(), getMeta()?.generado).then((d) => { if (tk === token) s.last7 = d; }).catch(() => {}),
    ];
    if (hexes) {
      jobs.push(getCells(s.countryBbox, s.from, s.to).then((cells) => {
        if (tk !== token) return;
        onSample(cells.sample);
        // keep only the tiles inside the country (the bbox also covers neighbours)
        const inside = cells.celdas.filter((c) => c.conteo > 0 && geoContains(s.feature, [c.lon_c, c.lat_c]));
        map.setCells(inside);
      }));
    }
    try { await Promise.all(jobs); } catch (e) { toast(e.message); }
    if (tk !== token) return;
    el.querySelector("[data-loading]")?.setAttribute("hidden", "");
    if (!s.focus && calData) {
      let max = null;
      for (const c of calData.celdas) if (c.conteo != null && (!max || c.conteo > max.conteo)) max = c;
      if (max) s.focus = { y: max.anio, m: max.mes };
    }
    renderCalendarCard();
    renderCell();
    renderSummary();
    await loadAnomaly(tk);
    syncHash();
    requestAnimationFrame(drawCallouts);
  }

  // ---------- open / close
  const onMapMove = () => drawCallouts();
  const detailMonth = () => (s.focus ? `${s.focus.y}-${String(s.focus.m).padStart(2, "0")}` : s.to);
  async function open(params) {
    const f110 = countryByIso(params.iso);
    if (!f110) return false;
    const meta = getMeta();
    s = {
      iso: params.iso,
      name: f110.properties.name,
      countryBbox: f110.properties.bbox,
      area: f110.properties.bbox,
      areaType: "country",
      from: params.from ?? FIRST_MONTH,
      to: params.to ?? meta?.ultimo_mes_completo ?? LAST_MONTH_FALLBACK,
      focus: params.month ? { y: +params.month.slice(0, 4), m: +params.month.slice(5, 7) } : null,
      cell: null, cellLabel: null, cellTotal: null, last7: null,
    };
    s.dayFrom = `${s.from}-01`;
    s.dayTo = lastDay(s.to);
    if (params.bbox) { const v = validateBbox(params.bbox); if (!v.error) { s.area = v.bbox; s.areaType = "drawn"; } }
    calData = null; anomaly = null; lastPoints = null;
    cancelDraw?.();

    document.body.classList.add("in-country");
    emit("section", "country");
    waves.setOpacity(0.12);
    const americas = await loadAmericas();
    s.feature = americas.features.find((f) => f.properties.iso2 === s.iso) ?? f110;

    if (map) { map.destroy(); map = null; }
    shell();
    el.hidden = false;
    // the same live map flies from the globe down to the country (§4.4)
    await globe.ready;
    map = createHexLayer(globe, {
      onSelect: (h) => selectCell(h === s.cell ? null : h),
      onHover: (d) => {
        const tip = el.querySelector(".hex-tip");
        if (!tip) return;
        if (!d) { tip.hidden = true; return; }
        tip.textContent = d.text ?? (d.mode === "points" ? T.country.hexDetections(fmtInt(d.v ?? 0)) : hexTooltip(d.v ?? 0));
        tip.hidden = false;
        tip.style.transform = `translate(${d.x + 14}px, ${d.y + 12}px)`;
      },
      onRes: ({ cuts, mode }) => {
        const lg = el.querySelector("[data-legend]");
        if (lg) lg.innerHTML = stepLegendHTML(cuts, ramp(), { label: mode === "points" ? T.country.perHexPoints(fmtMonthKey(detailMonth())) : T.country.perHex });
      },
      // zoomed in: the individual detections (B4) for the selected month, binned into small hexagons
      loadPoints: async (bbox) => {
        const ym = detailMonth();
        const fc = await getHotspots(bbox, `${ym}-01`, lastDay(ym));
        onSample(fc.sample);
        return fc.features ?? [];
      },
      clipBbox: () => (s.areaType === "country" ? s.countryBbox : s.area),
    });
    globe.setFocus(s.iso);
    const fly = globe.enterCountry(s.areaType === "country" ? s.countryBbox : s.area, { padding: map.insets(), duration: 1700 });
    requestAnimationFrame(() => el.classList.add("is-open"));
    globe.map.on("move", onMapMove);
    addEventListener("resize", drawCallouts);
    if (s.areaType !== "country") { map.setArea(s.area); syncBboxInputs(); }
    renderCell();
    renderCalendarCard();
    renderAnomalyCard();
    await Promise.all([fly, loadAll({ hexes: true })]);
    // restore a cell from the link (e.g. cell=MX-18.9-099.2)
    const pc = parseCellId(params.cell);
    if (pc) selectCell(hexAt(pc.lat, pc.lon, map.res));
    el.querySelector("#cv-title")?.focus?.({ preventScroll: true });
    return true;
  }

  function close() {
    if (el.hidden) return;
    cancelDraw?.();
    el.classList.remove("is-open");
    document.body.classList.remove("in-country");
    el.querySelector(".cv-callouts")?.replaceChildren();
    globe.map.off("move", onMapMove);
    removeEventListener("resize", drawCallouts);
    if (map) { map.destroy(); map = null; }
    globe.exitCountry();
    globe.setAutoRotate(true);
    setTimeout(() => { if (!el.classList.contains("is-open")) { el.hidden = true; el.innerHTML = ""; } }, reducedMotion ? 0 : 450);
  }

  // Esc: cancel drawing first, otherwise go back to the globe (an open dialog handles its own Esc)
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || el.hidden || el.querySelector("dialog[open]")) return;
    if (cancelDraw) { cancelDraw(); cancelDraw = null; return; }
    onClose("explore");
  });

  return { open, close, get isOpen() { return document.body.classList.contains("in-country"); }, get iso() { return s?.iso; } };
}
