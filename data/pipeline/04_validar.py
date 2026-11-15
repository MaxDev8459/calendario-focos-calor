"""Paso 4. Validación "dejar un año fuera" del factor por país y mes.

Para cada año del traslape (2012–2025): se calculan los factores SIN ese año, se predice
VIIRS ≈ MODIS × factor en sus meses y se compara con el VIIRS real. Así el método se prueba
con datos que no vio al calibrarse, como cuando se aplica a 2002–2011.

Métricas (meses nacionales con MODIS y VIIRS ≥ 10 celdas-día):
  error_medio_pct       promedio de |pred − real| / real
  error_ponderado_pct   Σ|pred − real| / Σ real (pesa más los meses con mucho fuego)
  sesgo_pct             (Σ pred − Σ real) / Σ real (positivo = sobrestima)
  r                     correlación de Pearson entre predicho y real
  *_factor_unico        las mismas métricas con un solo factor sin estacionalidad (línea base)

Además guarda el cociente VIIRS/MODIS de cada año para revisar si el factor se mueve con el
tiempo (por ejemplo, por el cambio de órbita de Aqua desde 2022).

Salida: intermedio/<pais>/validacion.json

Uso, desde data/:
    python pipeline/04_validar.py --pais Mexico
"""
import polars as pl

from comun import (argumentos, guardar_json, leer_json, lista_paises, meses_calibracion, paises_procesados,
                   ruta, validar_dejando_un_anio)

AMERICA = "_America"


def cociente_anual(totales):
    cal = meses_calibracion(totales)
    return {str(a): round(v / m, 2) for a, m, v in
            cal.group_by("anio").agg(pl.col("modis").sum(), pl.col("viirs").sum()).sort("anio").iter_rows()}


def main():
    a = argumentos("Validación dejar un año fuera")
    f_am = leer_json(ruta(a.trabajo, AMERICA, "factores.json"))["factores"]
    disponibles = [p for p in paises_procesados(a.trabajo, "factores.json") if p != AMERICA]
    print(f"{'país':<34} {'error %':>8} {'ponder. %':>9} {'sesgo %':>8} {'r':>6} {'meses':>6} "
          f"│ {'error % factor único':>21}")
    for pais in lista_paises(a.pais, disponibles):
        tot = pl.read_parquet(ruta(a.trabajo, pais, "totales.parquet"))
        val = validar_dejando_un_anio(tot, f_am)
        val["cociente_anual"] = cociente_anual(tot)
        guardar_json(val, ruta(a.trabajo, pais, "validacion.json"))
        if val["error_medio_pct"] is not None:
            print(f"{pais:<34} {val['error_medio_pct']:>8} {val['error_ponderado_pct']:>9} {val['sesgo_pct']:>8} "
                  f"{val['r'] if val['r'] is not None else '—':>6} {val['meses_validados']:>6} "
                  f"│ {val['error_medio_pct_factor_unico']:>21}")
        else:
            print(f"{pais:<34} {val['nota']}")


if __name__ == "__main__":
    main()
