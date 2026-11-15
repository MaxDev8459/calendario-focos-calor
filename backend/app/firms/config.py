"""Configuración del cliente de FIRMS. Todo se lee del entorno (o de backend/.env)."""
import json
import os
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parents[2]   # backend/
RAIZ_REPO = RAIZ_BACKEND.parent

try:
    from dotenv import load_dotenv
    load_dotenv(RAIZ_BACKEND / ".env")
except ImportError:  # python-dotenv es opcional en producción
    pass

URL_BASE = os.environ.get("FIRMS_URL_BASE", "https://firms.modaps.eosdis.nasa.gov")

# La API de área de FIRMS acepta como máximo 5 días por petición.
MAX_DIAS_POR_PETICION = 5

# Misma pareja de sensores que la serie histórica: VIIRS S-NPP.
# Primero el procesamiento estándar (SP, igual al archivo histórico) y después el casi tiempo real (NRT).
FUENTES_PREFERIDAS = ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT")

# NOAA-20 (mismo sensor VIIRS): solo llena los días sin S-NPP, llevado a unidades de S-NPP con un factor.
FUENTES_N20 = ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT")


def map_key() -> str:
    """La llave nunca se escribe en logs, mensajes de error ni nombres de archivo."""
    return os.environ.get("FIRMS_MAP_KEY", "").strip()


def nrt_url() -> str:
    """Release donde la GitHub Action publica los Parquet NRT. Vacío = no buscarlos en internet."""
    return os.environ.get("NRT_URL", "https://github.com/MaxDev8459/calendario-focos-calor/releases/download/nrt-latest")


def dir_nrt() -> Path:
    """Carpeta donde se escriben los focos recientes (ignorada por git)."""
    return Path(os.environ.get("NRT_DIR", RAIZ_BACKEND / "datos_nrt"))


def dir_datos() -> Path:
    """Los datos de la Parte A: data/salida/ y, si no existe, data/ejemplo/."""
    salida = RAIZ_REPO / "data" / "salida"
    return salida if (salida / "metadata.json").exists() else RAIZ_REPO / "data" / "ejemplo"


def metadata_historico() -> dict:
    with open(dir_datos() / "metadata.json", encoding="utf-8") as f:
        return json.load(f)
