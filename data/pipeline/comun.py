"""Constantes y funciones compartidas del pipeline de armonización MODIS-Aqua → VIIRS S-NPP.

Flujo (cada script se corre desde la carpeta data/):
    01_limpiar.py    CSV de FIRMS  → intermedio/<pais>/detecciones.parquet
    02_malla.py      detecciones   → intermedio/<pais>/conteos_crudos.parquet y totales.parquet
    03_armonizar.py  totales       → intermedio/<pais>/factores.json  (factor por país y mes)
    04_validar.py    totales       → intermedio/<pais>/validacion.json (dejar un año fuera)
    05_exportar.py   intermedio/*  → salida/ (archivos A1–A4 del contrato)
    06_grafica.py    intermedio/*  → figuras/ (antes y después de la armonización)
"""
import argparse
import glob
import json
import math
import os

import polars as pl

INICIO = (2002, 7)     # Aqua empieza en julio de 2002
CAMBIO = (2012, 2)     # VIIRS S-NPP completo desde febrero de 2012 (empieza el 20-ene-2012)
FIN = (2025, 12)       # último mes con archivo anual de FIRMS

MALLA_FINA = 0.01      # ~1 km: unidad de conteo (celdas-día con fuego)
MALLA_CONSULTA = 0.1   # cuadro de consulta del contrato (ty, tx)

# Umbrales del factor (ver docs del método en 03_armonizar.py)
MIN_CELDAS_MES = 10    # un mes nacional calibra si MODIS y VIIRS tienen ≥ 10 celdas-día cada uno
                       # (en meses casi sin fuego dominan las falsas alarmas diurnas de MODIS)
MIN_ANIOS_MES = 4      # un factor mensual necesita ≥ 4 años válidos; si no, se usa el del país
MIN_MESES_PAIS = 12    # el factor del país necesita ≥ 12 meses válidos; si no, se usa el de América

CARPETA_TRABAJO = "intermedio"

VERSION_CONTRATO = "0.6"
# A1 (detecciones.parquet, ~700 MB) no cabe en git: se publica como archivo de un release
RELEASE_DATOS = "datos-v1"
URL_DETECCIONES = ("https://github.com/MaxDev8459/calendario-focos-calor/releases/download/"
                   f"{RELEASE_DATOS}/detecciones.parquet")


def clave(anio, mes):
    return anio * 100 + mes


CLAVE_INICIO, CLAVE_CAMBIO, CLAVE_FIN = clave(*INICIO), clave(*CAMBIO), clave(*FIN)


def texto_mes(am):
    return f"{am[0]}-{am[1]:02d}"


# ---------------------------------------------------------------- argumentos y rutas

def paises_disponibles(crudo):
    nombres = {os.path.basename(p).split("_", 2)[2][:-4] for p in glob.glob(f"{crudo}/modis/modis_*_*.csv")}
    nombres |= {os.path.basename(p).split("_", 2)[2][:-4] for p in glob.glob(f"{crudo}/viirs-snpp/viirs-snpp_*_*.csv")}
    return sorted(nombres)


def paises_procesados(trabajo, archivo):
    return sorted(d for d in os.listdir(trabajo) if os.path.exists(os.path.join(trabajo, d, archivo))) \
        if os.path.isdir(trabajo) else []


def lista_paises(valor, disponibles):
    if valor == "todos":
        return disponibles
    pedidos = [p.strip() for p in valor.split(",") if p.strip()]
    faltan = [p for p in pedidos if p not in disponibles]
    if faltan:
        raise SystemExit(f"Países sin datos: {faltan}. Disponibles: {', '.join(disponibles)}")
    return pedidos


def argumentos(descripcion, crudo=False, salida=False):
    ap = argparse.ArgumentParser(description=descripcion)
    ap.add_argument("--pais", default="Mexico", help="País (como en FIRMS), lista separada por comas o 'todos'")
    ap.add_argument("--trabajo", default=CARPETA_TRABAJO, help="Carpeta de archivos intermedios (no se sube)")
    if crudo:
        ap.add_argument("--crudo", required=True, help="Carpeta con modis/ y viirs-snpp/ de FIRMS")
    if salida:
        ap.add_argument("--salida", default="salida", help="Carpeta de los archivos del contrato")
    return ap.parse_args()


def ruta(trabajo, pais, archivo):
    os.makedirs(os.path.join(trabajo, pais), exist_ok=True)
    return os.path.join(trabajo, pais, archivo)


