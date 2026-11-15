# Fire Hotspot Calendar API

A read-only REST API (Python, FastAPI and DuckDB) that serves **harmonized fire hotspots from NASA FIRMS** for the Americas, July 2002 to today. MODIS (2002-2011) and VIIRS (2012 onward) count fires differently; the data pipeline adjusts MODIS to VIIRS units so that one calendar can compare 24 years. The API reads those processed Parquet files directly (nothing is loaded fully into memory) and adds the most recent days from the FIRMS near-real-time feed.

- Published API: https://focos-calor-api.vercel.app
- Interactive documentation (OpenAPI): https://focos-calor-api.vercel.app/docs

## Run locally
```
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows (Git Bash: source .venv/Scripts/activate); Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional, only needed to refresh recent hotspots (see below)
uvicorn app.main:app --reload   # http://127.0.0.1:8000  and  http://127.0.0.1:8000/docs
python -m pytest -q             # all tests run offline with the sample data
```
Python 3.11 or newer. CORS is open (`GET` from any origin), so the static web app can call the API from another domain.

## Where the data comes from
The API reads the Parquet files produced by the data pipeline (`data/`). `app/datos.py` picks the first source that exists, in this order:

1. `DATOS_DIR` (environment variable), if set.
2. `data/salida/` in this repository (development with the full data).
3. The internet: the `datos-v1` GitHub release (override with `DATOS_URL`). DuckDB reads the Parquet files in parts over HTTP (httpfs), so the ~700 MB detections file is never downloaded in full. This is how the deployed API works.
4. `data/ejemplo/`, a small Mexico sample (offline development).

The tests use `data/ejemplo/` and reproduce the reference answers in `data/ejemplo/respuestas_api/` exactly.

## Environment variables
See `.env.example`. Never commit `.env`.

| Variable | Needed for | Notes |
|---|---|---|
| `FIRMS_MAP_KEY` | Refreshing recent hotspots (`python -m app.firms`) | Free key: https://firms.modaps.eosdis.nasa.gov/api/map_key/. Write it in `.env` as `FIRMS_MAP_KEY=your_map_key`. The API itself does not need it to answer requests. |
| `NRT_DIR` | Optional | Folder for recent hotspots (default `backend/datos_nrt`) |
| `DATOS_DIR` | Optional | Folder with the Parquet files (see above) |
| `DATOS_URL` | Optional | Base URL of the Parquet files if you host them elsewhere |

## API reference
All routes are `GET`, return JSON (except the CSV) and are documented at `/docs`. In the examples, `BASE=https://focos-calor-api.vercel.app` and the area is Morelos, Mexico.

Conventions:
- `bbox` is always `west,south,east,north` in decimal degrees (WGS84), e.g. Morelos `-99.5,18.3,-98.6,19.2`, Mexico `-118.5,14.5,-86.5,32.8`.
- Days are `YYYY-MM-DD` and months are `YYYY-MM` (UTC dates, as in FIRMS). Months are numbered 1-12.
- JSON field names are in Spanish and fixed by the data contract: `anio` (year), `mes` (month), `conteo` (count), `fuente` (source), `mediana` (median), `anomalia_pct` (anomaly in percent), `percentil` (percentile), `lugar` (rank).
- A count of `0` means the area was observed and had no fires; `null` or empty means there was no sensor or no data. They are not the same.
- `preliminar: true` appears only on recent months or points filled with NOAA-20 (see "NOAA-20 gap filling" below). Its absence means `false`.

| Route | Parameters | Returns |
|---|---|---|
| `/api/calendario` | `bbox`, `desde`, `hasta` (`YYYY-MM`) | Year x month cells, monthly median, peak month, colour scale |
| `/api/anomalia` | `bbox`, `anio`, `mes` | One month against its historical median |
| `/api/focos` | `bbox`, `desde`, `hasta` (`YYYY-MM-DD`) | GeoJSON points for the map (max. 5,000) |
| `/api/focos.csv` | same as `/api/focos` | CSV download (max. 50,000 rows) |
| `/api/serie_armonizacion` | `bbox` (optional) | Raw MODIS, raw VIIRS and harmonized monthly series |
| `/api/celdas` | `bbox`, `desde`, `hasta` (`YYYY-MM`) | Counts per 0.1 degree tile, for the map grid |
| `/api/globo` | `desde`, `hasta` (`YYYY-MM`), both optional | Continental overview for the globe |
| `/api/metadata` | none | Coverage of the archive and of the recent data |

