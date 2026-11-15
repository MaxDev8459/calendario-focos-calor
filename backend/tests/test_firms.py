"""Pruebas del cliente de FIRMS con respuestas simuladas (no gastan transacciones ni necesitan llave).

Correr desde backend/:  python -m pytest -q
"""
import io
import json
from datetime import date, timedelta

import duckdb
import httpx
import pandas as pd
import pytest

from app.firms import config
from app.firms.actualizar import actualizar, archivos_nrt, dias_por_mes, primer_dia_sin_historico
from app.firms.cliente import ClienteFirms, ErrorFirms, planear_fuentes, tramos
from app.firms.noaa20 import medir_factores
from app.firms.normalizar import (COLUMNAS_A1, celdas_fijas, escribir_parquets, normalizar, quitar_fuentes_fijas,
                                  quitar_persistentes)

LLAVE = "llave_de_prueba_123"
ENCABEZADO = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight"
DISPONIBILIDAD = ("data_id,min_date,max_date\n"
                  "MODIS_NRT,2026-06-01,2026-11-13\n"
                  "VIIRS_SNPP_SP,2012-01-20,2026-08-31\n"
                  "VIIRS_SNPP_NRT,2026-08-01,2026-11-13\n")
EJEMPLO = config.RAIZ_REPO / "data" / "ejemplo"


def csv_viirs(filas):
    return ENCABEZADO + "\n" + "\n".join(filas) + ("\n" if filas else "")


def fila(lat, lon, fecha, hora="742", sat="N", conf="n", frp="1.5", dn="N"):
    return f"{lat},{lon},330.1,0.4,0.37,{fecha},{hora},{sat},VIIRS,{conf},2.0NRT,290.1,{frp},{dn}"


class FirmsFalso:
    """Imita la API de área. Cada día: dos focos en la misma celda de 1 km del centro de México,
    uno en una plataforma del Golfo (fuera de los cuadros que el histórico tiene para México) y un
    quemador de gas en Tabasco (SP lo marca type 2; NRT no trae type). Los días de `sin_datos` vienen vacíos."""

    QUEMADOR = (18.45123, -93.15321)

    def __init__(self, sin_datos=(), sin_snpp=(), disponibilidad=None):
        self.peticiones = []
        self.sin_datos = set(sin_datos)
        self.sin_snpp = set(sin_snpp)          # días sin S-NPP (NOAA-20 sí tiene)
        self.disponibilidad = disponibilidad or DISPONIBILIDAD

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.peticiones.append(request.url.path)
        partes = request.url.path.strip("/").split("/")
        if partes[:3] == ["api", "data_availability", "csv"]:
            return httpx.Response(200, text=self.disponibilidad)
        if partes[:3] == ["api", "area", "csv"]:
            _, _, _, llave, fuente, zona, dias, inicio = partes
            if llave != LLAVE:
                return httpx.Response(200, text="Invalid MAP_KEY.")
            if int(dias) > 5:
                return httpx.Response(400, text="Invalid day range. Expects [1..5].")
            d0 = date.fromisoformat(inicio)
            sp = fuente.endswith("_SP")
            n20 = "NOAA20" in fuente
            sat = "N20" if n20 else "N"
            filas = []
            for i in range(int(dias)):
                d = (d0 + timedelta(days=i)).isoformat()
                if d in self.sin_datos or (not n20 and d in self.sin_snpp):
                    continue
                dia = [(fila(18.73412, -99.10233, d, sat=sat), "0"),
                       (fila(18.73499, -99.10101, d, hora="1942", sat=sat, conf="h", dn="D"), "0"),
                       (fila(27.32601, -90.7181, d, sat=sat, frp="40.2"), "3"), (fila(*self.QUEMADOR, d, sat=sat, frp="25.0"), "2")]
                if n20:   # NOAA-20 ve una celda más que S-NPP cada día: factor S-NPP/NOAA-20 = 0.5
                    dia.append((fila(18.80511, -99.20577, d, sat=sat), "0"))
                filas += [f"{f},{t}" if sp else f for f, t in dia]
            if not filas:
                return httpx.Response(200, text="")
            return httpx.Response(200, text=(ENCABEZADO + (",type" if sp else "")) + "\n" + "\n".join(filas) + "\n")
        return httpx.Response(400, text="Invalid API call.")


