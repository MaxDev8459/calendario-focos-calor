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
    assert r.status_code == 404 and r.json() == {"error": "sin_datos", "mensaje": "No hay datos para esa área y ese periodo."}


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
