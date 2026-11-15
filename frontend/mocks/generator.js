// Mock API — returns SAMPLE data in the exact shape of backend contract v0.1
// (plus the v0.2 fields Frontend requested). Used when VITE_USE_MOCK=true or when the API is unreachable.
// AI-assisted code — see README "Use of AI".
import { CLUSTERS, FACTORS, FIRST_YEAR, FIRST_MONTH, LAST_COMPLETE, GENERATED_AT, bboxCount, bboxFraction, season, yearFactor, density, hash, isAvailable } from "./model.js";

const pad = (n) => String(n).padStart(2, "0");
const parseMonth = (s) => s.split("-").map(Number);
function* monthsBetween(desde, hasta) {
  let [y, m] = parseMonth(desde);
  const [y2, m2] = parseMonth(hasta);
  while (y < y2 || (y === y2 && m <= m2)) {
    yield [y, m];
    m++;
    if (m > 12) { m = 1; y++; }
  }
}
function median(arr) {
  const a = arr.filter((v) => v != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const mean = (arr) => { const a = arr.filter((v) => v != null); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => { const u = 1 - rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function niceCuts(values) {
  const v = values.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4, 5, 6, 7];
  const qs = [0.12, 0.25, 0.4, 0.55, 0.7, 0.84, 0.94].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
  const nice = (x) => { if (x < 10) return Math.max(1, Math.round(x)); const p = 10 ** Math.floor(Math.log10(x)); return Math.round(x / (p / 2)) * (p / 2); };
  const out = [];
  for (const q of qs) { let n = nice(q); if (out.length && n <= out[out.length - 1]) n = out[out.length - 1] + Math.max(1, Math.round(out[out.length - 1] * 0.1)); out.push(n); }
  return out;
}

export function calendario({ bbox, desde, hasta }) {
  const celdas = [];
  for (const [anio, mes] of monthsBetween(desde, hasta)) {
    const conteo = bboxCount(bbox, anio, mes);
    celdas.push({ anio, mes, conteo, fuente: anio >= 2012 ? "VIIRS" : "MODIS_ajustado" });
  }
  // Baselines use every available year (the full record), as in the contract.
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let y = FIRST_YEAR; y <= LAST_COMPLETE.year; y++) for (let m = 1; m <= 12; m++) byMonth[m - 1].push(bboxCount(bbox, y, m));
  const mediana_mensual = byMonth.map((a) => r1(median(a)));
  const promedio_mensual = byMonth.map((a) => r1(mean(a)));
  const mes_pico = mediana_mensual.indexOf(Math.max(...mediana_mensual)) + 1;
  const vals = celdas.map((c) => c.conteo);
  return {
    bbox, desde, hasta, unidad: "focos_armonizados", celdas, mediana_mensual, promedio_mensual, mes_pico,
    escala: { min: 0, max: Math.ceil(Math.max(0, ...vals.filter((x) => x != null))), cortes: niceCuts(vals) },
  };
}

export function anomalia({ bbox, anio, mes }) {
  const conteo = bboxCount(bbox, anio, mes);
  const serie = [];
  for (let y = FIRST_YEAR; y <= LAST_COMPLETE.year; y++) { const v = bboxCount(bbox, y, mes); if (v != null) serie.push({ anio: y, conteo: v }); }
  const vals = serie.map((s) => s.conteo);
  const med = median(vals);
  const prom = mean(vals);
  const sorted = [...serie].sort((a, b) => b.conteo - a.conteo);
  const lugar = conteo == null ? null : sorted.findIndex((s) => s.anio === anio) + 1;
  const percentil = conteo == null ? null : Math.round((vals.filter((v) => v <= conteo).length / vals.length) * 100);
  const pct = (base) => (conteo == null || !base ? null : Math.round(((conteo - base) / base) * 1000) / 10);
  // Contract B2 fields, then the v0.2 additions Frontend requested (promedio, anomalia_vs_promedio_pct, reportados)
  return {
    anio, mes, conteo, mediana: r1(med), anomalia_pct: pct(med), percentil, lugar, de_anios: vals.length,
    fuente: anio >= 2012 ? "VIIRS" : "MODIS_ajustado",
    promedio: r1(prom), anomalia_vs_promedio_pct: pct(prom), reportados: null,
  };
}

function expectedDaily(bbox, y, m) {
  const c = bboxCount(bbox, y, m);
  return c == null ? 0 : c / new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// GeoJSON points (max 5,000), Spanish contract keys
export function focos({ bbox, desde, hasta, landTest, limit = 5000 }) {
  const d0 = new Date(desde + "T00:00:00Z");
  const d1 = new Date(hasta + "T00:00:00Z");
  const days = [];
  let expected = 0;
  for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    const e = isAvailable(y, m) ? expectedDaily(bbox, y, m) : y > LAST_COMPLETE.year ? expectedDaily(bbox, LAST_COMPLETE.year, m) * 0.9 : 0;
    days.push([d.toISOString().slice(0, 10), e, y, m]);
    expected += e;
  }
  const total = Math.round(expected);
  const n = Math.min(limit, total);
  const rnd = mulberry32(Math.floor(hash(...bbox, d0.getTime() / 1e5, d1.getTime() / 1e5) * 1e9));
  // candidate clusters weighted by mass inside bbox
  const cand = CLUSTERS.map((c) => ({ c, f: bboxFraction(c, bbox) * c.w })).filter((x) => x.f > 0);
  const fsum = cand.reduce((s, x) => s + x.f, 0);
  const cum = []; let acc = 0; for (const d of days) { acc += d[1]; cum.push(acc); }
  const features = [];
  let guard = 0;
  while (features.length < n && guard < n * 30) {
    guard++;
    let lat, lon;
    if (fsum > 0 && rnd() < 0.92) {
      let r = rnd() * fsum, pick = cand[0];
      for (const x of cand) { r -= x.f; if (r <= 0) { pick = x; break; } }
      lat = pick.c.lat + gauss(rnd) * pick.c.sLat;
      lon = pick.c.lon + gauss(rnd) * pick.c.sLon;
    } else {
      lat = bbox[1] + rnd() * (bbox[3] - bbox[1]);
      lon = bbox[0] + rnd() * (bbox[2] - bbox[0]);
    }
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (landTest && !landTest(lat, lon)) continue;
    let r = rnd() * acc, di = 0;
    while (di < cum.length - 1 && cum[di] < r) di++;
    const [fecha, , y] = days[di];
    const viirs = y >= 2012;
    const dn = rnd() < 0.82 ? "D" : "N";
    const hh = dn === "D" ? 17 + Math.floor(rnd() * 4) : 6 + Math.floor(rnd() * 3);
    const conf = viirs ? (rnd() < 0.12 ? "baja" : rnd() < 0.85 ? "nominal" : "alta") : (rnd() < 0.15 ? "baja" : rnd() < 0.8 ? "nominal" : "alta");
    const la = Math.round(lat * 1e5) / 1e5, lo = Math.round(lon * 1e5) / 1e5;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lo, la] },
      properties: {
        fecha, hora_utc: pad(hh) + pad(Math.floor(rnd() * 60)), lat: la, lon: lo,
        sensor: viirs ? "VIIRS" : "MODIS", satelite: viirs ? "SNPP" : "Aqua", confianza: conf,
        frp_mw: Math.round((2 + Math.pow(rnd(), 3) * 120) * 10) / 10, dia_noche: dn,
        ty: Math.floor(la / 0.1), tx: Math.floor(lo / 0.1),
      },
    });
  }
  return { type: "FeatureCollection", total_estimado: total, truncado: total > n, features };
}

