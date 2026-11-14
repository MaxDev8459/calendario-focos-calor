"""Convierte los focos de la API de FIRMS al formato del contrato (A1) y los cuenta como A2.

Reglas iguales a las del pipeline de datos (data/pipeline/generar_ejemplo.py):
- Solo VIIRS S-NPP (y MODIS Aqua si se pide MODIS); sin confianza baja; `type == 0` si la columna existe
  (las fuentes NRT no traen `type`, así que ahí no se puede filtrar).
- Conteo = celdas-día con fuego en malla de 0.01°, agrupadas por cuadro de 0.1° (ty, tx) y mes.
"""
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

COLUMNAS_A1 = ["fecha", "hora_utc", "lat", "lon", "pais", "sensor", "satelite", "confianza",
               "frp_mw", "dia_noche", "ty", "tx"]

SATELITES = {
    "N": "SNPP", "NPP": "SNPP", "SNPP": "SNPP", "SUOMI NPP": "SNPP", "SUOMI-NPP": "SNPP",
    "N20": "NOAA20", "1": "NOAA20", "NOAA-20": "NOAA20", "NOAA20": "NOAA20",
    "N21": "NOAA21", "2": "NOAA21", "NOAA-21": "NOAA21", "NOAA21": "NOAA21",
    "A": "Aqua", "AQUA": "Aqua", "T": "Terra", "TERRA": "Terra",
}
SATELITES_DE_LA_SERIE = {"SNPP", "Aqua"}


def normalizar(crudo: pd.DataFrame, pais: str, fuente: str) -> pd.DataFrame:
    """crudo: CSV de FIRMS leído como texto. Devuelve columnas A1 + `es_nrt`."""
    if crudo is None or crudo.empty:
        return pd.DataFrame(columns=COLUMNAS_A1 + ["es_nrt"])
    df = crudo.rename(columns=str.lower).copy()
    es_modis = fuente.upper().startswith("MODIS")

    def texto(col):
        return df[col].fillna("").astype(str).str.strip()

    if "type" in df.columns:
        df = df[texto("type") == "0"]

    df = df.assign(satelite=texto("satellite").str.upper().map(SATELITES))
    df = df[df["satelite"].isin(SATELITES_DE_LA_SERIE)]

    if es_modis:
        conf = pd.to_numeric(df["confidence"], errors="coerce")
        df = df.assign(_conf=np.where(conf >= 80, "alta", "nominal"))[conf >= 30]
    else:
        letra = texto("confidence").str.lower().str[:1]
        df = df.assign(_conf=np.where(letra == "h", "alta", "nominal"))[letra.isin(["n", "h"])]

    df = df.assign(_lat=pd.to_numeric(df["latitude"], errors="coerce").round(5),
                   _lon=pd.to_numeric(df["longitude"], errors="coerce").round(5))
    df = df.dropna(subset=["_lat", "_lon"])
    lat, lon, confianza = df["_lat"], df["_lon"], df["_conf"].to_numpy()
    out = pd.DataFrame({
        "fecha": pd.to_datetime(df["acq_date"], format="%Y-%m-%d").dt.date,
        "hora_utc": texto("acq_time").str.zfill(4),
        "lat": lat,
        "lon": lon,
        "pais": pais,
        "sensor": "MODIS" if es_modis else "VIIRS",
        "satelite": df["satelite"],
        "confianza": confianza,
        "frp_mw": pd.to_numeric(df["frp"], errors="coerce"),
        "dia_noche": texto("daynight"),
        "ty": np.floor(lat / 0.1).astype("int32"),
        "tx": np.floor(lon / 0.1).astype("int32"),
        "es_nrt": fuente.upper().endswith("_NRT"),
    })
    return out.reset_index(drop=True)


def celdas_fijas(crudo: pd.DataFrame, margen: int = 0) -> pd.DataFrame:
    """Celdas de 0.01° (fy, fx) donde FIRMS SP marcó focos que no son de vegetación
    (type 1 volcán, 2 fuente fija en tierra, 3 mar adentro), ampliadas `margen` celdas alrededor.

    Las fuentes NRT no traen `type`; con esta máscara se quitan de los días NRT los quemadores de gas,
    industrias y volcanes que SP ya identificó, igual que el filtro `type == 0` del histórico.

    Validación fuera de muestra en México (máscara de ene–abr 2026, evaluada en may–jul 2026 contra
    `type == 0`): margen 0 → error de −0.4 % a −1.7 %; margen 1 → de −0.9 % a −4.9 %. Las fuentes
    fijas no se mueven de su celda de 1 km, así que el margen solo quita incendios reales.
    """
    vacio = pd.DataFrame({"fy": pd.Series(dtype="int32"), "fx": pd.Series(dtype="int32")})
    if crudo is None or crudo.empty or "type" not in crudo.columns:
        return vacio
    df = crudo.rename(columns=str.lower)
    df = df[df["type"].fillna("").astype(str).str.strip().isin(["1", "2", "3"])]
    base = pd.DataFrame({"fy": np.floor(pd.to_numeric(df["latitude"], errors="coerce") / 0.01),
                         "fx": np.floor(pd.to_numeric(df["longitude"], errors="coerce") / 0.01)}).dropna()
    if base.empty:
        return vacio
    base = base.drop_duplicates()
    pasos = pd.DataFrame({"d": range(-margen, margen + 1)})
    vec = pasos.rename(columns={"d": "dy"}).merge(pasos.rename(columns={"d": "dx"}), how="cross")
    out = base.merge(vec, how="cross")
    out = pd.DataFrame({"fy": out.fy + out.dy, "fx": out.fx + out.dx}).drop_duplicates()
    return out.astype("int32").reset_index(drop=True)