@pytest.fixture
def falso():
    return FirmsFalso()


@pytest.fixture
def cliente(falso, tmp_path):
    http = httpx.Client(transport=httpx.MockTransport(falso))
    return ClienteFirms(map_key=LLAVE, url_base="https://firms.test", http=http,
                        dir_cache=tmp_path / "cache", pausa_s=0)


# ---------- tramos y plan de fuentes ----------
def test_tramos_de_5_dias():
    assert tramos(date(2026, 1, 1), date(2026, 1, 12)) == [
        (date(2026, 1, 1), 5), (date(2026, 1, 6), 5), (date(2026, 1, 11), 2)]
    assert tramos(date(2026, 1, 1), date(2026, 1, 1)) == [(date(2026, 1, 1), 1)]
    assert tramos(date(2026, 1, 2), date(2026, 1, 1)) == []


def test_plan_usa_sp_y_luego_nrt_sin_traslape():
    disp = {"VIIRS_SNPP_SP": (date(2012, 1, 20), date(2026, 8, 31)),
            "VIIRS_SNPP_NRT": (date(2026, 8, 1), date(2026, 11, 13))}
    assert planear_fuentes(date(2026, 1, 1), date(2026, 11, 14), disp) == [
        ("VIIRS_SNPP_SP", date(2026, 1, 1), date(2026, 8, 31)),
        ("VIIRS_SNPP_NRT", date(2026, 9, 1), date(2026, 11, 13))]


def test_plan_sin_sp_usa_solo_nrt():
    disp = {"VIIRS_SNPP_NRT": (date(2026, 1, 1), date(2026, 11, 13))}
    assert planear_fuentes(date(2026, 1, 1), date(2026, 3, 1), disp) == [
        ("VIIRS_SNPP_NRT", date(2026, 1, 1), date(2026, 3, 1))]


def test_plan_no_deja_huecos_si_nrt_empieza_tarde():
    """Si NRT no cubre el día siguiente al SP, no se inventa: el plan se detiene ahí."""
    disp = {"VIIRS_SNPP_SP": (date(2012, 1, 20), date(2026, 6, 30)),
            "VIIRS_SNPP_NRT": (date(2026, 8, 1), date(2026, 11, 13))}
    assert planear_fuentes(date(2026, 1, 1), date(2026, 11, 13), disp) == [
        ("VIIRS_SNPP_SP", date(2026, 1, 1), date(2026, 6, 30))]


# ---------- normalización ----------
def test_normalizar_filtra_y_da_columnas_a1():
    crudo = pd.read_csv(io.StringIO(csv_viirs([
        fila(18.73412, -99.10233, "2026-11-10", hora="42"),          # se queda, hora 0042
        fila(18.7, -99.1, "2026-11-10", conf="l"),                    # confianza baja: fuera
        fila(18.7, -99.1, "2026-11-10", sat="N20"),                   # NOAA-20: fuera de la serie
        fila(18.7, -99.1, "2026-11-10", conf=""),                     # sin confianza: fuera
        fila(19.0, -98.5, "2026-11-11", conf="h", dn="D"),            # se queda, alta
    ])), dtype=str)
    det = normalizar(crudo, "Mexico", "VIIRS_SNPP_NRT")
    assert list(det.columns) == COLUMNAS_A1 + ["es_nrt"]
    assert len(det) == 2
    a, b = det.iloc[0], det.iloc[1]
    assert (a.hora_utc, a.satelite, a.sensor, a.confianza, a.pais) == ("0042", "SNPP", "VIIRS", "nominal", "Mexico")
    assert (a.ty, a.tx) == (187, -992)          # igual que el ejemplo del contrato
    assert b.confianza == "alta" and b.dia_noche == "D"
    assert det.es_nrt.all()


