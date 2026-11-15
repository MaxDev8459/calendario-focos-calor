// Formatting — always en-US as the source language (§9) so browser translation works from English.
import { MONTHS, MONTHS_SHORT } from "../i18n/en.js";
import { state } from "../state.js";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const fmtInt = (n) => (n == null ? "—" : nf0.format(Math.round(n)));
export const fmtNum = (n) => (n == null ? "—" : Math.abs(n) >= 100 ? nf0.format(n) : nf1.format(n));
export const fmtCompact = (n) => (n == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));
export function fmtPct(p, digits = 0) {
  if (p == null || !isFinite(p)) return "—";
  const v = Math.round(p * 10 ** digits) / 10 ** digits;
  const s = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s}%`;
}
// Anomaly vs a baseline, rounded to 1 decimal exactly like the API (anomalia_pct), so the calendar
// readout and the anomaly card show the same whole-number percentage after fmtPct.
export function anomalyPct(count, baseline) {
  if (count == null || !baseline) return null;
  return Math.round(((count - baseline) / baseline) * 1000) / 10;
}
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export const monthName = (m) => MONTHS[m - 1];
export const monthShort = (m) => MONTHS_SHORT[m - 1];
export function fmtMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}
export function fmtLat(lat) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
}
export function fmtLon(lon) {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

// Time zone helpers (M21)
export function tzOffsetMinutes(tz, date = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}
export function fmtOffset(min) {
  const sign = min >= 0 ? "+" : "−";
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
export const tzCity = (tz) => (tz.split("/").pop() || tz).replace(/_/g, " ");

export function fmtDateTime(date, tz = state.tz) {
  const d = typeof date === "string" ? new Date(date) : date;
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${s} ${fmtOffset(tzOffsetMinutes(tz, d))}`;
}
// FIRMS acq_date (YYYY-MM-DD) + acq_time (HHMM, UTC) → local string
export function fmtAcq(fecha, hora, tz = state.tz) {
  const d = new Date(`${fecha}T${hora.slice(0, 2)}:${hora.slice(2, 4)}:00Z`);
  return fmtDateTime(d, tz);
}
