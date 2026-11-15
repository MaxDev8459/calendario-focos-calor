"""Acceso a los datos de la Parte A del contrato con DuckDB, sin cargarlos en memoria.

De dónde se leen, en este orden:
1. `DATOS_DIR` (variable de entorno), si se define.
2. `data/salida/` del repo, si existe (desarrollo con datos reales).
3. Internet (`DATOS_URL`, o el release `datos-v1` y la rama de datos): DuckDB lee los Parquet por partes
   con httpfs. Es el caso del despliegue serverless, donde `data/` no viaja con la función.
4. `data/ejemplo/` del repo (desarrollo sin conexión).

A1 (`detecciones.parquet`, ~700 MB) no va en git: si no está en la carpeta, se usa `detecciones_url`
de `metadata.json`.
"""
import json
import logging
import os
import tempfile
import threading
from pathlib import Path

import duckdb
import httpx

from .firms import archivos_nrt

log = logging.getLogger("datos")

RAIZ_REPO = Path(__file__).resolve().parents[2]
REPO = "MaxDev8459/calendario-focos-calor"
BASES_REMOTAS = (
    f"https://github.com/{REPO}/releases/download/datos-v1",
    f"https://raw.githubusercontent.com/{REPO}/main/data/salida",
    f"https://raw.githubusercontent.com/{REPO}/datos/data/salida",
)

_candado = threading.Lock()
_estado = {"fuentes": None, "con": None, "httpfs": False}


def _desde_carpeta(d: Path) -> dict | None:
    meta, conteos = d / "metadata.json", d / "conteos_celda_mes.parquet"
    if not (meta.exists() and conteos.exists()):
        return None
    metadata = json.loads(meta.read_text(encoding="utf-8"))
    det = d / "detecciones.parquet"
    return {"origen": str(d), "metadata": metadata, "conteos": conteos.as_posix(),
            "detecciones": det.as_posix() if det.exists() else metadata.get("detecciones_url")}


def _desde_url(base: str, http: httpx.Client) -> dict | None:
    base = base.rstrip("/")
    try:
        r = http.get(f"{base}/metadata.json")
        if r.status_code != 200:
            return None
        metadata = r.json()
        # Un GET de 4 bytes (los releases redirigen y no siempre aceptan HEAD)
        r = http.get(f"{base}/conteos_celda_mes.parquet", headers={"Range": "bytes=0-3"})
        if r.status_code not in (200, 206):
            return None
    except (httpx.HTTPError, ValueError):
        return None
    return {"origen": base, "metadata": metadata, "conteos": f"{base}/conteos_celda_mes.parquet",
            "detecciones": metadata.get("detecciones_url") or f"{base}/detecciones.parquet"}


def _resolver() -> dict:
    if os.environ.get("DATOS_DIR"):
        f = _desde_carpeta(Path(os.environ["DATOS_DIR"]))
        if f is None:
            raise RuntimeError(f"DATOS_DIR no tiene metadata.json y conteos_celda_mes.parquet: {os.environ['DATOS_DIR']}")
        return f
    f = _desde_carpeta(RAIZ_REPO / "data" / "salida")
    if f:
        return f
    bases = [b for b in os.environ.get("DATOS_URL", ",".join(BASES_REMOTAS)).split(",") if b.strip()]
    if bases:
        with httpx.Client(timeout=10, follow_redirects=True) as http:
            for base in bases:
                f = _desde_url(base.strip(), http)
                if f:
                    return f
    f = _desde_carpeta(RAIZ_REPO / "data" / "ejemplo")
    if f:
        return f
    raise RuntimeError("No hay datos: ni data/salida, ni las URL de datos, ni data/ejemplo.")


def fuentes() -> dict:
    """{'origen', 'metadata', 'conteos', 'detecciones'}; se resuelve una vez por proceso."""
    with _candado:
        if _estado["fuentes"] is None:
            _estado["fuentes"] = _resolver()
            log.info("Datos desde %s", _estado["fuentes"]["origen"])
        return _estado["fuentes"]


def nrt() -> dict | None:
    """Focos recientes publicados (o locales). None si no hay: la API sirve solo el histórico."""
    try:
        return archivos_nrt()
    except Exception as e:  # nunca tumbar la API por los datos recientes
        log.warning("Sin datos recientes: %s", e)
        return None


def cursor(*rutas: str) -> duckdb.DuckDBPyConnection:
    """Cursor de DuckDB para una petición. Carga httpfs solo si alguna ruta es de internet."""
    with _candado:
        if _estado["con"] is None:
            tmp = Path(tempfile.gettempdir()) / "duckdb_focos"
            tmp.mkdir(parents=True, exist_ok=True)
            con = duckdb.connect(config={"memory_limit": os.environ.get("DUCKDB_MEMORIA", "1GB")})
            con.execute(f"SET home_directory='{tmp.as_posix()}'")
            con.execute(f"SET extension_directory='{(tmp / 'ext').as_posix()}'")
            _estado["con"] = con
        if not _estado["httpfs"] and any(str(r).startswith("http") for r in rutas if r):
            _estado["con"].execute("INSTALL httpfs; LOAD httpfs; SET enable_http_metadata_cache=true")
            _estado["httpfs"] = True
        return _estado["con"].cursor()


def reiniciar():
    """Olvida las fuentes y la conexión (para las pruebas)."""
    with _candado:
        _estado.update(fuentes=None, con=None, httpfs=False)
