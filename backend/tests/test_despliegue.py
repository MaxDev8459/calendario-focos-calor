"""Pruebas de la descarga de A1 en el despliegue, con un servidor simulado."""
import json
import sys
from pathlib import Path

import duckdb
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "despliegue"))
import descargar_datos as dd  # noqa: E402

URL = "https://github.com/equipo/repo/releases/download/datos-v1/detecciones.parquet"


@pytest.fixture
def parquet_bytes(tmp_path):
    ruta = tmp_path / "origen.parquet"
    duckdb.connect().execute(
        f"COPY (SELECT range AS ty, range AS tx FROM range(1234)) TO '{ruta.as_posix()}' (FORMAT parquet)")
    return ruta.read_bytes()


def servidor(contenido: bytes, contador: list):
    def responder(request):
        contador.append(str(request.url))
        if str(request.url) == URL:
            return httpx.Response(302, headers={"location": "https://objetos.test/a1"})
        if request.url.host == "objetos.test":
            return httpx.Response(200, content=contenido)
        return httpx.Response(404)
    return httpx.Client(transport=httpx.MockTransport(responder), follow_redirects=True)


def test_descarga_verifica_filas_y_no_repite(tmp_path, parquet_bytes):
    peticiones = []
    http = servidor(parquet_bytes, peticiones)
    destino = tmp_path / "salida" / "detecciones.parquet"
    assert dd.descargar(URL, destino, 1234, http=http) == "descargado"
    assert dd.filas_parquet(destino) == 1234
    assert dd.descargar(URL, destino, 1234, http=http) == "ya_estaba"
    assert len(peticiones) == 2                       # redirección + archivo, una sola vez


def test_filas_distintas_falla_sin_dejar_archivo(tmp_path, parquet_bytes):
    destino = tmp_path / "salida" / "detecciones.parquet"
    with pytest.raises(RuntimeError, match="se esperaban"):
        dd.descargar(URL, destino, 999, http=servidor(parquet_bytes, []))
    assert list(destino.parent.iterdir()) == []


def test_404_falla(tmp_path):
    with pytest.raises(RuntimeError, match="HTTP 404"):
        dd.descargar(URL + "x", tmp_path / "d.parquet", http=servidor(b"", []))
    assert list(tmp_path.iterdir()) == []


def test_sin_salida_o_sin_url_no_hace_nada(tmp_path):
    assert dd.main(tmp_path) == 0
    (tmp_path / "metadata.json").write_text(json.dumps({"es_ejemplo": True}), encoding="utf-8")
    assert dd.main(tmp_path) == 0
    assert not (tmp_path / "detecciones.parquet").exists()