def test_normalizar_filtra_type_si_viene():
    crudo = pd.DataFrame({"latitude": ["18.7", "18.8"], "longitude": ["-99.1", "-99.2"],
                          "acq_date": ["2026-05-01"] * 2, "acq_time": ["1942"] * 2, "satellite": ["N"] * 2,
                          "confidence": ["n"] * 2, "frp": ["3"] * 2, "daynight": ["D"] * 2, "type": ["0", "2"]})
    det = normalizar(crudo, "Mexico", "VIIRS_SNPP_SP")
    assert len(det) == 1 and not det.es_nrt.any()


def test_normalizar_vacio():
    assert normalizar(pd.DataFrame(), "Mexico", "VIIRS_SNPP_NRT").empty


# ---------- Parquet compatibles con la Parte A ----------
def esquema(ruta):
    return [(c[0], c[1]) for c in duckdb.sql(f"DESCRIBE SELECT * FROM '{ruta.as_posix()}'").fetchall()]


@pytest.fixture
def det_ejemplo():
    crudo = pd.read_csv(io.StringIO(csv_viirs([
        fila(18.73412, -99.10233, "2026-10-30"),
        fila(18.73499, -99.10101, "2026-10-30", hora="1942"),        # misma celda de 1 km y día: cuenta 1
        fila(18.73412, -99.10233, "2026-10-31"),                       # otro día: cuenta 1 más
        fila(18.95, -99.05, "2026-11-02"),                             # otro cuadro, otro mes
    ])), dtype=str)
    sp = normalizar(crudo.iloc[:3], "Mexico", "VIIRS_SNPP_SP")
    nrt = normalizar(crudo.iloc[3:], "Mexico", "VIIRS_SNPP_NRT")
    return pd.concat([sp, nrt], ignore_index=True)


def test_conteos_celdas_dia_y_fuente(det_ejemplo, tmp_path):
    filas = escribir_parquets(det_ejemplo, tmp_path)
    assert filas == {"detecciones": 4, "conteos": 2}
    c = duckdb.sql(f"SELECT anio, mes, ty, tx, conteo_viirs, conteo_armonizado, fuente, conteo_modis "
                   f"FROM '{(tmp_path / 'conteos_celda_mes_nrt.parquet').as_posix()}' ORDER BY anio, mes").fetchall()
    assert c[0] == (2026, 10, 187, -992, 2, 2.0, "VIIRS", None)
    assert c[1] == (2026, 11, 189, -991, 1, 1.0, "VIIRS_NRT", None)


@pytest.mark.skipif(not (EJEMPLO / "conteos_celda_mes.parquet").exists(), reason="faltan los datos de ejemplo")
def test_mismo_esquema_que_los_datos_de_ejemplo(det_ejemplo, tmp_path):
    escribir_parquets(det_ejemplo, tmp_path)
    assert esquema(tmp_path / "conteos_celda_mes_nrt.parquet") == esquema(EJEMPLO / "conteos_celda_mes.parquet")
    assert esquema(tmp_path / "detecciones_nrt.parquet") == esquema(EJEMPLO / "detecciones.parquet")


@pytest.mark.skipif(not (EJEMPLO / "conteos_celda_mes.parquet").exists(), reason="faltan los datos de ejemplo")
def test_se_une_con_el_historico_en_duckdb(det_ejemplo, tmp_path):
    escribir_parquets(det_ejemplo, tmp_path)
    hist, nrt = (EJEMPLO / "conteos_celda_mes.parquet").as_posix(), (tmp_path / "conteos_celda_mes_nrt.parquet").as_posix()
    fuentes = dict(duckdb.sql(f"SELECT fuente, count(*) FROM read_parquet(['{hist}', '{nrt}']) GROUP BY 1").fetchall())
    assert set(fuentes) == {"MODIS_ajustado", "VIIRS", "VIIRS_NRT"}


