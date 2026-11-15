// Hexagon mesh (M23): H3 cells over the country, coloured by harmonized count (map ramp).
// Leaflet is lazy-loaded only for the country view (§10). Hexes pop in from the centre outward.
// AI-assisted code — see README "Use of AI".
import { polygonToCells, latLngToCell, cellToBoundary, cellToLatLng, cellArea } from "../../vendor/geo.js";
import { RAMP } from "../config.js";
import { T } from "../i18n/en.js";
import { fmtInt } from "../util/format.js";
import { reducedMotion, state, on } from "../state.js";

let L = null;
export async function loadLeaflet() {
  if (L) return L;
  for (const href of ["./vendor/leaflet.css", "./vendor/leaflet.draw.css"]) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.prepend(link); // before our CSS so the holo styles win
  }
  const mod = await import("../../vendor/leaflet.js"); // Leaflet 1.9.4 + Leaflet.draw 1.0.4 (sets window.L)
  L = mod.default;
  return L;
}

export function pickResolution(areaKm2) {
  if (areaKm2 < 3000) return 7;
  if (areaKm2 < 120000) return 6;
  if (areaKm2 < 700000) return 5;
  if (areaKm2 < 5000000) return 4;
  return 3;
}

function polyfill(geometry, res) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const set = new Set();
  for (const p of polys) {
    try { polygonToCells(p, res, true).forEach((c) => set.add(c)); } catch { /* tiny or invalid ring */ }
    // very small islands: keep at least the cell under the first vertex
    if (p[0]?.length) set.add(latLngToCell(p[0][0][1], p[0][0][0], res));
  }
  return [...set];
}

// nice, increasing thresholds for 10 colours from the non-zero values
function quantileCuts(values) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const qs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.82, 0.93];
  const nice = (x) => { if (x < 1) return Math.round(x * 10) / 10 || 0.1; if (x < 10) return Math.round(x); const p = 10 ** Math.floor(Math.log10(x)); return Math.round(x / (p / 4)) * (p / 4); };
  const out = [];
  for (const q of qs) { let n = nice(v[Math.min(v.length - 1, Math.floor(q * v.length))]); if (out.length && n <= out[out.length - 1]) n = nice(out[out.length - 1] * 1.15 + 0.1); out.push(n); }
  return out;
}
export const colorFor = (v, cuts) => { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return RAMP[i]; };

