// Country geometry helpers (Natural Earth, public domain).
import { geoContains, geoBounds, geoArea, geoCentroid } from "../../vendor/geo.js";
import { ACTIVE_REGIONS } from "../config.js";

let world = null;
let byIso = new Map();
let index = [];

// Countries that cross the antimeridian get a hand-made bbox (west < east, as the contract requires).
// MX matches the bbox of the backend example response (data/ejemplo/respuestas_api/calendario_mexico.json).
const BBOX_OVERRIDES = { US: [-170, 18.5, -66.5, 71.5], MX: [-118.5, 14.5, -86.5, 32.8], FJ: [177, -19, 180, -16] };

export async function loadWorld() {
  if (world) return world;
  const res = await fetch("./data/countries-110m.json");
  world = await res.json();
  for (const f of world.features) {
    const p = f.properties;
    p.active = ACTIVE_REGIONS.includes(p.region);
    p.bbox = BBOX_OVERRIDES[p.iso2] ?? fixBounds(geoBounds(f));
    p.area = geoArea(f);
    byIso.set(p.iso2, f);
    index.push(f);
  }
  return world;
}

function fixBounds([[w, s], [e, n]]) {
  if (w > e) return [-180, s, 180, n];
  return [w, s, e, n];
}

export const countryByIso = (iso) => byIso.get(iso);
export const allCountries = () => index;

export function countryAt(lat, lon) {
  for (const f of index) {
    const [w, s, e, n] = f.properties.bbox;
    if (lat < s || lat > n || lon < w || lon > e) continue;
    if (geoContains(f, [lon, lat])) return f;
  }
  return null;
}

export function landTest(lat, lon) {
  const f = countryAt(lat, lon);
  return f ? { iso2: f.properties.iso2, region: f.properties.region } : null;
}

export const isActiveRegion = (region) => ACTIVE_REGIONS.includes(region);
export { geoCentroid };

export function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}
