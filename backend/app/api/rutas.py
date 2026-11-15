"""Rutas de la Parte B del contrato. Los parámetros se validan a mano para responder con los
códigos de error del contrato (`bbox_invalido`, `fecha_invalida`, `sin_datos`, `rango_muy_grande`).
Los textos de `summary`, `description` y `Query(description=...)` son los que se ven en /docs (en inglés);
`Query` solo documenta: el valor por defecto sigue siendo None y el tipo str, y la validación es manual."""
from fastapi import APIRouter, Query
from fastapi.responses import Response

from . import consultas
from .validar import leer_bbox, leer_entero, leer_fecha, leer_mes

router = APIRouter(prefix="/api")

BBOX = "Bounding box as `west,south,east,north` in decimal degrees (WGS84). Example (Morelos): `-99.5,18.3,-98.6,19.2`."
BBOX_OPC = "Optional bounding box as `west,south,east,north`. If omitted, the whole covered area is used."
MES_DESDE = "First month, `YYYY-MM`. Default: first month of the archive."
MES_HASTA = "Last month, `YYYY-MM`, not before `desde`. Default: latest month with data."
DIA_DESDE = "First day (UTC), `YYYY-MM-DD`."
DIA_HASTA = "Last day (UTC), `YYYY-MM-DD`, not before `desde`."
ERRORES = {
    400: {"description": "`bbox_invalido`, `fecha_invalida` or `rango_muy_grande`. "
                         'Body: `{"error": code, "mensaje": text}`.'},
    404: {"description": "`sin_datos` (no data for that area and period) or `no_encontrado`."},
}


@router.get("/calendario", tags=["Calendar"], responses=ERRORES,
            summary="Year-by-month calendar of harmonized fire hotspots",
            description="One cell per year and month for the area: harmonized count (MODIS adjusted to VIIRS units "
                        "before Feb 2012), the source of each cell, the monthly median (January to December), the "
                        "peak month and a colour scale whose cut points are computed by the server. Months after the "
                        "archive come from recent hotspots and add `dias_con_datos` and `dias_mes`; a month filled "
                        "partly with NOAA-20 has `fuente = VIIRS_NRT_N20` and `preliminar: true`.")
def calendario(bbox: str | None = Query(None, description=BBOX),
               desde: str | None = Query(None, description=MES_DESDE),
               hasta: str | None = Query(None, description=MES_HASTA)):
    return consultas.calendario(leer_bbox(bbox), leer_mes(desde), leer_mes(hasta))


@router.get("/anomalia", tags=["Calendar"], responses=ERRORES,
            summary="How one month compares with its historical median",
            description="Count of the chosen month, historical median for that calendar month, anomaly in percent, "
                        "percentile, rank (`lugar` out of `de_anios` years) and source. An incomplete month is "
                        "compared with the median projected to the full month (`conteo_proyectado`, "
                        "`incompleto: true`). Median, percentiles and rank use only complete months of the archive.")
def anomalia(bbox: str | None = Query(None, description=BBOX),
             anio: str | None = Query(None, description="Year, integer from 2000 to 2100. Example: `2026`."),
             mes: str | None = Query(None, description="Month, integer from 1 to 12 (never 0-11).")):
    return consultas.anomalia(leer_bbox(bbox), leer_entero(anio, 2000, 2100), leer_entero(mes, 1, 12))


@router.get("/focos.csv", tags=["Hotspots"], responses=ERRORES,
            summary="Download hotspots as CSV",
            description="CSV file (UTF-8, comma separated, header row) named `focos_<desde>_<hasta>.csv` with one "
                        "row per cleaned hotspot: `fecha, hora_utc, lat, lon, pais, sensor, satelite, confianza, "
                        "frp_mw, dia_noche, ty, tx`. Recent hotspots from NOAA-20 have `satelite = NOAA20`. "
                        "More than 50,000 rows answers `rango_muy_grande`: narrow the area or the dates.")
def focos_csv(bbox: str | None = Query(None, description=BBOX),
              desde: str | None = Query(None, description=DIA_DESDE),
              hasta: str | None = Query(None, description=DIA_HASTA)):
    d, h = leer_fecha(desde), leer_fecha(hasta)
    texto = consultas.focos_csv(leer_bbox(bbox), d, h)
    return Response(texto, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="focos_{d}_{h}.csv"'})


@router.get("/focos", tags=["Hotspots"], responses=ERRORES,
            summary="Hotspots as GeoJSON points for the map",
            description="GeoJSON `FeatureCollection` of points, most recent first, limited to 5,000. `total` is the "
                        "number of hotspots found and `truncado` is true when more exist than were returned. "
                        "Properties: `fecha`, `sensor`, `frp_mw` (fire radiative power, MW), `confianza`, "
                        "`hora_utc` (HHMM, UTC), `dia_noche` (D/N), plus `satelite` and `preliminar: true` for "
                        "NOAA-20 points. No hotspots is a normal answer (200 with an empty collection).")
def focos(bbox: str | None = Query(None, description=BBOX),
          desde: str | None = Query(None, description=DIA_DESDE),
          hasta: str | None = Query(None, description=DIA_HASTA)):
    return consultas.focos_geojson(leer_bbox(bbox), leer_fecha(desde), leer_fecha(hasta))


@router.get("/serie_armonizacion", tags=["Calendar"], responses=ERRORES,
            summary="Before-and-after series of the sensor harmonization",
            description="Monthly series for the area: raw MODIS, raw VIIRS and the harmonized series, all aligned "
                        "with `meses`. `null` means the sensor was not available that month.")
def serie_armonizacion(bbox: str | None = Query(None, description=BBOX_OPC)):
    return consultas.serie_armonizacion(leer_bbox(bbox, obligatorio=False))


# Rutas adicionales (no quitan ni cambian nada del contrato)
@router.get("/celdas", tags=["Map"], responses=ERRORES,
            summary="Harmonized counts per 0.1 degree tile",
            description="Sum of harmonized hotspots per 0.1 degree tile (`ty`, `tx` and tile centre `lat_c`, "
                        "`lon_c`) for the period, to paint the map grid. `truncado` is true if the list was cut.")
def celdas(bbox: str | None = Query(None, description=BBOX),
           desde: str | None = Query(None, description=MES_DESDE),
           hasta: str | None = Query(None, description="Last month, `YYYY-MM`, not before `desde`. Default: no upper limit.")):
    return consultas.celdas(leer_bbox(bbox), leer_mes(desde), leer_mes(hasta))


@router.get("/globo", tags=["Map"], responses=ERRORES,
            summary="Continental overview for the globe",
            description="Harmonized counts summed in 0.5 degree cells (`celdas`, each with a `region`: "
                        "`north_america`, `central_america`, `caribbean` or `south_america`) and per country "
                        "(`paises`, ISO 3166 alpha-2). Default period: the 12 months ending at the last complete month of the archive.")
def globo(desde: str | None = Query(None, description="First month, `YYYY-MM`. Default: 12 months before `hasta`."),
          hasta: str | None = Query(None, description="Last month, `YYYY-MM`. Default: last complete month of the archive.")):
    return consultas.globo(leer_mes(desde), leer_mes(hasta))


@router.get("/metadata", tags=["Metadata"],
            summary="Coverage of the archive and of the recent data",
            description="Countries covered, first month, last complete month of the archive, and the `recientes` "
                        "block describing the recent hotspots (period, sources, days with satellite data per "
                        "month and the NOAA-20 gap-filling method and validation).")
def metadata():
    return consultas.metadata()