### `GET /api/calendario`
Calendar of harmonized fire hotspots for an area.

| Parameter | Required | Description |
|---|---|---|
| `bbox` | yes | `west,south,east,north` |
| `desde` | no | First month, `YYYY-MM` (default: first month of the archive, 2002-07) |
| `hasta` | no | Last month, `YYYY-MM` (default: latest month with data) |

```
curl "$BASE/api/calendario?bbox=-99.5,18.3,-98.6,19.2&desde=2026-09&hasta=2026-10"
```
```json
{
  "bbox": [-99.5, 18.3, -98.6, 19.2],
  "desde": "2026-09", "hasta": "2026-10",
  "unidad": "focos_armonizados",
  "celdas": [
    {"anio": 2026, "mes": 9, "conteo": 3.0, "fuente": "VIIRS_NRT", "dias_con_datos": 30, "dias_mes": 30},
    {"anio": 2026, "mes": 10, "conteo": 3.0, "fuente": "VIIRS_NRT", "dias_con_datos": 31, "dias_mes": 31}
  ],
  "mediana_mensual": [161.0, 226.0, 330.7, 306.0, 184.0, 13.0, 1.0, 1.0, 1.0, 4.0, 27.0, 109.0],
  "mes_pico": 3,
  "escala": {"min": 0, "max": 805.0, "cortes": [3.0, 11.6, 34.9, 89.0, 152.3, 214.0, 320.0]}
}
```
- `celdas`: one entry per year and month (the web app draws the calendar grid with them). `conteo` is the harmonized count of fire cell-days. `fuente` is `MODIS_ajustado` (Jul 2002 to Jan 2012, adjusted to VIIRS units), `VIIRS` (Feb 2012 onward), `VIIRS_NRT` (recent months, S-NPP) or `VIIRS_NRT_N20` (recent month partly filled with NOAA-20, also `preliminar: true`).
- `dias_con_datos` / `dias_mes`: only in months after the archive, to tell an incomplete month.
- `mediana_mensual`: 12 values, January to December. `mes_pico`: month (1-12) with the highest median.
- `escala.cortes`: colour thresholds computed on the server, so colours do not depend on the browser.

### `GET /api/anomalia`
How one month compares with the historical median of the same calendar month.

| Parameter | Required | Description |
|---|---|---|
| `bbox` | yes | `west,south,east,north` |
| `anio` | yes | Year, integer (2000-2100) |
| `mes` | yes | Month, integer 1-12 |

```
curl "$BASE/api/anomalia?bbox=-99.5,18.3,-98.6,19.2&anio=2026&mes=10"
```
```json
{"anio": 2026, "mes": 10, "conteo": 3.0, "mediana": 4.0, "anomalia_pct": -25.0,
 "percentil": 32, "lugar": 14, "de_anios": 25, "fuente": "VIIRS_NRT",
 "dias_con_datos": 31, "dias_mes": 31, "incompleto": false}
```
`lugar` is the rank of the month among `de_anios` years. An incomplete month (`incompleto: true`) is compared with the median projected to the full month, and `conteo_proyectado` is added. Median, percentile and rank use only complete months of the archive. `preliminar: true` appears if the month was filled with NOAA-20.

### `GET /api/focos`
Individual hotspots as a GeoJSON `FeatureCollection` of points, most recent first.

| Parameter | Required | Description |
|---|---|---|
| `bbox` | yes | `west,south,east,north` |
| `desde` | yes | First day, `YYYY-MM-DD` (UTC) |
| `hasta` | yes | Last day, `YYYY-MM-DD` (UTC), not before `desde` |

