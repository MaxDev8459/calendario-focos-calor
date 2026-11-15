"""Descarga de FIRMS los focos posteriores al histórico y los deja en el formato del contrato.

El histórico (data/salida o data/ejemplo) llega hasta `ultimo_mes_completo`. Esto rellena desde el mes
siguiente hasta hoy con VIIRS S-NPP (SP mientras exista y NRT después). Los días sin S-NPP (S-NPP dejó de
reportar el 2026-11-02) se llenan con NOAA-20 multiplicado por un factor S-NPP/NOAA-20 medido por país
(noaa20.py). Escribe en NRT_DIR:
- detecciones_nrt.parquet       mismas columnas y tipos que A1 (detecciones.parquet)
- conteos_celda_mes_nrt.parquet mismas columnas y tipos que A2; fuente `VIIRS`, `VIIRS_NRT` o `VIIRS_NRT_N20`
- metadata_nrt.json             periodo cubierto, fuentes usadas, días por mes y el factor de NOAA-20

Uso, desde backend/:
    python -m app.firms                  # México, de 2026-01 a hoy
    python -m app.firms --pais Mexico --desde 2026-10-01
    python -m app.firms --estado         # revisa la llave y la disponibilidad
"""
import argparse
import calendar
import json
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb
import pandas as pd

from . import config
from .cliente import ClienteFirms, ErrorFirms, planear_fuentes
from .noaa20 import medir_factores
from .publicado import archivos_nrt  # noqa: F401  (compatibilidad)
from .normalizar import (celdas_fijas, escribir_parquets, normalizar, quitar_fuentes_fijas,
                         quitar_persistentes)

log = logging.getLogger("firms")