def test_parquet_vacio_conserva_esquema(tmp_path):
    assert escribir_parquets(None, tmp_path) == {"detecciones": 0, "conteos": 0}
    assert ("fecha", "DATE") in esquema(tmp_path / "detecciones_nrt.parquet")
    assert ("mes", "TINYINT") in esquema(tmp_path / "conteos_celda_mes_nrt.parquet")


# ---------- cliente ----------
def test_disponibilidad(cliente):
    disp = cliente.disponibilidad()
    assert disp["VIIRS_SNPP_NRT"] == (date(2026, 8, 1), date(2026, 11, 13))


def test_tramos_de_5_dias_y_cache(cliente, falso):
    bbox = (-118.4, 14.5, -86.7, 32.8)
    df = cliente.focos_area("VIIRS_SNPP_SP", bbox, date(2026, 1, 1), date(2026, 1, 7))
    assert len(df) == 28                                      # 7 días × 4 focos
    assert falso.peticiones == [f"/api/area/csv/{LLAVE}/VIIRS_SNPP_SP/-118.4,14.5,-86.7,32.8/5/2026-01-01",
                                f"/api/area/csv/{LLAVE}/VIIRS_SNPP_SP/-118.4,14.5,-86.7,32.8/2/2026-01-06"]
    cliente.focos_area("VIIRS_SNPP_SP", bbox, date(2026, 1, 1), date(2026, 1, 7))
    assert len(falso.peticiones) == 2                         # la segunda vez sale de la caché
    assert not any(LLAVE in p.name for p in cliente.dir_cache.iterdir())


def test_dias_sin_datos_del_satelite_no_son_error(tmp_path):
    """FIRMS responde vacío (ni encabezado) cuando el satélite no tiene datos en todo el tramo."""
    falso = FirmsFalso(sin_datos=[f"2026-03-{d:02d}" for d in range(10, 15)])
    c = ClienteFirms(map_key=LLAVE, url_base="https://firms.test", dir_cache=tmp_path, pausa_s=0,
                     http=httpx.Client(transport=httpx.MockTransport(falso)))
    assert c.focos_area("VIIRS_SNPP_SP", (-99.5, 18.3, -98.6, 19.2), date(2026, 3, 10), date(2026, 3, 14)).empty


def test_la_llave_no_sale_en_los_logs_de_httpx():
    import logging
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING


def test_bbox_en_orden_del_contrato(cliente, falso):
    cliente.focos_area("VIIRS_SNPP_NRT", (-99.5, 18.3, -98.6, 19.2), date(2026, 11, 1), date(2026, 11, 1))
    assert falso.peticiones[-1] == f"/api/area/csv/{LLAVE}/VIIRS_SNPP_NRT/-99.5,18.3,-98.6,19.2/1/2026-11-01"


def test_llave_invalida_no_se_filtra_en_el_error(falso, tmp_path):
    http = httpx.Client(transport=httpx.MockTransport(falso))
    otro = ClienteFirms(map_key="llave_mala", url_base="https://firms.test", http=http, dir_cache=tmp_path, pausa_s=0)
    with pytest.raises(ErrorFirms) as e:
        otro.focos_area("VIIRS_SNPP_NRT", (-99.5, 18.3, -98.6, 19.2), date(2026, 11, 1), date(2026, 11, 1))
    assert e.value.codigo == "firms_rechazo" and "llave_mala" not in str(e.value)


def test_reintenta_si_firms_esta_saturado(tmp_path):
    respuestas = iter([httpx.Response(503), httpx.Response(200, text=DISPONIBILIDAD)])
    http = httpx.Client(transport=httpx.MockTransport(lambda r: next(respuestas)))
    c = ClienteFirms(map_key=LLAVE, url_base="https://firms.test", http=http, dir_cache=tmp_path, pausa_s=0)
    assert "VIIRS_SNPP_SP" in c.disponibilidad()