def guardar_json(obj, camino):
    with open(camino, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def leer_json(camino):
    with open(camino, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- factor de armonización

def meses_calibracion(totales):
    """Meses nacionales del periodo de traslape (feb-2012 a dic-2025) aptos para calibrar.

    totales: DataFrame con anio, mes, modis, viirs (celdas-día con fuego del país, meses completos).
    Devuelve las filas con MODIS y VIIRS ≥ MIN_CELDAS_MES y la columna r = viirs / modis.
    """
    return (totales
            .filter((clave(pl.col("anio"), pl.col("mes")) >= CLAVE_CAMBIO)
                    & (clave(pl.col("anio"), pl.col("mes")) <= CLAVE_FIN)
                    & (pl.col("modis") >= MIN_CELDAS_MES) & (pl.col("viirs") >= MIN_CELDAS_MES))
            .with_columns((pl.col("viirs") / pl.col("modis")).alias("r")))


def calcular_factores(totales, factores_america=None, anio_fuera=None):
    """Factor por mes = mediana, entre años, del cociente VIIRS/MODIS del país en ese mes.

    Respaldo por falta de datos (países chicos o meses sin fuego):
      - mes con < MIN_ANIOS_MES años válidos → factor del país (mediana de todos sus meses válidos);
      - país con < MIN_MESES_PAIS meses válidos → factor de América para ese mes.
    Devuelve (factores {"1".."12": float}, origen {"1".."12": "pais_mes" | "pais" | "america_mes"}).
    """
    cal = meses_calibracion(totales)
    if anio_fuera is not None:
        cal = cal.filter(pl.col("anio") != anio_fuera)
    por_mes = {m: (n, med) for m, n, med in
               cal.group_by("mes").agg(pl.len(), pl.col("r").median()).iter_rows()}
    factores, origen = {}, {}
    pais_ok = cal.height >= MIN_MESES_PAIS
    f_pais = cal["r"].median() if cal.height else None
    for mes in range(1, 13):
        n, med = por_mes.get(mes, (0, None))
        if pais_ok and n >= MIN_ANIOS_MES:
            factores[str(mes)], origen[str(mes)] = med, "pais_mes"
        elif pais_ok:
            factores[str(mes)], origen[str(mes)] = f_pais, "pais"
        elif factores_america is not None:
            factores[str(mes)], origen[str(mes)] = factores_america[str(mes)], "america_mes"
        elif f_pais is not None:
            factores[str(mes)], origen[str(mes)] = f_pais, "pais"
        else:
            factores[str(mes)], origen[str(mes)] = None, "sin_datos"
    return {k: (round(v, 3) if v is not None else None) for k, v in factores.items()}, origen


def factor_unico(totales, anio_fuera=None):
    """Línea base para comparar: un solo factor (mediana de todos los meses), sin estacionalidad."""
    cal = meses_calibracion(totales)
    if anio_fuera is not None:
        cal = cal.filter(pl.col("anio") != anio_fuera)
    return cal["r"].median() if cal.height else None


def metricas(pred, real):
    """Error medio absoluto (%), error ponderado (%), sesgo (%) y correlación de Pearson."""
    pares = [(p, r) for p, r in zip(pred, real) if p is not None and r > 0]
    if len(pares) < 3:
        return None
    p, r = zip(*pares)
    mp, mr = sum(p) / len(p), sum(r) / len(r)
    sp = math.sqrt(sum((x - mp) ** 2 for x in p))
    sr = math.sqrt(sum((x - mr) ** 2 for x in r))
    return {
        "error_medio_pct": round(100 * sum(abs(a - b) / b for a, b in pares) / len(pares), 1),
        "error_ponderado_pct": round(100 * sum(abs(a - b) for a, b in pares) / sum(r), 1),
        "sesgo_pct": round(100 * (sum(p) - sum(r)) / sum(r), 1),
        "r": round(sum((a - mp) * (b - mr) for a, b in pares) / (sp * sr), 3) if sp and sr else None,
        "meses_validados": len(pares),
    }


def validar_dejando_un_anio(totales, factores_america=None):
    """Dejar un año fuera: para cada año del traslape, calcula los factores SIN ese año,
    predice VIIRS = MODIS × factor en sus meses y compara con el VIIRS real."""
    cal = meses_calibracion(totales)
    pred, pred_unico, real = [], [], []
    for anio in sorted(cal["anio"].unique()):
        f, _ = calcular_factores(totales, factores_america, anio_fuera=anio)
        fu = factor_unico(totales, anio_fuera=anio)
        for _a, mes, m, v in cal.filter(pl.col("anio") == anio).select("anio", "mes", "modis", "viirs").iter_rows():
            pred.append(m * f[str(mes)] if f[str(mes)] is not None else None)
            pred_unico.append(m * fu if fu is not None else None)
            real.append(v)
    val = metricas(pred, real)
    if val is None:
        # mismas claves con null: el país usa el factor de América y no tiene meses para validar
        return {"tipo": "dejar_un_anio_fuera", "error_medio_pct": None, "error_ponderado_pct": None,
                "sesgo_pct": None, "r": None, "meses_validados": len(real),
                "error_medio_pct_factor_unico": None, "error_ponderado_pct_factor_unico": None,
                "nota": "datos insuficientes para validar"}
    base = metricas(pred_unico, real)
    return {"tipo": "dejar_un_anio_fuera", **val,
            "error_medio_pct_factor_unico": base["error_medio_pct"] if base else None,
            "error_ponderado_pct_factor_unico": base["error_ponderado_pct"] if base else None}