def primer_dia_sin_historico() -> date:
    """Primer día del mes siguiente a `ultimo_mes_completo` del histórico."""
    anio, mes = map(int, config.metadata_historico()["ultimo_mes_completo"].split("-"))
    return date(anio + mes // 12, mes % 12 + 1, 1)


def dias_por_mes(desde: date, hasta: date, con_datos: set | None = None) -> dict:
    """{'AAAA-MM': [días con datos, días del mes]} para saber si un mes está incompleto.

    Sin `con_datos` cuenta todos los días del periodo.
    """
    out, d = {}, desde
    while d <= hasta:
        clave = f"{d.year}-{d.month:02d}"
        out.setdefault(clave, [0, calendar.monthrange(d.year, d.month)[1]])
        if con_datos is None or d in con_datos:
            out[clave][0] += 1
        d += timedelta(days=1)
    return out


def _fechas(crudo: pd.DataFrame) -> set:
    if crudo is None or crudo.empty:
        return set()
    return {date.fromisoformat(x) for x in crudo["acq_date"].dropna().unique()}


DIAS_MINIMOS_MASCARA = 60   # días de SP con `type` para armar la máscara de fuentes fijas


def huella_pais(pais: str):
    """Cuadros de 0.1° (ty, tx) que el histórico asigna al país, y el bbox que los contiene.

    La API de FIRMS ya no consulta por país, solo por bbox. El bbox de un país incluye a sus vecinos
    (y plataformas en el mar), así que se conservan solo los cuadros que el histórico tiene para ese país:
    los focos recientes cubren exactamente la misma huella que la serie.
    """
    ruta = (config.dir_datos() / "conteos_celda_mes.parquet").as_posix()
    con = duckdb.connect()
    cuadros = pd.DataFrame(
        con.execute(f"SELECT DISTINCT ty, tx FROM read_parquet('{ruta}') WHERE pais = ?", [pais]).fetchall(),
        columns=["ty", "tx"])
    if cuadros.empty:
        raise ErrorFirms("sin_datos", f"El histórico no tiene cuadros para el país {pais!r}.")
    cuadros = cuadros.astype("int32")
    bbox = (round(cuadros.tx.min() * 0.1, 1), round(cuadros.ty.min() * 0.1, 1),
            round((cuadros.tx.max() + 1) * 0.1, 1), round((cuadros.ty.max() + 1) * 0.1, 1))
    return cuadros, bbox


def celdas_persistentes() -> pd.DataFrame | None:
    """A5 (celdas de 0.01° con fuentes de calor persistentes) si Datos la publicó junto al histórico."""
    ruta = config.dir_datos() / "celdas_persistentes.parquet"
    if not ruta.exists():
        log.warning("Sin %s: no se quitan las celdas persistentes", ruta.name)
        return None
    return pd.read_parquet(ruta, columns=["fy", "fx"])


def _mascara_fuentes_fijas(cliente, zona, crudos, disponibilidad) -> pd.DataFrame:
    """Celdas fijas según SP. Usa el SP ya descargado si alcanza; si no, baja los últimos días de SP."""
    sp = [(d0, d1, c) for f, d0, d1, c in crudos if f.endswith("_SP")]
    if sum((d1 - d0).days + 1 for d0, d1, _ in sp) < DIAS_MINIMOS_MASCARA:
        fuente_sp = next((f for f in config.FUENTES_PREFERIDAS if f.endswith("_SP") and f in disponibilidad), None)
        if fuente_sp:
            f1 = disponibilidad[fuente_sp][1]
            f0 = f1 - timedelta(days=DIAS_MINIMOS_MASCARA - 1)
            sp.append((f0, f1, cliente.focos_area(fuente_sp, zona, f0, f1)))
    con_type = [c for _, _, c in sp if c is not None and not c.empty]
    return celdas_fijas(pd.concat(con_type, ignore_index=True) if con_type else None)


def actualizar(paises=("Mexico",), desde: date | None = None, hasta: date | None = None,
               cliente: ClienteFirms | None = None, dir_salida: Path | None = None,
               modo: str = "pais", bbox=None, con_noaa20: bool = True) -> dict:
    """Descarga, normaliza y escribe los Parquet NRT. Devuelve el contenido de metadata_nrt.json.

    modo "pais": bbox del país y solo sus cuadros del histórico (por defecto).
    modo "area": el bbox dado, sin recortar; `paises` debe tener un solo nombre, que se usa como etiqueta.
    """
    cliente = cliente or ClienteFirms()
    dir_salida = Path(dir_salida) if dir_salida else config.dir_nrt()
    hoy = datetime.now(timezone.utc).date()
    desde = desde or primer_dia_sin_historico()
    hasta = min(hasta or hoy, hoy)
    if desde > hasta:
        raise ErrorFirms("sin_periodo", f"No hay días por descargar ({desde} > {hasta}).")

    disponibilidad = cliente.disponibilidad()
    plan = planear_fuentes(desde, hasta, disponibilidad)
    if not plan:
        raise ErrorFirms("sin_datos", f"FIRMS no tiene {config.FUENTES_PREFERIDAS} para {desde}..{hasta}.")
    plan_n20 = planear_fuentes(desde, hasta, disponibilidad, config.FUENTES_N20) if con_noaa20 else []
    hay_nrt = any(f.endswith("_NRT") for f, _, _ in plan + plan_n20)
    persistentes = celdas_persistentes()

    def limpiar(det, cuadros, fijas):
        """Mismos filtros que la serie: huella del país, fuentes fijas (días NRT) y celdas persistentes."""
        if cuadros is not None:
            det = det.merge(cuadros, on=["ty", "tx"], how="inner")
        n0 = len(det)
        det = quitar_fuentes_fijas(det, fijas)
        n1 = len(det)
        det = quitar_persistentes(det, persistentes)
        return det, n0 - n1, n1 - len(det)

    snpp, n20, dias_snpp, dias_n20 = [], [], set(), set()
    quitados = {"fuentes_fijas": 0, "persistentes": 0}
    for pais in paises:
        cuadros, zona = (None, bbox) if modo == "area" else huella_pais(pais)
        crudos = [(fuente, d0, d1, cliente.focos_area(fuente, zona, d0, d1)) for fuente, d0, d1 in plan]
        fijas = _mascara_fuentes_fijas(cliente, zona, crudos, disponibilidad) if hay_nrt else None
        for fuente, d0, d1, crudo in crudos:
            dias_snpp |= _fechas(crudo)
            det, q_fijas, q_pers = limpiar(normalizar(crudo, pais, fuente), cuadros, fijas)
            quitados["fuentes_fijas"] += q_fijas
            quitados["persistentes"] += q_pers
            log.info("%s %s %s..%s: %d focos (quitados: %d fuentes fijas, %d persistentes)",
                     pais, fuente, d0, d1, len(det), q_fijas, q_pers)
            snpp.append(det)
        for fuente, d0, d1 in plan_n20:
            try:
                crudo = cliente.focos_area(fuente, zona, d0, d1)
            except ErrorFirms as e:   # NOAA-20 nunca tumba la actualización de S-NPP
                log.warning("Sin NOAA-20 (%s %s..%s): %s", fuente, d0, d1, e.mensaje)
                continue
            dias_n20 |= _fechas(crudo)
            det, _, _ = limpiar(normalizar(crudo, pais, fuente, satelites={"NOAA20"}), cuadros, fijas)
            log.info("%s %s %s..%s: %d focos de NOAA-20", pais, fuente, d0, d1, len(det))
            n20.append(det)

    def juntar(partes):
        partes = [p for p in partes if p is not None and len(p)]
        return pd.concat(partes, ignore_index=True) if partes else None

    det_snpp, det_n20 = juntar(snpp), juntar(n20)
    cubierto_hasta = max([plan[-1][2]] + [b for _, _, b in plan_n20 if dias_n20])
    dias_relleno = sorted(d for d in dias_n20 if d not in dias_snpp and desde <= d <= cubierto_hasta)
    medicion = medir_factores(det_snpp, det_n20, dias_snpp & dias_n20, paises) if dias_relleno else None

    det = det_snpp
    if medicion and det_n20 is not None:
        relleno = det_n20[det_n20["fecha"].isin(set(dias_relleno))]
        relleno = relleno.assign(es_n20=True, peso=relleno["pais"].map(medicion["factores"]).astype("float64"))
        det = juntar([det.assign(es_n20=False, peso=1.0) if det is not None else None, relleno])

    con_datos = dias_snpp | set(dias_relleno)
    filas = escribir_parquets(det, dir_salida)
    filas["quitados_fuentes_fijas"] = quitados["fuentes_fijas"]
    filas["quitados_persistentes"] = quitados["persistentes"]
    sin_datos = sorted(d for d in (desde + timedelta(days=i) for i in range((cubierto_hasta - desde).days + 1))
                       if d not in con_datos)
    meta = {
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version_contrato": "0.4",
        "paises": list(paises),
        "desde": desde.isoformat(),
        "hasta": cubierto_hasta.isoformat(),
        "fuentes": [{"fuente": f, "desde": a.isoformat(), "hasta": b.isoformat()} for f, a, b in plan],
        "dias_por_mes": dias_por_mes(desde, cubierto_hasta, con_datos),
        "dias_sin_datos": [d.isoformat() for d in sin_datos],
        "filas": filas,
        "nota": "Focos VIIRS S-NPP posteriores al histórico, solo en los cuadros de 0.1° que el histórico "
                "tiene para cada país y sin las celdas persistentes de A5. Las fuentes NRT no traen `type`: "
                "en esos días se quitan las celdas de 0.01° que FIRMS SP marcó como volcán, fuente fija o mar "
                "adentro. Los días sin S-NPP se llenan con NOAA-20 × factor (ver `noaa20`). "
                "dias_por_mes = [días con datos, días del mes].",
    }
    if medicion:
        meta["noaa20"] = {
            "fuente_api": "VIIRS_NRT_N20",
            "preliminar": True,
            "fuentes": [{"fuente": f, "desde": a.isoformat(), "hasta": b.isoformat()} for f, a, b in plan_n20],
            "dias": [d.isoformat() for d in dias_relleno],
            "meses": sorted({f"{d.year}-{d.month:02d}" for d in dias_relleno}),
            "factores": medicion["factores"],
            "por_pais": medicion["por_pais"],
            "zona": medicion["zona"],
            "metodo": "factor = mediana mensual de (celdas-día S-NPP / celdas-día NOAA-20) en los días con "
                      "datos de los dos satélites y meses con al menos 20 de esos días; validación dejando un "
                      "mes fuera. Si el país tiene menos de 3 meses, se usa el factor de toda la zona; si no "
                      "hay meses comparables, factor 1.",
        }
    tmp = dir_salida / "metadata_nrt.json.tmp"
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(dir_salida / "metadata_nrt.json")
    return meta


def main():
    ap = argparse.ArgumentParser(description="Focos recientes de FIRMS en el formato del contrato.")
    ap.add_argument("--pais", nargs="+", default=["Mexico"])
    ap.add_argument("--desde", type=date.fromisoformat)
    ap.add_argument("--hasta", type=date.fromisoformat)
    ap.add_argument("--modo", choices=["pais", "area"], default="pais")
    ap.add_argument("--bbox", help="oeste,sur,este,norte (solo con --modo area)")
    ap.add_argument("--estado", action="store_true", help="solo revisar la llave y la disponibilidad")
    ap.add_argument("--sin-noaa20", action="store_true", help="no llenar con NOAA-20 los días sin S-NPP")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    try:
        cliente = ClienteFirms()
        if a.estado:
            print("llave:", cliente.estado_llave())
            for fuente, (f0, f1) in sorted(cliente.disponibilidad().items()):
                if "VIIRS_SNPP" in fuente or "VIIRS_NOAA20" in fuente or "MODIS" in fuente:
                    print(f"  {fuente}: {f0} .. {f1}")
            return
        bbox = tuple(float(x) for x in a.bbox.split(",")) if a.bbox else None
        if a.modo == "area" and not bbox:
            ap.error("--modo area necesita --bbox")
        meta = actualizar(a.pais, a.desde, a.hasta, cliente=cliente, modo=a.modo, bbox=bbox,
                          con_noaa20=not a.sin_noaa20)
        resumen = {k: meta[k] for k in ("desde", "hasta", "fuentes", "filas")}
        if "noaa20" in meta:
            n = meta["noaa20"]
            resumen["noaa20"] = {"dias": len(n["dias"]), "meses": n["meses"], "factores": n["factores"],
                                 "validacion": {p: {k: v.get(k) for k in ("origen", "meses", "error_medio_abs_pct",
                                                                         "error_max_abs_pct")}
                                                for p, v in n["por_pais"].items()}}
        print(json.dumps(resumen, indent=2, ensure_ascii=False))
    except ErrorFirms as e:
        raise SystemExit(f"Error de FIRMS ({e.codigo}): {e.mensaje}")
