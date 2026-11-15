// Deterministic SAMPLE fire model used only in mock mode.
// Every number it produces is simulated and is labelled "Sample data" in the UI.
// The shapes it returns follow backend contract v0.1 (+ requested v0.2 fields).
// AI-assisted code — see README "Use of AI".

// Fire "clusters": centre, spread (degrees), annual weight (harmonized hotspots), peak month, season width, trend.
// Rough, plausible geography for the demo — not a scientific model.
export const CLUSTERS = [
  // Americas
  { id: "mx-centro", lat: 18.9, lon: -99.3, sLat: 1.4, sLon: 2.2, w: 14000, peak: 4, k: 3.2, trend: 0.01, region: "americas" },
  { id: "mx-sur", lat: 16.8, lon: -93.5, sLat: 1.3, sLon: 1.8, w: 16000, peak: 4, k: 3.4, trend: 0.012, region: "americas" },
  { id: "mx-yuc", lat: 19.3, lon: -89.3, sLat: 1.1, sLon: 1.3, w: 13000, peak: 4, k: 3.4, trend: 0.01, region: "americas" },
  { id: "mx-occ", lat: 21.5, lon: -104.4, sLat: 2.0, sLon: 1.8, w: 9000, peak: 5, k: 2.8, trend: 0.004, region: "americas" },
  { id: "mx-norte", lat: 27.5, lon: -106.5, sLat: 2.4, sLon: 2.2, w: 4500, peak: 5, k: 2.2, trend: 0.0, region: "americas" },
  { id: "gt-hn", lat: 15.2, lon: -88.6, sLat: 1.0, sLon: 2.0, w: 17000, peak: 4, k: 3.6, trend: 0.006, region: "americas" },
  { id: "ni", lat: 13.2, lon: -85.2, sLat: 1.0, sLon: 1.0, w: 9000, peak: 4, k: 3.4, trend: 0.0, region: "americas" },
  { id: "us-se", lat: 32.5, lon: -84.0, sLat: 2.6, sLon: 4.0, w: 16000, peak: 3, k: 1.4, trend: -0.004, region: "americas" },
  { id: "us-west", lat: 41.0, lon: -121.5, sLat: 3.4, sLon: 2.2, w: 9000, peak: 8, k: 3.4, trend: 0.025, region: "americas" },
  { id: "us-plains", lat: 37.5, lon: -96.5, sLat: 2.0, sLon: 2.4, w: 12000, peak: 4, k: 2.4, trend: 0.0, region: "americas" },
  { id: "us-ag", lat: 35.0, lon: -91.0, sLat: 2.2, sLon: 1.6, w: 9000, peak: 10, k: 2.0, trend: 0.0, region: "americas" },
  { id: "ca-bc", lat: 54.0, lon: -123.5, sLat: 3.0, sLon: 3.0, w: 7000, peak: 8, k: 4.2, trend: 0.03, region: "americas" },
  { id: "ca-boreal", lat: 57.0, lon: -110.0, sLat: 3.4, sLon: 8.0, w: 12000, peak: 7, k: 4.2, trend: 0.03, region: "americas" },
  { id: "ca-quebec", lat: 51.5, lon: -76.0, sLat: 2.0, sLon: 4.0, w: 4000, peak: 6, k: 4.0, trend: 0.03, region: "americas" },
  { id: "ak", lat: 64.5, lon: -149.0, sLat: 2.0, sLon: 6.0, w: 6000, peak: 7, k: 4.6, trend: 0.02, region: "americas" },
  { id: "cu", lat: 21.8, lon: -79.5, sLat: 0.8, sLon: 3.0, w: 3500, peak: 4, k: 3.0, trend: 0.0, region: "americas" },
  { id: "hisp", lat: 18.9, lon: -71.5, sLat: 0.7, sLon: 1.2, w: 2500, peak: 3, k: 3.0, trend: 0.0, region: "americas" },
  { id: "llanos", lat: 6.0, lon: -69.0, sLat: 1.8, sLon: 3.4, w: 40000, peak: 2, k: 4.0, trend: -0.005, region: "americas" },
  { id: "co-amz", lat: 1.5, lon: -74.0, sLat: 1.5, sLon: 2.2, w: 9000, peak: 2, k: 3.6, trend: 0.01, region: "americas" },
  { id: "amz-arc", lat: -9.5, lon: -55.0, sLat: 3.2, sLon: 8.0, w: 210000, peak: 8.6, k: 4.4, trend: -0.004, region: "americas" },
  { id: "amz-acre", lat: -9.5, lon: -67.5, sLat: 2.2, sLon: 3.4, w: 45000, peak: 9, k: 4.6, trend: 0.004, region: "americas" },
  { id: "cerrado", lat: -13.5, lon: -46.5, sLat: 3.4, sLon: 3.2, w: 95000, peak: 9, k: 4.0, trend: -0.006, region: "americas" },
  { id: "matopiba", lat: -7.5, lon: -45.5, sLat: 2.6, sLon: 2.6, w: 60000, peak: 9.5, k: 4.0, trend: 0.002, region: "americas" },
  { id: "bo-chiqui", lat: -16.5, lon: -62.0, sLat: 2.2, sLon: 3.0, w: 90000, peak: 9, k: 4.8, trend: 0.01, region: "americas" },
  { id: "pantanal", lat: -18.0, lon: -57.0, sLat: 1.6, sLon: 1.4, w: 26000, peak: 9, k: 4.6, trend: 0.012, region: "americas" },
  { id: "chaco", lat: -22.5, lon: -60.5, sLat: 2.2, sLon: 2.6, w: 42000, peak: 8.5, k: 3.6, trend: 0.006, region: "americas" },
  { id: "ar-pampa", lat: -32.0, lon: -60.0, sLat: 2.4, sLon: 2.4, w: 16000, peak: 9, k: 2.6, trend: 0.0, region: "americas" },
  { id: "ar-delta", lat: -33.5, lon: -59.5, sLat: 0.6, sLon: 0.8, w: 5000, peak: 8, k: 3.2, trend: 0.01, region: "americas" },
  { id: "cl-centro", lat: -36.5, lon: -72.2, sLat: 1.6, sLon: 0.5, w: 6000, peak: 1.5, k: 4.6, trend: 0.02, region: "americas" },
  { id: "pe-amz", lat: -8.5, lon: -75.5, sLat: 2.4, sLon: 1.6, w: 9000, peak: 9, k: 3.8, trend: 0.0, region: "americas" },
  { id: "ve-guayana", lat: 6.5, lon: -63.0, sLat: 1.6, sLon: 2.0, w: 9000, peak: 3, k: 3.8, trend: 0.0, region: "americas" },
  // Other continents (grey in the demo, M24)
  { id: "sahel", lat: 10.0, lon: 5.0, sLat: 2.8, sLon: 14.0, w: 300000, peak: 12.5, k: 3.6, trend: 0, region: "other" },
  { id: "s-africa", lat: -11.0, lon: 24.0, sLat: 4.0, sLon: 8.0, w: 380000, peak: 7.5, k: 3.6, trend: 0, region: "other" },
  { id: "e-africa", lat: 2.0, lon: 33.0, sLat: 4.0, sLon: 3.0, w: 50000, peak: 1, k: 3.0, trend: 0, region: "other" },
  { id: "madag", lat: -18.5, lon: 46.5, sLat: 3.0, sLon: 1.4, w: 40000, peak: 10, k: 3.6, trend: 0, region: "other" },
  { id: "india", lat: 23.0, lon: 80.0, sLat: 4.0, sLon: 5.0, w: 70000, peak: 4, k: 3.0, trend: 0, region: "other" },
  { id: "punjab", lat: 30.5, lon: 75.5, sLat: 1.0, sLon: 1.4, w: 30000, peak: 10.8, k: 6.0, trend: 0, region: "other" },
  { id: "se-asia", lat: 18.0, lon: 101.0, sLat: 3.6, sLon: 4.6, w: 120000, peak: 3, k: 4.0, trend: 0, region: "other" },
  { id: "indonesia", lat: -1.5, lon: 110.5, sLat: 2.6, sLon: 6.0, w: 60000, peak: 9, k: 4.4, trend: 0, region: "other" },
  { id: "siberia", lat: 58.0, lon: 115.0, sLat: 5.0, sLon: 16.0, w: 90000, peak: 6, k: 3.4, trend: 0, region: "other" },
  { id: "kazakh", lat: 52.0, lon: 70.0, sLat: 2.4, sLon: 8.0, w: 40000, peak: 8, k: 3.0, trend: 0, region: "other" },
  { id: "ukraine", lat: 48.5, lon: 34.0, sLat: 2.6, sLon: 6.0, w: 26000, peak: 8, k: 2.4, trend: 0, region: "other" },
  { id: "iberia", lat: 40.0, lon: -6.5, sLat: 2.0, sLon: 2.6, w: 6000, peak: 8, k: 4.0, trend: 0, region: "other" },
  { id: "aus-north", lat: -15.5, lon: 132.0, sLat: 2.6, sLon: 9.0, w: 160000, peak: 9, k: 3.4, trend: 0, region: "other" },
  { id: "aus-east", lat: -31.0, lon: 150.0, sLat: 3.0, sLon: 1.6, w: 15000, peak: 12, k: 3.0, trend: 0, region: "other" },
];

