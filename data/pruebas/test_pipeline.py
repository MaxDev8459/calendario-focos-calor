"""Pruebas del método con datos inventados cuyo resultado se conoce. Correr desde data/:
    .venv/bin/python -m pytest pruebas -q
"""
import importlib.util
import os
import sys
from datetime import date

import polars as pl
import pytest

PIPELINE = os.path.join(os.path.dirname(__file__), "..", "pipeline")
sys.path.insert(0, PIPELINE)
import comun  # noqa: E402


def cargar(nombre):
    spec = importlib.util.spec_from_file_location(nombre, os.path.join(PIPELINE, f"{nombre}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def totales(cociente_por_mes, anios=range(2012, 2026), modis=100, extremo=None):
    """Totales nacionales sintéticos: viirs = modis × cociente[mes]. extremo=(anio, mes, cociente)."""
    filas = []
    for a in anios:
        for m in range(1, 13):
            if (a, m) < comun.CAMBIO:
                continue
            c = cociente_por_mes(m)
            if extremo and (a, m) == extremo[:2]:
                c = extremo[2]
            filas.append((a, m, modis, round(modis * c)))
    return pl.DataFrame(filas, schema=["anio", "mes", "modis", "viirs"], orient="row")


def test_factor_es_el_cociente_por_mes():
    f, origen = comun.calcular_factores(totales(lambda m: 2 + m / 10))
    assert f["1"] == pytest.approx(2.1) and f["12"] == pytest.approx(3.2)
    assert set(origen.values()) == {"pais_mes"}


def test_un_anio_extremo_no_mueve_la_mediana():
    f, _ = comun.calcular_factores(totales(lambda m: 4, extremo=(2016, 4, 40)))
    assert f["4"] == pytest.approx(4)


def test_respaldo_factor_del_pais_si_el_mes_tiene_pocos_anios():
    t = totales(lambda m: 3).with_columns(
        pl.when((pl.col("mes") == 7) & (pl.col("anio") > 2014)).then(0).otherwise(pl.col("modis")).alias("modis"))
    f, origen = comun.calcular_factores(t)
    assert origen["7"] == "pais" and f["7"] == pytest.approx(3)


def test_respaldo_factor_de_america_si_el_pais_no_tiene_fuego():
    t = totales(lambda m: 3, modis=2)          # menos de MIN_MODIS_MES en todos los meses
    america = {str(m): 5.0 for m in range(1, 13)}
    f, origen = comun.calcular_factores(t, america)
    assert set(origen.values()) == {"america_mes"} and f["1"] == 5.0


def test_mes_con_falsas_alarmas_de_modis_no_calibra():
    # como El Salvador en septiembre: MODIS ve 20 celdas-día y VIIRS solo 3 → no es fuego real
    t = totales(lambda m: 4).with_columns(
        pl.when(pl.col("mes") == 9).then(20).otherwise(pl.col("modis")).alias("modis"),
        pl.when(pl.col("mes") == 9).then(3).otherwise(pl.col("viirs")).alias("viirs"))
    f, origen = comun.calcular_factores(t)
    assert origen["9"] == "pais" and f["9"] == pytest.approx(4)


def test_quita_fuentes_persistentes_pero_no_incendios():
    limpiar = cargar("01_limpiar")
    filas = []
    for anio in (2015, 2016):
        for mes in range(1, 13):                          # refinería: arde todo el año
            filas.append((date(anio, mes, 5), 10.215, -61.635))
        for dia in range(1, 29):                          # incendio grande: un mes, muchos días
            filas.append((date(anio, 4, dia), 18.705, -99.105))
    det = pl.DataFrame(filas, schema=["fecha", "lat", "lon"], orient="row")
    limpio, quitadas = limpiar.quitar_persistentes(det)
    assert quitadas.height == 1
    assert limpio["lat"].unique().to_list() == [18.705]


def test_validacion_con_factor_perfecto_da_error_cero_y_supera_al_factor_unico():
    v = comun.validar_dejando_un_anio(totales(lambda m: 2 + m / 2, modis=1000))
    assert v["error_medio_pct"] == 0 and v["r"] == pytest.approx(1)
    assert v["error_medio_pct_factor_unico"] > 10


def test_pais_sin_datos_para_validar_trae_las_mismas_claves_en_null():
    v = comun.validar_dejando_un_anio(totales(lambda m: 3, modis=2))
    for k in ("error_medio_pct", "sesgo_pct", "r"):
        assert k in v and v[k] is None


def test_malla_cuenta_celdas_dia_no_focos():
    malla = cargar("02_malla")
    d = date(2015, 3, 10)
    det = pl.DataFrame({
        "pais": ["X"] * 4, "sensor": ["VIIRS", "VIIRS", "VIIRS", "MODIS"],
        "fecha": [d, d, d, d],
        # tres píxeles VIIRS: dos en la misma celda de 0.01°, uno en otra
        "lat": [18.7012, 18.7049, 18.7151, 18.7020], "lon": [-99.1012, -99.1031, -99.1012, -99.1010]})
    conteos, tot = malla.malla(det)
    fila = tot.filter((pl.col("anio") == 2015) & (pl.col("mes") == 3)).row(0, named=True)
    assert fila["viirs"] == 2 and fila["modis"] == 1
    assert tot.filter(pl.col("anio") == 2011)["viirs"].null_count() == 12      # VIIRS vacío antes de 2012
    assert tot.filter(pl.col("anio") == 2016)["modis"].sum() == 0               # sin fuego = 0, no vacío
    assert conteos.select("ty", "tx").row(0) == (187, -992)


def test_exportar_usa_modis_ajustado_antes_de_2012_y_viirs_despues():
    exp = cargar("05_exportar")
    c = pl.DataFrame({"pais": ["X", "X"], "ty": [187, 187], "tx": [-992, -992], "anio": [2008, 2015],
                      "mes": [4, 4], "conteo_modis": [10, 10], "conteo_viirs": [None, 33]},
                     schema_overrides={"conteo_viirs": pl.Int32})
    r = exp.armonizar(c, {str(m): 2.5 for m in range(1, 13)})
    assert r["conteo_armonizado"].to_list() == [25.0, 33.0]
    assert r["fuente"].to_list() == ["MODIS_ajustado", "VIIRS"]
    assert r.columns == exp.COLUMNAS_A2