```
curl "$BASE/api/focos?bbox=-99.5,18.3,-98.6,19.2&desde=2026-04-01&hasta=2026-04-03"
```
```json
{"type": "FeatureCollection", "total": 17, "truncado": false,
 "features": [{"type": "Feature",
   "geometry": {"type": "Point", "coordinates": [-98.79257, 18.60655]},
   "properties": {"fecha": "2026-04-03", "sensor": "VIIRS", "frp_mw": 11.81,
                  "confianza": "nominal", "hora_utc": "2009", "dia_noche": "D"}}]}
```
At most 5,000 points are returned. `total` is how many hotspots exist in the area and period; `truncado` is `true` when `total` is larger than what was returned. If there are no hotspots the answer is an empty collection (200), not an error. Properties: `frp_mw` is fire radiative power in MW, `confianza` is `nominal` or `alta` (low confidence is removed), `hora_utc` is `HHMM` in UTC, `dia_noche` is `D` (day) or `N` (night). Points from NOAA-20 add `satelite: "NOAA20"` and `preliminar: true`.

### `GET /api/focos.csv`
The same hotspots as a file download, named `focos_<desde>_<hasta>.csv`.

Parameters: the same as `/api/focos`.

```
curl -OJ "$BASE/api/focos.csv?bbox=-99.5,18.3,-98.6,19.2&desde=2026-04-01&hasta=2026-04-03"
```
```
fecha,hora_utc,lat,lon,pais,sensor,satelite,confianza,frp_mw,dia_noche,ty,tx
2026-04-01,1906,18.69287,-98.76981,Mexico,VIIRS,SNPP,nominal,6.98,D,186,-988
```
UTF-8, comma separated, decimal point, one header row. `ty` and `tx` are the 0.1 degree tile indices (`floor(lat / 0.1)`, `floor(lon / 0.1)`). More than 50,000 rows answers `rango_muy_grande` (HTTP 400): narrow the area or the dates. Points from NOAA-20 have `satelite = NOAA20`.

### `GET /api/serie_armonizacion`
The "before and after" chart of the sensor harmonization: raw MODIS, raw VIIRS and the harmonized series for an area.

| Parameter | Required | Description |
|---|---|---|
| `bbox` | no | `west,south,east,north` (default: the whole covered area) |

```
curl "$BASE/api/serie_armonizacion?bbox=-99.5,18.3,-98.6,19.2"
```
```json
{"meses": ["2002-07", "2002-08", "...", "2026-10", "2026-11"],
 "modis_crudo": [12, 9, "...", null, null],
 "viirs_crudo": [null, null, "...", 3, 0],
 "armonizado": [41.3, 30.2, "...", 3.0, 0.0]}
```
The four lists have the same length and are aligned by month. `null` means that sensor was not available that month. (Only the end of the real response is shown; the first values and the `"..."` placeholders are illustrative. The real lists have one entry per month since 2002-07.)

### `GET /api/celdas`
Harmonized counts per 0.1 degree tile, to paint the map grid.

| Parameter | Required | Description |
|---|---|---|
| `bbox` | yes | `west,south,east,north` |
| `desde` | no | First month, `YYYY-MM` (default: first month of the archive) |
| `hasta` | no | Last month, `YYYY-MM` (default: no upper limit) |

```
curl "$BASE/api/celdas?bbox=-99.5,18.3,-98.6,19.2&desde=2026-04&hasta=2026-04"
```
```json
{"bbox": [-99.5, 18.3, -98.6, 19.2], "unidad": "focos_armonizados", "truncado": false,
 "celdas": [{"ty": 188, "tx": -989, "lat_c": 18.85, "lon_c": -98.85, "conteo": 18.0},
            {"ty": 185, "tx": -988, "lat_c": 18.55, "lon_c": -98.75, "conteo": 13.0}]}
```
`lat_c` and `lon_c` are the tile centre. `truncado` is `true` if the list was cut.

### `GET /api/globo`
Continental overview for the globe on the landing page: counts summed in 0.5 degree cells and per country.

| Parameter | Required | Description |
|---|---|---|
| `desde` | no | First month, `YYYY-MM` (default: 12 months ending at `hasta`) |
| `hasta` | no | Last month, `YYYY-MM` (default: last complete month of the archive) |

```
curl "$BASE/api/globo?desde=2026-01&hasta=2026-03"
```
```json
{"desde": "2026-01", "hasta": "2026-03", "unidad": "focos_armonizados", "malla_grados": 0.5,
 "celdas": [{"lat": 16.75, "lon": -99.25, "conteo": 491.0, "region": "central_america"}],
 "paises": [{"iso_a2": "MX", "conteo": 26072}]}
```
`region` is one of `north_america`, `central_america`, `caribbean`, `south_america`. `paises` uses ISO 3166 alpha-2 codes. (Extract shortened: the real answer lists many cells and countries.)

