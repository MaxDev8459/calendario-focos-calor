// Top bar: logo, nav, time zone, day/night, Locate me (M21). No login UI (M3).
import { T, REGION_NAMES } from "../i18n/en.js";
import { icons } from "./icons.js";
import { state, set, on, safeSet, emit } from "../state.js";
import { tzOffsetMinutes, fmtOffset, tzCity } from "../util/format.js";
import { countryAt, isActiveRegion } from "../util/geo.js";
import { toast } from "./toast.js";

export function renderTopbar(el) {
  const n = T.nav;
  el.innerHTML = `
    <a class="brand" href="#hero" aria-label="${T.siteName} — home">
      <span class="brand-orb" aria-hidden="true"></span>
      <span class="brand-name">${T.siteName}</span>
    </a>
    <nav class="nav" aria-label="${n.label}">
      <a href="#explore" data-nav="explore">${n.explore}</a>
      <a href="#calendar" data-nav="calendar">${n.calendar}</a>
      <a href="#method" data-nav="method">${n.method}</a>
      <a href="#data" data-nav="data">${n.data}</a>
      <a href="#about" data-nav="about">${n.about}</a>
    </nav>
    <div class="controls">
      <label class="tz pill" title="${T.topbar.timezoneHint}">
        ${icons.clock}
        <span class="tz-off num" data-tz-off></span>
        <span class="tz-city" data-tz-city></span>
        ${icons.chevron}
        <span class="sr-only">${T.topbar.timezone}</span>
        <select data-tz aria-describedby="tz-hint"></select>
      </label>
      <span id="tz-hint" class="sr-only">${T.topbar.timezoneHint}</span>
      <div class="theme pill" role="group" aria-label="${T.topbar.theme}">
        <button type="button" data-theme-btn="night" aria-label="${T.topbar.night}" title="${T.topbar.night}">${icons.moon}</button>
        <button type="button" data-theme-btn="day" aria-label="${T.topbar.day}" title="${T.topbar.day}">${icons.sun}</button>
      </div>
      <button type="button" class="locate pill" data-locate>${icons.locate}<span data-locate-label>${T.topbar.locate}</span></button>
      <button type="button" class="menu-btn pill" data-menu aria-expanded="false" aria-controls="topbar" aria-label="${n.menu}">${icons.menu}</button>
    </div>`;

  // --- time zone
  const sel = el.querySelector("[data-tz]");
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = ["UTC", "America/Mexico_City", "America/Bogota", "America/Sao_Paulo", "America/New_York", "America/Los_Angeles"]; }
  if (!zones.includes(state.tz)) zones.unshift(state.tz);
  if (!zones.includes("UTC")) zones.unshift("UTC");
  const now = new Date();
  const rows = zones.map((z) => ({ z, off: tzOffsetMinutes(z, now) })).sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
  sel.innerHTML = rows.map(({ z, off }) => `<option value="${z}">${fmtOffset(off)} · ${tzCity(z)}</option>`).join("");
  const paintTz = () => {
    sel.value = state.tz;
    el.querySelector("[data-tz-off]").textContent = fmtOffset(tzOffsetMinutes(state.tz));
    el.querySelector("[data-tz-city]").textContent = tzCity(state.tz);
  };
  sel.addEventListener("change", () => set("tz", sel.value));
  on("tz", paintTz);
  paintTz();

  // --- theme
  const paintTheme = () => {
    document.documentElement.dataset.theme = state.theme;
    el.querySelectorAll("[data-theme-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === state.theme)));
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "day" ? "#f5ece1" : "#03071e");
  };
  el.querySelectorAll("[data-theme-btn]").forEach((b) =>
    b.addEventListener("click", () => { set("theme", b.dataset.themeBtn); safeSet("ha-theme", state.theme); }),
  );
  on("theme", paintTheme);
  paintTheme();

  // --- locate me: geolocation only after the click (no prompt on load)
  const locBtn = el.querySelector("[data-locate]");
  const locLabel = el.querySelector("[data-locate-label]");
  locBtn.addEventListener("click", () => {
    locLabel.textContent = T.topbar.locating;
    locBtn.disabled = true;
    const done = () => { locLabel.textContent = T.topbar.locate; locBtn.disabled = false; };
    if (!("geolocation" in navigator)) { fallbackToTz(); done(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        done();
        const { latitude: lat, longitude: lon } = pos.coords;
        const c = countryAt(lat, lon);
        emit("locate", { lat, lon, country: c, exact: true });
        if (c && !isActiveRegion(c.properties.region)) toast(T.topbar.locationOutside(REGION_NAMES[c.properties.region]));
      },
      () => { done(); fallbackToTz(); },
      { timeout: 9000, maximumAge: 600000 },
    );
  });

  // --- mobile menu
  const menuBtn = el.querySelector("[data-menu]");
  menuBtn.addEventListener("click", () => {
    const open = el.classList.toggle("is-open");
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? n.close : n.menu);
    menuBtn.innerHTML = open ? icons.close : icons.menu;
  });
  el.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => { if (el.classList.contains("is-open")) menuBtn.click(); }));

  on("section", (s) => {
    el.querySelectorAll("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.nav === s || (s === "country" && a.dataset.nav === "explore")));
  });
}

// Time zone → approximate region centre when geolocation is denied (M21 fallback)
const TZ_POINTS = {
  "America/Mexico_City": [19.43, -99.13], "America/Monterrey": [25.67, -100.31], "America/Cancun": [21.16, -86.85], "America/Tijuana": [32.5, -117.0], "America/Bogota": [4.71, -74.07],
  "America/Lima": [-12.05, -77.04], "America/Sao_Paulo": [-23.55, -46.63], "America/Argentina/Buenos_Aires": [-34.6, -58.38], "America/Santiago": [-33.45, -70.66], "America/Caracas": [10.48, -66.9],
  "America/La_Paz": [-16.5, -68.15], "America/Asuncion": [-25.26, -57.58], "America/Guatemala": [14.63, -90.51], "America/New_York": [40.71, -74.0], "America/Chicago": [41.88, -87.63],
  "America/Denver": [39.74, -104.99], "America/Los_Angeles": [34.05, -118.24], "America/Toronto": [43.65, -79.38], "America/Vancouver": [49.28, -123.12], "America/Havana": [23.11, -82.37],
};
const CONTINENT_POINTS = { America: [15, -80], Europe: [50, 10], Africa: [5, 20], Asia: [35, 95], Australia: [-25, 134], Pacific: [-15, 170], Atlantic: [30, -30], Indian: [-10, 75], Antarctica: [-80, 0] };

function fallbackToTz() {
  const tz = state.tz;
  const p = TZ_POINTS[tz] ?? CONTINENT_POINTS[tz.split("/")[0]] ?? [15, -80];
  const c = countryAt(p[0], p[1]);
  emit("locate", { lat: p[0], lon: p[1], country: c, exact: false });
  toast(T.topbar.locationUnavailable);
}
