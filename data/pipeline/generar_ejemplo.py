"""Genera los datos de ejemplo de la Parte A del contrato (v0.2) a partir de los CSV de FIRMS.

Armonización preliminar: factor por mes (mediana VIIRS/MODIS-Aqua en 2012-02..2025-12)
para UN país. Sirve para que backend y frontend desarrollen con datos reales;
el pipeline final (por región y con validación completa) lo reemplaza.

Uso, desde la carpeta data/:
    python pipeline/generar_ejemplo.py --crudo crudo --pais Mexico --salida ejemplo
"""
import argparse, json, math, os
from datetime import datetime, timezone

import polars as pl

INICIO = (2002, 7)          # Aqua empieza en julio de 2002
CAMBIO = (2012, 2)          # VIIRS S-NPP completo desde febrero de 2012
FIN = (2025, 12)            # último mes con archivo anual de FIRMS
RECORTE = (-101.0, 17.5, -97.5, 20.5)   # centro de México, para las copias CSV
MORELOS = (-99.5, 18.3, -98.6, 19.2)


def leer(crudo, pais):
    modis = (pl.scan_csv(f"{crudo}/modis/modis_*_{pais}.csv", infer_schema_length=0)
             .filter((pl.col("type") == "0") & (pl.col("satellite") == "Aqua")
                     & (pl.col("confidence").cast(pl.Int32) >= 30))
             .with_columns(pl.lit("MODIS").alias("sensor"), pl.lit("Aqua").alias("satelite"),
                           pl.when(pl.col("confidence").cast(pl.Int32) >= 80).then(pl.lit("alta"))
                             .otherwise(pl.lit("nominal")).alias("confianza")))
    viirs = (pl.scan_csv(f"{crudo}/viirs-snpp/viirs-snpp_*_{pais}.csv", infer_schema_length=0)
             .filter((pl.col("type") == "0") & pl.col("confidence").is_in(["n", "h"]))
             .with_columns(pl.lit("VIIRS").alias("sensor"), pl.lit("SNPP").alias("satelite"),
                           pl.when(pl.col("confidence") == "h").then(pl.lit("alta"))
                             .otherwise(pl.lit("nominal")).alias("confianza")))
    cols = ["acq_date", "acq_time", "latitude", "longitude", "sensor", "satelite", "confianza", "frp", "daynight"]
    return (pl.concat([modis.select(cols), viirs.select(cols)])
            .select(pl.col("acq_date").str.to_date().alias("fecha"),
                    pl.col("acq_time").str.zfill(4).alias("hora_utc"),
                    pl.col("latitude").cast(pl.Float64).round(5).alias("lat"),
                    pl.col("longitude").cast(pl.Float64).round(5).alias("lon"),
                    pl.lit(pais).alias("pais"), "sensor", "satelite", "confianza",
                    pl.col("frp").cast(pl.Float64).alias("frp_mw"),
                    pl.col("daynight").alias("dia_noche"))
            .with_columns((pl.col("lat") / 0.1).floor().cast(pl.Int32).alias("ty"),
                          (pl.col("lon") / 0.1).floor().cast(pl.Int32).alias("tx"))
            .collect())


def en_periodo(anio, mes):
    return (anio, mes) >= INICIO and (anio, mes) <= FIN


def calcular_factores(totales):
    """totales: DataFrame anio, mes, modis, viirs (totales del país)."""
    tras = totales.filter((pl.col("anio") * 100 + pl.col("mes") >= CAMBIO[0] * 100 + CAMBIO[1])
                          & (pl.col("modis") > 0) & pl.col("viirs").is_not_null())
    tras = tras.with_columns((pl.col("viirs") / pl.col("modis")).alias("r"))

    def factores_sin(anio_fuera=None):
        t = tras if anio_fuera is None else tras.filter(pl.col("anio") != anio_fuera)
        return dict(t.group_by("mes").agg(pl.col("r").median()).iter_rows())

    f = factores_sin()
    pred, real = [], []
    for anio in sorted(tras["anio"].unique()):
        fa = factores_sin(anio)
        for _, mes, m, v, _r in tras.filter(pl.col("anio") == anio).iter_rows():
            pred.append(m * fa[mes]); real.append(v)
    errs = [abs(p - r) / r for p, r in zip(pred, real) if r > 0]
    sesgo = [(p - r) / r for p, r in zip(pred, real) if r > 0]
    mp, mr = sum(pred) / len(pred), sum(real) / len(real)
    cov = sum((p - mp) * (r - mr) for p, r in zip(pred, real))
    rr = cov / math.sqrt(sum((p - mp) ** 2 for p in pred) * sum((r - mr) ** 2 for r in real))
    val = {"tipo": "dejar_un_anio_fuera", "error_medio_pct": round(100 * sum(errs) / len(errs), 1),
           "sesgo_pct": round(100 * sum(sesgo) / len(sesgo), 1), "r": round(rr, 3), "meses_validados": len(real)}
    return {str(m): round(f[m], 3) for m in sorted(f)}, val