### `GET /api/metadata`
Coverage of the archive and of the recent data. No parameters.

```
curl "$BASE/api/metadata"
```
```json
{"generado": "2026-11-14T22:19:31Z", "paises": ["Argentina", "...", "Mexico", "..."],
 "bbox_cubierto": [-176.63, -54.9, 179.59, 82.57],
 "primer_mes": "2002-07", "ultimo_mes_completo": "2025-12", "es_ejemplo": false,
 "recientes": {"desde": "2026-01-01", "hasta": "2026-11-02", "paises": ["Mexico"],
   "fuentes": [{"fuente": "VIIRS_SNPP_SP", "desde": "2026-01-01", "hasta": "2026-07-31"},
               {"fuente": "VIIRS_SNPP_NRT", "desde": "2026-08-01", "hasta": "2026-11-02"}],
   "dias_por_mes": {"2026-01": [31, 31], "2026-03": [28, 31]}}}
```
`ultimo_mes_completo` is the last month of the processed archive; `recientes` describes the hotspots added after it. `dias_por_mes` is `[days with satellite data, days in the month]`. `bbox_cubierto` spans almost all longitudes because Alaska crosses the antimeridian: do not use it to centre a map. When NOAA-20 fills gaps, `recientes.noaa20` documents the factor per country, its leave-one-month-out validation, the days and months filled and the method.

### NOAA-20 gap filling (`preliminar`)
Some days have no S-NPP data. For those days the recent hotspots use NOAA-20, scaled to S-NPP units with a measured factor. A recent month with at least one day filled this way has `fuente = VIIRS_NRT_N20` and `preliminar: true`, and its points have `satelite = NOAA20`. Treat those values as provisional. Recent months with no record at all (a gap between the archive and the recent hotspots) have `conteo: null` and `dias_con_datos: 0`: empty, not zero.

### Errors
Every route answers errors in the same format:
```json
{"error": "bbox_invalido", "mensaje": "bbox must be west,south,east,north in decimal degrees."}
```
`mensaje` is a human-readable text; use `error` (the code) in your logic.

| Code | HTTP | When |
|---|---|---|
| `bbox_invalido` | 400 | `bbox` is missing, malformed or not `west,south,east,north` |
| `fecha_invalida` | 400 | A date is malformed, a month is not 1-12, or `desde` is after `hasta` |
| `rango_muy_grande` | 400 | `/api/focos.csv` would return more than 50,000 rows |
| `sin_datos` | 404 | No data for that area and period (also a well-formed period outside the data, e.g. 1990) |
| `no_encontrado` | 404 | Unknown route |
| `peticion_invalida` | 405 and other 4xx | Method other than `GET`, or another invalid request |
| `error_interno` | 500 | Unexpected server error |

`sin_datos` is used by `/api/calendario`, `/api/anomalia`, `/api/serie_armonizacion` and `/api/focos.csv`. `/api/focos`, `/api/celdas` and `/api/globo` never answer `sin_datos`: nothing found is an empty list (200).

**Performance note.** Requests are fast for the areas and periods the web app uses (a country for a year: 1-3 s cold, well under 1 s warm). `/api/focos` over the whole continent and the whole archive has to count about 61 million rows read over HTTP to report the exact `total`; the first such request can take tens of seconds.

## Recent hotspots (FIRMS API) · `app/firms/`
The historical series ends at `ultimo_mes_completo` (see `data/*/metadata.json`). `app/firms` fills the gap from the next month up to today with the **FIRMS API**, using the same sensor as the series (VIIRS S-NPP): standard processing (`VIIRS_SNPP_SP`) while available, then near real time (`VIIRS_SNPP_NRT`).

```
python -m app.firms --estado          # check the key and data availability
python -m app.firms                   # Mexico, from the month after the archive to today
python -m app.firms --pais Mexico --desde 2026-10-01
```

It writes to `backend/datos_nrt/` (ignored by git), with **the same columns and types** as the data contract:

