// Hexagon mesh (M23) on the live map: small H3 hexagons where hotspots were detected, linked to their
// neighbours so the fire pattern reads as a mesh (like FIRMS points, but aggregated and comparable).
// The H3 resolution follows the zoom, so hexagons stay a few pixels wide: zoom in and they get finer.
import { latLngToCell, cellToBoundary, cellToLatLng, cellArea, gridDisk } from "../../vendor/geo.js";
import { ramp } from "../util/ramp.js";
import { T } from "../i18n/en.js";
import { fmtInt } from "../util/format.js";
import { reducedMotion, state, on } from "../state.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const SHRINK = 0.66; // hexagons are drawn smaller than their cell so the links between them show

// 0.1° tiles (≈11 km) support hexagons down to res 5; closer than that we switch to the individual
// detections (B4 points), binned into res 7–9 hexagons, so zooming in shows real detail, not a lattice.
export const DETAIL_ZOOM = 6.2;
export function resForZoom(z) {
  if (z < 3.2) return 3;
  if (z < 4.6) return 4;
  if (z < DETAIL_ZOOM) return 5;
  if (z < 7.6) return 6;
  if (z < 9) return 7;
  return 8;
}

// nice, increasing thresholds for 10 colours from the non-zero values
function quantileCuts(values) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const qs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.82, 0.93];
  const nice = (x) => { if (x < 1) return Math.round(x * 10) / 10 || 0.1; if (x < 10) return Math.round(x); const p = 10 ** Math.floor(Math.log10(x)); return Math.round(x / (p / 4)) * (p / 4); };
  const out = [];
  for (const q of qs) { let n = nice(v[Math.min(v.length - 1, Math.floor(q * v.length))]); const prev = out[out.length - 1]; if (out.length && n <= prev) n = prev < 10 ? Math.floor(prev) + 1 : Math.max(prev + 1, nice(prev * 1.15)); out.push(n); }
  return out;
}
export const colorFor = (v, cuts) => { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return ramp()[i]; };
const stepExpr = (cuts) => { const R = ramp(); const e = ["step", ["get", "v"], R[0]]; cuts.forEach((c, i) => e.push(c, R[i + 1])); return e; };

function ring(h, k = 1) {
  const [la, lo] = cellToLatLng(h);
  const r = cellToBoundary(h, true).map(([x, y]) => [lo + (x - lo) * k, la + (y - la) * k]);
  r.push(r[0]);
  return r;
}

const ink = () => (state.theme === "day"
  ? { link: "rgba(157, 2, 8, 0.32)", sel: "#2a1210", area: "#9d0208", pt: "#9d0208", ptStroke: "#fff4e4" }
  : { link: "rgba(255, 186, 8, 0.38)", sel: "#fff4e4", area: "#ffba08", pt: "#ffba08", ptStroke: "#fff4e4" });

