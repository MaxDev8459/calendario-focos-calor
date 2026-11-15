// Live holographic globe (M20, M23, M24, §4.3) on MapLibre GL JS, globe projection.
// One map serves the whole site: the glowing globe in the hero/story/explore and the flat country map.
// Base geometry comes from our own Natural Earth files (always available); OpenFreeMap vector tiles add
// names, coastlines, rivers, roads and state borders when the network allows. Text is never baked into
// images: map labels are live text and every other label is an HTML overlay (M2).
// AI-assisted code — see README "Use of AI".
import * as maplibregl from "../../vendor/maplibre/maplibre-gl.mjs";
import { RAMP, INACTIVE_GREY, VIIRS_BLUE } from "../config.js";
import { state, on, reducedMotion } from "../state.js";
import { countryByIso } from "../util/geo.js";

// Camera per layout. alt is the old globe.gl altitude (distance in globe radii); it is turned into a
// MapLibre zoom from the radius the globe should have on screen, so the composition is unchanged.
const LAYOUTS = {
  hero: { alt: 2.3, x: 0, y: 0.02 },
  story: { alt: 2.25, x: -0.22, y: 0.03 },
  explore: { alt: 1.75, x: 0, y: 0.03 },
  coming: { alt: 2.15, x: 0, y: 0.02 },
  country: { alt: 0.9, x: 0, y: 0 },
  page: { alt: 2.6, x: 0.26, y: 0.02 },
};
// Phones: the globe sits lower and further away so titles stay readable over it.
const LAYOUTS_MOBILE = {
  hero: { alt: 2.9, x: 0, y: 0.2 },
  story: { alt: 3.2, x: 0, y: 0.1 },
  explore: { alt: 2.5, x: 0, y: 0.04 },
  coming: { alt: 2.8, x: 0, y: 0 },
  page: { alt: 3.4, x: 0, y: 0.05 },
};
const layoutFor = (name) => (innerWidth < 768 && LAYOUTS_MOBILE[name]) || LAYOUTS[name] || LAYOUTS.hero;
// screen radius (px) the old camera gave for an altitude: tan(asin(1/(1+alt))) / tan(25°) · H/2
const radiusForAlt = (alt) => (Math.tan(Math.asin(1 / (1 + alt))) / Math.tan((25 * Math.PI) / 180)) * (innerHeight / 2);

const OMT = "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const NAME = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]]; // English names first (M1)

// Colours per theme and mode. Night = amber glass over the heat waves; day = paper and ink.
const PALETTE = {
  night: {
    ocean: "rgba(120, 30, 8, 0.50)", land: "rgba(205, 80, 22, 0.42)", landInactive: "rgba(120, 58, 40, 0.30)",
    border: "rgba(255, 176, 92, 0.82)", borderInactive: "rgba(255, 170, 80, 0.32)", glow: "rgba(255, 120, 30, 0.55)",
    grat: "rgba(255, 170, 90, 0.16)", hover: "rgba(255, 186, 8, 0.30)", water: "rgba(60, 14, 6, 0.55)",
    road: "rgba(255, 190, 120, 0.16)", state: "rgba(255, 190, 120, 0.28)", label: "#ffe9cf", halo: "rgba(40, 8, 4, 0.85)",
    // country mode: darker, so the hexagons carry the colour
    cOcean: "rgba(6, 3, 12, 0.72)", cLand: "rgba(46, 16, 12, 0.78)", cLandInactive: "rgba(30, 14, 14, 0.72)", cBorder: "rgba(255, 170, 90, 0.42)",
  },
  day: {
    ocean: "rgba(240, 170, 120, 0.42)", land: "rgba(250, 214, 168, 0.85)", landInactive: "rgba(225, 205, 190, 0.7)",
    border: "rgba(150, 60, 20, 0.85)", borderInactive: "rgba(150, 60, 20, 0.35)", glow: "rgba(232, 93, 4, 0.25)",
    grat: "rgba(150, 60, 20, 0.14)", hover: "rgba(194, 65, 12, 0.22)", water: "rgba(215, 160, 120, 0.7)",
    road: "rgba(150, 60, 20, 0.16)", state: "rgba(150, 60, 20, 0.3)", label: "#3a1a10", halo: "rgba(255, 246, 236, 0.9)",
    cOcean: "rgba(236, 214, 196, 0.85)", cLand: "rgba(250, 238, 224, 0.92)", cLandInactive: "rgba(236, 226, 216, 0.9)", cBorder: "rgba(150, 60, 20, 0.45)",
  },
};

