"""Focos recientes de FIRMS (posteriores al histórico) en el formato del contrato de datos.

La API solo necesita `archivos_nrt` (ligero). El cliente y el actualizador (pandas) se importan
desde `app.firms.cliente` y `app.firms.actualizar`, o se corren con `python -m app.firms`.
"""
from .publicado import archivos_nrt

__all__ = ["archivos_nrt"]
