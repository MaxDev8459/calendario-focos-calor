"""Dónde están publicados los Parquet de focos recientes. Módulo ligero (sin pandas) para la API."""
import json
import logging
import time
from pathlib import Path

import httpx

from . import config

log = logging.getLogger("firms")

ARCHIVOS = {"detecciones": "detecciones_nrt.parquet", "conteos": "conteos_celda_mes_nrt.parquet"}
_cache_remoto = {"url": None, "hasta_t": 0.0, "valor": None}


def archivos_nrt(dir_salida: Path | None = None, url_base: str | None = None,
                 http: httpx.Client | None = None, ttl_s: float = 3600) -> dict | None:
    """Dónde leer los Parquet NRT para unirlos con el histórico en DuckDB.

    1. Si existen en `dir_salida` (NRT_DIR, por defecto backend/datos_nrt): rutas locales (desarrollo).
    2. Si no, el release `nrt-latest` (NRT_URL): URLs https que DuckDB lee por partes con httpfs.
       Lo publica a diario la GitHub Action `.github/workflows/nrt.yml` (en serverless no hay hilos de fondo).
    Devuelve {"detecciones": str, "conteos": str, "metadata": dict}, o None si no hay nada:
    en ese caso la API sirve solo el histórico.
    """
    d = Path(dir_salida) if dir_salida else config.dir_nrt()
    meta_local = d / "metadata_nrt.json"
    if meta_local.exists():
        out = {k: (d / nombre).as_posix() for k, nombre in ARCHIVOS.items()}
        return {**out, "metadata": json.loads(meta_local.read_text(encoding="utf-8"))}

    base = (config.nrt_url() if url_base is None else url_base).rstrip("/")
    if not base:
        return None
    ahora = time.monotonic()
    if _cache_remoto["url"] == base and ahora < _cache_remoto["hasta_t"]:
        return _cache_remoto["valor"]
    valor = None
    try:
        cliente = http or httpx.Client(timeout=10, follow_redirects=True)
        r = cliente.get(f"{base}/metadata_nrt.json")
        if r.status_code == 200:
            valor = {**{k: f"{base}/{nombre}" for k, nombre in ARCHIVOS.items()}, "metadata": r.json()}
        else:
            log.warning("NRT no disponible en %s (HTTP %s)", base, r.status_code)
    except (httpx.HTTPError, ValueError) as e:
        log.warning("NRT no disponible en %s: %s", base, e)
    # Si falla, se recuerda poco tiempo para no frenar cada petición, pero se reintenta pronto.
    _cache_remoto.update(url=base, valor=valor, hasta_t=ahora + (ttl_s if valor else 60))
    return valor
