"""Rutas de la Parte B del contrato. Los parámetros se validan a mano para responder con los
códigos de error del contrato (`bbox_invalido`, `fecha_invalida`, `sin_datos`, `rango_muy_grande`)."""
from fastapi import APIRouter
from fastapi.responses import Response

from . import consultas
from .validar import leer_bbox, leer_entero, leer_fecha, leer_mes

router = APIRouter(prefix="/api")


@router.get("/calendario")
def calendario(bbox: str | None = None, desde: str | None = None, hasta: str | None = None):
    return consultas.calendario(leer_bbox(bbox), leer_mes(desde), leer_mes(hasta))


@router.get("/anomalia")
def anomalia(bbox: str | None = None, anio: str | None = None, mes: str | None = None):
    return consultas.anomalia(leer_bbox(bbox), leer_entero(anio, 2000, 2100), leer_entero(mes, 1, 12))


@router.get("/focos.csv")
def focos_csv(bbox: str | None = None, desde: str | None = None, hasta: str | None = None):
    d, h = leer_fecha(desde), leer_fecha(hasta)
    texto = consultas.focos_csv(leer_bbox(bbox), d, h)
    return Response(texto, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="focos_{d}_{h}.csv"'})


@router.get("/focos")
def focos(bbox: str | None = None, desde: str | None = None, hasta: str | None = None):
    return consultas.focos_geojson(leer_bbox(bbox), leer_fecha(desde), leer_fecha(hasta))


@router.get("/serie_armonizacion")
def serie_armonizacion(bbox: str | None = None):
    return consultas.serie_armonizacion(leer_bbox(bbox, obligatorio=False))


# Rutas adicionales (no quitan ni cambian nada del contrato)
@router.get("/celdas")
def celdas(bbox: str | None = None, desde: str | None = None, hasta: str | None = None):
    return consultas.celdas(leer_bbox(bbox), leer_mes(desde), leer_mes(hasta))


@router.get("/globo")
def globo(desde: str | None = None, hasta: str | None = None):
    return consultas.globo(leer_mes(desde), leer_mes(hasta))


@router.get("/metadata")
def metadata():
    return consultas.metadata()
