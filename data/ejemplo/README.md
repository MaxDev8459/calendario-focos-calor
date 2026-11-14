# Example data (preliminary)

Real FIRMS data for **Mexico**, harmonized with a preliminary method, so the API and the web app can be developed before the final pipeline is ready.

| File | Content |
|---|---|
| `conteos_celda_mes.parquet` | Monthly fire cell-days per 0.1° tile (`ty`, `tx`), MODIS Aqua adjusted (Jul 2002 – Jan 2012) and VIIRS S-NPP (Feb 2012 – Dec 2025) |
| `detecciones.parquet` | Individual filtered detections, **central Mexico only** (-101, 17.5, -97.5, 20.5) |
| `*_recorte*.csv` | Human-readable CSV extracts of the same data |
| `factores.json` | Monthly MODIS→VIIRS factors and leave-one-year-out validation |
| `metadata.json` | Coverage and generation date |
| `respuestas_api/` | Reference responses for `/api/calendario` and `/api/anomalia` |

Method (preliminary): detections are filtered (`type = 0`, low confidence removed), collapsed to 1 km fire cell-days, and MODIS Aqua is scaled to VIIRS units with a per-month factor (median VIIRS/MODIS ratio over Feb 2012 – Dec 2025).

Regenerate: `python pipeline/generar_ejemplo.py --crudo crudo --pais Mexico --salida ejemplo` (raw data: `sh pipeline/00_descargar.sh`).
