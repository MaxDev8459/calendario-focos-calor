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

Because the schemas match, DuckDB can read the archive and the recent data together:
```python
from app.firms import archivos_nrt
nrt = archivos_nrt()   # None if it has not run yet
files = [str(data_dir / "conteos_celda_mes.parquet")] + ([str(nrt["conteos"])] if nrt else [])
duckdb.sql(f"SELECT anio, mes, sum(conteo_armonizado) FROM read_parquet({files}) WHERE ... GROUP BY 1, 2")
```

To refresh automatically while the API is running (every 3 h, in a background thread; without `FIRMS_MAP_KEY` it does nothing and the API serves only the archive):
```python
from contextlib import asynccontextmanager
from app.firms import iniciar_actualizacion_periodica

@asynccontextmanager
async def lifespan(app):
    iniciar_actualizacion_periodica()
    yield
```

Notes:
- Requests are split into 5-day chunks (API limit) and cached on disk; old chunks are never downloaded again. A full run for Mexico (Jan–Nov 2026, about 70 requests) takes under a minute.
- Days without S-NPP data come back empty from FIRMS and are listed in `dias_sin_datos` (14 days in Jan–Jul 2026). As of 14 Nov 2026, `VIIRS_SNPP_NRT` ends on 2 Nov while NOAA-20 and NOAA-21 are up to date.
- The current month is incomplete: compare it with the median using `dias_por_mes`.
- The key is part of every FIRMS URL, so `httpx` request logging is silenced and the key is masked in error messages.

## Deployment (Render, free plan)
`render.yaml` (repository root) defines the API and the static web app.
1. Render → **New → Blueprint** → select this repository.
2. In the API service, set the environment variable `FIRMS_MAP_KEY`.
3. Every push to `main` redeploys.

The free plan sleeps after 15 minutes of inactivity (the first request takes about a minute) and its disk is not persistent: recent hotspots are downloaded again on each start, in the background.