// Same columns as contract A1 (the backend CSV). B3 names the file focos_<desde>_<hasta>.csv.
export function focosCsv(args) {
  const fc = focos(args);
  const rows = [["fecha", "hora_utc", "lat", "lon", "pais", "sensor", "satelite", "confianza", "frp_mw", "dia_noche", "ty", "tx"].join(",")];
  for (const f of fc.features) {
    const p = f.properties;
    rows.push([p.fecha, p.hora_utc, p.lat.toFixed(5), p.lon.toFixed(5), args.pais ?? "", p.sensor, p.satelite, p.confianza, p.frp_mw, p.dia_noche, p.ty, p.tx].join(","));
  }
  return rows.join("\n") + "\n";
}

// v0.2 request: aggregated harmonized counts per grid cell for a bbox and month range
export function celdas({ bbox, desde, hasta, step }) {
  const [w, s, e, n] = bbox;
  const area = (e - w) * (n - s);
  // 0.1° tiles like the contract (coarser only for continent-sized boxes, to stay fast)
  const res = step ?? (area > 2500 ? 0.25 : area > 1600 ? 0.2 : 0.1);
  const months = [...monthsBetween(desde, hasta)].filter(([y, m]) => isAvailable(y, m));
  // Collapse the month range into a per-cluster weight to keep it fast
  const weights = CLUSTERS.map((c) => months.reduce((acc, [y, m]) => acc + season(c, m) * yearFactor(c, y, m), 0));
  const out = [];
  const kmCellLat = 111 * res;
  for (let lat = s + res / 2; lat < n; lat += res) {
    const kmCellLon = 111 * res * Math.cos((lat * Math.PI) / 180);
    const cellKm2 = kmCellLat * kmCellLon;
    for (let lon = w + res / 2; lon < e; lon += res) {
      let v = 0;
      CLUSTERS.forEach((c, i) => {
        const dx = (lon - c.lon) / c.sLon, dy = (lat - c.lat) / c.sLat;
        const d2 = dx * dx + dy * dy;
        if (d2 > 14 || !weights[i]) return;
        const pk = c.w / (2 * Math.PI * 111 * c.sLat * 111 * c.sLon * Math.cos((c.lat * Math.PI) / 180));
        v += pk * Math.exp(-0.5 * d2) * weights[i];
      });
      // texture: patchy fire-prone cells and quiet cells
      const h = hash(Math.round(lat * 20), Math.round(lon * 20));
      const tex = 0.25 + 1.6 * Math.pow(h, 1.6) + (h > 0.965 ? 2.2 : 0);
      v = v * cellKm2 * tex;
      // real tiles exist only where something burned: keep a tile with probability 1 − e^(−v/k)
      const p = 1 - Math.exp(-v / (2 + months.length * 0.15));
      if (p < 0.02 || hash(lat * 7.3, lon * 3.1, 11) > p) continue;
      v = v / Math.max(p, 0.05);
      out.push({ ty: Math.floor(lat / 0.1), tx: Math.floor(lon / 0.1), lat_c: Math.round(lat * 1e5) / 1e5, lon_c: Math.round(lon * 1e5) / 1e5, conteo: Math.round(v * 10) / 10 });
    }
  }
  return { bbox, desde, hasta, resolucion: res, unidad: "focos_armonizados", celdas: out };
}