function graticule(step = 15) {
  const lines = [];
  for (let lon = -180; lon < 180; lon += step) lines.push(Array.from({ length: 35 }, (_, i) => [lon, -85 + i * 5]));
  for (let lat = -75; lat <= 75; lat += step) lines.push(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]));
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }] };
}

// point at angular distance d (rad) and bearing b (rad) from [lng, lat]
function destination([lng, lat], d, b) {
  const φ1 = (lat * Math.PI) / 180, λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [((((λ2 * 180) / Math.PI) + 540) % 360) - 180, (φ2 * 180) / Math.PI];
}
function angularDist([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}
function greatCircle(a, b, n = 64) {
  const d = angularDist(a, b);
  if (!d) return [a, b];
  const r = Math.PI / 180;
  const [x1, y1, z1] = [Math.cos(a[1] * r) * Math.cos(a[0] * r), Math.cos(a[1] * r) * Math.sin(a[0] * r), Math.sin(a[1] * r)];
  const [x2, y2, z2] = [Math.cos(b[1] * r) * Math.cos(b[0] * r), Math.cos(b[1] * r) * Math.sin(b[0] * r), Math.sin(b[1] * r)];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * x1 + B * x2, y = A * y1 + B * y2, z = A * z1 + B * z2;
    out.push([Math.atan2(y, x) / r, Math.atan2(z, Math.hypot(x, y)) / r]);
  }
  return out;
}

const rampStep = (prop) => {
  const e = ["step", ["get", prop], RAMP[2]];
  for (let i = 3; i < RAMP.length; i++) e.push((i - 2) / (RAMP.length - 2), RAMP[i]);
  return e;
};

