"""Descarga de FIRMS los focos posteriores al histórico y los deja en el formato del contrato.

El histórico (data/salida o data/ejemplo) llega hasta `ultimo_mes_completo`. Esto rellena desde el mes
siguiente hasta hoy con VIIRS S-NPP (SP mientras exista y NRT después) y escribe en NRT_DIR:
- detecciones_nrt.parquet       mismas columnas y tipos que A1 (detecciones.parquet)
- conteos_celda_mes_nrt.parquet mismas columnas y tipos que A2; fuente `VIIRS` o `VIIRS_NRT`
- metadata_nrt.json             periodo cubierto, fuentes usadas y días por mes

Uso, desde backend/:
    python -m app.firms                  # México, de 2026-01 a hoy
    python -m app.firms --pais Mexico --desde 2026-10-01
    python -m app.firms --estado         # revisa la llave y la disponibilidad
"""
import argparse
import calendar
import json
import logging
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb
import pandas as pd

from . import config
from .cliente import ClienteFirms, ErrorFirms, planear_fuentes
from .normalizar import celdas_fijas, escribir_parquets, normalizar, quitar_fuentes_fijas

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
               modo: str = "pais", bbox=None) -> dict:
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
    cubierto_hasta = plan[-1][2]
    hay_nrt = any(f.endswith("_NRT") for f, _, _ in plan)

    partes, con_datos, quitados = [], set(), 0
    for pais in paises:
        cuadros, zona = (None, bbox) if modo == "area" else huella_pais(pais)
        crudos = [(fuente, d0, d1, cliente.focos_area(fuente, zona, d0, d1)) for fuente, d0, d1 in plan]
        fijas = _mascara_fuentes_fijas(cliente, zona, crudos, disponibilidad) if hay_nrt else None
        for fuente, d0, d1, crudo in crudos:
            con_datos |= _fechas(crudo)
            det = normalizar(crudo, pais, fuente)
            if cuadros is not None:
                det = det.merge(cuadros, on=["ty", "tx"], how="inner")
            antes = len(det)
            det = quitar_fuentes_fijas(det, fijas)
            quitados += antes - len(det)
            log.info("%s %s %s..%s: %d focos (%d en fuentes fijas)", pais, fuente, d0, d1, len(det), antes - len(det))
            partes.append(det)

    det = pd.concat([p for p in partes if len(p)], ignore_index=True) if any(len(p) for p in partes) else None
    filas = escribir_parquets(det, dir_salida)
    filas["quitados_fuentes_fijas"] = quitados
    sin_datos = sorted(d for d in (desde + timedelta(days=i) for i in range((cubierto_hasta - desde).days + 1))
                       if d not in con_datos)
    meta = {
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version_contrato": "0.2",
        "paises": list(paises),
        "desde": desde.isoformat(),
        "hasta": cubierto_hasta.isoformat(),
        "fuentes": [{"fuente": f, "desde": a.isoformat(), "hasta": b.isoformat()} for f, a, b in plan],
        "dias_por_mes": dias_por_mes(desde, cubierto_hasta, con_datos),
        "dias_sin_datos": [d.isoformat() for d in sin_datos],
        "filas": filas,
        "nota": "Focos VIIRS S-NPP posteriores al histórico, solo en los cuadros de 0.1° que el histórico "
                "tiene para cada país. Las fuentes NRT no traen `type`: en esos días se quitan las celdas "
                "de 0.01° que FIRMS SP marcó como volcán, fuente fija o mar adentro. "
                "dias_por_mes = [días con datos del satélite, días del mes].",
    }
    tmp = dir_salida / "metadata_nrt.json.tmp"
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(dir_salida / "metadata_nrt.json")
    return meta


def archivos_nrt(dir_salida: Path | None = None) -> dict | None:
    """Rutas y metadatos de los Parquet NRT si ya existen (para que la API los una con el histórico)."""
    d = Path(dir_salida) if dir_salida else config.dir_nrt()
    meta = d / "metadata_nrt.json"
    if not meta.exists():
        return None
    return {"detecciones": d / "detecciones_nrt.parquet",
            "conteos": d / "conteos_celda_mes_nrt.parquet",
            "metadata": json.loads(meta.read_text(encoding="utf-8"))}


def iniciar_actualizacion_periodica(cada_horas: float = 3.0, **kwargs) -> threading.Thread | None:
    """Actualiza en segundo plano al arrancar la API y luego cada `cada_horas`.

    Pensado para llamarse desde el lifespan de app/main.py. Si no hay FIRMS_MAP_KEY no hace nada,
    así la API sigue funcionando solo con el histórico.
    """
    if not config.map_key():
        log.warning("Sin FIRMS_MAP_KEY: la API solo servirá el histórico.")
        return None
    parar = threading.Event()

    def ciclo():
        while not parar.is_set():
            try:
                meta = actualizar(**kwargs)
                log.info("NRT actualizado hasta %s (%s focos)", meta["hasta"], meta["filas"]["detecciones"])
            except Exception as e:  # nunca tumbar la API por FIRMS
                log.error("No se pudo actualizar NRT: %s", e)
            parar.wait(cada_horas * 3600)

    hilo = threading.Thread(target=ciclo, name="actualizar-firms", daemon=True)
    hilo.parar = parar
    hilo.start()
    return hilo


def main():
    ap = argparse.ArgumentParser(description="Focos recientes de FIRMS en el formato del contrato.")
    ap.add_argument("--pais", nargs="+", default=["Mexico"])
    ap.add_argument("--desde", type=date.fromisoformat)
    ap.add_argument("--hasta", type=date.fromisoformat)
    ap.add_argument("--modo", choices=["pais", "area"], default="pais")
    ap.add_argument("--bbox", help="oeste,sur,este,norte (solo con --modo area)")
    ap.add_argument("--estado", action="store_true", help="solo revisar la llave y la disponibilidad")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    try:
        cliente = ClienteFirms()
        if a.estado:
            print("llave:", cliente.estado_llave())
            for fuente, (f0, f1) in sorted(cliente.disponibilidad().items()):
                if "VIIRS_SNPP" in fuente or "MODIS" in fuente:
                    print(f"  {fuente}: {f0} .. {f1}")
            return
        bbox = tuple(float(x) for x in a.bbox.split(",")) if a.bbox else None
        if a.modo == "area" and not bbox:
            ap.error("--modo area necesita --bbox")
        meta = actualizar(a.pais, a.desde, a.hasta, cliente=cliente, modo=a.modo, bbox=bbox)
        print(json.dumps({k: meta[k] for k in ("desde", "hasta", "fuentes", "filas")}, indent=2))
    except ErrorFirms as e:
        raise SystemExit(f"Error de FIRMS ({e.codigo}): {e.mensaje}")