// v0.2 request: aggregated hotspots for the globe + per-country totals
export function globo({ desde, hasta, landTest }) {
  const rnd = mulberry32(20261114);
  const months = [...monthsBetween(desde, hasta)].filter(([y, m]) => isAvailable(y, m));
  const celdas = [];
  const paises = {};
  const target = 9000;
  const totalW = CLUSTERS.reduce((s, c) => s + Math.sqrt(c.w), 0);
  for (const c of CLUSTERS) {
    const mass = months.reduce((acc, [y, m]) => acc + season(c, m) * yearFactor(c, y, m), 0) * c.w;
    const k = Math.round((target * Math.sqrt(c.w)) / totalW);
    let placed = 0, guard = 0;
    while (placed < k && guard < k * 12) {
      guard++;
      const lat = c.lat + gauss(rnd) * c.sLat * 1.1;
      const lon = c.lon + gauss(rnd) * c.sLon * 1.1;
      const land = landTest ? landTest(lat, lon) : { iso2: null, region: c.region };
      if (!land) continue;
      placed++;
      const conteo = Math.round((mass / k) * (0.3 + 1.7 * Math.pow(rnd(), 2)) * 10) / 10;
      celdas.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, conteo, region: land.region });
      if (land.iso2) paises[land.iso2] = (paises[land.iso2] ?? 0) + conteo;
    }
  }
  return { desde, hasta, unidad: "focos_armonizados", celdas, paises: Object.entries(paises).map(([iso_a2, conteo]) => ({ iso_a2, conteo: Math.round(conteo) })) };
}

export function serieArmonizacion({ bbox }) {
  const meses = [], modis_crudo = [], viirs_crudo = [], armonizado = [];
  for (let y = FIRST_YEAR; y <= LAST_COMPLETE.year; y++) {
    for (let m = 1; m <= 12; m++) {
      const h = bboxCount(bbox, y, m);
      if (h == null) continue;
      const noise = 0.9 + 0.2 * hash(y, m, 99);
      const modis = Math.round((h / FACTORS[m - 1]) * noise * 10) / 10;
      meses.push(`${y}-${pad(m)}`);
      modis_crudo.push(modis);
      viirs_crudo.push(y >= 2012 ? h : null);
      armonizado.push(h);
    }
  }
  return { meses, modis_crudo, viirs_crudo, armonizado };
}

export function metadata() {
  return { generado: GENERATED_AT, version_contrato: "0.3", primer_mes: `${FIRST_YEAR}-${pad(FIRST_MONTH)}`, ultimo_mes_completo: `${LAST_COMPLETE.year}-${pad(LAST_COMPLETE.month)}`, es_ejemplo: true };
}

// Simulated "near real time" detections for the last 7 days
export function ultimos7({ bbox, now }) {
  const end = new Date(now ?? GENERATED_AT);
  let e = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(end.getTime() - i * 86400000);
    const m = d.getUTCMonth() + 1;
    e += expectedDaily(bbox, LAST_COMPLETE.year, m <= LAST_COMPLETE.month ? m : LAST_COMPLETE.month) * (0.8 + 0.4 * hash(i, bbox[0]));
  }
  return { total: Math.round(e), desde: new Date(end.getTime() - 6 * 86400000).toISOString().slice(0, 10), hasta: end.toISOString().slice(0, 10), actualizado: GENERATED_AT };
}
