# Backend

Python + FastAPI + DuckDB over the Parquet files of `data/` (`data/salida/`, or `data/ejemplo/` if it does not exist).

## Run locally
```
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows (Git Bash: source .venv/Scripts/activate)
pip install -r requirements.txt
cp .env.example .env            # then add your FIRMS_MAP_KEY
uvicorn app.main:app --reload
python -m pytest -q
```

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

DuckDB needs a writable folder for the httpfs extension (only `/tmp` is writable in the function):
```python
con = duckdb.connect()
con.execute("SET home_directory='/tmp'; SET extension_directory='/tmp/duckdb_ext'")
con.execute("INSTALL httpfs; LOAD httpfs; SET enable_http_metadata_cache=true")
```

Measured from a laptop against the `datos-v1` release (1 thread, cold): loading httpfs 1.5 s, file metadata 1.8 s, Morelos 2024–2025 (6,093 hotspots) 1.7 s, all of Mexico in April 2024 (92,925 hotspots) 2.2 s, 5,000 map points 1.1 s.
