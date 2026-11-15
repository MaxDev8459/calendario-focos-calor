"""Pruebas de la API (Parte B del contrato) con los datos de data/ejemplo/ y sin internet.

Las respuestas de referencia de data/ejemplo/respuestas_api/ deben salir idénticas.
"""
import csv
import io
import json
from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import datos
from app.firms import config
from app.firms.normalizar import escribir_parquets
from app.main import app

EJEMPLO = config.RAIZ_REPO / "data" / "ejemplo"
MORELOS = "-99.5,18.3,-98.6,19.2"
MEXICO = "-118.5,14.5,-86.5,32.8"
pytestmark = pytest.mark.skipif(not (EJEMPLO / "conteos_celda_mes.parquet").exists(), reason="faltan los datos de ejemplo")


def referencia(nombre):
    return json.loads((EJEMPLO / "respuestas_api" / nombre).read_text(encoding="utf-8"))


@pytest.fixture
def api(tmp_path, monkeypatch):
    """API sobre data/ejemplo y sin focos recientes."""
    monkeypatch.setenv("DATOS_DIR", str(EJEMPLO))
    monkeypatch.setenv("NRT_DIR", str(tmp_path / "nrt"))
    monkeypatch.setenv("NRT_URL", "")
    datos.reiniciar()
    yield TestClient(app)
    datos.reiniciar()


@pytest.fixture
def api_con_recientes(api, tmp_path):
    """Agrega focos recientes: octubre de 2026 completo (SP) y noviembre con 2 de 30 días (NRT)."""
    base = dict(hora_utc="0742", lat=18.73412, lon=-99.10233, pais="Mexico", sensor="VIIRS", satelite="SNPP",
                confianza="nominal", frp_mw=3.2, dia_noche="N", ty=187, tx=-992)
    det = pd.DataFrame([{**base, "fecha": date(2026, 10, d), "es_nrt": False} for d in (3, 4, 5)]
                       + [{**base, "fecha": date(2026, 11, d), "es_nrt": True} for d in (1, 2)])
    escribir_parquets(det, tmp_path / "nrt")
    (tmp_path / "nrt" / "metadata_nrt.json").write_text(json.dumps({
        "paises": ["Mexico"], "desde": "2026-01-01", "hasta": "2026-11-02",
        "fuentes": [{"fuente": "VIIRS_SNPP_SP", "desde": "2026-01-01", "hasta": "2026-10-31"},
                    {"fuente": "VIIRS_SNPP_NRT", "desde": "2026-11-01", "hasta": "2026-11-02"}],
        "dias_por_mes": {**{f"2026-{m:02d}": [d, d] for m, d in zip(range(1, 11), (31, 28, 31, 30, 31, 30, 31, 31, 30, 31))},
                         "2026-11": [2, 30]},
        "dias_sin_datos": []}), encoding="utf-8")
    return api


@pytest.fixture
def api_con_noaa20(api, tmp_path):
    """Noviembre de 2026: 2 días de S-NPP y 2 de NOAA-20 (factor 0.8), marcado preliminar."""
    base = dict(hora_utc="0742", lat=18.73412, lon=-99.10233, pais="Mexico", sensor="VIIRS",
                confianza="nominal", frp_mw=3.2, dia_noche="N", ty=187, tx=-992, es_nrt=True)
    det = pd.DataFrame([{**base, "fecha": date(2026, 11, d), "satelite": "SNPP", "es_n20": False, "peso": 1.0} for d in (1, 2)]
                       + [{**base, "fecha": date(2026, 11, d), "satelite": "NOAA20", "es_n20": True, "peso": 0.8} for d in (3, 4)])
    escribir_parquets(det, tmp_path / "nrt")
    (tmp_path / "nrt" / "metadata_nrt.json").write_text(json.dumps({
        "paises": ["Mexico"], "desde": "2026-11-01", "hasta": "2026-11-04",
        "fuentes": [{"fuente": "VIIRS_SNPP_NRT", "desde": "2026-11-01", "hasta": "2026-11-02"}],
        "dias_por_mes": {"2026-11": [4, 30]}, "dias_sin_datos": [],
        "noaa20": {"fuente_api": "VIIRS_NRT_N20", "preliminar": True, "dias": ["2026-11-03", "2026-11-04"],
                   "meses": ["2026-11"], "factores": {"Mexico": 0.8}}}), encoding="utf-8")
    return api


