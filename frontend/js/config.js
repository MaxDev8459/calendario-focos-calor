// Central configuration. SITE_NAME is a placeholder: change it here only.
export const SITE_NAME = "Heat Atlas";
// The API URL lives here only (team rule). Leave it empty to run on sample data.
// For testing, the page also accepts ?api=https://…/api or ?mock=1 in the address bar.
const params = new URLSearchParams(location.search);
const API_BASE = "https://focos-calor-api.vercel.app/api"; // deployed API (Vercel). Leave empty to run on sample data.
export const TEAM_NAME = "the Heat Atlas team"; // ← replace with the official team name
export const API_URL = (params.get("api") ?? API_BASE).replace(/\/$/, "");
export const USE_MOCK = params.get("mock") === "1" || !API_URL;
// M24 — demo scope. Regions outside this list render grey and show "Coming soon".
export const ACTIVE_REGIONS = ["north_america", "central_america", "caribbean", "south_america"];
// M12 — sequential ramp, monotonic lightness (fewer → more fire).
export const RAMP = ["#370617", "#6A040F", "#9D0208", "#D00000", "#DC2F02", "#E85D04", "#F48C06", "#FAA307", "#FFBA08", "#FFE8A3"];
// Day theme: same colours, reversed, so more fire = darker on the light background.
export const RAMP_DAY = [...RAMP].reverse();
// M12 — diverging ramp for anomalies (blue = below normal, red = above).
export const DIVERGING = ["#1D4E89", "#3F7CBF", "#9CC3E4", "#E9E2D6", "#F6B48A", "#E8622C", "#B3001B"];
export const VIIRS_BLUE = "#7CC6FF"; // reserved: VIIRS / 2012 marker only
export const INACTIVE_GREY = "#A49A94";

export const FIRST_MONTH = "2002-07"; // MODIS Aqua series starts Jul 2002 (contract A2)
export const LAST_MONTH_FALLBACK = "2025-12"; // metadata.json → ultimo_mes_completo
export const VIIRS_START_YEAR = 2012;
// Pilot area from the data contract examples (Morelos, Mexico).
export const PILOT_BBOX = [-99.5, 18.3, -98.6, 19.2];
export const MAX_POINTS = 5000;
