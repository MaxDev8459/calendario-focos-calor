"""Paso 1. Limpia los CSV anuales de FIRMS de un país y los deja con las columnas de A1.

Filtros (reglas de Datos):
  - type == 0: incendio en vegetación (quita volcanes, fuentes fijas y otras fuentes en tierra);
  - confianza: MODIS ≥ 30, VIIRS 'n' o 'h' (se quitan las bajas);
  - MODIS solo Aqua: pasa a la misma hora local que S-NPP (≈ 13:30 y 01:30), así el
    cociente VIIRS/MODIS mide la diferencia de sensor y no la de horario;
  - desde julio de 2002 (inicio de Aqua) hasta el fin del periodo.

Uso, desde data/:
    python pipeline/01_limpiar.py --crudo ../../../data/crudo --pais Mexico
"""
import glob
import time

import polars as pl

from comun import CLAVE_FIN, CLAVE_INICIO, argumentos, clave, lista_paises, paises_disponibles, ruta

COLUMNAS = ["acq_date", "acq_time", "latitude", "longitude", "sensor", "satelite", "confianza", "frp", "daynight"]


def escanear(patron):
    archivos = sorted(glob.glob(patron))
    return pl.scan_csv(archivos, infer_schema_length=0) if archivos else None


def limpiar(crudo, pais):
    partes = []
    modis = escanear(f"{crudo}/modis/modis_*_{pais}.csv")
    if modis is not None:
        conf = pl.col("confidence").cast(pl.Int32)
        partes.append(modis
                      .filter((pl.col("type") == "0") & (pl.col("satellite") == "Aqua") & (conf >= 30))
                      .with_columns(pl.lit("MODIS").alias("sensor"), pl.lit("Aqua").alias("satelite"),
                                    pl.when(conf >= 80).then(pl.lit("alta")).otherwise(pl.lit("nominal"))
                                    .alias("confianza"))
                      .select(COLUMNAS))
    viirs = escanear(f"{crudo}/viirs-snpp/viirs-snpp_*_{pais}.csv")
    if viirs is not None:
        partes.append(viirs
                      .filter((pl.col("type") == "0") & pl.col("confidence").is_in(["n", "h"]))
                      .with_columns(pl.lit("VIIRS").alias("sensor"), pl.lit("SNPP").alias("satelite"),
                                    pl.when(pl.col("confidence") == "h").then(pl.lit("alta"))
                                    .otherwise(pl.lit("nominal")).alias("confianza"))
                      .select(COLUMNAS))
    det = (pl.concat(partes)
           .select(pl.col("acq_date").str.to_date().alias("fecha"),
                   pl.col("acq_time").str.zfill(4).alias("hora_utc"),
                   pl.col("latitude").cast(pl.Float64).round(5).alias("lat"),
                   pl.col("longitude").cast(pl.Float64).round(5).alias("lon"),
                   pl.lit(pais).alias("pais"), "sensor", "satelite", "confianza",
                   pl.col("frp").cast(pl.Float64).alias("frp_mw"),
                   pl.col("daynight").alias("dia_noche"))
           .filter(clave(pl.col("fecha").dt.year(), pl.col("fecha").dt.month()).is_between(CLAVE_INICIO, CLAVE_FIN))
           .with_columns((pl.col("lat") / 0.1).floor().cast(pl.Int32).alias("ty"),
                         (pl.col("lon") / 0.1).floor().cast(pl.Int32).alias("tx"))
           .sort("fecha", "hora_utc"))
    return det.collect()


def main():
    a = argumentos("Limpia los CSV de FIRMS por país", crudo=True)
    for pais in lista_paises(a.pais, paises_disponibles(a.crudo)):
        t = time.perf_counter()
        det = limpiar(a.crudo, pais)
        det.write_parquet(ruta(a.trabajo, pais, "detecciones.parquet"), compression="zstd")
        n = dict(det.group_by("sensor").len().iter_rows())
        print(f"{pais:<34} MODIS-Aqua {n.get('MODIS', 0):>10,}  VIIRS {n.get('VIIRS', 0):>11,}  "
              f"({time.perf_counter() - t:.1f} s)")


if __name__ == "__main__":
    main()