def conteos(det, factores):
    cd = (det.with_columns((pl.col("lat") / 0.01).floor().cast(pl.Int32).alias("fy"),
                           (pl.col("lon") / 0.01).floor().cast(pl.Int32).alias("fx"))
          .select("pais", "sensor", "fecha", "fy", "fx", "ty", "tx").unique())
    c = (cd.group_by("pais", "ty", "tx", pl.col("fecha").dt.year().alias("anio"),
                     pl.col("fecha").dt.month().alias("mes"), "sensor").len()
         .pivot(on="sensor", index=["pais", "ty", "tx", "anio", "mes"], values="len"))
    for col in ("MODIS", "VIIRS"):
        if col not in c.columns:
            c = c.with_columns(pl.lit(None, pl.UInt32).alias(col))
    clave = pl.col("anio") * 100 + pl.col("mes")
    antes = clave < CAMBIO[0] * 100 + CAMBIO[1]
    fac = pl.col("mes").cast(pl.Utf8).replace_strict(factores, return_dtype=pl.Float64)
    c = (c.rename({"MODIS": "conteo_modis", "VIIRS": "conteo_viirs"})
         .filter((clave >= INICIO[0] * 100 + INICIO[1]) & (clave <= FIN[0] * 100 + FIN[1]))
         .with_columns(pl.when(antes).then(None).otherwise(pl.col("conteo_viirs").fill_null(0)).alias("conteo_viirs"))
         .with_columns(pl.when(antes).then((pl.col("conteo_modis").fill_null(0) * fac).round(1))
                         .otherwise(pl.col("conteo_viirs").cast(pl.Float64)).alias("conteo_armonizado"),
                       pl.when(antes).then(pl.lit("MODIS_ajustado")).otherwise(pl.lit("VIIRS")).alias("fuente"),
                       ((pl.col("ty") + 0.5) * 0.1).round(2).alias("lat_c"),
                       ((pl.col("tx") + 0.5) * 0.1).round(2).alias("lon_c"))
         .filter(pl.col("conteo_armonizado") > 0)
         .select("pais", "ty", "tx", "lat_c", "lon_c", "anio", "mes", "conteo_modis", "conteo_viirs",
                 "conteo_armonizado", "fuente")
         .sort("anio", "mes", "ty", "tx"))
    return c


def bbox_filtro(b):
    o, s, e, n = b
    return (pl.col("ty").is_between(math.floor(s / 0.1), math.floor(n / 0.1))
            & pl.col("tx").is_between(math.floor(o / 0.1), math.floor(e / 0.1)))