def test_sin_llave(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "")
    with pytest.raises(ErrorFirms) as e:
        ClienteFirms()
    assert e.value.codigo == "falta_map_key"


# ---------- fuentes fijas ----------
def test_celdas_fijas_con_margen():
    crudo = pd.DataFrame({"latitude": ["18.45123", "19.0"], "longitude": ["-93.15321", "-99.0"], "type": ["2", "0"]})
    fijas = celdas_fijas(crudo)
    assert list(zip(fijas.fy, fijas.fx)) == [(1845, -9316)]   # solo la celda de 1 km del quemador
    assert len(celdas_fijas(crudo, margen=1)) == 9            # con margen: la celda y sus 8 vecinas
    assert celdas_fijas(crudo.drop(columns="type")).empty     # NRT: sin type no hay máscara


def test_quitar_fuentes_fijas_solo_en_nrt():
    fijas = pd.DataFrame({"fy": [1845], "fx": [-9316]}, dtype="int32")
    base = dict(fecha=date(2026, 9, 1), hora_utc="0742", pais="Mexico", sensor="VIIRS", satelite="SNPP",
                confianza="nominal", frp_mw=25.0, dia_noche="N", ty=184, tx=-932)
    det = pd.DataFrame([{**base, "lat": 18.45123, "lon": -93.15321, "es_nrt": True},
                        {**base, "lat": 18.45123, "lon": -93.15321, "es_nrt": False},
                        {**base, "lat": 18.47, "lon": -93.10, "es_nrt": True}])
    quedan = quitar_fuentes_fijas(det, fijas)
    assert list(quedan.columns) == list(det.columns)
    assert [(r.lat, r.es_nrt) for r in quedan.itertuples()] == [(18.45123, False), (18.47, True)]


# ---------- actualizador completo ----------
def test_actualizar_de_punta_a_punta(tmp_path):
    falso = FirmsFalso(sin_datos=["2026-08-27"])
    cliente = ClienteFirms(map_key=LLAVE, url_base="https://firms.test", dir_cache=tmp_path / "cache", pausa_s=0,
                           http=httpx.Client(transport=httpx.MockTransport(falso)))
    meta = actualizar(["Mexico"], date(2026, 8, 25), date(2026, 9, 5), cliente=cliente, dir_salida=tmp_path / "nrt")
    assert meta["fuentes"] == [
        {"fuente": "VIIRS_SNPP_SP", "desde": "2026-08-25", "hasta": "2026-08-31"},
        {"fuente": "VIIRS_SNPP_NRT", "desde": "2026-09-01", "hasta": "2026-09-05"}]
    assert meta["dias_por_mes"] == {"2026-08": [6, 31], "2026-09": [5, 30]}
    assert meta["dias_sin_datos"] == ["2026-08-27"]
    # 11 días con datos × 2 focos: la plataforma se va por estar fuera de México y el quemador por
    # `type` (días SP) o por la máscara de fuentes fijas (días NRT).
    assert meta["filas"]["detecciones"] == 22
    assert meta["filas"]["quitados_fuentes_fijas"] == 5
    o, s, e, n = map(float, falso.peticiones[-1].split("/")[6].split(","))   # bbox de los cuadros de México
    assert -119 < o < -117 and 14 < s < 15 and -87 < e < -86 and 32 < n < 33
    a = archivos_nrt(tmp_path / "nrt")
    assert duckdb.sql(f"SELECT count(*) FROM '{a['detecciones']}' WHERE lat > 27 OR lon > -94").fetchall()[0][0] == 0
    c = dict(duckdb.sql(f"SELECT mes, fuente FROM '{a['conteos']}'").fetchall())
    assert c == {8: "VIIRS", 9: "VIIRS_NRT"}
    total = duckdb.sql(f"SELECT sum(conteo_armonizado) FROM '{a['conteos']}'").fetchall()[0][0]
    assert total == 11                                       # 2 focos por día en la misma celda = 1 celda-día
    assert json.loads((tmp_path / "nrt" / "metadata_nrt.json").read_text(encoding="utf-8"))["hasta"] == "2026-09-05"


