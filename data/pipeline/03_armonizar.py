"""Paso 3. Factor de armonización por país y por mes.

factor[mes] = mediana, entre los años 2012–2025, de VIIRS / MODIS-Aqua (celdas-día con fuego
del país en ese mes). Se aplica como MODIS × factor[mes] para jul-2002 a ene-2012.

- Por mes: el cociente cambia con la temporada (tipo y tamaño de los incendios).
- Mediana: un año extremo no mueve el factor.
- Respaldo para países o meses con poco fuego (ver comun.calcular_factores): factor del país
  y, si tampoco alcanza, factor de América (todos los países procesados juntos).

Salida: intermedio/<pais>/factores.json  y  intermedio/_America/factores.json (referencia)

Uso, desde data/:
    python pipeline/03_armonizar.py --pais Mexico
"""
import polars as pl

from comun import argumentos, calcular_factores, guardar_json, lista_paises, paises_procesados, ruta

AMERICA = "_America"


def factores_america(trabajo):
    paises = [p for p in paises_procesados(trabajo, "totales.parquet") if p != AMERICA]
    t = pl.concat([pl.read_parquet(ruta(trabajo, p, "totales.parquet")) for p in paises])
    t = (t.group_by("anio", "mes")
          .agg(pl.col("modis").sum(),
               pl.when(pl.col("viirs").is_null().all()).then(None).otherwise(pl.col("viirs").sum()).first()
               .alias("viirs"))
          .sort("anio", "mes"))
    t.write_parquet(ruta(trabajo, AMERICA, "totales.parquet"))
    f, origen = calcular_factores(t)
    guardar_json({"paises_incluidos": paises, "factores": f, "origen": origen}, ruta(trabajo, AMERICA, "factores.json"))
    return f, len(paises)


def main():
    a = argumentos("Factor de armonización por país y mes")
    f_am, n = factores_america(a.trabajo)
    print(f"{'América (' + str(n) + ' países)':<34} " + " ".join(f"{f_am[str(m)]:5.2f}" for m in range(1, 13)))
    disponibles = [p for p in paises_procesados(a.trabajo, "totales.parquet") if p != AMERICA]
    for pais in lista_paises(a.pais, disponibles):
        tot = pl.read_parquet(ruta(a.trabajo, pais, "totales.parquet"))
        f, origen = calcular_factores(tot, f_am)
        guardar_json({"factores": f, "origen": origen}, ruta(a.trabajo, pais, "factores.json"))
        marca = {"pais_mes": " ", "pais": "*", "america_mes": "^", "sin_datos": "?"}
        print(f"{pais:<34} " + " ".join(
            f"{f[str(m)]:5.2f}" if f[str(m)] is not None else "  —  "
            for m in range(1, 13)) + "   " + "".join(marca[origen[str(m)]] for m in range(1, 13)))
    print("origen por mes: ' ' país y mes · '*' factor del país · '^' factor de América · '?' sin datos")


if __name__ == "__main__":
    main()
