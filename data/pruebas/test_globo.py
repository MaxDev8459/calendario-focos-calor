"""Pruebas del agregado para el globo (/api/globo). Correr desde data/:
    .venv/bin/python -m pytest pruebas -q
"""
import os
import sys

import duckdb
import polars as pl
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import globo as g  # noqa: E402


@pytest.fixture
def conteos(tmp_path):
    """Tres cuadros de 0.1°: dos caen en la misma celda de 0.5° (México) y uno en Brasil."""
    df = pl.DataFrame({
        "pais": ["Mexico", "Mexico", "Brazil", "Mexico"],
        "ty": [189, 189, -100, 189], "tx": [-994, -993, -500, -994],
        "lat_c": [18.95, 18.95, -9.95, 18.95], "lon_c": [-99.35, -99.25, -49.95, -99.35],
        "anio": [2025, 2025, 2025, 2024], "mes": [4, 5, 8, 4],
        "conteo_armonizado": [10.0, 5.0, 7.0, 99.0],
    })
    ruta = tmp_path / "conteos.parquet"
    df.write_parquet(ruta)
    return str(ruta)


def test_forma_y_sumas(conteos):
    r = g.globo(duckdb.connect(), conteos, "2025-01", "2025-12")
    assert set(r) >= {"desde", "hasta", "unidad", "celdas", "paises"}
    assert r["unidad"] == "focos_armonizados"
    mx = [c for c in r["celdas"] if c["region"] == "central_america"]
    assert len(mx) == 1 and mx[0]["conteo"] == 15.0            # dos cuadros, misma celda de 0.5°
    assert mx[0]["lat"] == 18.75 and mx[0]["lon"] == -99.25     # centro de la celda de 0.5°
    assert {p["iso_a2"]: p["conteo"] for p in r["paises"]} == {"MX": 15, "BR": 7}


def test_periodo_excluye_fuera_de_rango(conteos):
    r = g.globo(duckdb.connect(), conteos, "2024-04", "2024-04")
    assert [p["iso_a2"] for p in r["paises"]] == ["MX"] and r["paises"][0]["conteo"] == 99


def test_fecha_invalida(conteos):
    with pytest.raises(ValueError, match="fecha_invalida"):
        g.globo(duckdb.connect(), conteos, "2025-13", "2025-12")
    with pytest.raises(ValueError, match="fecha_invalida"):
        g.globo(duckdb.connect(), conteos, "2025-12", "2025-01")


def test_todos_los_paises_tienen_region_del_frontend():
    assert len(g.PAISES) == 35
    assert {r for _, r in g.PAISES.values()} <= {"north_america", "central_america", "caribbean", "south_america"}