def respuesta_calendario(c, b):
    serie = dict(((a, m), v) for a, m, v in
                 c.filter(bbox_filtro(b)).group_by("anio", "mes").agg(pl.col("conteo_armonizado").sum()).iter_rows())
    celdas = []
    for anio in range(INICIO[0], FIN[0] + 1):
        for mes in range(1, 13):
            if en_periodo(anio, mes):
                celdas.append({"anio": anio, "mes": mes, "conteo": round(serie.get((anio, mes), 0.0), 1),
                               "fuente": "MODIS_ajustado" if (anio, mes) < CAMBIO else "VIIRS"})
    mediana = []
    for mes in range(1, 13):
        v = sorted(x["conteo"] for x in celdas if x["mes"] == mes)
        k = len(v); mediana.append(round((v[(k - 1) // 2] + v[k // 2]) / 2, 1))
    nz = sorted(x["conteo"] for x in celdas if x["conteo"] > 0)
    cortes = [round(nz[int(len(nz) * i / 8)], 1) for i in range(1, 8)] if nz else []
    return {"bbox": list(b), "desde": f"{INICIO[0]}-{INICIO[1]:02d}", "hasta": f"{FIN[0]}-{FIN[1]:02d}",
            "unidad": "focos_armonizados", "celdas": celdas, "mediana_mensual": mediana,
            "mes_pico": mediana.index(max(mediana)) + 1,
            "escala": {"min": 0, "max": max(x["conteo"] for x in celdas), "cortes": cortes}}


def respuesta_anomalia(cal, anio, mes):
    vals = sorted((x["conteo"] for x in cal["celdas"] if x["mes"] == mes), reverse=True)
    actual = next(x for x in cal["celdas"] if x["anio"] == anio and x["mes"] == mes)
    med = cal["mediana_mensual"][mes - 1]
    menores = sum(1 for v in vals if v < actual["conteo"])
    return {"anio": anio, "mes": mes, "conteo": actual["conteo"], "mediana": med,
            "anomalia_pct": round(100 * (actual["conteo"] - med) / med, 1) if med else None,
            "percentil": round(100 * menores / len(vals)), "lugar": vals.index(actual["conteo"]) + 1,
            "de_anios": len(vals), "fuente": actual["fuente"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crudo", default="crudo"); ap.add_argument("--pais", default="Mexico")
    ap.add_argument("--salida", default="ejemplo")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.salida, "respuestas_api"), exist_ok=True)

    det = leer(a.crudo, a.pais)
    tot = (det.with_columns((pl.col("lat") / 0.01).floor().cast(pl.Int32).alias("fy"),
                            (pl.col("lon") / 0.01).floor().cast(pl.Int32).alias("fx"))
           .select("sensor", "fecha", "fy", "fx").unique()
           .group_by(pl.col("fecha").dt.year().alias("anio"), pl.col("fecha").dt.month().alias("mes"), "sensor").len()
           .pivot(on="sensor", index=["anio", "mes"], values="len")
           .rename({"MODIS": "modis", "VIIRS": "viirs"}).sort("anio", "mes"))
    factores, validacion = calcular_factores(tot.select("anio", "mes", "modis", "viirs"))
    c = conteos(det, factores)

    det_ej = (det.filter((pl.col("lon").is_between(RECORTE[0], RECORTE[2])) & (pl.col("lat").is_between(RECORTE[1], RECORTE[3]))
                         & (pl.col("fecha").dt.year() * 100 + pl.col("fecha").dt.month() >= INICIO[0] * 100 + INICIO[1]))
              .sort("fecha", "hora_utc"))
    det_ej.write_parquet(os.path.join(a.salida, "detecciones.parquet"), compression="zstd")
    det_ej.filter(pl.col("fecha").dt.year() >= 2024).with_columns(pl.col("fecha").cast(pl.Utf8)) \
          .write_csv(os.path.join(a.salida, "detecciones_recorte_2024_2025.csv"))
    c.write_parquet(os.path.join(a.salida, "conteos_celda_mes.parquet"), compression="zstd")
    c.filter(bbox_filtro(RECORTE)).write_csv(os.path.join(a.salida, "conteos_celda_mes_recorte.csv"))

    json.dump({"version": "0.2", "metodo": "factor_por_pais_y_mes_mediana", "pareja_sensores": ["Aqua", "SNPP"],
               "unidad": "celdas_dia_con_fuego_1km", "malla_conteo_grados": 0.01, "malla_consulta_grados": 0.1,
               "periodo_calibracion": [f"{CAMBIO[0]}-{CAMBIO[1]:02d}", f"{FIN[0]}-{FIN[1]:02d}"],
               "paises": {a.pais: {"factores": factores, "validacion": validacion}}},
              open(os.path.join(a.salida, "factores.json"), "w"), indent=2, ensure_ascii=False)
    json.dump({"generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "version_contrato": "0.2",
               "paises": [a.pais],
               "bbox_cubierto": [round(det["lon"].min(), 2), round(det["lat"].min(), 2), round(det["lon"].max(), 2), round(det["lat"].max(), 2)],
               "primer_mes": f"{INICIO[0]}-{INICIO[1]:02d}", "ultimo_mes_completo": f"{FIN[0]}-{FIN[1]:02d}",
               "es_ejemplo": True,
               "nota": "detecciones.parquet solo cubre el recorte del centro de México " + str(list(RECORTE))},
              open(os.path.join(a.salida, "metadata.json"), "w"), indent=2, ensure_ascii=False)

    for nombre, b in (("calendario_morelos", MORELOS), ("calendario_mexico", (-118.5, 14.5, -86.5, 32.8))):
        cal = respuesta_calendario(c, b)
        json.dump(cal, open(os.path.join(a.salida, "respuestas_api", f"{nombre}.json"), "w"), indent=1)
        if nombre == "calendario_morelos":
            json.dump(respuesta_anomalia(cal, 2024, 4),
                      open(os.path.join(a.salida, "respuestas_api", "anomalia_morelos_2024_04.json"), "w"), indent=1)

    print(f"detecciones (recorte): {det_ej.height:,} | conteos: {c.height:,} filas")
    print("factores por mes:", factores)
    print("validación:", validacion)


if __name__ == "__main__":
    main()