# ---------- B1 calendario ----------
@pytest.mark.parametrize("bbox, archivo", [(MORELOS, "calendario_morelos.json"), (MEXICO, "calendario_mexico.json")])
def test_calendario_igual_a_la_referencia(api, bbox, archivo):
    r = api.get("/api/calendario", params={"bbox": bbox})
    assert r.status_code == 200
    assert r.json() == referencia(archivo)


def test_calendario_con_rango(api):
    d = api.get("/api/calendario", params={"bbox": MORELOS, "desde": "2024-01", "hasta": "2024-12"}).json()
    assert (d["desde"], d["hasta"], len(d["celdas"])) == ("2024-01", "2024-12", 12)
    assert [c["mes"] for c in d["celdas"]] == list(range(1, 13))
    assert d["mediana_mensual"] == referencia("calendario_morelos.json")["mediana_mensual"]   # la mediana no depende del rango


def test_calendario_con_meses_recientes(api_con_recientes):
    d = api_con_recientes.get("/api/calendario", params={"bbox": MORELOS}).json()
    assert d["hasta"] == "2026-11"
    por_mes = {(c["anio"], c["mes"]): c for c in d["celdas"]}
    assert por_mes[(2026, 10)] == {"anio": 2026, "mes": 10, "conteo": 3.0, "fuente": "VIIRS", "dias_con_datos": 31, "dias_mes": 31}
    assert por_mes[(2026, 11)] == {"anio": 2026, "mes": 11, "conteo": 2.0, "fuente": "VIIRS_NRT", "dias_con_datos": 2, "dias_mes": 30}
    assert por_mes[(2026, 2)]["conteo"] == 0.0                     # observado y sin focos: 0, no vacío
    assert d["mediana_mensual"] == referencia("calendario_morelos.json")["mediana_mensual"]   # solo meses completos del histórico


def test_recientes_no_aplican_fuera_de_su_cobertura(api_con_recientes):
    """En un área sin focos recientes el calendario termina en el histórico (vacío no es cero)."""
    d = api_con_recientes.get("/api/calendario", params={"bbox": "-110.5,27,-109,28.5"}).json()
    assert d["hasta"] == "2025-12"


def test_mes_con_noaa20_es_preliminar(api_con_noaa20):
    d = api_con_noaa20.get("/api/calendario", params={"bbox": MORELOS}).json()
    nov = {(c["anio"], c["mes"]): c for c in d["celdas"]}[(2026, 11)]
    assert nov == {"anio": 2026, "mes": 11, "conteo": 3.6, "fuente": "VIIRS_NRT_N20", "preliminar": True,
                   "dias_con_datos": 4, "dias_mes": 30}                      # 2 × 1 + 2 × 0.8
    oct_ = {(c["anio"], c["mes"]): c for c in d["celdas"]}[(2026, 10)]
    assert oct_["conteo"] is None and oct_["dias_con_datos"] == 0      # hueco sin registro: sin datos, no 0
    a = api_con_noaa20.get("/api/anomalia", params={"bbox": MORELOS, "anio": 2026, "mes": 11}).json()
    assert (a["fuente"], a["preliminar"], a["incompleto"], a["conteo_proyectado"]) == ("VIIRS_NRT_N20", True, True, 27.0)
    f = api_con_noaa20.get("/api/focos", params={"bbox": MORELOS, "desde": "2026-11-01", "hasta": "2026-11-04"}).json()
    props = {x["properties"]["fecha"]: x["properties"] for x in f["features"]}
    assert props["2026-11-03"]["satelite"] == "NOAA20" and props["2026-11-03"]["preliminar"] is True
    assert props["2026-11-01"]["satelite"] == "SNPP" and "preliminar" not in props["2026-11-01"]
    m = api_con_noaa20.get("/api/metadata").json()
    assert m["recientes"]["noaa20"]["factores"] == {"Mexico": 0.8}


