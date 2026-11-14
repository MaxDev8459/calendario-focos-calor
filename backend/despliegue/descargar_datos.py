"""Descarga A1 (detecciones.parquet de América) del release del repo a data/salida/ (contrato v0.3).

A1 pesa ~700 MB y no va en git: `data/salida/metadata.json` trae `detecciones_url` y `detecciones_filas`.
Lo corre el build del despliegue, así se descarga una vez por versión y no en cada arranque.

Uso, desde la raíz del repo:
    python backend/despliegue/descargar_datos.py

- Si no existe data/salida/metadata.json o no trae `detecciones_url`, no hace nada (la API usa data/ejemplo/).
- Si el archivo ya está y tiene las filas esperadas, no lo vuelve a bajar.
- Si la descarga falla o el número de filas no coincide, termina con error y no deja un archivo a medias
  (así el build falla y queda en línea la versión anterior).
"""
import json
import sys
from pathlib import Path

import duckdb
import httpx

RAIZ_REPO = Path(__file__).resolve().parents[2]
SALIDA = RAIZ_REPO / "data" / "salida"


def filas_parquet(ruta: Path) -> int:
    con = duckdb.connect()
    return int(con.execute("SELECT sum(num_rows) FROM parquet_file_metadata(?)", [ruta.as_posix()]).fetchall()[0][0])


def descargar(url: str, destino: Path, filas_esperadas: int | None = None,
              http: httpx.Client | None = None) -> str:
    """Devuelve 'ya_estaba' o 'descargado'. Lanza RuntimeError si algo no cuadra."""
    if destino.exists() and filas_esperadas is not None and filas_parquet(destino) == filas_esperadas:
        return "ya_estaba"
    http = http or httpx.Client(timeout=httpx.Timeout(60, read=300), follow_redirects=True)
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_name(destino.name + ".part")
    try:
        with http.stream("GET", url) as r:
            if r.status_code != 200:
                raise RuntimeError(f"HTTP {r.status_code} al descargar {url}")
            with open(parcial, "wb") as f:
                for trozo in r.iter_bytes(1 << 20):
                    f.write(trozo)
        filas = filas_parquet(parcial)
        if filas_esperadas is not None and filas != filas_esperadas:
            raise RuntimeError(f"{destino.name}: {filas:,} filas y se esperaban {filas_esperadas:,}")
        parcial.replace(destino)
        return "descargado"
    finally:
        parcial.unlink(missing_ok=True)


def main(salida: Path = SALIDA) -> int:
    meta_ruta = salida / "metadata.json"
    if not meta_ruta.exists():
        print("Sin data/salida/metadata.json: la API usará data/ejemplo/.")
        return 0
    meta = json.loads(meta_ruta.read_text(encoding="utf-8"))
    url = meta.get("detecciones_url")
    if not url:
        print("metadata.json no trae detecciones_url: no hay nada que descargar.")
        return 0
    destino = salida / "detecciones.parquet"
    try:
        estado = descargar(url, destino, meta.get("detecciones_filas"))
    except (RuntimeError, httpx.HTTPError, duckdb.Error) as e:
        print(f"ERROR: no se pudo obtener {destino.name}: {e}", file=sys.stderr)
        return 1
    mb = destino.stat().st_size / 1e6
    print(f"{destino.name}: {estado} ({mb:,.0f} MB, {filas_parquet(destino):,} filas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