// Monthly calibration factor VIIRS ÷ MODIS (sample values; real ones come from factores.json).
export const FACTORS = [3.42, 3.58, 3.86, 4.05, 3.83, 3.54, 3.31, 3.24, 3.39, 3.61, 3.72, 3.51];

export const FIRST_YEAR = 2002;
export const FIRST_MONTH = 7; // MODIS Aqua series starts Jul 2002 (contract A2)
export const LAST_COMPLETE = { year: 2025, month: 12 }; // as metadata.json → ultimo_mes_completo
export const GENERATED_AT = "2026-11-14T22:19:31Z";

// Small deterministic hash → [0,1)
export function hash(...n) {
  let h = 2166136261;
  for (const x of n) {
    const v = Math.floor(x * 1000) | 0;
    h ^= v;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}
function strSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
CLUSTERS.forEach((c) => (c.seed = strSeed(c.id)));

export function season(c, m) {
  // von Mises bump on the 12-month circle, normalized so the 12 values sum to 1
  if (!c._season) {
    const raw = [];
    for (let i = 1; i <= 12; i++) raw.push(Math.exp(c.k * Math.cos((2 * Math.PI * (i - c.peak)) / 12)));
    const s = raw.reduce((a, b) => a + b, 0);
    c._season = raw.map((v) => v / s);
  }
  return c._season[m - 1];
}

// Notable sample years per cluster so the record has extremes.
const EVENTS = { "mx-centro": { 2024: 1.9, 2013: 1.35, 2017: 1.3, 2011: 1.4 }, "mx-sur": { 2024: 1.8, 2013: 1.3, 2017: 1.4, 2011: 1.5 }, "mx-yuc": { 2024: 1.7, 2019: 1.4 }, "gt-hn": { 2024: 1.6, 2019: 1.3 }, "amz-arc": { 2019: 1.25, 2020: 1.3, 2024: 1.45, 2004: 1.4, 2005: 1.35, 2010: 1.45 }, "bo-chiqui": { 2019: 1.6, 2024: 1.8, 2010: 1.4 }, pantanal: { 2020: 2.4, 2024: 1.9 }, "ca-boreal": { 2023: 3.2, 2016: 1.6 }, "ca-quebec": { 2023: 4.0 }, "ca-bc": { 2017: 2.2, 2018: 2.3, 2021: 1.8, 2023: 2.4 }, "us-west": { 2020: 2.4, 2021: 1.8, 2018: 1.6 }, "cl-centro": { 2017: 3.0, 2023: 2.0 } };

export function yearFactor(c, y, m) {
  const t = 1 + c.trend * (y - 2013);
  const n = 0.75 + 0.5 * hash(c.seed, y);
  const nm = 0.85 + 0.3 * hash(c.seed, y, m);
  const ev = EVENTS[c.id]?.[y] ?? 1;
  return Math.max(0.05, t * n * nm * ev);
}

function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const cdf = (x, mu, s) => 0.5 * (1 + erf((x - mu) / (s * Math.SQRT2)));

// Fraction of a cluster's mass inside a bbox
export function bboxFraction(c, [w, s, e, n]) {
  const fx = cdf(e, c.lon, c.sLon) - cdf(w, c.lon, c.sLon);
  const fy = cdf(n, c.lat, c.sLat) - cdf(s, c.lat, c.sLat);
  return Math.max(0, fx) * Math.max(0, fy);
}

// Density per km² (harmonized hotspots per month) at a point for a given month/year
export function density(lat, lon, y, m) {
  let v = 0;
  for (const c of CLUSTERS) {
    const dx = (lon - c.lon) / c.sLon;
    const dy = (lat - c.lat) / c.sLat;
    const d2 = dx * dx + dy * dy;
    if (d2 > 16) continue;
    const kmLat = 111 * c.sLat;
    const kmLon = 111 * c.sLon * Math.cos((c.lat * Math.PI) / 180);
    const peakDensity = c.w / (2 * Math.PI * kmLat * kmLon);
    v += peakDensity * Math.exp(-0.5 * d2) * season(c, m) * (y ? yearFactor(c, y, m) : 1);
  }
  return v;
}

export function isAvailable(y, m) {
  if (y < FIRST_YEAR || (y === FIRST_YEAR && m < FIRST_MONTH)) return false;
  if (y > LAST_COMPLETE.year) return false;
  if (y === LAST_COMPLETE.year && m > LAST_COMPLETE.month) return false;
  return true;
}

// Harmonized monthly count for a bbox (analytic integral of the clusters)
export function bboxCount(bbox, y, m, region = "americas") {
  if (!isAvailable(y, m)) return null;
  let v = 0;
  for (const c of CLUSTERS) {
    if (region && c.region !== region) continue;
    const f = bboxFraction(c, bbox);
    if (f < 1e-6) continue;
    v += c.w * f * season(c, m) * yearFactor(c, y, m);
  }
  // tiny background so small areas are not empty
  const area = Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  v += area * 0.04 * (0.6 + 0.8 * hash(y, m, bbox[0], bbox[1]));
  return Math.round(v * 10) / 10;
}