export function initGlobe(container, world, { onCountryClick, onCountryHover } = {}) {
  const stage = container.parentElement;
  const day0 = state.theme === "day";
  const P0 = PALETTE[day0 ? "day" : "night"];

  const style = {
    version: 8,
    projection: { type: "globe" },
    glyphs: GLYPHS,
    sky: {
      "sky-color": "rgba(0,0,0,0)", "horizon-color": "#ff6a1a", "fog-color": "#ff6a1a",
      "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.9,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.8, 6, 0],
    },
    sources: {
      countries: { type: "geojson", data: world, promoteId: "iso2" },
      grat: { type: "geojson", data: graticule() },
      omt: { type: "vector", url: OMT },
      hot: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      arcs: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": P0.ocean } },
      { id: "grat", type: "line", source: "grat", paint: { "line-color": P0.grat, "line-width": 0.7 } },
      { id: "land", type: "fill", source: "countries", paint: { "fill-color": ["case", ["get", "active"], P0.land, P0.landInactive], "fill-antialias": true } },
      { id: "land-hover", type: "fill", source: "countries", paint: { "fill-color": P0.hover, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0] } },
      // live detail (OpenFreeMap / OpenMapTiles), from zoom 3 so the globe stays clean
      { id: "omt-water", type: "fill", source: "omt", "source-layer": "water", minzoom: 3, paint: { "fill-color": P0.water, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 4, 1] } },
      { id: "omt-river", type: "line", source: "omt", "source-layer": "waterway", minzoom: 5, paint: { "line-color": P0.water, "line-width": 0.8 } },
      { id: "omt-road", type: "line", source: "omt", "source-layer": "transportation", minzoom: 5, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]], paint: { "line-color": P0.road, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.4] } },
      { id: "omt-state", type: "line", source: "omt", "source-layer": "boundary", minzoom: 3.5, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": P0.state, "line-width": 0.7, "line-dasharray": [3, 3] } },
      { id: "border-glow", type: "line", source: "countries", filter: ["==", ["get", "active"], true], paint: { "line-color": P0.glow, "line-width": 5, "line-blur": 4 } },
      { id: "border", type: "line", source: "countries", paint: { "line-color": ["case", ["get", "active"], P0.border, P0.borderInactive], "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 5, 1.2] } },
      { id: "focus-glow", type: "line", source: "countries", filter: ["==", ["get", "iso2"], ""], paint: { "line-color": "#ffba08", "line-width": 9, "line-blur": 7, "line-opacity": 0.7 } },
      { id: "focus-line", type: "line", source: "countries", filter: ["==", ["get", "iso2"], ""], paint: { "line-color": "#ffd46a", "line-width": 1.6 } },
      { id: "arcs", type: "line", source: "arcs", layout: { "line-cap": "round" }, paint: { "line-color": "#fff0c8", "line-width": 1.6, "line-blur": 0.6, "line-opacity": 0.85, "line-dasharray": [0, 4, 3] } },
      {
        id: "hot-glow", type: "circle", source: "hot",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, ["+", 1.6, ["*", 4, ["get", "t"]]], 4, ["+", 4, ["*", 10, ["get", "t"]]], 7, ["+", 8, ["*", 18, ["get", "t"]]]],
          "circle-color": ["case", ["get", "active"], rampStep("t"), INACTIVE_GREY],
          "circle-blur": 1, "circle-opacity": ["case", ["get", "active"], 0.55, 0.25],
          "circle-pitch-alignment": "map",
        },
      },
      {
        id: "hot-core", type: "circle", source: "hot",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, ["+", 0.5, ["*", 1.4, ["get", "t"]]], 4, ["+", 1.2, ["*", 3, ["get", "t"]]], 7, ["+", 2.5, ["*", 5, ["get", "t"]]]],
          "circle-color": ["case", ["get", "active"], ["interpolate", ["linear"], ["get", "t"], 0, RAMP[4], 0.7, RAMP[8], 1, "#fff4e4"], INACTIVE_GREY],
          "circle-opacity": ["case", ["get", "active"], ["+", 0.55, ["*", 0.45, ["get", "t"]]], 0.55],
          "circle-pitch-alignment": "map",
        },
      },
      {
        id: "omt-country-label", type: "symbol", source: "omt", "source-layer": "place", minzoom: 2.6, filter: ["==", ["get", "class"], "country"],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 6, 15], "text-transform": "uppercase", "text-letter-spacing": 0.18, "text-max-width": 8 },
        paint: { "text-color": P0.label, "text-halo-color": P0.halo, "text-halo-width": 1.4, "text-opacity": ["interpolate", ["linear"], ["zoom"], 2.6, 0, 3.2, 0.9] },
      },
      {
        id: "omt-state-label", type: "symbol", source: "omt", "source-layer": "place", minzoom: 4.5, filter: ["==", ["get", "class"], "state"],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-letter-spacing": 0.08, "text-max-width": 7 },
        paint: { "text-color": P0.label, "text-halo-color": P0.halo, "text-halo-width": 1.2, "text-opacity": 0.75 },
      },
      {
        id: "omt-city-label", type: "symbol", source: "omt", "source-layer": "place", minzoom: 5, filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 9, 13], "symbol-sort-key": ["get", "rank"], "text-max-width": 8 },
        paint: { "text-color": P0.label, "text-halo-color": P0.halo, "text-halo-width": 1.2, "text-opacity": 0.85 },
      },
    ],
  };

  const startZoom = 1.8;
  const map = new maplibregl.Map({
    container,
    style,
    center: [-78, 20],
    zoom: startZoom,
    minZoom: 0.4,
    maxZoom: 11,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false,
    renderWorldCopies: false,
    pixelRatio: Math.min(2, window.devicePixelRatio || 1), // §10 cap DPR at 2
    canvasContextAttributes: { antialias: true, alpha: true, preserveDrawingBuffer: false },
    fadeDuration: reducedMotion ? 0 : 300,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation?.();
  // OSM-derived detail only appears from zoom 3: the attribution follows it (ODbL)
  const attrib = new maplibregl.AttributionControl({ compact: true });
  map.addControl(attrib, "bottom-left");
  const syncAttrib = () => container.classList.toggle("show-attrib", map.getZoom() >= 2.9);
  map.on("zoomend", syncAttrib);
  // tiles or glyphs can be blocked or offline: the globe keeps working with the local geometry
  map.on("error", (e) => { if (!/omt|openfreemap|glyph|pbf|Failed to fetch|AJAXError/i.test(String(e?.error?.message ?? e?.error ?? ""))) console.warn("[map]", e?.error ?? e); });

  let loaded = false;
  const ready = new Promise((r) => map.once("load", () => { loaded = true; r(); }));
  const whenReady = (fn) => (loaded ? fn() : ready.then(fn));

  // Americas at 50m: sharper coasts and borders when zoomed in (and in the country view)
  whenReady(() =>
    fetch("./data/americas-50m.json").then((r) => r.json()).then((am) => {
      for (const f of am.features) f.properties.active = true;
      map.addSource("americas", { type: "geojson", data: am, promoteId: "iso2" });
      const P = pal();
      map.addLayer({ id: "land50", type: "fill", source: "americas", minzoom: 2.8, paint: { "fill-color": P.land, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 2.8, 0, 3.4, 1] } }, "land-hover");
      map.addLayer({ id: "border50", type: "line", source: "americas", minzoom: 2.8, paint: { "line-color": P.border, "line-width": 1.1, "line-opacity": ["interpolate", ["linear"], ["zoom"], 2.8, 0, 3.4, 1] } }, "focus-glow");
      map.addLayer({ id: "land50-hover", type: "fill", source: "americas", minzoom: 2.8, paint: { "fill-color": P.hover, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.8, 0] } }, "omt-water");
      applyTheme();
    }).catch(() => {}),
  );

  // ---------- theme / mode paints
  let countryMode = false;
  const pal = () => PALETTE[state.theme === "day" ? "day" : "night"];
  const setPaint = (id, prop, v) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); };
  function applyTheme() {
    const day = state.theme === "day";
    const P = pal();
    stage.classList.toggle("is-day", day);
    stage.classList.toggle("is-country", countryMode);
    if (!loaded) return;
    setPaint("ocean", "background-color", countryMode ? P.cOcean : P.ocean);
    setPaint("grat", "line-color", countryMode ? P.grat.replace(/[\d.]+\)$/, "0.08)") : P.grat);
    setPaint("land", "fill-color", ["case", ["get", "active"], countryMode ? P.cLand : P.land, countryMode ? P.cLandInactive : P.landInactive]);
    setPaint("land50", "fill-color", countryMode ? P.cLand : P.land);
    setPaint("land-hover", "fill-color", P.hover);
    setPaint("land50-hover", "fill-color", P.hover);
    setPaint("border", "line-color", ["case", ["get", "active"], countryMode ? P.cBorder : P.border, P.borderInactive]);
    setPaint("border50", "line-color", countryMode ? P.cBorder : P.border);
    setPaint("border-glow", "line-color", P.glow);
    setPaint("border-glow", "line-opacity", countryMode ? 0 : 1);
    setPaint("omt-water", "fill-color", countryMode ? P.cOcean : P.water);
    setPaint("omt-river", "line-color", countryMode ? P.cOcean : P.water);
    setPaint("omt-road", "line-color", P.road);
    setPaint("omt-state", "line-color", P.state);
    for (const id of ["omt-country-label", "omt-state-label", "omt-city-label"]) { setPaint(id, "text-color", P.label); setPaint(id, "text-halo-color", P.halo); }
    setPaint("focus-line", "line-color", day ? "#9d0208" : "#ffd46a");
    setPaint("focus-glow", "line-color", day ? "#e85d04" : "#ffba08");
    setPaint("arcs", "line-color", day ? "#c2410c" : "#fff0c8");
    setPaint("hot-glow", "circle-opacity", ["case", ["get", "active"], day ? 0.35 : 0.55, 0.25]);
    for (const id of ["hot-glow", "hot-core", "arcs"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", countryMode ? "none" : "visible");
    map.setSky({ ...style.sky, "horizon-color": day ? "#f48c06" : "#ff6a1a", "fog-color": day ? "#f8c79a" : "#ff6a1a", "atmosphere-blend": countryMode ? 0 : style.sky["atmosphere-blend"] });
    orbits.classList.toggle("is-day", day);
  }
  on("theme", applyTheme);

  // ---------- hotspots (globe embers) and light arcs
  function setHotspots(cells) {
    const active = cells.filter((c) => c.active).map((c) => c.conteo).sort((a, b) => a - b);
    const q = (v) => { let lo = 0, hi = active.length; while (lo < hi) { const m = (lo + hi) >> 1; if (active[m] < v) lo = m + 1; else hi = m; } return active.length ? lo / active.length : 0; };
    const fc = { type: "FeatureCollection", features: cells.map((c) => ({ type: "Feature", properties: { t: c.active ? q(c.conteo) : 0, active: !!c.active }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })) };
    whenReady(() => map.getSource("hot").setData(fc));
  }
  function setArcs(cells) {
    const bins = new Map();
    for (const c of cells) {
      if (!c.active) continue;
      const k = `${Math.round(c.lat / 7)}_${Math.round(c.lon / 7)}`;
      const b = bins.get(k) ?? { lat: 0, lon: 0, w: 0 };
      b.lat += c.lat * c.conteo; b.lon += c.lon * c.conteo; b.w += c.conteo;
      bins.set(k, b);
    }
    const top = [...bins.values()].sort((a, b) => b.w - a.w).slice(0, 8).map((b) => [b.lon / b.w, b.lat / b.w]);
    const feats = reducedMotion ? [] : top.map((a, i) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: greatCircle(a, top[(i + 3) % top.length]) } }));
    whenReady(() => map.getSource("arcs").setData({ type: "FeatureCollection", features: feats }));
  }

  // ---------- orbital rings: an SVG overlay sized from the globe's radius on screen
  const orbits = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  orbits.setAttribute("class", "orbits");
  orbits.setAttribute("aria-hidden", "true");
  orbits.innerHTML = `<g class="orb orb-a"><ellipse/></g><g class="orb orb-b"><ellipse/></g>`;
  stage.append(orbits);

  // ---------- globe geometry on screen
  function centerPx() { const c = map.getCenter(); const p = map.project(c); const r = container.getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }
  function radiusPx() {
    const c = map.getCenter();
    const p0 = map.project(c);
    const p1 = map.project(destination([c.lng, c.lat], (88 * Math.PI) / 180, Math.PI / 2));
    return Math.hypot(p1.x - p0.x, p1.y - p0.y) / Math.sin((88 * Math.PI) / 180);
  }
  // Globe radius on screen grows as 2^zoom and, in MapLibre's globe, with the centre latitude
  // (≈ cos(lat)^-0.78, measured). Calibrate once at low zoom so altitude→zoom stays right even
  // when the map is currently zoomed deep into a country.
  const latK = (lat) => Math.pow(Math.cos((Math.max(-80, Math.min(80, lat)) * Math.PI) / 180), 0.78);
  let kRad = null;
  function calibrate() {
    if (map.getZoom() > 3.5) return;
    const r = radiusPx();
    if (r > 0) kRad = (r * latK(map.getCenter().lat)) / 2 ** map.getZoom();
  }
  const zoomForAlt = (alt, lat = map.getCenter().lat) => {
    if (kRad == null) calibrate();
    if (kRad == null) return startZoom;
    return Math.max(0.2, Math.min(11, Math.log2((radiusForAlt(alt) * latK(lat)) / kRad)));
  };
  map.on("moveend", calibrate);
  ready.then(calibrate);
  const altForZoom = () => { const r = radiusPx(); const k = r / ((innerHeight / 2) / Math.tan((25 * Math.PI) / 180)); return 1 / Math.sin(Math.atan(k)) - 1; };

  function syncOverlay() {
    const r = radiusPx();
    const [cx, cy] = centerPx();
    const sr = stage.getBoundingClientRect();
    orbits.style.setProperty("--cx", `${cx - sr.left}px`);
    orbits.style.setProperty("--cy", `${cy - sr.top}px`);
    orbits.querySelector(".orb-a ellipse").setAttribute("rx", r * 1.52);
    orbits.querySelector(".orb-a ellipse").setAttribute("ry", r * 1.52 * 0.3);
    orbits.querySelector(".orb-b ellipse").setAttribute("rx", r * 1.74);
    orbits.querySelector(".orb-b ellipse").setAttribute("ry", r * 1.74 * 0.24);
    orbits.style.opacity = countryMode || map.getZoom() > 3.2 ? "0" : "";
    for (const m of markers) {
      const p = map.project([m.lng, m.lat]);
      const rect = container.getBoundingClientRect();
      const c = map.getCenter();
      const hidden = map.getZoom() < 5 && angularDist([c.lng, c.lat], [m.lng, m.lat]) > (80 * Math.PI) / 180;
      m.el.style.transform = `translate(${rect.left + p.x}px, ${rect.top + p.y}px)`;
      m.el.style.opacity = hidden ? "0" : "1";
    }
  }
  map.on("render", syncOverlay);
  addEventListener("resize", () => requestAnimationFrame(syncOverlay));

  // ---------- "You are here" (HTML overlay outside the blended stage)
  const markers = [];
  function clearMarkers() { markers.splice(0).forEach((m) => m.el.remove()); }

  // ---------- hover + click on countries (hexagons in the country view take precedence)
  let hoverIso = null;
  const hitLayers = () => ["land50", "land"].filter((id) => map.getLayer(id));
  const setHover = (iso) => {
    if (iso === hoverIso) return;
    for (const src of ["countries", "americas"]) {
      if (!map.getSource(src)) continue;
      if (hoverIso) map.setFeatureState({ source: src, id: hoverIso }, { hover: false });
      if (iso) map.setFeatureState({ source: src, id: iso }, { hover: true });
    }
    hoverIso = iso;
  };
  const overlayHit = (point) => (map.getLayer("hx-fill") ? map.queryRenderedFeatures(point, { layers: ["hx-fill", "pts"].filter((id) => map.getLayer(id)) }).length > 0 : false);
  function countryAtPoint(point) {
    const f = map.queryRenderedFeatures(point, { layers: hitLayers() })[0];
    return f ? countryByIso(f.properties.iso2) : null;
  }
  map.on("mousemove", (e) => {
    if (!stage.classList.contains("is-interactive")) return;
    if (drawing || overlayHit(e.point)) { setHover(null); onCountryHover?.(null); return; }
    const f = countryAtPoint(e.point);
    const own = countryMode && f?.properties.iso2 === focusIso;
    setHover(f && !own ? f.properties.iso2 : null);
    container.style.cursor = f && !own ? "pointer" : "";
    onCountryHover?.(f && !own ? f : null);
  });
  map.on("mouseout", () => { setHover(null); onCountryHover?.(null); });
  map.on("click", (e) => {
    if (drawing || overlayHit(e.point)) return;
    const f = countryAtPoint(e.point);
    if (!f) { onCountryHover?.(null); return; }
    if (countryMode && f.properties.iso2 === focusIso) return;
    onCountryClick?.(f);
  });

  // ---------- auto-rotation (5°/s, paused while the user interacts)
  let autoAllowed = true, autoOn = true, resumeTimer = 0, interacting = false, last = performance.now();
  const BASE = reducedMotion ? 1 : 5;
  const pauseRotation = () => { autoOn = false; clearTimeout(resumeTimer); resumeTimer = setTimeout(() => (autoOn = autoAllowed), 3000); };
  container.addEventListener("pointerdown", () => { interacting = true; pauseRotation(); });
  addEventListener("pointerup", () => { interacting = false; });
  container.addEventListener("wheel", pauseRotation, { passive: true });
  container.addEventListener("pointermove", (e) => { if (e.buttons) pauseRotation(); });

  // ---------- frame loop: rotation, ember flicker, arc dashes
  const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  let dashI = 0, lastDash = 0, lastFlick = 0, paused = false;
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (paused || document.hidden || !loaded) return;
    if (autoOn && autoAllowed && !interacting && !countryMode && !map.isMoving()) {
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + BASE * dt, c.lat] });
    }
    if (!reducedMotion && !countryMode) {
      if (now - lastDash > 70) { lastDash = now; dashI = (dashI + 1) % DASH.length; map.setPaintProperty("arcs", "line-dasharray", DASH[dashI]); }
      if (now - lastFlick > 140) { lastFlick = now; const k = 0.5 + 0.12 * Math.sin(now / 420) + 0.06 * Math.sin(now / 157); map.setPaintProperty("hot-glow", "circle-opacity", ["case", ["get", "active"], state.theme === "day" ? k * 0.65 : k, 0.25]); }
    }
  };
  requestAnimationFrame(loop);
  document.addEventListener("visibilitychange", () => { last = performance.now(); });

  // ---------- interaction switches
  const handlers = ["dragPan", "scrollZoom", "doubleClickZoom", "touchZoomRotate", "keyboard"];
  function setInteractive(on) {
    stage.classList.toggle("is-interactive", on);
    for (const h of handlers) on ? map[h].enable() : map[h].disable();
    if (on) map.touchZoomRotate.disableRotation();
    if (!on) { setHover(null); onCountryHover?.(null); }
  }
  setInteractive(false);

  // ---------- country mode (same map: the globe flies down and flattens)
  let focusIso = "";
  function setFocus(iso) {
    focusIso = iso ?? "";
    whenReady(() => {
      for (const id of ["focus-glow", "focus-line"]) map.setFilter(id, ["==", ["get", "iso2"], focusIso]);
    });
  }
  function enterCountry(bbox, { padding, duration = 1600 } = {}) {
    countryMode = true;
    layout = "country";
    stage.dataset.layout = "country";
    stage.style.setProperty("--gx", "0px");
    stage.style.setProperty("--gy", "0px");
    autoAllowed = false; autoOn = false;
    applyTheme();
    setInteractive(true);
    return new Promise((resolve) => whenReady(() => {
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding, duration: reducedMotion ? 0 : duration, maxZoom: 9, essential: true });
      map.once("moveend", resolve);
      if (reducedMotion) setTimeout(resolve, 50);
    }));
  }
  function exitCountry() {
    countryMode = false;
    setFocus("");
    autoAllowed = true;
    applyTheme();
  }

  let layout = "hero";
  const api = {
    map,
    get canvas() { return map.getCanvas(); },
    get layout() { return layout; },
    get countryMode() { return countryMode; },
    ready,
    setHotspots,
    setArcs,
    radiusPx,
    centerPx,
    pov(lat, lng, alt, ms = 1400) {
      whenReady(() => {
        const zoom = alt != null ? zoomForAlt(alt, lat) : map.getZoom();
        map.easeTo({ center: [lng, lat], zoom, duration: reducedMotion ? 0 : ms, essential: true });
      });
    },
    getPov() { const c = map.getCenter(); return { lat: c.lat, lng: c.lng, altitude: altForZoom() }; },
    rotateBy(dLng, dLat = 0) {
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + dLng, Math.max(-70, Math.min(70, c.lat + dLat))] });
      pauseRotation();
    },
    zoomBy(f) { map.easeTo({ zoom: map.getZoom() - Math.log2(f) * 1.6, duration: reducedMotion ? 0 : 450 }); pauseRotation(); },
    setLayout(name, { ms = 1100, keepPov = false } = {}) {
      if (countryMode && name !== "country") exitCountry();
      layout = name;
      const L = layoutFor(name);
      stage.dataset.layout = name;
      stage.style.setProperty("--gx", `${L.x * 100}vw`);
      stage.style.setProperty("--gy", `${L.y * 100}vh`);
      if (!keepPov) whenReady(() => map.easeTo({ zoom: zoomForAlt(L.alt), duration: reducedMotion ? 0 : ms, essential: true }));
    },
    setInteractive,
    setAutoRotate(on) { autoAllowed = on; autoOn = on; },
    youAreHere(lat, lng, label) {
      clearMarkers();
      const el = document.createElement("div");
      el.className = "you-are-here";
      el.innerHTML = `<span class="yah-dot" aria-hidden="true"><i></i><i></i></span><span class="yah-label"></span>`;
      el.querySelector(".yah-label").textContent = label;
      el.style.setProperty("--viirs", VIIRS_BLUE);
      document.body.append(el);
      markers.push({ el, lat, lng });
      pauseRotation();
      syncOverlay();
    },
    clearMarkers,
    enterCountry,
    exitCountry,
    setFocus,
    setDrawing(on) { drawing = on; },
    pause() { paused = true; },
    resume() { paused = false; },
  };
  let drawing = false;
  whenReady(applyTheme);
  return api;
}
