// Data access: fetch + error mapping + mock switch (§5.4, contract v0.3 Part B).
// Responses are normalized to one internal shape. Each result carries `sample: true` when it came from
// the simulated generator, so the UI can label it "Sample data" (§12). Real example responses from
// data/ejemplo/respuestas_api/ are served as-is for their exact requests.
import { API_URL, USE_MOCK, MAX_POINTS } from "../config.js";
import { ERRORS } from "../i18n/en.js";
import { landTest } from "../util/geo.js";

let mockMod = null;
const mock = async () => (mockMod ??= await import("../../mocks/generator.js"));

// Real example responses (Mexico, FIRMS, preliminary harmonization) keyed by bbox
const FIXTURES = {
  calendario: [
    { bbox: [-99.5, 18.3, -98.6, 19.2], file: "calendario_morelos.json" },
    { bbox: [-118.5, 14.5, -86.5, 32.8], file: "calendario_mexico.json" },
  ],
  anomalia: [{ bbox: [-99.5, 18.3, -98.6, 19.2], anio: 2024, mes: 4, file: "anomalia_morelos_2024_04.json" }],
};
const sameBbox = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.051);
const fixtureCache = new Map();
async function fixture(file) {
  if (!fixtureCache.has(file)) fixtureCache.set(file, fetch(`./mocks/ejemplo/${file}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return fixtureCache.get(file);
}

export class ApiError extends Error {
  constructor(code, detail) {
    super(ERRORS[code] ?? ERRORS.default); // English message only (M1)
    this.code = code;
    this.detail = detail;
  }
}

const bboxParam = (b) => b.map((n) => Number(n).toFixed(5)).join(",");
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();

async function get(path, params) {
  const url = `${API_URL}${path}?${qs(params)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw new ApiError("network", e);
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (body?.mensaje) console.warn(`[api] ${path}: ${body.error} — ${body.mensaje}`); // raw Spanish text stays in the console (M1)
    // 404 without a body, or a route the deployed API does not have yet (contract v0.4: "no_encontrado"), falls back to sample data
    if (res.status === 404 && (!body?.error || body.error === "no_encontrado")) throw new ApiError("not_found");
    throw new ApiError(body?.error ?? (res.status >= 500 ? "network" : "default"), body);
  }
  return res.json();
}

// Real request first (unless mock mode); fall back to labelled sample data when the API is missing or down.
async function withFallback(real, sample) {
  if (USE_MOCK) return { ...(await sample()), sample: true };
  try {
    return { ...(await real()), sample: false };
  } catch (e) {
    if (!["network", "not_found"].includes(e.code)) throw e;
    console.info("[api] falling back to sample data:", e.code);
    return { ...(await sample()), sample: true };
  }
}

// ---------- normalizers (contract v0.3 → internal)
function normCalendar(d) {
  return { ...d, promedio_mensual: d.promedio_mensual ?? null };
}
function normAnomaly(d) {
  return {
    ...d,
    anomalia: d.anomalia ?? d.anomalia_pct ?? null,
    total_anios: d.total_anios ?? d.de_anios ?? null,
    anomalia_vs_promedio: d.anomalia_vs_promedio ?? d.anomalia_vs_promedio_pct ?? null,
  };
}
function normSeries(d) {
  if (Array.isArray(d.serie)) return d;
  const serie = (d.meses ?? []).map((fecha, i) => ({ fecha, modis: d.modis_crudo?.[i] ?? null, viirs: d.viirs_crudo?.[i] ?? null, armonizado: d.armonizado?.[i] ?? null }));
  return { ...d, serie };
}

// ---------- endpoints
export async function getCalendar(bbox, desde, hasta) {
  const fx = FIXTURES.calendario.find((f) => sameBbox(f.bbox, bbox));
  const sample = async () => {
    if (fx) {
      const d = await fixture(fx.file);
      if (d) return { ...padCalendar(d, desde, hasta), example: true, sampleOverride: false };
    }
    return (await mock()).calendario({ bbox, desde, hasta });
  };
  const r = await withFallback(() => get("/calendario", { bbox: bboxParam(bbox), desde, hasta }), sample);
  if (r.example) r.sample = false;
  return normCalendar(r);
}

// The fixtures cover 2002-07..2025-12; keep the requested window, null outside the record.
function padCalendar(d, desde, hasta) {
  const have = new Map(d.celdas.map((c) => [`${c.anio}-${c.mes}`, c]));
  const celdas = [];
  let [y, m] = desde.split("-").map(Number);
  const [y2, m2] = hasta.split("-").map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    celdas.push(have.get(`${y}-${m}`) ?? { anio: y, mes: m, conteo: null, fuente: null });
    if (++m > 12) { m = 1; y++; }
  }
  return { ...d, desde, hasta, celdas };
}

export async function getAnomaly(bbox, anio, mes) {
  const fx = FIXTURES.anomalia.find((f) => sameBbox(f.bbox, bbox) && f.anio === anio && f.mes === mes);
  const sample = async () => {
    if (fx) { const d = await fixture(fx.file); if (d) return { ...d, example: true }; }
    return (await mock()).anomalia({ bbox, anio, mes });
  };
  const r = await withFallback(() => get("/anomalia", { bbox: bboxParam(bbox), anio, mes }), sample);
  if (r.example) r.sample = false;
  return normAnomaly(r);
}

export function getHotspots(bbox, desde, hasta) {
  return withFallback(
    () => get("/focos", { bbox: bboxParam(bbox), desde, hasta }),
    async () => (await mock()).focos({ bbox, desde, hasta, landTest, limit: MAX_POINTS }),
  );
}

// Requested v0.2 addition: aggregated 0.1° tiles for a bbox; falls back to binning /api/focos points.
export async function getCells(bbox, desde, hasta) {
  if (USE_MOCK) return { ...(await mock()).celdas({ bbox, desde, hasta }), sample: true };
  try {
    return { ...(await get("/celdas", { bbox: bboxParam(bbox), desde, hasta })), sample: false };
  } catch (e) {
    if (e.code === "not_found") {
      try {
        const pts = await get("/focos", { bbox: bboxParam(bbox), desde: `${desde}-01`, hasta: lastDayOf(hasta) });
        return { celdas: pts.features.map((f) => ({ lat_c: f.geometry.coordinates[1], lon_c: f.geometry.coordinates[0], conteo: 1 })), fromPoints: true, sample: false };
      } catch { /* fall through to sample */ }
    }
    return { ...(await mock()).celdas({ bbox, desde, hasta }), sample: true };
  }
}
const lastDayOf = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export function getGlobe(desde, hasta) {
  return withFallback(
    () => get("/globo", { desde, hasta }),
    async () => (await mock()).globo({ desde, hasta, landTest }),
  );
}

export async function getSeries(bbox) {
  const r = await withFallback(
    () => get("/serie_armonizacion", bbox ? { bbox: bboxParam(bbox) } : {}),
    async () => (await mock()).serieArmonizacion({ bbox }),
  );
  return normSeries(r);
}

// metadata.json (contract A4). A static copy ships in ./data/ until the API exposes it.
export async function getMetadata() {
  if (!USE_MOCK) {
    try { return { ...(await get("/metadata", {})), sample: false }; } catch { /* use the static copy */ }
  }
  try { const r = await fetch("./data/metadata.json"); if (r.ok) return { ...(await r.json()), sample: false }; } catch { /* ignore */ }
  return { ...(await mock()).metadata(), sample: true };
}

// factores.json (contract A3), real values from Datos.
export async function getFactors() {
  try { const r = await fetch("./data/factores.json"); if (r.ok) return await r.json(); } catch { /* ignore */ }
  return null;
}

// Last 7 days (NRT): count of /api/focos features for the last 7 days.
export async function getLast7(bbox, now) {
  if (USE_MOCK) return { ...(await mock()).ultimos7({ bbox, now }), sample: true };
  const end = new Date(now ?? Date.now());
  const start = new Date(end.getTime() - 6 * 86400000);
  try {
    const fc = await get("/focos", { bbox: bboxParam(bbox), desde: start.toISOString().slice(0, 10), hasta: end.toISOString().slice(0, 10) });
    return { total: fc.features.length, capped: fc.features.length >= MAX_POINTS, actualizado: new Date().toISOString(), sample: false };
  } catch {
    return { ...(await mock()).ultimos7({ bbox, now }), sample: true };
  }
}

// CSV download (M18). Real API: a link to /api/focos.csv; mock: a generated file with the same columns.
export async function downloadCsv(bbox, desde, hasta, pais) {
  const filename = `focos_${desde}_${hasta}.csv`;
  let href, revoke = false;
  if (USE_MOCK) {
    const text = (await mock()).focosCsv({ bbox, desde, hasta, landTest, limit: MAX_POINTS, pais });
    href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    revoke = true;
  } else {
    href = `${API_URL}/focos.csv?${qs({ bbox: bboxParam(bbox), desde, hasta })}`;
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 4000);
  return filename;
}
