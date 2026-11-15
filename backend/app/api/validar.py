"""Errores del contrato y validación de parámetros (bbox, meses y fechas)."""
import math
import re
from datetime import date

MENSAJES = {
    "bbox_invalido": "El bbox debe ser oeste,sur,este,norte en grados decimales.",
    "fecha_invalida": "Las fechas van como AAAA-MM-DD y los meses como AAAA-MM, con desde <= hasta.",
    "sin_datos": "No hay datos para esa área y ese periodo.",
    "rango_muy_grande": "El rango supera las 50 000 filas. Reduce el área o el periodo.",
}


class ErrorApi(Exception):
    def __init__(self, codigo: str, mensaje: str | None = None):
        super().__init__(codigo)
        self.codigo = codigo
        self.mensaje = mensaje or MENSAJES[codigo]
        self.estado = 404 if codigo == "sin_datos" else 400


def leer_bbox(texto: str | None, obligatorio: bool = True):
    """'oeste,sur,este,norte' → (o, s, e, n). None si no es obligatorio y no viene."""
    if texto is None or not texto.strip():
        if obligatorio:
            raise ErrorApi("bbox_invalido")
        return None
    try:
        o, s, e, n = (float(x) for x in texto.split(","))
    except ValueError:
        raise ErrorApi("bbox_invalido") from None
    if not all(math.isfinite(v) for v in (o, s, e, n)) or not (-180 <= o < e <= 180 and -90 <= s < n <= 90):
        raise ErrorApi("bbox_invalido")
    return o, s, e, n


def cuadros(bbox) -> tuple[int, int, int, int]:
    """Rango de cuadros de 0.1° del contrato: (ty_min, ty_max, tx_min, tx_max)."""
    o, s, e, n = bbox
    return math.floor(s / 0.1), math.floor(n / 0.1), math.floor(o / 0.1), math.floor(e / 0.1)


def leer_mes(texto: str | None) -> tuple[int, int] | None:
    """'AAAA-MM' → (anio, mes)."""
    if texto is None or not texto.strip():
        return None
    m = re.fullmatch(r"(\d{4})-(\d{2})", texto.strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise ErrorApi("fecha_invalida")
    return int(m.group(1)), int(m.group(2))


def leer_fecha(texto: str | None) -> date:
    if texto is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto.strip()):
        raise ErrorApi("fecha_invalida")
    try:
        return date.fromisoformat(texto.strip())
    except ValueError:
        raise ErrorApi("fecha_invalida") from None


def leer_entero(texto: str | None, minimo: int, maximo: int) -> int:
    try:
        v = int(str(texto).strip())
    except (TypeError, ValueError):
        raise ErrorApi("fecha_invalida") from None
    if not minimo <= v <= maximo:
        raise ErrorApi("fecha_invalida")
    return v
