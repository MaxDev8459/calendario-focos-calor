"""Paso 6. Figuras para el pitch (textos en inglés, porque las ve el jurado).

  figuras/harmonization_before_after.png  totales anuales: MODIS y VIIRS crudos (antes) contra
                                          MODIS × factor por mes y VIIRS (después)
  figuras/monthly_factor_by_country.png   factor VIIRS/MODIS por mes en varios países
  figuras/*.csv                           los mismos números en tabla

Uso, desde data/:
    python pipeline/06_grafica.py --pais todos --comparar Mexico,Brazil,Bolivia,Canada
"""
import argparse
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import polars as pl  # noqa: E402

from comun import CARPETA_TRABAJO, leer_json, lista_paises, paises_procesados, ruta  # noqa: E402

AMERICA = "_America"
SUPERFICIE, TINTA, TINTA_2, REJILLA = "#fcfcfb", "#1f1f1e", "#5f5e5a", "#e4e3df"
AZUL, NARANJA, AQUA, AMARILLO = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
NOMBRES = {"Mexico": "Mexico", "Brazil": "Brazil", "Bolivia": "Bolivia", "Canada": "Canada",
           "United_States": "United States"}


def estilo(ax):
    ax.set_facecolor(SUPERFICIE)
    for lado in ("top", "right", "left"):
        ax.spines[lado].set_visible(False)
    ax.spines["bottom"].set_color(REJILLA)
    ax.grid(axis="y", color=REJILLA, linewidth=0.8)
    ax.tick_params(colors=TINTA_2, length=0, labelsize=10)
    ax.set_axisbelow(True)


def etiqueta(ax, x, y, texto, color):
    ax.plot([x + 0.25, x + 0.85], [y, y], color=color, linewidth=2, solid_capstyle="round")
    ax.text(x + 1.0, y, texto, va="center", fontsize=10, color=TINTA)


def series_anuales(trabajo, paises):
    filas = []
    for p in paises:
        t = pl.read_parquet(ruta(trabajo, p, "totales.parquet"))
        f = leer_json(ruta(trabajo, p, "factores.json"))["factores"]
        fac = pl.col("mes").cast(pl.Utf8).replace_strict({k: (v or 0.0) for k, v in f.items()},
                                                         return_dtype=pl.Float64)
        filas.append(t.with_columns((pl.col("modis") * fac).alias("ajustado")))
    t = pl.concat(filas)
    return (t.group_by("anio")
             .agg(pl.col("modis").sum(), pl.col("ajustado").sum(),
                  pl.when(pl.col("viirs").is_null().any()).then(None).otherwise(pl.col("viirs").sum()).first()
                  .alias("viirs"))
             .filter(pl.col("anio") >= 2003)
             .with_columns(pl.when(pl.col("anio") >= 2013).then(pl.col("viirs")).alias("viirs"))
             .sort("anio"))


def figura_antes_despues(s, titulo_region, salida):
    a = s["anio"].to_list()
    k = 1000
    fig, (izq, der) = plt.subplots(1, 2, figsize=(13, 5.2), sharey=True, facecolor=SUPERFICIE)
    for ax in (izq, der):
        estilo(ax)
        ax.set_xlim(2002.5, 2029.5)
        ax.set_xticks([2003, 2008, 2013, 2018, 2025])
    v = [x / k if x is not None else None for x in s["viirs"].to_list()]
    av = [x for x, y in zip(a, v) if y is not None]
    vv = [y for y in v if y is not None]

    izq.plot(a, [x / k for x in s["modis"].to_list()], color=NARANJA, linewidth=2)
    izq.plot(av, vv, color=AQUA, linewidth=2)
    etiqueta(izq, a[-1], s["modis"][-1] / k, "MODIS (Aqua)", NARANJA)
    etiqueta(izq, a[-1], vv[-1], "VIIRS (S-NPP)", AQUA)
    izq.set_title("Before: two sensors, two scales", loc="left", fontsize=13, color=TINTA, pad=10)
    izq.set_ylabel("Fire cell-days per year (thousands, 1 km cells)", color=TINTA_2, fontsize=10)

    der.plot(a, [x / k for x in s["ajustado"].to_list()], color=AZUL, linewidth=2)
    der.plot(av, vv, color=AQUA, linewidth=2, linestyle=(0, (4, 2)))
    der.axvspan(2002.5, 2012.5, color=AZUL, alpha=0.06, linewidth=0)
    der.text(2003, min(vv) * 0.25, "MODIS-only years:\nharmonized series\nfills the gap",
             fontsize=9, color=TINTA_2, va="bottom")
    etiqueta(der, a[-1], s["ajustado"][-1] / k + max(vv) * 0.03, "MODIS × monthly factor", AZUL)
    etiqueta(der, a[-1], vv[-1] - max(vv) * 0.03, "VIIRS observed", AQUA)
    der.set_title("After: one consistent series (2003–2025)", loc="left", fontsize=13, color=TINTA, pad=10)

    fig.suptitle(f"Harmonizing MODIS with VIIRS active-fire detections · {titulo_region}",
                 x=0.06, ha="left", fontsize=15, color=TINTA, y=0.99)
    fig.text(0.06, 0.01, "Source: NASA FIRMS (MODIS C6.1 Aqua, VIIRS S-NPP 375 m), type 0, nominal/high confidence. "
             "Factor = median VIIRS/MODIS ratio per country and month, 2012–2025.",
             fontsize=8.5, color=TINTA_2)
    fig.tight_layout(rect=(0.04, 0.04, 1, 0.95))
    fig.savefig(salida, dpi=200, facecolor=SUPERFICIE)
    plt.close(fig)


