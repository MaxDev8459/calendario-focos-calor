// Draw area / type coordinates (M11). Both produce bbox = west,south,east,north (5 decimals).
// A single lat/lon point creates a 0.5° box around it. English validation messages (M1).
import { T } from "../i18n/en.js";
import { round5 } from "../util/geo.js";

const E = T.country.controls.err;

export function validateBbox([w, s, e, n]) {
  const nums = [w, s, e, n].map(Number);
  if (nums.some((x) => !isFinite(x)) || [w, s, e, n].some((x) => String(x).trim() === "")) return { error: E.number };
  [w, s, e, n] = nums;
  if (w < -180 || w > 180 || e < -180 || e > 180) return { error: E.lon };
  if (s < -90 || s > 90 || n < -90 || n > 90) return { error: E.lat };
  if (w >= e) return { error: E.we };
  if (s >= n) return { error: E.sn };
  return { bbox: [round5(w), round5(s), round5(e), round5(n)] };
}

export function pointToBbox(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon) || String(lat).trim() === "") return { error: E.number };
  if (lat < -90 || lat > 90) return { error: E.lat };
  if (lon < -180 || lon > 180) return { error: E.lon };
  return validateBbox([Math.max(-180, lon - 0.25), Math.max(-90, lat - 0.25), Math.min(180, lon + 0.25), Math.min(90, lat + 0.25)]);
}

export function validateMonthRange(from, to, min, max) {
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!re.test(from) || !re.test(to)) return { error: E.month };
  if (from > to) return { error: E.order };
  if (from < min || to > max) return { error: E.range(min, max) };
  return { from, to };
}

export function validateDayRange(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return { error: E.day };
  if (from > to) return { error: E.order };
  return { from, to };
}

// Rectangle drawing on the live map: press, drag, release (mouse, pen or touch). Esc cancels.
export function startDraw(globe, { onDone, onCancel }) {
  const map = globe.map;
  const canvas = map.getCanvasContainer();
  const EMPTY = { type: "FeatureCollection", features: [] };
  if (!map.getSource("draft")) {
    map.addSource("draft", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "draft-fill", type: "fill", source: "draft", paint: { "fill-color": "#ffba08", "fill-opacity": 0.1 } });
    map.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#ffba08", "line-width": 1.8, "line-dasharray": [2, 2] } });
  }
  const box = (a, b) => [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
  const show = (bb) => map.getSource("draft").setData(bb ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [bb[0], bb[1]]]] } } : EMPTY);
  let start = null;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return map.unproject([e.clientX - r.left, e.clientY - r.top]); };
  const down = (e) => {
    if (e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    start = at(e);
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => { if (start) show(box(start, at(e))); };
  const up = (e) => {
    if (!start) return;
    const bb = box(start, at(e));
    start = null;
    finish();
    if (bb[2] - bb[0] < 0.02 || bb[3] - bb[1] < 0.02) { onCancel?.(); return; }
    onDone(validateBbox(bb));
  };
  function finish() {
    canvas.removeEventListener("pointerdown", down, true);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.classList.remove("is-drawing");
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.disableRotation();
    globe.setDrawing(false);
    show(null);
  }
  map.dragPan.disable();
  map.touchZoomRotate.disable();
  globe.setDrawing(true);
  canvas.classList.add("is-drawing");
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  return () => { finish(); onCancel?.(); };
}