# ---------- B2 anomalía ----------
def test_anomalia_igual_a_la_referencia(api):
    r = api.get("/api/anomalia", params={"bbox": MORELOS, "anio": 2024, "mes": 4})
    assert r.status_code == 200 and r.json() == referencia("anomalia_morelos_2024_04.json")


def test_anomalia_de_un_mes_incompleto_se_proyecta(api_con_recientes):
    d = api_con_recientes.get("/api/anomalia", params={"bbox": MORELOS, "anio": 2026, "mes": 11}).json()
    assert (d["conteo"], d["fuente"], d["incompleto"]) == (2.0, "VIIRS_NRT", True)
    assert (d["dias_con_datos"], d["dias_mes"], d["conteo_proyectado"]) == (2, 30, 30.0)
    assert d["de_anios"] == 25                                    # 24 noviembres del histórico (2002–2025) + 2026
    assert d["anomalia_pct"] == round(100 * (30.0 - d["mediana"]) / d["mediana"], 1)


def test_anomalia_fuera_del_periodo(api):
    r = api.get("/api/anomalia", params={"bbox": MORELOS, "anio": 2026, "mes": 10})
    assert r.status_code == 404 and r.json()["error"] == "sin_datos"


# ---------- B3 y B4 focos ----------
def test_csv_con_columnas_de_a1(api):
    r = api.get("/api/focos.csv", params={"bbox": MORELOS, "desde": "2024-04-01", "hasta": "2024-04-30"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="focos_2024-04-01_2024-04-30.csv"' in r.headers["content-disposition"]
    filas = list(csv.DictReader(io.StringIO(r.text)))
    assert list(filas[0]) == ["fecha", "hora_utc", "lat", "lon", "pais", "sensor", "satelite", "confianza",
                              "frp_mw", "dia_noche", "ty", "tx"]
    assert len(filas) > 100 and all("2024-04-01" <= f["fecha"] <= "2024-04-30" for f in filas)
    assert all(-99.5 <= float(f["lon"]) <= -98.6 and 18.3 <= float(f["lat"]) <= 19.2 for f in filas)
    assert len(filas[0]["hora_utc"]) == 4


def test_csv_rango_muy_grande(api):
    r = api.get("/api/focos.csv", params={"bbox": "-101,17.5,-97.5,20.5", "desde": "2002-07-01", "hasta": "2025-12-31"})
    assert r.status_code == 400 and r.json()["error"] == "rango_muy_grande"


def test_csv_sin_datos(api):
    r = api.get("/api/focos.csv", params={"bbox": "-99.2,18.8,-99.19,18.81", "desde": "2024-09-01", "hasta": "2024-09-01"})
    assert r.status_code == 404 and r.json() == {"error": "sin_datos", "mensaje": "No data for that area and period."}


def test_geojson_limitado_a_5000(api):
    d = api.get("/api/focos", params={"bbox": "-101,17.5,-97.5,20.5", "desde": "2024-01-01", "hasta": "2024-12-31"}).json()
    assert d["type"] == "FeatureCollection" and len(d["features"]) == 5000 and d["truncado"] and d["total"] > 5000
    f = d["features"][0]
    assert f["geometry"]["type"] == "Point" and len(f["geometry"]["coordinates"]) == 2
    assert {"fecha", "sensor", "frp_mw", "confianza"} <= set(f["properties"])


def test_geojson_incluye_focos_recientes(api_con_recientes):
    d = api_con_recientes.get("/api/focos", params={"bbox": MORELOS, "desde": "2025-12-25", "hasta": "2026-11-14"}).json()
    fechas = {f["properties"]["fecha"] for f in d["features"]}
    assert "2026-11-02" in fechas and any(x.startswith("2025-12") for x in fechas)


# ---------- B5 serie ----------
def test_serie_armonizacion(api):
    d = api.get("/api/serie_armonizacion", params={"bbox": MORELOS}).json()
    n = len(d["meses"])
    assert (d["meses"][0], d["meses"][-1]) == ("2002-07", "2025-12")
    assert len(d["modis_crudo"]) == len(d["viirs_crudo"]) == len(d["armonizado"]) == n
    i = d["meses"].index("2012-01")
    assert d["viirs_crudo"][i] is None and d["viirs_crudo"][i + 1] is not None     # VIIRS empieza en feb-2012
    assert d["armonizado"] == [c["conteo"] for c in referencia("calendario_morelos.json")["celdas"]]


def test_serie_con_meses_recientes_trae_su_crudo(api_con_recientes):
    d = api_con_recientes.get("/api/serie_armonizacion", params={"bbox": MORELOS}).json()
    i = d["meses"].index("2026-10")
    assert (d["viirs_crudo"][i], d["viirs_crudo"][i + 1]) == (3, 2)        # octubre 3 celdas-día, noviembre 2
    assert d["viirs_crudo"][d["meses"].index("2026-02")] == 0           # observado y sin focos


def test_serie_sin_bbox_es_todo_el_territorio(api):
    assert api.get("/api/serie_armonizacion").status_code == 200


# ---------- errores ----------
@pytest.mark.parametrize("ruta, params, codigo", [
    ("/api/calendario", {}, "bbox_invalido"),
    ("/api/calendario", {"bbox": "19.2,-98.6,18.3,-99.5"}, "bbox_invalido"),          # orden equivocado
    ("/api/calendario", {"bbox": "-99.5,18.3,-98.6"}, "bbox_invalido"),
    ("/api/calendario", {"bbox": "a,b,c,d"}, "bbox_invalido"),
    ("/api/calendario", {"bbox": MORELOS, "desde": "2024-13"}, "fecha_invalida"),
    ("/api/calendario", {"bbox": MORELOS, "desde": "2024-05", "hasta": "2024-01"}, "fecha_invalida"),
    ("/api/anomalia", {"bbox": MORELOS, "anio": 2024, "mes": 0}, "fecha_invalida"),     # mes del 1 al 12
    ("/api/anomalia", {"bbox": MORELOS, "anio": 2024}, "fecha_invalida"),
    ("/api/focos", {"bbox": MORELOS, "desde": "2024-04", "hasta": "2024-04-30"}, "fecha_invalida"),
    ("/api/focos.csv", {"bbox": MORELOS, "desde": "2024-04-30", "hasta": "2024-04-01"}, "fecha_invalida"),
])
def test_errores_del_contrato(api, ruta, params, codigo):
    r = api.get(ruta, params=params)
    assert r.status_code == 400
    assert r.json()["error"] == codigo and r.json()["mensaje"]


def test_sin_datos_en_el_mar(api):
    r = api.get("/api/calendario", params={"bbox": "-130,5,-129,6"})
    assert r.status_code == 404 and r.json()["error"] == "sin_datos"


# ---------- B6 globo ----------
def test_globo_suma_lo_mismo_que_las_celdas(api):
    d = api.get("/api/globo", params={"desde": "2024-04", "hasta": "2024-04"}).json()
    assert (d["desde"], d["hasta"], d["unidad"], d["malla_grados"]) == ("2024-04", "2024-04", "focos_armonizados", 0.5)
    assert [p["iso_a2"] for p in d["paises"]] == ["MX"]
    c = api.get("/api/celdas", params={"bbox": MEXICO, "desde": "2024-04", "hasta": "2024-04"}).json()
    total = sum(x["conteo"] for x in c["celdas"])
    assert sum(x["conteo"] for x in d["celdas"]) == pytest.approx(total, abs=1)
    assert d["paises"][0]["conteo"] == pytest.approx(total, abs=1)
    x = d["celdas"][0]
    assert set(x) == {"lat", "lon", "conteo", "region"} and x["region"] == "central_america"
    assert (x["lat"] * 2) % 1 == 0.5 and (x["lon"] * 2) % 1 == 0.5        # centro de una celda de 0.5°


def test_globo_sin_periodo_son_los_ultimos_12_meses(api):
    d = api.get("/api/globo").json()
    assert (d["desde"], d["hasta"]) == ("2025-01", "2025-12") and d["celdas"]


def test_globo_incluye_focos_recientes_solo_si_el_periodo_los_pide(api_con_recientes):
    d = api_con_recientes.get("/api/globo", params={"desde": "2026-11", "hasta": "2026-11"}).json()
    assert d["paises"] == [{"iso_a2": "MX", "conteo": 2}]
    d = api_con_recientes.get("/api/globo", params={"desde": "2025-12", "hasta": "2025-12"}).json()
    assert d["paises"][0]["conteo"] > 0


@pytest.mark.parametrize("params", [{"desde": "2025-13"}, {"desde": "2025-12", "hasta": "2025-01"}, {"hasta": "2025"}])
def test_globo_fecha_invalida(api, params):
    r = api.get("/api/globo", params=params)
    assert r.status_code == 400 and r.json()["error"] == "fecha_invalida"


# ---------- extras y CORS ----------
def test_celdas_por_cuadro(api):
    d = api.get("/api/celdas", params={"bbox": MORELOS, "desde": "2024-04", "hasta": "2024-04"}).json()
    assert sum(c["conteo"] for c in d["celdas"]) == pytest.approx(331.0)       # igual que la anomalía de referencia
    assert set(d["celdas"][0]) == {"ty", "tx", "lat_c", "lon_c", "conteo"}


def test_metadata(api):
    d = api.get("/api/metadata").json()
    assert d["ultimo_mes_completo"] == "2025-12" and "recientes" not in d


def test_cors_para_la_web(api):
    r = api.get("/api/metadata", headers={"Origin": "https://ejemplo.vercel.app"})
    assert r.headers["access-control-allow-origin"] == "*"


def test_ruta_inexistente_con_el_formato_de_errores(api):
    r = api.get("/api/no_existe")
    assert r.status_code == 404 and r.json()["error"] == "no_encontrado" and r.json()["mensaje"]


# ---------- QA del contrato: casos límite ----------
@pytest.mark.parametrize("bbox", [
    "nan,18.3,-98.6,19.2", "-inf,18.3,inf,19.2", "-200,18.3,-98.6,19.2", "-99.5,18.3,-98.6,95",
    "-99.5,18.3,-98.6,19.2,1", "-99.5;18.3;-98.6;19.2", "-99.5,18.3,-98.6,19.2,", "-99.5,18.3,-99.5,18.3", "",
])
def test_bbox_invalido_en_todas_las_rutas_con_bbox(api, bbox):
    for ruta, extra in [("/api/calendario", {}), ("/api/anomalia", {"anio": 2024, "mes": 4}), ("/api/celdas", {}),
                        ("/api/focos", {"desde": "2024-04-01", "hasta": "2024-04-30"}),
                        ("/api/focos.csv", {"desde": "2024-04-01", "hasta": "2024-04-30"})]:
        r = api.get(ruta, params={"bbox": bbox, **extra})
        assert (r.status_code, r.json()["error"]) == (400, "bbox_invalido"), ruta
    if bbox:                                                    # en la serie el bbox es opcional: vacío = todo
        assert api.get("/api/serie_armonizacion", params={"bbox": bbox}).json()["error"] == "bbox_invalido"


def test_bbox_con_espacios_y_notacion_cientifica(api):
    a = api.get("/api/calendario", params={"bbox": " -99.5, 18.3, -98.6, 19.2 "})
    b = api.get("/api/calendario", params={"bbox": "-9.95e1,18.3,-98.6,19.2"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json() == referencia("calendario_morelos.json")


def test_periodo_valido_fuera_de_los_datos_es_sin_datos(api):
    """Un periodo bien escrito pero sin datos no es `fecha_invalida`."""
    for desde, hasta in [("1990-01", "1999-12"), ("2030-01", "2030-12")]:
        r = api.get("/api/calendario", params={"bbox": MORELOS, "desde": desde, "hasta": hasta})
        assert (r.status_code, r.json()["error"]) == (404, "sin_datos"), (desde, hasta)
    d = api.get("/api/calendario", params={"bbox": MORELOS, "desde": "1990-01", "hasta": "2002-12"}).json()
    assert (d["desde"], d["hasta"]) == ("2002-07", "2002-12")       # se recorta a lo que hay


@pytest.mark.parametrize("params", [
    {}, {"desde": "2024-04-01"}, {"desde": "2024-02-30", "hasta": "2024-03-01"}, {"desde": "2024-4-1", "hasta": "2024-04-30"},
    {"desde": "01/04/2024", "hasta": "30/04/2024"},
])
def test_focos_fechas_invalidas(api, params):
    for ruta in ("/api/focos", "/api/focos.csv"):
        r = api.get(ruta, params={"bbox": MORELOS, **params})
        assert (r.status_code, r.json()["error"]) == (400, "fecha_invalida"), ruta


@pytest.mark.parametrize("desde, hasta", [("2024-09-01", "2024-09-01"), ("1995-01-01", "1995-12-31"), ("2030-01-01", "2030-01-31")])
def test_sin_focos_mapa_vacio_y_csv_sin_datos(api, desde, hasta):
    p = {"bbox": "-99.2,18.8,-99.19,18.81", "desde": desde, "hasta": hasta}
    g = api.get("/api/focos", params=p)
    assert g.status_code == 200 and g.json() == {"type": "FeatureCollection", "total": 0, "truncado": False, "features": []}
    c = api.get("/api/focos.csv", params=p)
    assert (c.status_code, c.json()["error"]) == (404, "sin_datos")


def _mas_recientes(bbox, desde, hasta, n=5000):
    """Los n focos más recientes del área según los datos de ejemplo (orden de la API)."""
    import duckdb
    o, s, e, nn = (float(x) for x in bbox.split(","))
    return duckdb.sql(
        f"SELECT fecha, hora_utc, lat, lon FROM '{(EJEMPLO / 'detecciones.parquet').as_posix()}' "
        f"WHERE fecha BETWEEN DATE '{desde}' AND DATE '{hasta}' AND lat BETWEEN {s} AND {nn} AND lon BETWEEN {o} AND {e} "
        f"ORDER BY fecha DESC, hora_utc DESC, lat, lon LIMIT {n}").fetchall()


@pytest.mark.parametrize("bbox, desde, hasta", [
    ("-101,17.5,-97.5,20.5", "2024-01-01", "2024-12-31"),        # muchos focos: basta la primera ventana
    (MORELOS, "2002-07-01", "2025-12-31"),                       # todo el histórico: hay que ampliar la ventana
    (MORELOS, "2002-07-01", "2030-12-31"),                       # `hasta` más allá de los datos
])
def test_geojson_truncado_trae_los_mas_recientes(api, bbox, desde, hasta):
    d = api.get("/api/focos", params={"bbox": bbox, "desde": desde, "hasta": hasta}).json()
    esperado = _mas_recientes(bbox, desde, hasta)
    assert d["truncado"] and d["total"] > 5000 and len(d["features"]) == 5000
    obtenido = [(f["properties"]["fecha"], f["properties"]["hora_utc"], f["geometry"]["coordinates"][1],
                 f["geometry"]["coordinates"][0]) for f in d["features"]]
    assert obtenido == [(fe.isoformat(), ho, la, lo) for fe, ho, la, lo in esperado]


def test_celdas_en_orden_estable(api):
    d = api.get("/api/celdas", params={"bbox": MEXICO, "desde": "2024-01", "hasta": "2024-12"}).json()
    orden = [(-c["conteo"], c["ty"], c["tx"]) for c in d["celdas"]]
    assert orden == sorted(orden) and len(orden) > 1000


def test_globo_en_orden_estable(api):
    d = api.get("/api/globo", params={"desde": "2024-01", "hasta": "2024-12"}).json()
    orden = [(-c["conteo"], c["lat"], c["lon"]) for c in d["celdas"]]
    assert orden == sorted(orden)


def test_globo_solo_con_desde_reciente_llega_al_ultimo_mes(api_con_recientes):
    d = api_con_recientes.get("/api/globo", params={"desde": "2026-10"}).json()
    assert (d["desde"], d["hasta"]) == ("2026-10", "2026-11") and d["paises"] == [{"iso_a2": "MX", "conteo": 5}]
    d = api_con_recientes.get("/api/globo", params={"desde": "2020-01"}).json()
    assert d["hasta"] == "2025-12"                               # dentro del histórico: hasta el último mes completo


def test_anomalia_con_mediana_cero_no_divide(api):
    """En un cuadro casi sin fuego la mediana del mes es 0: la anomalía en % no existe (null)."""
    bbox = "-113.5,27.5,-113.4,27.6"
    cal = api.get("/api/calendario", params={"bbox": bbox})
    if cal.status_code != 200 or 0.0 not in cal.json()["mediana_mensual"]:
        pytest.skip("el cuadro de prueba ya no tiene un mes con mediana 0")
    mes = cal.json()["mediana_mensual"].index(0.0) + 1
    a = api.get("/api/anomalia", params={"bbox": bbox, "anio": 2020, "mes": mes}).json()
    assert a["mediana"] == 0.0 and a["anomalia_pct"] is None and 1 <= a["lugar"] <= a["de_anios"]


@pytest.mark.parametrize("anio, mes", [("2024", "4.0"), ("dos mil", "4"), ("1999", "4"), ("2024", "13"), ("-1", "4"), ("2024", "")])
def test_anomalia_parametros_invalidos(api, anio, mes):
    r = api.get("/api/anomalia", params={"bbox": MORELOS, "anio": anio, "mes": mes})
    assert (r.status_code, r.json()["error"]) == (400, "fecha_invalida")


def test_anomalia_de_un_mes_sin_observar_es_sin_datos(api):
    for anio, mes in [(2002, 1), (2027, 1)]:                     # antes del primer mes y después del último
        r = api.get("/api/anomalia", params={"bbox": MORELOS, "anio": anio, "mes": mes})
        assert (r.status_code, r.json()["error"]) == (404, "sin_datos")


def test_preflight_de_cors_y_metodos_no_permitidos(api):
    r = api.options("/api/calendario", headers={"Origin": "https://ejemplo.vercel.app", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "*"
    r = api.post("/api/calendario")
    assert r.status_code == 405 and r.json()["error"] == "peticion_invalida" and r.json()["mensaje"]
    r = api.get("/api/calendario", headers={"Origin": "https://ejemplo.vercel.app"})       # los errores también llevan CORS
    assert r.status_code == 400 and r.headers["access-control-allow-origin"] == "*"


def test_peticiones_en_paralelo_dan_lo_mismo_que_en_serie(api):
    from concurrent.futures import ThreadPoolExecutor
    peticiones = [("/api/calendario", {"bbox": MORELOS}), ("/api/anomalia", {"bbox": MORELOS, "anio": 2024, "mes": 4}),
                  ("/api/serie_armonizacion", {}), ("/api/celdas", {"bbox": MEXICO, "desde": "2024-01", "hasta": "2024-12"}),
                  ("/api/focos", {"bbox": MORELOS, "desde": "2024-04-01", "hasta": "2024-04-30"}),
                  ("/api/focos.csv", {"bbox": MORELOS, "desde": "2024-04-01", "hasta": "2024-04-30"}), ("/api/metadata", {})]
    serie = [api.get(r, params=p) for r, p in peticiones]
    with ThreadPoolExecutor(8) as ex:
        paralelo = list(ex.map(lambda x: api.get(x[0], params=x[1]), peticiones * 4))
    assert all(r.status_code == 200 for r in paralelo)
    assert [r.content for r in paralelo] == [r.content for r in serie] * 4


def test_openapi_documenta_todas_las_rutas(api):
    rutas = api.get("/openapi.json").json()["paths"]
    for ruta in ("/api/calendario", "/api/anomalia", "/api/focos", "/api/focos.csv", "/api/serie_armonizacion",
                 "/api/celdas", "/api/globo", "/api/metadata"):
        assert rutas[ruta]["get"]["summary"] and rutas[ruta]["get"]["description"], ruta
    assert api.get("/docs").status_code == 200
