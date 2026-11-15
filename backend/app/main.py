"""API del calendario de focos de calor (FastAPI). Local: `uvicorn app.main:app --reload`."""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.rutas import router
from .api.validar import ErrorApi

log = logging.getLogger("api")

app = FastAPI(
    title="Fire Hotspot Calendar API", version="0.5",
    description=("Harmonized MODIS + VIIRS fire hotspots (NASA FIRMS) for the Americas, from July 2002 to today.\n\n"
                 "- `bbox` is always `west,south,east,north` in decimal degrees.\n"
                 "- Dates are ISO: `YYYY-MM-DD` for days, `YYYY-MM` for months. Months are 1-12.\n"
                 "- Errors are `{\"error\": code, \"mensaje\": text}` with codes `bbox_invalido`, `fecha_invalida`, "
                 "`rango_muy_grande` (HTTP 400), `sin_datos`, `no_encontrado` (404), `peticion_invalida` (other 4xx, "
                 "such as 405) and `error_interno` (500).\n"
                 "- JSON field names are in Spanish (`anio`, `mes`, `conteo`, ...), as fixed by the data contract."),
    openapi_tags=[
        {"name": "Calendar", "description": "Monthly calendar, anomaly and sensor-harmonization series."},
        {"name": "Hotspots", "description": "Individual hotspots as GeoJSON (map) or CSV (download)."},
        {"name": "Map", "description": "Aggregated counts for the map grid and the globe."},
        {"name": "Metadata", "description": "Data coverage and provenance."},
    ])

# La web es un sitio estático en otro dominio y la API solo tiene lecturas públicas.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"],
                   expose_headers=["Content-Disposition"])


@app.exception_handler(ErrorApi)
async def error_del_contrato(request: Request, e: ErrorApi):
    return JSONResponse(status_code=e.estado, content={"error": e.codigo, "mensaje": e.mensaje})


@app.exception_handler(StarletteHTTPException)
async def error_http(request: Request, e: StarletteHTTPException):
    codigo = "no_encontrado" if e.status_code == 404 else "peticion_invalida"
    return JSONResponse(status_code=e.status_code, content={"error": codigo, "mensaje": str(e.detail)})


@app.exception_handler(Exception)
async def error_inesperado(request: Request, e: Exception):
    log.exception("Error en %s", request.url.path)
    return JSONResponse(status_code=500, content={"error": "error_interno", "mensaje": "Internal server error."})


app.include_router(router)


@app.get("/")
def raiz():
    return {"nombre": app.title, "documentacion": "/docs",
            "rutas": ["/api/calendario", "/api/anomalia", "/api/focos", "/api/focos.csv",
                      "/api/serie_armonizacion", "/api/celdas", "/api/globo", "/api/metadata"]}