export function createHexLayer(globe, { onSelect, onHover, onRes, loadPoints, clipBbox }) {
  const map = globe.map;
  const before = map.getLayer("omt-country-label") ? "omt-country-label" : undefined;
  const add = (id, src, layer) => { if (!map.getSource(src)) map.addSource(src, { type: "geojson", data: EMPTY }); if (!map.getLayer(id)) map.addLayer({ id, source: src, ...layer }, before); };
  const I = ink();
  add("area-fill", "area", { type: "fill", paint: { "fill-color": I.area, "fill-opacity": 0.06 } });
  add("hx-links", "hx-links", { type: "line", layout: { "line-cap": "round" }, paint: { "line-color": I.link, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 8, 1.2] } });
  add("hx-glow", "hx-centers", {
    type: "circle",
    filter: [">=", ["get", "t"], 0.55],
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 9, 9, 14], "circle-color": stepExpr([1, 2, 3, 4, 5, 6, 7, 8, 9]), "circle-blur": 1, "circle-opacity": 0.45 },
  });
  add("hx-fill", "hx", { type: "fill", paint: { "fill-color": ramp()[5], "fill-opacity": 0, "fill-opacity-transition": { duration: reducedMotion ? 0 : 900, delay: 0 } } });
  add("hx-sel", "hx-sel", { type: "line", paint: { "line-color": I.sel, "line-width": 2.4 } });
  add("area-line", "area", { type: "line", paint: { "line-color": I.area, "line-width": 1.6, "line-dasharray": [3, 2] } });
  add("pts", "pts", { type: "circle", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 9, 4.5], "circle-color": I.pt, "circle-stroke-color": I.ptStroke, "circle-stroke-width": 0.8, "circle-opacity": 0.95 } });

  let cells = [], points = [], counts = new Map(), cuts = [], res = resForZoom(map.getZoom()), selected = null, pointTip = null, firstPaint = true;
  let mode = "cells", pointsKey = "", pointsTimer = 0;

  function build() {
    counts = new Map();
    const list = mode === "points" ? points : cells;
    for (const c of list) {
      const h = latLngToCell(c.lat_c, c.lon_c, res);
      counts.set(h, (counts.get(h) ?? 0) + (c.conteo ?? 0));
    }
    const hexes = [...counts.keys()].filter((h) => counts.get(h) > 0);
    const values = hexes.map((h) => counts.get(h));
    cuts = quantileCuts(values);
    const tOf = (v) => { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return i / cuts.length; };
    const fill = [], centers = [], links = [];
    const have = new Set(hexes);
    for (const h of hexes) {
      const v = counts.get(h);
      const [la, lo] = cellToLatLng(h);
      fill.push({ type: "Feature", properties: { h, v }, geometry: { type: "Polygon", coordinates: [ring(h, SHRINK)] } });
      centers.push({ type: "Feature", properties: { v, t: tOf(v) }, geometry: { type: "Point", coordinates: [lo, la] } });
      for (const n of gridDisk(h, 1)) {
        if (n <= h || !have.has(n)) continue;
        const [la2, lo2] = cellToLatLng(n);
        links.push([[lo, la], [lo2, la2]]);
      }
    }
    map.getSource("hx").setData({ type: "FeatureCollection", features: fill });
    map.getSource("hx-centers").setData({ type: "FeatureCollection", features: centers });
    map.getSource("hx-links").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: links } }] });
    paintRamp();
    if (firstPaint && !reducedMotion) {
      map.setPaintProperty("hx-fill", "fill-opacity", 0);
      requestAnimationFrame(() => requestAnimationFrame(() => map.setPaintProperty("hx-fill", "fill-opacity", 0.95)));
      firstPaint = false;
    } else map.setPaintProperty("hx-fill", "fill-opacity", 0.95);
    onRes?.({ res, cuts, mode });
    return { cuts, values };
  }

  function paintRamp() {
    const R = ramp();
    map.setPaintProperty("hx-fill", "fill-color", stepExpr(cuts));
    map.setPaintProperty("hx-glow", "circle-color", ["step", ["get", "t"], R[0], ...cuts.flatMap((_, i) => [(i + 1) / cuts.length, R[i + 1]])]);
  }
  function setCells(list) { cells = list; if (mode === "cells") return build(); refreshPoints(true); return { cuts }; }

  // detail mode: fetch the detections for what is on screen (inside the clip box), debounced
  function refreshPoints(force = false) {
    if (!loadPoints) return;
    clearTimeout(pointsTimer);
    pointsTimer = setTimeout(async () => {
      const b = map.getBounds();
      const c = clipBbox?.() ?? [-180, -90, 180, 90];
      const bb = [Math.max(b.getWest(), c[0]), Math.max(b.getSouth(), c[1]), Math.min(b.getEast(), c[2]), Math.min(b.getNorth(), c[3])].map((v) => Math.round(v * 100) / 100);
      if (bb[0] >= bb[2] || bb[1] >= bb[3]) return;
      const key = bb.join(",");
      if (!force && key === pointsKey) { build(); return; }
      pointsKey = key;
      try {
        const feats = await loadPoints(bb);
        if (mode !== "points" || key !== pointsKey) return;
        points = feats.map((f) => ({ lat_c: f.geometry.coordinates[1], lon_c: f.geometry.coordinates[0], conteo: 1 }));
        build();
      } catch { /* keep what is shown */ }
    }, force ? 0 : 280);
  }

  const onZoom = () => {
    const z = map.getZoom();
    const nextMode = loadPoints && z >= DETAIL_ZOOM ? "points" : "cells";
    const r = resForZoom(z);
    if (nextMode !== mode) { mode = nextMode; res = r; if (mode === "points") refreshPoints(true); else build(); return; }
    if (mode === "points") { res = r; refreshPoints(); return; }
    if (r !== res && cells.length) { res = r; build(); }
  };
  map.on("moveend", onZoom);

  const enter = () => (map.getCanvas().style.cursor = "pointer");
  const move = (e) => {
    const f = e.features?.[0];
    if (!f) return;
    onHover({ h: f.properties.h, v: f.properties.v, mode, x: e.originalEvent.clientX, y: e.originalEvent.clientY });
  };
  const leave = () => { map.getCanvas().style.cursor = ""; onHover(null); };
  const click = (e) => { const f = e.features?.[0]; if (f) onSelect(f.properties.h); };
  const ptMove = (e) => {
    const f = e.features?.[0];
    if (!f || !pointTip) return;
    onHover({ text: pointTip(f.properties), x: e.originalEvent.clientX, y: e.originalEvent.clientY });
  };
  map.on("mouseenter", "hx-fill", enter);
  map.on("mousemove", "hx-fill", move);
  map.on("mouseleave", "hx-fill", leave);
  map.on("click", "hx-fill", click);
  map.on("mousemove", "pts", ptMove);
  map.on("mouseleave", "pts", leave);

  function select(h) {
    selected = h;
    map.getSource("hx-sel").setData(h ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(h, 1)] } }] } : EMPTY);
  }
  function setArea(bbox) {
    map.getSource("area").setData(bbox ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]] } } : EMPTY);
  }
  function setPoints(features, tooltipFor) {
    pointTip = tooltipFor ?? null;
    map.getSource("pts").setData(features ? { type: "FeatureCollection", features } : EMPTY);
  }
  const restyle = () => {
    if (cuts.length) { paintRamp(); onRes?.({ res, cuts, mode }); }
    const I = ink();
    map.setPaintProperty("hx-links", "line-color", I.link);
    map.setPaintProperty("hx-sel", "line-color", I.sel);
    map.setPaintProperty("area-fill", "fill-color", I.area);
    map.setPaintProperty("area-line", "line-color", I.area);
    map.setPaintProperty("pts", "circle-color", I.pt);
  };
  const offTheme = on("theme", () => { if (alive) restyle(); });
  let alive = true;

  // keep the country clear of the title (top-left), tools (left), cards (right) and legend (bottom)
  // The country is framed in the free space between the left column and the right panel,
  // measured from the page itself so nothing ever lands under a card.
  const insets = () => {
    if (innerWidth < 768) return { top: 190, left: 20, right: 20, bottom: 200 };
    const L = document.querySelector(".cv-left")?.getBoundingClientRect();
    const C = document.querySelector(".cv-cards")?.getBoundingClientRect();
    const left = L?.width ? L.right + 24 : 230;
    const right = C?.width ? innerWidth - C.left + 24 : Math.min(460, innerWidth * 0.34) + 70;
    const ok = innerWidth - left - right > 240;
    return { top: 116, bottom: 48, left: ok ? left : 40, right: ok ? right : 40 };
  };

  return {
    map,
    setCells,
    select,
    setArea,
    setPoints,
    insets,
    fitBbox(b, { capZoom } = {}) {
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: insets(), maxZoom: capZoom ?? 9, duration: reducedMotion ? 0 : 900 });
    },
    hexCenterPoint(h) { const [la, lo] = cellToLatLng(h); return map.project([lo, la]); },
    countOf(h) { return counts.get(h) ?? null; },
    get res() { return res; },
    get mode() { return mode; },
    reloadPoints() { if (mode === "points") refreshPoints(true); },
    get cuts() { return cuts; },
    destroy() {
      alive = false;
      offTheme?.();
      map.off("moveend", onZoom);
      clearTimeout(pointsTimer);
      map.off("mouseenter", "hx-fill", enter);
      map.off("mousemove", "hx-fill", move);
      map.off("mouseleave", "hx-fill", leave);
      map.off("click", "hx-fill", click);
      map.off("mousemove", "pts", ptMove);
      map.off("mouseleave", "pts", leave);
      for (const src of ["hx", "hx-centers", "hx-links", "hx-sel", "area", "pts"]) map.getSource(src)?.setData(EMPTY);
    },
  };
}

export function hexInfo(h) {
  const [lat, lon] = cellToLatLng(h);
  const r = cellToBoundary(h);
  const lats = r.map((p) => p[0]), lons = r.map((p) => p[1]);
  return { lat, lon, areaKm2: cellArea(h, "km2"), bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] };
}

export function hexAt(lat, lon, res) { return latLngToCell(lat, lon, res); }

// Display cell ID in the contract style, e.g. MX-18.9-099.2 (N/W). Southern latitudes get an "S" prefix.
export function cellId(iso, lat, lon) {
  const la = Math.abs(lat).toFixed(1);
  const lo = Math.abs(lon).toFixed(1).padStart(5, "0");
  return `${iso}-${lat < 0 ? "S" : ""}${la}-${lon > 0 ? "E" : ""}${lo}`;
}
export function parseCellId(id) {
  const m = /^([A-Z]{2})-(S?)(\d+(?:\.\d+)?)-(E?)(\d+(?:\.\d+)?)$/.exec(id ?? "");
  if (!m) return null;
  return { iso: m[1], lat: (m[2] ? -1 : 1) * +m[3], lon: (m[4] ? 1 : -1) * +m[5] };
}

export function hexTooltip(v) { return T.country.hexTooltip(fmtInt(v)); }