def quitar_fuentes_fijas(det: pd.DataFrame, fijas: pd.DataFrame) -> pd.DataFrame:
    """Quita de las filas NRT las que caen en una celda fija. Las filas SP ya vienen filtradas por `type`."""
    if det is None or det.empty or fijas is None or fijas.empty:
        return det
    m = det.assign(fy=np.floor(det["lat"] / 0.01).astype("int32"), fx=np.floor(det["lon"] / 0.01).astype("int32"))
    m = m.merge(fijas.assign(_fija=True), on=["fy", "fx"], how="left")
    quedan = ~(m["_fija"].eq(True) & m["es_nrt"])
    return m[quedan].drop(columns=["fy", "fx", "_fija"]).reset_index(drop=True)


_SQL_DETECCIONES = """
SELECT CAST(fecha AS DATE) AS fecha, CAST(hora_utc AS VARCHAR) AS hora_utc,
       CAST(lat AS DOUBLE) AS lat, CAST(lon AS DOUBLE) AS lon, CAST(pais AS VARCHAR) AS pais,
       CAST(sensor AS VARCHAR) AS sensor, CAST(satelite AS VARCHAR) AS satelite,
       CAST(confianza AS VARCHAR) AS confianza, CAST(frp_mw AS DOUBLE) AS frp_mw,
       CAST(dia_noche AS VARCHAR) AS dia_noche, CAST(ty AS INTEGER) AS ty, CAST(tx AS INTEGER) AS tx
FROM det ORDER BY fecha, hora_utc
"""

# Celdas-día únicas (malla 0.01°) → conteo por cuadro de 0.1° y mes, con los tipos exactos de A2.
# El mes es VIIRS_NRT si alguno de sus días vino de la fuente NRT; si todo vino de SP, es VIIRS.
_SQL_CONTEOS = """
WITH det_viirs AS (SELECT * FROM det WHERE sensor = 'VIIRS'),
cd AS (
    SELECT DISTINCT pais, CAST(fecha AS DATE) AS fecha,
           CAST(floor(lat / 0.01) AS INTEGER) AS fy, CAST(floor(lon / 0.01) AS INTEGER) AS fx,
           CAST(ty AS INTEGER) AS ty, CAST(tx AS INTEGER) AS tx
    FROM det_viirs
),
meses AS (
    SELECT year(CAST(fecha AS DATE)) AS anio, month(CAST(fecha AS DATE)) AS mes, bool_or(es_nrt) AS hay_nrt
    FROM det_viirs GROUP BY 1, 2
)
SELECT cd.pais, cd.ty, cd.tx,
       CAST(round((cd.ty + 0.5) * 0.1, 2) AS DOUBLE) AS lat_c,
       CAST(round((cd.tx + 0.5) * 0.1, 2) AS DOUBLE) AS lon_c,
       CAST(year(cd.fecha) AS INTEGER) AS anio, CAST(month(cd.fecha) AS TINYINT) AS mes,
       CAST(NULL AS UINTEGER) AS conteo_modis,
       CAST(count(*) AS UINTEGER) AS conteo_viirs,
       CAST(count(*) AS DOUBLE) AS conteo_armonizado,
       CASE WHEN any_value(m.hay_nrt) THEN 'VIIRS_NRT' ELSE 'VIIRS' END AS fuente
FROM cd JOIN meses m ON m.anio = year(cd.fecha) AND m.mes = month(cd.fecha)
GROUP BY cd.pais, cd.ty, cd.tx, year(cd.fecha), month(cd.fecha)
ORDER BY anio, mes, ty, tx
"""


def _vacio() -> pd.DataFrame:
    return pd.DataFrame({"fecha": pd.Series(dtype="object"), "hora_utc": pd.Series(dtype="object"),
                         "lat": pd.Series(dtype="float64"), "lon": pd.Series(dtype="float64"),
                         "pais": pd.Series(dtype="object"), "sensor": pd.Series(dtype="object"),
                         "satelite": pd.Series(dtype="object"), "confianza": pd.Series(dtype="object"),
                         "frp_mw": pd.Series(dtype="float64"), "dia_noche": pd.Series(dtype="object"),
                         "ty": pd.Series(dtype="int32"), "tx": pd.Series(dtype="int32"),
                         "es_nrt": pd.Series(dtype="bool")})


def _copiar(con, sql: str, destino: Path):
    """Escribe a un archivo temporal y lo renombra, para que la API nunca lea un Parquet a medias."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".parquet.tmp")
    ruta = str(tmp).replace("\\", "/").replace("'", "''")
    con.execute(f"COPY ({sql}) TO '{ruta}' (FORMAT parquet, COMPRESSION zstd)")
    tmp.replace(destino)


def escribir_parquets(det: pd.DataFrame, dir_salida: Path) -> dict:
    """Escribe detecciones_nrt.parquet (A1) y conteos_celda_mes_nrt.parquet (A2). Devuelve filas de cada uno."""
    if det is None or det.empty:
        det = _vacio()
    con = duckdb.connect()
    con.register("det", det)
    _copiar(con, _SQL_DETECCIONES, Path(dir_salida) / "detecciones_nrt.parquet")
    _copiar(con, _SQL_CONTEOS, Path(dir_salida) / "conteos_celda_mes_nrt.parquet")
    return {"detecciones": len(det), "conteos": con.execute(f"SELECT count(*) FROM ({_SQL_CONTEOS})").fetchone()[0]}
