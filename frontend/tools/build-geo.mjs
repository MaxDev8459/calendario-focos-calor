// Builds the slimmed country layers used by the globe and the country view.
// Source: Natural Earth admin-0 countries (public domain), 110m and 50m.
// Usage: node tools/build-geo.mjs <ne_110m.geojson> <ne_50m.geojson>
import { readFileSync, writeFileSync } from "node:fs";

const [src110, src50] = process.argv.slice(2);
const SUB_TO_REGION = {
  "Northern America": "north_america",
  "Central America": "central_america",
  "Caribbean": "caribbean",
  "South America": "south_america",
};
const CONT_TO_REGION = { Europe: "europe", Africa: "africa", Asia: "asia", Oceania: "oceania", Antarctica: "antarctica", "Seven seas (open ocean)": "oceania" };

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
function roundCoords(c, d) {
  return typeof c[0] === "number" ? [round(c[0], d), round(c[1], d)] : c.map((x) => roundCoords(x, d));
}
function slim(f, d) {
  const p = f.properties;
  const iso2 = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2;
  const region = SUB_TO_REGION[p.SUBREGION] ?? CONT_TO_REGION[p.CONTINENT] ?? "other";
  return {
    type: "Feature",
    properties: { name: p.NAME_EN || p.NAME, iso2: iso2 === "-99" ? p.ADM0_A3 : iso2, iso3: p.ADM0_A3, region, lx: round(p.LABEL_X, 2), ly: round(p.LABEL_Y, 2) },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates, d) },
  };
}
const ACTIVE = new Set(Object.values(SUB_TO_REGION));

const w110 = JSON.parse(readFileSync(src110, "utf8"));
const all = w110.features.map((f) => slim(f, 2));
writeFileSync("public/data/countries-110m.json", JSON.stringify({ type: "FeatureCollection", features: all }));

const w50 = JSON.parse(readFileSync(src50, "utf8"));
const am = w50.features.map((f) => slim(f, 3)).filter((f) => ACTIVE.has(f.properties.region));
writeFileSync("public/data/americas-50m.json", JSON.stringify({ type: "FeatureCollection", features: am }));
console.log("110m:", all.length, "features · americas 50m:", am.length);
