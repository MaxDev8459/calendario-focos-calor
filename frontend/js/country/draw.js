// Draw area / type coordinates (M11). Both produce bbox = west,south,east,north (5 decimals).
// A single lat/lon point creates a 0.5° box around it. English validation messages (M1).
// AI-assisted code — see README "Use of AI".
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

// Rectangle drawing on the Leaflet map (Leaflet.draw, rectangle only)
export function startDraw(L, map, { onDone, onCancel }) {
  const handler = new L.Draw.Rectangle(map, {
    showArea: false, // avoids a known Leaflet.draw + Leaflet 1.9 tooltip bug
    shapeOptions: { className: "map-area drawing", weight: 1.6, fillOpacity: 0.08, color: "#FFBA08" },
  });
  const created = (e) => {
    const b = e.layer.getBounds();
    finish();
    onDone(validateBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]));
  };
  const stopped = () => { finish(); onCancel?.(); };
  function finish() { map.off(L.Draw.Event.CREATED, created); map.off(L.Draw.Event.DRAWSTOP, stopped); }
  map.on(L.Draw.Event.CREATED, created);
  map.once(L.Draw.Event.DRAWSTOP, stopped);
  handler.enable();
  return () => handler.disable();
}