def test_archivos_nrt_si_no_hay_nada(tmp_path):
    assert archivos_nrt(tmp_path, url_base="") is None


def release_falso(estado=200):
    peticiones = []

    def responder(request):
        peticiones.append(str(request.url))
        if estado == 200 and request.url.path.endswith("/metadata_nrt.json"):
            return httpx.Response(200, json={"hasta": "2026-11-02", "dias_por_mes": {"2026-11": [2, 30]}})
        return httpx.Response(estado)
    return httpx.Client(transport=httpx.MockTransport(responder)), peticiones


def test_archivos_nrt_desde_el_release(tmp_path):
    """En el despliegue no hay archivos locales: se leen del release nrt-latest (DuckDB httpfs)."""
    base = "https://github.test/equipo/repo/releases/download/nrt-latest"
    http, peticiones = release_falso()
    a = archivos_nrt(tmp_path, url_base=base, http=http)
    assert a["conteos"] == f"{base}/conteos_celda_mes_nrt.parquet"
    assert a["detecciones"] == f"{base}/detecciones_nrt.parquet"
    assert a["metadata"]["hasta"] == "2026-11-02"
    assert archivos_nrt(tmp_path, url_base=base, http=http) == a
    assert len(peticiones) == 1                                # la segunda vez sale de la caché


def test_archivos_nrt_si_el_release_no_existe(tmp_path):
    http, _ = release_falso(estado=404)
    assert archivos_nrt(tmp_path, url_base="https://github.test/otro/releases/download/nrt-latest", http=http) is None


def test_archivos_locales_tienen_prioridad(tmp_path):
    (tmp_path / "metadata_nrt.json").write_text('{"hasta": "2026-11-02"}', encoding="utf-8")
    a = archivos_nrt(tmp_path, url_base="https://no.se.usa")
    assert a["conteos"].endswith("/conteos_celda_mes_nrt.parquet") and a["metadata"]["hasta"] == "2026-11-02"


def test_periodo_por_defecto_empieza_despues_del_historico():
    anio, mes = map(int, config.metadata_historico()["ultimo_mes_completo"].split("-"))
    d = primer_dia_sin_historico()
    assert d.day == 1 and (d.year * 12 + d.month) == (anio * 12 + mes) + 1


def test_dias_por_mes():
    assert dias_por_mes(date(2026, 10, 30), date(2026, 11, 2)) == {"2026-10": [2, 31], "2026-11": [2, 30]}


# ---------- NOAA-20 para los días sin S-NPP (P37) ----------
def det_sintetico(pais, sat, conteos_por_mes, anio=2026):
    """Una fila por celda-día: `conteos_por_mes` = {mes: (días, celdas por día)}."""
    filas = []
    for mes, (dias, celdas) in conteos_por_mes.items():
        for d in range(1, dias + 1):
            for k in range(celdas):
                filas.append({"fecha": date(anio, mes, d), "lat": 18.005 + 0.01 * k, "lon": -99.005, "pais": pais,
                              "satelite": sat})
    return pd.DataFrame(filas)


def dias_de(meses, anio=2026, dias=25):
    return {date(anio, m, d) for m in meses for d in range(1, dias + 1)}


