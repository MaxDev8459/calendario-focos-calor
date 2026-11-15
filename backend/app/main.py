"""API del calendario de focos de calor (FastAPI). Local: `uvicorn app.main:app --reload`."""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.rutas import router
from .api.validar import ErrorApi

log = logging.getLogger("api")

app = FastAPI(title="Fire Hotspot Calendar API", version="0.3",
              description="Harmonized MODIS + VIIRS fire hotspots (NASA FIRMS) for the Americas.")

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
    return JSONResponse(status_code=500, content={"error": "error_interno", "mensaje": "Error interno del servidor."})


app.include_router(router)


@app.get("/")
def raiz():
    return {"nombre": app.title, "documentacion": "/docs",
            "rutas": ["/api/calendario", "/api/anomalia", "/api/focos", "/api/focos.csv",
                      "/api/serie_armonizacion", "/api/celdas", "/api/metadata"]}
