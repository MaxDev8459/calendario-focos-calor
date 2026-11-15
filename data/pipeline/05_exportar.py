"""Paso 5. Escribe los archivos de la Parte A del contrato (v0.2) en salida/.

  A1 detecciones.parquet       focos limpios de todos los países pedidos
  A2 conteos_celda_mes.parquet celdas-día por cuadro de 0.1° y mes, con conteo_armonizado:
                               MODIS × factor[pais, mes] de jul-2002 a ene-2012 (fuente MODIS_ajustado)
                               VIIRS desde feb-2012 (fuente VIIRS)
  A3 factores.json             factores por país y mes, su origen y la validación
  A4 metadata.json
  A5 celdas_persistentes.parquet  celdas de 0.01° (fy, fx) quitadas por ser fuentes de calor persistentes

Se guarda toda combinación cuadro-mes con fuego en al menos un sensor; las que no aparecen
valen 0 dentro del periodo.

Uso, desde data/:
    python pipeline/05_exportar.py --pais Mexico
    python pipeline/05_exportar.py --pais todos
"""
import os
import time
from datetime import datetime, timezone

import polars as pl

from comun import (CAMBIO, CLAVE_CAMBIO, FIN, INICIO, MALLA_CONSULTA, MALLA_FINA, URL_DETECCIONES,
                   VERSION_CONTRATO, argumentos, clave, guardar_json, leer_json, lista_paises, paises_procesados,
                   ruta, texto_mes)

AMERICA = "_America"
COLUMNAS_A2 = ["pais", "ty", "tx", "lat_c", "lon_c", "anio", "mes", "conteo_modis", "conteo_viirs",
               "conteo_armonizado", "fuente"]


def armonizar(conteos, factores):
    fac = pl.col("mes").cast(pl.Utf8).replace_strict(factores, return_dtype=pl.Float64)
    antes = clave(pl.col("anio"), pl.col("mes")) < CLAVE_CAMBIO
    return (conteos
            .with_columns(pl.when(antes).then((pl.col("conteo_modis") * fac).round(1))
                          .otherwise(pl.col("conteo_viirs").cast(pl.Float64)).alias("conteo_armonizado"),
                          pl.when(antes).then(pl.lit("MODIS_ajustado")).otherwise(pl.lit("VIIRS")).alias("fuente"),
                          ((pl.col("ty") + 0.5) * MALLA_CONSULTA).round(2).alias("lat_c"),
                          ((pl.col("tx") + 0.5) * MALLA_CONSULTA).round(2).alias("lon_c"))
            .select(COLUMNAS_A2))


def main():
    a = argumentos("Exporta los archivos de la Parte A", salida=True)
    t0 = time.perf_counter()
    disponibles = [p for p in paises_procesados(a.trabajo, "validacion.json") if p != AMERICA]
    paises = lista_paises(a.pais, disponibles)
    os.makedirs(a.salida, exist_ok=True)

    # A2 · conteos armonizados
    partes, info = [], {}
    for pais in paises:
        f = leer_json(ruta(a.trabajo, pais, "factores.json"))
        v = leer_json(ruta(a.trabajo, pais, "validacion.json"))
        info[pais] = {"factores": f["factores"], "origen_factor": f["origen"], "validacion": v}
        partes.append(armonizar(pl.read_parquet(ruta(a.trabajo, pais, "conteos_crudos.parquet")), f["factores"]))
    # Orden por lugar: filas vecinas parecidas comprimen mejor (35 → 18 MB, el repo acepta ≤ 20 MB)
    # y DuckDB se salta los bloques cuyo rango de ty/tx queda fuera del bbox consultado.
    conteos = pl.concat(partes).sort("pais", "ty", "tx", "anio", "mes")
    conteos.write_parquet(os.path.join(a.salida, "conteos_celda_mes.parquet"), compression="zstd",
                          compression_level=22)

    # A5 · celdas persistentes (refinerías, quemadores de gas) que 01_limpiar quitó: el backend las quita
    # también de los focos NRT para que una fuente industrial no aparezca como incendio del mes actual
    (pl.concat([pl.read_parquet(ruta(a.trabajo, p, "persistentes.parquet")).with_columns(pl.lit(p).alias("pais"))
                for p in paises])
     .select("pais", "fy", "fx",
             ((pl.col("fy") + 0.5) * MALLA_FINA).round(3).alias("lat_c"),
             ((pl.col("fx") + 0.5) * MALLA_FINA).round(3).alias("lon_c"))
     .sort("pais", "fy", "fx")
     .write_parquet(os.path.join(a.salida, "celdas_persistentes.parquet")))

    # A1 · detecciones (en streaming para no cargar toda América en memoria)
    pl.concat([pl.scan_parquet(ruta(a.trabajo, p, "detecciones.parquet")) for p in paises]) \
      .sink_parquet(os.path.join(a.salida, "detecciones.parquet"), compression="zstd", compression_level=10)
    caja = (pl.scan_parquet(os.path.join(a.salida, "detecciones.parquet"))
            .select(pl.col("lon").min().alias("o"), pl.col("lat").min().alias("s"),
                    pl.col("lon").max().alias("e"), pl.col("lat").max().alias("n")).collect().row(0))
    filas_a1 = pl.scan_parquet(os.path.join(a.salida, "detecciones.parquet")).select(pl.len()).collect().item()

    # A3 · factores y validación
    america = leer_json(ruta(a.trabajo, AMERICA, "factores.json"))
    guardar_json({"version": VERSION_CONTRATO, "metodo": "factor_por_pais_y_mes_mediana",
                  "pareja_sensores": ["Aqua", "SNPP"], "unidad": "celdas_dia_con_fuego_1km",
                  "malla_conteo_grados": MALLA_FINA, "malla_consulta_grados": MALLA_CONSULTA,
                  "periodo_calibracion": [texto_mes(CAMBIO), texto_mes(FIN)],
                  "factor_america": {"factores": america["factores"],
                                     "paises_incluidos": len(america["paises_incluidos"])},
                  "paises": info},
                 os.path.join(a.salida, "factores.json"))

    # A4 · metadata
    guardar_json({"generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "version_contrato": VERSION_CONTRATO, "paises": paises,
                  "bbox_cubierto": [round(x, 2) for x in caja],
                  "primer_mes": texto_mes(INICIO), "ultimo_mes_completo": texto_mes(FIN),
                  "es_ejemplo": False,
                  "detecciones_url": URL_DETECCIONES,
                  "detecciones_filas": filas_a1},
                 os.path.join(a.salida, "metadata.json"))

    tam = {n: os.path.getsize(os.path.join(a.salida, n)) / 1e6 for n in os.listdir(a.salida)}
    print(f"{len(paises)} países · conteos {conteos.height:,} filas · " +
          " · ".join(f"{n} {mb:.1f} MB" for n, mb in sorted(tam.items())) +
          f" ({time.perf_counter() - t0:.1f} s)")


if __name__ == "__main__":
    main()