def test_factor_es_la_mediana_mensual_y_se_valida_dejando_un_mes_fuera():
    # razones S-NPP/NOAA-20 por mes: 0.8, 0.9, 1.0 y 1.2 → mediana 0.95
    snpp = det_sintetico("Mexico", "SNPP", {1: (25, 4), 2: (25, 9), 3: (25, 10), 4: (25, 6)})
    n20 = det_sintetico("Mexico", "NOAA20", {1: (25, 5), 2: (25, 10), 3: (25, 10), 4: (25, 5)})
    m = medir_factores(snpp, n20, dias_de([1, 2, 3, 4]), ["Mexico"])
    assert m["factores"] == {"Mexico": 0.95}
    v = m["por_pais"]["Mexico"]
    assert (v["origen"], v["meses"]) == ("pais", 4)
    enero = v["por_mes"][0]
    assert enero["mes"] == "2026-01" and enero["factor_sin_el_mes"] == 1.0      # mediana de 0.9, 1.0 y 1.2
    assert enero["error_pct"] == round(100 * (1.0 * 125 - 100) / 100, 1)        # 25 %
    assert v["error_max_abs_pct"] == max(abs(x["error_pct"]) for x in v["por_mes"])


def test_pais_con_pocos_meses_usa_el_factor_de_la_zona():
    snpp = pd.concat([det_sintetico("Mexico", "SNPP", {1: (25, 2), 2: (25, 2), 3: (25, 2)}),
                      det_sintetico("Belize", "SNPP", {1: (25, 2)})])
    n20 = pd.concat([det_sintetico("Mexico", "NOAA20", {1: (25, 4), 2: (25, 4), 3: (25, 4)}),
                     det_sintetico("Belize", "NOAA20", {1: (25, 4)})])
    m = medir_factores(snpp, n20, dias_de([1, 2, 3]), ["Mexico", "Belize"])
    assert m["factores"] == {"Mexico": 0.5, "Belize": 0.5}
    assert m["por_pais"]["Belize"]["origen"] == "zona" and m["zona"]["meses"] == 3


def test_meses_con_pocos_dias_comunes_no_cuentan_y_sin_meses_el_factor_es_1():
    snpp = det_sintetico("Mexico", "SNPP", {11: (2, 3)})
    n20 = det_sintetico("Mexico", "NOAA20", {11: (2, 6)})
    m = medir_factores(snpp, n20, {date(2026, 11, 1), date(2026, 11, 2)}, ["Mexico"])
    assert m["factores"] == {"Mexico": 1.0} and m["por_pais"]["Mexico"]["origen"] == "respaldo_factor_1"


def test_normalizar_noaa20_solo_si_se_pide():
    crudo = pd.read_csv(io.StringIO(csv_viirs([fila(18.7, -99.1, "2026-11-10", sat="N20"),
                                               fila(18.7, -99.1, "2026-11-10", sat="N")])), dtype=str)
    assert list(normalizar(crudo, "Mexico", "VIIRS_SNPP_NRT")["satelite"]) == ["SNPP"]
    assert list(normalizar(crudo, "Mexico", "VIIRS_NOAA20_NRT", satelites={"NOAA20"})["satelite"]) == ["NOAA20"]


def test_quitar_persistentes_en_todas_las_filas():
    det = pd.DataFrame({"lat": [18.7341, 18.9001], "lon": [-99.1023, -99.2001], "es_nrt": [False, True]})
    pers = pd.DataFrame({"fy": [1873], "fx": [-9911]})
    assert list(quitar_persistentes(det, pers)["lat"]) == [18.9001]
    assert len(quitar_persistentes(det, None)) == 2


def test_conteos_con_noaa20_ponderados_y_fuente_propia(det_ejemplo, tmp_path):
    n20 = det_ejemplo.assign(fecha=date(2026, 11, 5), satelite="NOAA20", es_nrt=True, es_n20=True, peso=0.8)
    det = pd.concat([det_ejemplo.assign(es_n20=False, peso=1.0), n20], ignore_index=True)
    escribir_parquets(det, tmp_path)
    c = duckdb.sql(f"SELECT mes, fuente, sum(conteo_viirs), sum(conteo_armonizado) FROM "
                   f"'{tmp_path / 'conteos_celda_mes_nrt.parquet'}' GROUP BY 1, 2 ORDER BY 1").fetchall()
    sep, nov = c[0], c[-1]
    assert nov[1] == "VIIRS_NRT_N20" and sep[1] != "VIIRS_NRT_N20"
    # noviembre: 1 celda-día de S-NPP (día 2) + 2 celdas-día de NOAA-20 (día 5) × 0.8
    assert (nov[2], nov[3]) == (3, pytest.approx(1 + 2 * 0.8))