| File | Same schema as | Notes |
|---|---|---|
| `detecciones_nrt.parquet` | `detecciones.parquet` (A1) | Low confidence removed; S-NPP only |
| `conteos_celda_mes_nrt.parquet` | `conteos_celda_mes.parquet` (A2) | Fire cell-days on the 0.01° grid; `fuente` is `VIIRS` (SP) or `VIIRS_NRT` |
| `metadata_nrt.json` | – | Covered period, sources used, `dias_por_mes` (`[days with satellite data, days in month]`, to flag incomplete months) and `dias_sin_datos` |

How it matches the archive:
- **Same footprint.** The FIRMS API only queries by bounding box (the country endpoint no longer exists), and a country's box includes its neighbours and offshore platforms. Only the 0.1° tiles that the archive assigns to the country are kept.
- **Static sources.** NRT files have no `type` column. Hotspots in the 1 km cells that FIRMS SP flagged as volcano, static land source or offshore (`type` 1–3) are removed from NRT days. Out-of-sample check for Mexico (mask from Jan–Apr 2026, tested on May–Jul 2026 against `type = 0`): error between −0.4 % and −1.7 %. Without it, Aug–Oct 2026 came out 2–3× above the historical median (gas flares dominate in the rainy season).

Because the schemas match, DuckDB can read the archive and the recent data together. `archivos_nrt()` returns local paths in development (`backend/datos_nrt/`) and, in production, the URLs of the `nrt-latest` release, which DuckDB reads in parts over HTTP (httpfs):
```python
from app.firms import archivos_nrt
nrt = archivos_nrt()   # None if there is no recent data: serve only the archive
files = [str(data_dir / "conteos_celda_mes.parquet")] + ([nrt["conteos"]] if nrt else [])
con.execute(f"SELECT anio, mes, sum(conteo_armonizado) FROM read_parquet({files}) WHERE ... GROUP BY 1, 2")
```

### Daily refresh (GitHub Actions)
Serverless functions cannot run background jobs, so `.github/workflows/nrt.yml` runs `python -m app.firms` once a day (07:30 UTC, or by hand from the Actions tab) and publishes `detecciones_nrt.parquet`, `conteos_celda_mes_nrt.parquet` and `metadata_nrt.json` to the `nrt-latest` release. It needs the repository secret `FIRMS_MAP_KEY` (Settings → Secrets and variables → Actions). Scheduled workflows only run from the default branch (`main`).

Notes:
- Requests are split into 5-day chunks (API limit) and cached on disk; old chunks are never downloaded again. A full run for Mexico (Jan–Nov 2026, about 70 requests) takes under a minute.
- Days without S-NPP data come back empty from FIRMS and are listed in `dias_sin_datos` (14 days in Jan–Jul 2026). As of 14 Nov 2026, `VIIRS_SNPP_NRT` ends on 2 Nov while NOAA-20 and NOAA-21 are up to date.
- The current month is incomplete: compare it with the median using `dias_por_mes`.
- The key is part of every FIRMS URL, so `httpx` request logging is silenced and the key is masked in error messages.

## Deployment (Vercel, Hobby plan)
FastAPI runs as a single serverless function; Vercel detects `app/main.py` (variable `app`) with no extra configuration.
1. Create the project with **Root Directory** = `backend/` (the static web app goes in a second project with Root Directory = `frontend/`).
2. Set `FIRMS_MAP_KEY` in Settings → Environment Variables (it is only needed if the API calls FIRMS directly; the daily refresh uses the GitHub secret).
3. Every push to `main` redeploys. For a test from the terminal: `cd backend && vercel deploy`.

Large files are not bundled (the function must stay under 500 MB; `.vercelignore` excludes `.venv`, `tests` and local data). DuckDB reads them in parts from GitHub releases:

| Data | Where it is read from |
|---|---|
| A1 detections (~700 MB, 61 M rows) | `datos-v1` release (`detecciones_url` in `data/salida/metadata.json`) |
| Recent hotspots | `nrt-latest` release (`archivos_nrt()`) |

DuckDB needs a writable folder for the httpfs extension, and only the temporary folder is writable in the function: `app/datos.py` points `home_directory` and `extension_directory` there.

Measured from a laptop against the `datos-v1` release (1 thread, cold): loading httpfs 1.5 s, file metadata 1.8 s, Morelos 2024–2025 (6,093 hotspots) 1.7 s, all of Mexico in April 2024 (92,925 hotspots) 2.2 s, 5,000 map points 1.1 s.
