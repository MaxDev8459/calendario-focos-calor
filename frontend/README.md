# Heat Atlas: frontend

The public website of the project: a holographic globe with more than two decades (July 2002 – December 2025) of harmonized MODIS and VIIRS hotspots across the Americas. Visitors can open any country to get a hexagon map, a burn calendar, the anomaly against the historical median, and a CSV download.

The site has **no build step**. It is plain HTML, CSS and JavaScript ES modules. Libraries are vendored as prebuilt, pinned ES-module bundles in `vendor/`, so the folder can be served as-is by any static host (Render static site, GitHub Pages, `python -m http.server`).

## Run it locally

```bash
cd frontend
python3 -m http.server 5173      # or: npm start
```

Open http://localhost:5173.

| URL | What it does |
|---|---|
| `/` | Uses the API set in `js/config.js` (`API_BASE`). If it is empty, the site runs on sample data. |
| `/?mock=1` | Forces sample data, even when an API is configured. |
| `/?api=https://example.onrender.com/api` | Points the site at another API without editing code. |

Anything simulated is labelled **"Sample data"** on screen. The example responses in `mocks/ejemplo/` are real outputs of the pipeline (Mexico and Morelos, with the Morelos anomaly for April 2024). They are served as real data for those exact requests.

When the API is unreachable or answers 404, each request falls back to sample data and the label appears. Other API errors (`bbox_invalido`, `fecha_invalida`, `sin_datos`, `rango_muy_grande`) are shown as short English messages, and the original Spanish text stays in the browser console.

## Deep links

| Hash | Opens |
|---|---|
| `#hero`, `#story-1` … `#story-5`, `#explore`, `#method`, `#data`, `#about` | That section or story chapter |
| `#calendar` | The pilot area (Morelos, Mexico) |
| `#country=MX` | The country view |
| `#country=MX&bbox=-99.5,18.3,-98.6,19.2&from=2024-01&to=2024-12&month=2024-04&cell=…` | Country view with a drawn area, period, selected month and hexagon |
| `#region=europe` | The "Coming soon" card for regions outside the Americas |

## Structure

```
index.html            single page; sections are filled by js/
css/                  tokens (night/day themes), base, components
js/main.js            boot, hash router, section choreography
js/config.js          API_BASE, active regions, colour ramps, date limits
js/i18n/en.js         every visible string (English only)
js/api/client.js      fetch, error mapping, normalizers for contract v0.3, sample fallback
js/globe/             live MapLibre globe (holo styling, heat waves), explore controls
js/story/             hero intro, horizontal story
js/country/           H3 hexagon mesh on the same map, draw tool, calendar, anomaly, charts
js/ui/                top bar, coming soon, legends, icons, toast
data/                 Natural Earth country layers, factores.json, metadata.json
mocks/                deterministic sample-data generator + real example responses
vendor/               pinned third-party bundles (do not edit by hand)
fonts/                self-hosted woff2 files
tools/                dev-only: vendor bundle entry points and the geo layer builder
```

To regenerate `vendor/` after changing a library version, run `npm install && npm run vendor`. To rebuild the country layers from Natural Earth, run `npm run geo -- <ne_110m.geojson> <ne_50m.geojson>`.

## Accessibility and motion

- The language is set with `lang="en"` and every string lives in `js/i18n/en.js`.
- Everything works with the keyboard: skip link, visible focus, a burn calendar exposed as a grid with arrow-key navigation, and Esc to close the country view and release the scroll lock in Explore.
- Colour is never the only signal. Anomalies show a signed number, and the calendar and hexagon colours come with numeric legends.
- `prefers-reduced-motion` turns off the intro, smooth scrolling, light arcs and hexagon animations, and slows the globe's rotation.
- Night and day themes are available. The theme is stored in `localStorage` when the browser allows it.

## Open items for the backend (contract v0.3)

The frontend already handles these. When an endpoint is missing, it uses a fallback.

1. `GET /api/globo?desde&hasta` returns aggregated cells for the globe (12 months). The fallback is sample data.
2. `GET /api/celdas?bbox&desde&hasta` returns 0.1° tiles `{ty, tx, lat_c, lon_c, conteo}` for the hexagons. The fallback bins `/api/focos` points.
3. `GET /api/metadata` returns metadata. The fallback is the static copy in `data/metadata.json`.
4. B4 `/api/focos` would also need `hora_utc` and `dia_noche`, so the point tooltip can show the time.
5. B2 `/api/anomalia` would also need `promedio`, which today is computed from the calendar on the client.
6. Near-real-time months should report `fuente: "VIIRS_NRT"`, which the site labels "preliminary".

## Credits

- **Hotspot data:** NASA FIRMS (MODIS Collection 6.1 and VIIRS 375 m S-NPP). Heat Atlas is not an official NASA product.
- **Harmonization:** the project team's per-country, per-month MODIS→VIIRS factors (`data/factores.json`).
- **Country borders:** Natural Earth admin-0 (public domain).
- **Map labels, rivers and roads:** vector tiles from [OpenFreeMap](https://openfreemap.org/), © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL) and OpenMapTiles. They need an internet connection. Without it the globe still works with the local Natural Earth borders, just without place names.

## Libraries and licenses

| Library | Version | License |
|---|---|---|
| MapLibre GL JS | 6.18.0 | BSD-3-Clause |
| GSAP + ScrollTrigger | 3.15.1 | GSAP Standard "no charge" license |
| Lenis | 1.3.27 | MIT |
| h3-js | 4.5.0 | Apache-2.0 |
| d3-geo, d3-scale, d3-shape | 3.1.2, 4.0.3, 3.2.1 | ISC |
| Instrument Serif, Inter, JetBrains Mono (via Fontsource) | | SIL Open Font License 1.1 |

The project's own code is released under the MIT License (see `../LICENSE`).

## Use of AI

Parts of this frontend were written with the help of an AI coding assistant, under the team's direction, and were reviewed and tested by the team. Files that contain AI-assisted code say so in their header comment. No AI-generated images, video or audio are used. The globe, heat waves, maps and charts are all drawn in code from the data. If AI-generated media is added later, it will carry a visible "AI-generated" watermark.
