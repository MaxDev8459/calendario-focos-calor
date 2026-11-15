"""Paso 2. Convierte focos en "celdas-día con fuego" y los agrega por cuadro de 0.1° y mes.

Por qué celdas-día: un píxel VIIRS mide 375 m y uno MODIS 1 km; un mismo incendio aparece
en varios píxeles VIIRS y en uno MODIS. Contar celdas de 0.01° (~1 km) con al menos un foco
por día pone a los dos sensores en la misma unidad y quita el efecto del tamaño del píxel.

Salidas en intermedio/<pais>/:
  conteos_crudos.parquet  pais, ty, tx, anio, mes, conteo_modis, conteo_viirs (solo cuadros con fuego)
  totales.parquet         anio, mes, modis, viirs (total nacional; TODOS los meses del periodo:
                          0 = sin fuego, vacío = VIIRS aún no existía)

Uso, desde data/:
    python pipeline/02_malla.py --pais Mexico
"""
import time

import polars as pl

from comun import CAMBIO, CARPETA_TRABAJO, FIN, INICIO, MALLA_FINA, argumentos, lista_paises, paises_procesados, ruta


def celdas_dia(det):
    """Una fila por (sensor, fecha, celda fina) con al menos un foco. ty/tx salen de la celda
    fina (fy // 10) para que cada celda fina caiga en un solo cuadro de 0.1°."""
    return (det
            .with_columns((pl.col("lat") / MALLA_FINA).floor().cast(pl.Int32).alias("fy"),
                          (pl.col("lon") / MALLA_FINA).floor().cast(pl.Int32).alias("fx"))
            .select("pais", "sensor", "fecha", "fy", "fx").unique()
            .with_columns(pl.col("fy").floordiv(10).alias("ty"), pl.col("fx").floordiv(10).alias("tx"),
                          pl.col("fecha").dt.year().cast(pl.Int32).alias("anio"),
                          pl.col("fecha").dt.month().cast(pl.Int32).alias("mes")))


def por_sensor(df, indice):
    """Cuenta por índice y sensor y deja columnas MODIS y VIIRS (aunque falte un sensor)."""
    c = df.group_by(*indice, "sensor").len().pivot(on="sensor", index=indice, values="len")
    for col in ("MODIS", "VIIRS"):
        if col not in c.columns:
            c = c.with_columns(pl.lit(None, pl.UInt32).alias(col))
    return c.with_columns(pl.col("MODIS").cast(pl.Int32), pl.col("VIIRS").cast(pl.Int32))


def todos_los_meses():
    return pl.DataFrame([(a, m) for a in range(INICIO[0], FIN[0] + 1) for m in range(1, 13)
                         if INICIO <= (a, m) <= FIN], schema=["anio", "mes"], orient="row",
                        ).cast(pl.Int32)


def malla(det):
    cd = celdas_dia(det)
    antes = (pl.col("anio") * 100 + pl.col("mes")) < CAMBIO[0] * 100 + CAMBIO[1]
    conteos = (por_sensor(cd, ["pais", "ty", "tx", "anio", "mes"])
               .rename({"MODIS": "conteo_modis", "VIIRS": "conteo_viirs"})
               .with_columns(pl.col("conteo_modis").fill_null(0),
                             pl.when(antes).then(None).otherwise(pl.col("conteo_viirs").fill_null(0))
                             .alias("conteo_viirs"))
               .sort("anio", "mes", "ty", "tx"))
    totales = (todos_los_meses()
               .join(por_sensor(cd, ["anio", "mes"]), on=["anio", "mes"], how="left")
               .select("anio", "mes", pl.col("MODIS").fill_null(0).alias("modis"),
                       pl.when(antes).then(None).otherwise(pl.col("VIIRS").fill_null(0)).alias("viirs"))
               .sort("anio", "mes"))
    return conteos, totales


def main():
    a = argumentos("Celdas-día con fuego por cuadro de 0.1° y mes")
    for pais in lista_paises(a.pais, paises_procesados(a.trabajo or CARPETA_TRABAJO, "detecciones.parquet")):
        t = time.perf_counter()
        conteos, totales = malla(pl.read_parquet(ruta(a.trabajo, pais, "detecciones.parquet")))
        conteos.write_parquet(ruta(a.trabajo, pais, "conteos_crudos.parquet"), compression="zstd")
        totales.write_parquet(ruta(a.trabajo, pais, "totales.parquet"))
        print(f"{pais:<34} cuadros-mes {conteos.height:>9,}  celdas-día MODIS {totales['modis'].sum():>9,}  "
              f"VIIRS {totales['viirs'].sum():>10,}  ({time.perf_counter() - t:.1f} s)")


if __name__ == "__main__":
    main()