export function createMap(el, { americas, country, onSelect, onHover }) {
  const map = L.map(el, {
    zoomControl: false, attributionControl: false, preferCanvas: false, zoomSnap: 0.25, minZoom: 2, maxZoom: 10,
    worldCopyJump: false, keyboard: true, zoomAnimation: !reducedMotion, fadeAnimation: !reducedMotion,
  });
  const svgRenderer = L.svg({ padding: 0.5 });
  const canvasRenderer = L.canvas({ padding: 0.5 });

  // graticule (faint)
  const grat = [];
  for (let lon = -180; lon <= 180; lon += 10) grat.push([[-80, lon], [85, lon]]);
  for (let lat = -80; lat <= 80; lat += 10) grat.push([[lat, -180], [lat, 180]]);
  L.polyline(grat, { className: "map-grat", interactive: false, weight: 1 }).addTo(map);

  // neighbours
  L.geoJSON(americas, { interactive: false, style: () => ({ className: "map-land", weight: 1 }) }).addTo(map);
  // selected country
  const countryLayer = L.geoJSON(country, { interactive: false, style: () => ({ className: "map-country", weight: 1.5 }) }).addTo(map);

  let hexLayer = null, hexIndex = new Map(), cuts = [], selected = null, areaRect = null, pointsLayer = null;

  function setHexes(cells, counts, { animate = true } = {}) {
    if (hexLayer) hexLayer.remove();
    hexIndex = new Map();
    const values = cells.map((h) => counts.get(h) ?? 0);
    cuts = quantileCuts(values);
    const useSvg = cells.length <= 2600;
    const center = map.getCenter();
    const feats = cells.map((h, i) => {
      const ring = cellToBoundary(h, true);
      ring.push(ring[0]);
      const [la, lo] = cellToLatLng(h);
      return { type: "Feature", properties: { h, v: values[i], d: Math.hypot(la - center.lat, (lo - center.lng) * Math.cos((la * Math.PI) / 180)) }, geometry: { type: "Polygon", coordinates: [ring] } };
    });
    const maxD = Math.max(...feats.map((f) => f.properties.d), 1);
    hexLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
      renderer: useSvg ? svgRenderer : canvasRenderer,
      style: (f) => ({ className: "hx", fillColor: colorFor(f.properties.v, cuts), fillOpacity: 0.92, color: state.theme === "day" ? "#f5ece1" : "#0b0507", weight: 0.8, opacity: 0.9 }),
      onEachFeature: (f, layer) => {
        hexIndex.set(f.properties.h, layer);
        layer.on("click", () => onSelect(f.properties.h));
        layer.on("mouseover", (e) => onHover({ h: f.properties.h, v: f.properties.v, e }));
        layer.on("mouseout", () => onHover(null));
      },
    }).addTo(map);
    if (useSvg && animate && !reducedMotion) {
      hexLayer.eachLayer((layer) => {
        const p = layer.getElement?.();
        if (!p) return;
        const d = layer.feature.properties.d / maxD;
        p.style.animationDelay = `${Math.round(d * 900 + Math.random() * 120)}ms`;
        p.classList.add("hx-pop");
      });
    }
    return { cuts, values };
  }

  function select(h) {
    if (selected && hexIndex.get(selected)) hexIndex.get(selected).setStyle({ weight: 0.8, color: state.theme === "day" ? "#f5ece1" : "#0b0507" });
    selected = h;
    const layer = h && hexIndex.get(h);
    if (layer) { layer.setStyle({ weight: 2.6, color: state.theme === "day" ? "#2a1210" : "#fff4e4" }); layer.bringToFront(); }
  }

  function setArea(bbox) {
    areaRect?.remove();
    areaRect = null;
    if (!bbox) return;
    areaRect = L.rectangle([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { className: "map-area", weight: 1.6, fill: true, fillOpacity: 0.06, interactive: false }).addTo(map);
  }

  function setPoints(features, tooltipFor) {
    pointsLayer?.remove();
    pointsLayer = null;
    if (!features) return;
    pointsLayer = L.layerGroup(
      features.map((f) => L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { renderer: canvasRenderer, radius: 3, weight: 1, color: "#fff4e4", fillColor: "#FFBA08", fillOpacity: 0.95, className: "pt" }).bindTooltip(tooltipFor(f.properties), { className: "map-tip", direction: "top", offset: [0, -4] })),
    ).addTo(map);
  }

  on("theme", () => { if (hexLayer) hexLayer.setStyle((f) => ({ color: state.theme === "day" ? "#f5ece1" : "#0b0507" })); select(selected); });

  // keep the country clear of the title (top-left), tools (left), cards (right) and legend (bottom)
  const insets = () => (innerWidth > 960
    ? { paddingTopLeft: [210, 230], paddingBottomRight: [Math.min(440, innerWidth * 0.34) + 90, 110] }
    : { paddingTopLeft: [16, 170], paddingBottomRight: [16, 170] });

  return {
    map,
    fitCountry() { map.fitBounds(countryLayer.getBounds(), { ...insets(), animate: false }); },
    // cap the zoom so the country-level hexagons stay readable around a small drawn area
    fitBbox(b) {
      const o = insets();
      const cap = map.getBoundsZoom(countryLayer.getBounds(), false, L.point(o.paddingTopLeft).add(o.paddingBottomRight)) + 1;
      map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { ...o, maxZoom: cap, animate: !reducedMotion });
    },
    setHexes, select, setArea, setPoints,
    hexCenterPoint(h) { const [la, lo] = cellToLatLng(h); return map.latLngToContainerPoint([la, lo]); },
    get cuts() { return cuts; },
    destroy() { map.remove(); },
  };
}

export function computeHexes(geometry, res, cellsResp) {
  const hexes = polyfill(geometry, res);
  const set = new Set(hexes);
  const counts = new Map();
  for (const c of cellsResp.celdas) {
    const h = latLngToCell(c.lat_c, c.lon_c, res);
    if (!set.has(h)) continue;
    counts.set(h, (counts.get(h) ?? 0) + (c.conteo ?? 0));
  }
  return { hexes, counts };
}

export function hexInfo(h) {
  const [lat, lon] = cellToLatLng(h);
  const ring = cellToBoundary(h);
  const lats = ring.map((p) => p[0]), lons = ring.map((p) => p[1]);
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