def figura_factores(trabajo, paises, salida):
    colores = [AZUL, NARANJA, AQUA, AMARILLO]
    fig, ax = plt.subplots(figsize=(10, 5.2), facecolor=SUPERFICIE)
    estilo(ax)
    meses = list(range(1, 13))
    tabla = {}
    for p, c in zip(paises, colores):
        f = leer_json(ruta(trabajo, p, "factores.json"))["factores"]
        y = [f[str(m)] for m in meses]
        tabla[NOMBRES.get(p, p)] = y
        ax.plot(meses, y, color=c, linewidth=2, marker="o", markersize=5,
                markeredgecolor=SUPERFICIE, markeredgewidth=1.5)
    # etiquetas directas a la derecha, separadas para que no choquen
    finales = sorted(((tabla[n][-1], n, c) for n, c in zip(tabla, colores)), reverse=True)
    pos, minimo = [], 0.45
    for y, n, c in finales:
        yy = min(y, pos[-1] - minimo) if pos else y
        pos.append(yy)
        etiqueta(ax, 12, yy, n, c)
    ax.set_xlim(0.6, 14.6)
    ax.set_xticks(meses, ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
    ax.set_ylim(0, max(max(v) for v in tabla.values()) * 1.18)
    ax.set_ylabel("VIIRS / MODIS ratio (fire cell-days)", color=TINTA_2, fontsize=10)
    ax.set_title("The correction factor follows each region's fire season", loc="left",
                 fontsize=14, color=TINTA, pad=24)
    ax.text(0, 1.02, "Lowest during the main fire season (large fires both sensors see): "
            "April in Mexico, July–August in Bolivia and Brazil", transform=ax.transAxes,
            fontsize=9.5, color=TINTA_2)
    ax.legend([plt.Line2D([], [], color=c, linewidth=2) for c in colores[:len(tabla)]], list(tabla),
              loc="upper left", frameon=False, ncol=len(tabla), fontsize=9, labelcolor=TINTA)
    fig.tight_layout()
    fig.savefig(salida, dpi=200, facecolor=SUPERFICIE)
    plt.close(fig)
    pl.DataFrame({"month": meses, **tabla}).write_csv(salida.replace(".png", ".csv"))


def main():
    ap = argparse.ArgumentParser(description="Figuras de la armonización")
    ap.add_argument("--pais", default="todos", help="Países que suma la figura antes/después")
    ap.add_argument("--comparar", default="Mexico,Brazil,Bolivia,Canada", help="Hasta 4 países")
    ap.add_argument("--trabajo", default=CARPETA_TRABAJO)
    ap.add_argument("--figuras", default="figuras")
    a = ap.parse_args()
    os.makedirs(a.figuras, exist_ok=True)
    disponibles = [p for p in paises_procesados(a.trabajo, "factores.json") if p != AMERICA]
    paises = lista_paises(a.pais, disponibles)
    region = "35 countries of the Americas" if a.pais == "todos" else ", ".join(NOMBRES.get(p, p) for p in paises)

    s = series_anuales(a.trabajo, paises)
    s.rename({"anio": "year", "modis": "modis_raw", "viirs": "viirs_raw", "ajustado": "modis_harmonized"}) \
     .write_csv(os.path.join(a.figuras, "harmonization_before_after.csv"))
    figura_antes_despues(s, region, os.path.join(a.figuras, "harmonization_before_after.png"))
    figura_factores(a.trabajo, lista_paises(a.comparar, disponibles)[:4],
                    os.path.join(a.figuras, "monthly_factor_by_country.png"))
    solape = s.filter(pl.col("viirs").is_not_null())
    dif = 100 * (solape["ajustado"].sum() - solape["viirs"].sum()) / solape["viirs"].sum()
    print(f"figuras en {a.figuras}/ · salto crudo VIIRS/MODIS {solape['viirs'].sum() / solape['modis'].sum():.1f}× · "
          f"diferencia armonizado vs VIIRS 2013–2025: {dif:+.1f} %")


if __name__ == "__main__":
    main()