def test_actualizar_llena_con_noaa20_los_dias_sin_snpp(tmp_path):
    disp = ("data_id,min_date,max_date\n"
            "VIIRS_SNPP_SP,2012-01-20,2026-08-31\n"
            "VIIRS_SNPP_NRT,2026-08-01,2026-09-05\n"
            "VIIRS_NOAA20_SP,2018-04-01,2026-08-31\n"
            "VIIRS_NOAA20_NRT,2026-08-01,2026-09-10\n")
    falso = FirmsFalso(sin_snpp=["2026-07-15"], disponibilidad=disp)
    cliente = ClienteFirms(map_key=LLAVE, url_base="https://firms.test", dir_cache=tmp_path / "cache", pausa_s=0,
                           http=httpx.Client(transport=httpx.MockTransport(falso)))
    meta = actualizar(["Mexico"], date(2026, 6, 1), date(2026, 9, 10), cliente=cliente, dir_salida=tmp_path / "nrt")
    n = meta["noaa20"]
    assert n["dias"] == ["2026-07-15"] + [f"2026-09-{d:02d}" for d in range(6, 11)]
    assert n["meses"] == ["2026-07", "2026-09"] and n["preliminar"] and n["fuente_api"] == "VIIRS_NRT_N20"
    assert n["factores"] == {"Mexico": 0.5}
    v = n["por_pais"]["Mexico"]
    assert (v["origen"], v["meses"], v["error_max_abs_pct"]) == ("pais", 3, 0.0)    # jun, jul y ago
    assert meta["hasta"] == "2026-09-10" and meta["dias_sin_datos"] == []
    assert meta["dias_por_mes"]["2026-07"] == [31, 31] and meta["dias_por_mes"]["2026-09"] == [10, 30]
    a = archivos_nrt(tmp_path / "nrt")
    c = dict((m, (f, x)) for m, f, x in duckdb.sql(
        f"SELECT mes, any_value(fuente), sum(conteo_armonizado) FROM '{a['conteos']}' GROUP BY 1").fetchall())
    assert c[6] == ("VIIRS", 30.0) and c[8] == ("VIIRS", 31.0)          # agosto sigue en SP
    assert c[7] == ("VIIRS_NRT_N20", 31.0)          # 30 días S-NPP + 1 día NOAA-20 (2 celdas × 0.5)
    assert c[9] == ("VIIRS_NRT_N20", 10.0)          # 5 días S-NPP + 5 días NOAA-20 (2 celdas × 0.5)
    sats = dict(duckdb.sql(f"SELECT satelite, count(*) FROM '{a['detecciones']}' GROUP BY 1").fetchall())
    assert sats["NOAA20"] == 6 * 3                   # solo los días de relleno: 3 focos de México por día


def test_actualizar_sin_noaa20(tmp_path):
    disp = DISPONIBILIDAD + "VIIRS_NOAA20_NRT,2026-08-01,2026-11-13\n"
    falso = FirmsFalso(disponibilidad=disp)
    cliente = ClienteFirms(map_key=LLAVE, url_base="https://firms.test", dir_cache=tmp_path / "cache", pausa_s=0,
                           http=httpx.Client(transport=httpx.MockTransport(falso)))
    meta = actualizar(["Mexico"], date(2026, 8, 25), date(2026, 9, 5), cliente=cliente,
                      dir_salida=tmp_path / "nrt", con_noaa20=False)
    assert "noaa20" not in meta and not any("NOAA20" in p for p in falso.peticiones)
