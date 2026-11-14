"""Cliente de la API de FIRMS (área y disponibilidad de datos).

Documentación de la API: https://firms.modaps.eosdis.nasa.gov/api/
- Área:  /api/area/csv/{MAP_KEY}/{FUENTE}/{oeste,sur,este,norte}/{DIAS}/{AAAA-MM-DD}
- Disponibilidad: /api/data_availability/csv/{MAP_KEY}/{FUENTE|ALL}

DIAS va de 1 a 5 (más da "Invalid day range") y la fecha es el PRIMER día del tramo
(devuelve de fecha a fecha + DIAS - 1). La consulta por país (/api/country) ya no existe:
responde "Invalid API call" (verificado el 14-nov-2026).
"""
import hashlib
import io
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from . import config

# httpx registra cada URL en nivel INFO, y en FIRMS la llave va dentro de la URL: nunca en los logs.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


class ErrorFirms(Exception):
    def __init__(self, codigo: str, mensaje: str):
        super().__init__(f"{codigo}: {mensaje}")
        self.codigo = codigo
        self.mensaje = mensaje


def tramos(desde: date, hasta: date, max_dias: int = config.MAX_DIAS_POR_PETICION):
    """Parte [desde, hasta] (ambos incluidos) en tramos de como máximo max_dias: [(inicio, dias), ...]."""
    out, d = [], desde
    while d <= hasta:
        dias = min(max_dias, (hasta - d).days + 1)
        out.append((d, dias))
        d += timedelta(days=dias)
    return out


def planear_fuentes(desde: date, hasta: date, disponibilidad: dict, preferidas=config.FUENTES_PREFERIDAS):
    """Decide qué fuente cubre cada parte del periodo, en orden de preferencia y sin traslapes.

    disponibilidad: {fuente: (fecha_min, fecha_max)}. Devuelve [(fuente, inicio, fin), ...].
    """
    plan, cursor = [], desde
    for fuente in preferidas:
        if fuente not in disponibilidad or cursor > hasta:
            continue
        f_min, f_max = disponibilidad[fuente]
        inicio, fin = max(cursor, f_min), min(hasta, f_max)
        if inicio == cursor and inicio <= fin:
            plan.append((fuente, inicio, fin))
            cursor = fin + timedelta(days=1)
    return plan


def _parece_csv_de_focos(texto: str) -> bool:
    primera = texto.lstrip().split("\n", 1)[0].lower()
    return "latitude" in primera and "acq_date" in primera


class ClienteFirms:
    def __init__(self, map_key: str | None = None, url_base: str = config.URL_BASE,
                 http: httpx.Client | None = None, dir_cache: Path | None = None,
                 reintentos: int = 3, pausa_s: float = 2.0, horas_cache_reciente: float = 3.0):
        self.map_key = map_key if map_key is not None else config.map_key()
        if not self.map_key:
            raise ErrorFirms("falta_map_key", "Define FIRMS_MAP_KEY en backend/.env o en el entorno.")
        self.url_base = url_base.rstrip("/")
        self.http = http or httpx.Client(timeout=90)
        self.dir_cache = Path(dir_cache) if dir_cache else config.dir_nrt() / "cache"
        self.reintentos = reintentos
        self.pausa_s = pausa_s
        self.horas_cache_reciente = horas_cache_reciente

    # ---------- peticiones ----------
    def _get(self, ruta: str, params: dict | None = None) -> httpx.Response:
        url = f"{self.url_base}{ruta}"
        ultimo = None
        for intento in range(self.reintentos):
            try:
                r = self.http.get(url, params=params)
            except httpx.HTTPError as e:
                ultimo = f"sin conexión con FIRMS ({type(e).__name__})"
            else:
                if r.status_code == 200:
                    return r
                if r.status_code not in (429, 500, 502, 503, 504):
                    raise ErrorFirms("firms_rechazo", self._limpiar(f"HTTP {r.status_code}: {r.text[:200]}"))
                ultimo = f"HTTP {r.status_code}"
            time.sleep(self.pausa_s * (2 ** intento))
        raise ErrorFirms("firms_no_disponible", ultimo or "error desconocido")

    def _limpiar(self, texto: str) -> str:
        return texto.replace(self.map_key, "***")

    # ---------- utilidades ----------
    def estado_llave(self) -> dict:
        """Transacciones usadas y límite (5000 cada 10 minutos)."""
        return self._get("/mapserver/mapkey_status/", {"MAP_KEY": self.map_key}).json()

    def disponibilidad(self, fuente: str = "ALL") -> dict:
        """{fuente: (fecha_min, fecha_max)} según FIRMS."""
        texto = self._get(f"/api/data_availability/csv/{self.map_key}/{fuente}").text
        if "data_id" not in texto.split("\n", 1)[0]:
            raise ErrorFirms("firms_rechazo", self._limpiar(texto[:200]))
        df = pd.read_csv(io.StringIO(texto), dtype=str)
        return {fila.data_id: (date.fromisoformat(fila.min_date), date.fromisoformat(fila.max_date))
                for fila in df.itertuples()}

    # ---------- focos ----------
    def focos_area(self, fuente: str, bbox, desde: date, hasta: date) -> pd.DataFrame:
        """bbox en el orden del contrato: (oeste, sur, este, norte)."""
        o, s, e, n = bbox
        zona = f"{o:g},{s:g},{e:g},{n:g}"
        return self._focos("area", fuente, zona, desde, hasta)

    def _focos(self, tipo: str, fuente: str, zona: str, desde: date, hasta: date) -> pd.DataFrame:
        partes = []
        for inicio, dias in tramos(desde, hasta):
            texto = self._tramo(tipo, fuente, zona, inicio, dias)
            if not texto.strip():          # días sin datos del satélite: FIRMS responde vacío
                continue
            df = pd.read_csv(io.StringIO(texto), dtype=str)
            if len(df):
                partes.append(df)
        if not partes:
            return pd.DataFrame()
        return pd.concat(partes, ignore_index=True)

    def _tramo(self, tipo: str, fuente: str, zona: str, inicio: date, dias: int) -> str:
        """Descarga un tramo, con caché en disco. La llave no forma parte del nombre del archivo."""
        clave = hashlib.sha1(f"{tipo}|{fuente}|{zona}|{inicio}|{dias}".encode()).hexdigest()[:16]
        ruta = self.dir_cache / f"{fuente}_{inicio}_{dias}d_{clave}.csv"
        fin = inicio + timedelta(days=dias - 1)
        if ruta.exists() and self._cache_vigente(ruta, fin):
            return ruta.read_text(encoding="utf-8")

        texto = self._get(f"/api/{tipo}/csv/{self.map_key}/{fuente}/{zona}/{dias}/{inicio.isoformat()}").text
        if texto.strip() and not _parece_csv_de_focos(texto):
            raise ErrorFirms("firms_rechazo", self._limpiar(texto.strip()[:200]))
        self.dir_cache.mkdir(parents=True, exist_ok=True)
        tmp = ruta.with_suffix(".tmp")
        tmp.write_text(texto, encoding="utf-8")
        tmp.replace(ruta)
        return texto

    def _cache_vigente(self, ruta: Path, fin_tramo: date) -> bool:
        """Los tramos viejos no cambian; los de los últimos 2 días se renuevan cada pocas horas."""
        hoy = datetime.now(timezone.utc).date()
        if fin_tramo < hoy - timedelta(days=2):
            return True
        edad_h = (time.time() - ruta.stat().st_mtime) / 3600
        return edad_h < self.horas_cache_reciente
