"""Consultas de la Parte B sobre los Parquet de la Parte A (histórico) y los focos recientes (NRT).

Las fórmulas de mediana, percentil, lugar y cortes de color son las mismas que generaron las respuestas
de referencia de `data/ejemplo/respuestas_api/` (las pruebas comparan contra esos archivos).
"""
import calendar
import csv
import io
from datetime import date

from .. import datos
from . import globo as _globo
from .validar import ErrorApi, cuadros

CAMBIO = (2012, 2)            # VIIRS S-NPP completo desde febrero de 2012 (contrato, A2)
MAX_FILAS_CSV = 50_000
MAX_PUNTOS_MAPA = 5_000
MAX_CELDAS = 20_000
COLUMNAS_A1 = ["fecha", "hora_utc", "lat", "lon", "pais", "sensor", "satelite", "confianza",
               "frp_mw", "dia_noche", "ty", "tx"]


def _ym(texto: str) -> tuple[int, int]:
    return int(texto[:4]), int(texto[5:7])


def _txt(am) -> str:
    return f"{am[0]}-{am[1]:02d}"


def _meses(desde, hasta):
    a, m = desde
    while (a, m) <= hasta:
        yield a, m
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)


def _filtro_bbox(bbox):
    """SQL y parámetros del filtro por cuadros de 0.1° (vacío si no hay bbox)."""
    if bbox is None:
        return "", []
    ty0, ty1, tx0, tx1 = cuadros(bbox)
    return " AND ty BETWEEN ? AND ? AND tx BETWEEN ? AND ?", [ty0, ty1, tx0, tx1]


def _mediana(valores) -> float:
    v = sorted(valores)
    k = len(v)
    return round((v[(k - 1) // 2] + v[k // 2]) / 2, 1) if k else 0.0


class Serie:
    """Serie mensual de un área: histórico completo más los meses recientes, si los hay."""

    def __init__(self, bbox):
        f = datos.fuentes()
        meta = f["metadata"]
        self.primer, self.ultimo = _ym(meta["primer_mes"]), _ym(meta["ultimo_mes_completo"])
        rec = datos.nrt()
        filtro, params = _filtro_bbox(bbox)
        sql = ("SELECT anio, mes, sum(conteo_armonizado), sum(conteo_modis), sum(conteo_viirs) "
               "FROM read_parquet(?) WHERE true{} GROUP BY anio, mes")
        cur = datos.cursor(f["conteos"], rec["conteos"] if rec else None)
        hist = {(a, m): (c, mo, vi) for a, m, c, mo, vi in
                cur.execute(sql.format(filtro), [f["conteos"], *params]).fetchall()}
        nrt = {}
        if rec:
            corte = self.ultimo[0] * 100 + self.ultimo[1]
            try:
                nrt = {(a, m): (c, mo, vi) for a, m, c, mo, vi in cur.execute(
                    sql.format(filtro + " AND anio * 100 + mes > ?"), [rec["conteos"], *params, corte]).fetchall()}
            except Exception as e:  # los datos recientes nunca tumban el histórico
                datos.log.warning("No se pudieron leer los focos recientes: %s", e)
        self.hay_datos = bool(hist) or bool(nrt)

        self.celdas = {}        # (anio, mes) -> dict de la celda del calendario
        self.crudos = {}        # (anio, mes) -> (modis, viirs)
        for am in _meses(self.primer, self.ultimo):
            c, mo, vi = hist.get(am, (0.0, None, None))
            antes = am < CAMBIO
            self.celdas[am] = {"anio": am[0], "mes": am[1], "conteo": round(c or 0.0, 1),
                               "fuente": "MODIS_ajustado" if antes else "VIIRS"}
            self.crudos[am] = (int(mo or 0), None if antes else int(vi or 0))
        self.completos = list(self.celdas)          # meses con los que se calculan mediana y percentiles

        # Meses recientes: solo si los focos recientes cubren esta área (por ahora, los países de `paises`).
        if rec and nrt:
            m_rec = rec["metadata"]
            meses_nrt = {(d.year, d.month) for fu in m_rec.get("fuentes", []) if fu["fuente"].endswith("_NRT")
                         for d in (date.fromisoformat(fu["desde"]), date.fromisoformat(fu["hasta"]))}
            primero_nrt = min(meses_nrt) if meses_nrt else None
            # Meses con días de NOAA-20 llevado a S-NPP (contrato v0.4): fuente propia y `preliminar`.
            meses_n20 = set((m_rec.get("noaa20") or {}).get("meses", []))
            for clave, (dias, total) in sorted(m_rec.get("dias_por_mes", {}).items()):
                am = _ym(clave)
                if am <= self.ultimo:
                    continue
                c = nrt.get(am, (0.0, None, None))[0]
                fuente = ("VIIRS_NRT_N20" if clave in meses_n20
                          else "VIIRS_NRT" if primero_nrt and am >= primero_nrt else "VIIRS")
                self.celdas[am] = {"anio": am[0], "mes": am[1],
                                   "conteo": round(c or 0.0, 1) if dias else None,
                                   "fuente": fuente, "dias_con_datos": dias, "dias_mes": total}
                if clave in meses_n20:
                    self.celdas[am]["preliminar"] = True
                self.crudos[am] = (None, int(c or 0) if dias else None)
            # Meses recientes sin registro en metadata_nrt (huecos): sin datos, no cero.
            siguiente = (self.ultimo[0] + 1, 1) if self.ultimo[1] == 12 else (self.ultimo[0], self.ultimo[1] + 1)
            for am in _meses(siguiente, max(self.celdas)):
                if am not in self.celdas:
                    self.celdas[am] = {"anio": am[0], "mes": am[1], "conteo": None, "fuente": "VIIRS",
                                       "dias_con_datos": 0, "dias_mes": calendar.monthrange(*am)[1]}
                    self.crudos[am] = (None, None)
        self.fin = max(self.celdas)

    def mediana_mensual(self):
        return [_mediana(self.celdas[am]["conteo"] for am in self.completos if am[1] == mes) for mes in range(1, 13)]


def calendario(bbox, desde=None, hasta=None) -> dict:
    s = Serie(bbox)
    if not s.hay_datos:
        raise ErrorApi("sin_datos")
    desde, hasta = max(desde or s.primer, s.primer), min(hasta or s.fin, s.fin)
    if desde > hasta:
        raise ErrorApi("fecha_invalida")
    celdas = [s.celdas[am] for am in _meses(desde, hasta)]
    mediana = s.mediana_mensual()
    nz = sorted(s.celdas[am]["conteo"] for am in s.completos if s.celdas[am]["conteo"] > 0)
    cortes = [round(nz[int(len(nz) * i / 8)], 1) for i in range(1, 8)] if nz else []
    return {"bbox": list(bbox), "desde": _txt(desde), "hasta": _txt(hasta), "unidad": "focos_armonizados",
            "celdas": celdas, "mediana_mensual": mediana, "mes_pico": mediana.index(max(mediana)) + 1,
            "escala": {"min": 0, "max": max((c["conteo"] or 0) for c in s.celdas.values()), "cortes": cortes}}


def anomalia(bbox, anio: int, mes: int) -> dict:
    s = Serie(bbox)
    actual = s.celdas.get((anio, mes))
    if not s.hay_datos or actual is None or actual["conteo"] is None:
        raise ErrorApi("sin_datos")
    historicos = [s.celdas[am]["conteo"] for am in s.completos if am[1] == mes]
    reciente = (anio, mes) not in s.completos
    incompleto = reciente and actual["dias_con_datos"] < actual["dias_mes"]
    # Un mes incompleto se compara proyectado al mes entero (conteo × días del mes / días con datos).
    comparado = round(actual["conteo"] * actual["dias_mes"] / actual["dias_con_datos"], 1) if incompleto else actual["conteo"]
    vals = sorted(historicos + ([comparado] if reciente else []), reverse=True)
    med = _mediana(historicos)
    out = {"anio": anio, "mes": mes, "conteo": actual["conteo"], "mediana": med,
           "anomalia_pct": round(100 * (comparado - med) / med, 1) if med else None,
           "percentil": round(100 * sum(1 for v in vals if v < comparado) / len(vals)),
           "lugar": vals.index(comparado) + 1, "de_anios": len(vals), "fuente": actual["fuente"]}
    if actual.get("preliminar"):
        out["preliminar"] = True
    if reciente:
        out.update(dias_con_datos=actual["dias_con_datos"], dias_mes=actual["dias_mes"], incompleto=incompleto)
        if incompleto:
            out["conteo_proyectado"] = comparado
    return out


def serie_armonizacion(bbox=None) -> dict:
    s = Serie(bbox)
    if not s.hay_datos:
        raise ErrorApi("sin_datos")
    meses = sorted(s.celdas)
    return {"meses": [_txt(am) for am in meses],
            "modis_crudo": [s.crudos[am][0] for am in meses],
            "viirs_crudo": [s.crudos[am][1] for am in meses],
            "armonizado": [s.celdas[am]["conteo"] for am in meses]}


def celdas(bbox, desde=None, hasta=None) -> dict:
    """Suma por cuadro de 0.1° en un periodo (para pintar la malla del mapa)."""
    f = datos.fuentes()
    primer, ultimo = _ym(f["metadata"]["primer_mes"]), _ym(f["metadata"]["ultimo_mes_completo"])
    rec = datos.nrt()
    desde, hasta = desde or primer, hasta or (9999, 12)
    if desde > hasta:
        raise ErrorApi("fecha_invalida")
    filtro, params = _filtro_bbox(bbox)
    parte = ("SELECT ty, tx, lat_c, lon_c, conteo_armonizado AS c FROM read_parquet(?) "
             "WHERE anio * 100 + mes BETWEEN ? AND ?" + filtro)
    d, h = desde[0] * 100 + desde[1], hasta[0] * 100 + hasta[1]
    partes, valores = [parte], [f["conteos"], d, min(h, ultimo[0] * 100 + ultimo[1]), *params]
    if rec and hasta > ultimo:
        partes.append(parte)
        valores += [rec["conteos"], max(d, ultimo[0] * 100 + ultimo[1] + 1), h, *params]
    cur = datos.cursor(f["conteos"], rec["conteos"] if rec else None)
    filas = cur.execute(
        f"SELECT ty, tx, any_value(lat_c), any_value(lon_c), round(sum(c), 1) AS conteo FROM ({' UNION ALL '.join(partes)}) "
        f"GROUP BY ty, tx ORDER BY conteo DESC LIMIT {MAX_CELDAS + 1}", valores).fetchall()
    return {"bbox": list(bbox), "unidad": "focos_armonizados", "truncado": len(filas) > MAX_CELDAS,
            "celdas": [{"ty": ty, "tx": tx, "lat_c": la, "lon_c": lo, "conteo": c} for ty, tx, la, lo, c in filas[:MAX_CELDAS]]}


def _consulta_focos(bbox, desde: date, hasta: date):
    """(cursor, SQL de las filas A1 del área y periodo, parámetros). Histórico más recientes."""
    if desde > hasta:
        raise ErrorApi("fecha_invalida")
    f = datos.fuentes()
    ultimo = _ym(f["metadata"]["ultimo_mes_completo"])
    fin_hist = date(ultimo[0], ultimo[1], calendar.monthrange(*ultimo)[1])
    rec = datos.nrt() if hasta > fin_hist else None
    o, s, e, n = bbox
    filtro, params = _filtro_bbox(bbox)
    parte = (f"SELECT {', '.join(COLUMNAS_A1)} FROM read_parquet(?) WHERE fecha BETWEEN ? AND ?" + filtro
             + " AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?")
    partes, valores = [], []
    if desde <= fin_hist and f["detecciones"]:
        partes.append(parte)
        valores += [f["detecciones"], desde, min(hasta, fin_hist), *params, s, n, o, e]
    if rec:
        partes.append(parte)
        valores += [rec["detecciones"], max(desde, date.fromordinal(fin_hist.toordinal() + 1)), hasta, *params, s, n, o, e]
    if not partes:
        raise ErrorApi("sin_datos")
    cur = datos.cursor(f["detecciones"], rec["detecciones"] if rec else None)
    return cur, " UNION ALL ".join(partes), valores


def focos_csv(bbox, desde: date, hasta: date) -> str:
    cur, sql, valores = _consulta_focos(bbox, desde, hasta)
    total = cur.execute(f"SELECT count(*) FROM ({sql})", valores).fetchall()[0][0]
    if total > MAX_FILAS_CSV:
        raise ErrorApi("rango_muy_grande")
    if total == 0:
        raise ErrorApi("sin_datos")
    salida = io.StringIO()
    w = csv.writer(salida, lineterminator="\n")
    w.writerow(COLUMNAS_A1)
    w.writerows(cur.execute(f"SELECT * FROM ({sql}) ORDER BY fecha, hora_utc", valores).fetchall())
    return salida.getvalue()


def focos_geojson(bbox, desde: date, hasta: date) -> dict:
    cur, sql, valores = _consulta_focos(bbox, desde, hasta)
    total = cur.execute(f"SELECT count(*) FROM ({sql})", valores).fetchall()[0][0]
    filas = cur.execute(f"SELECT fecha, hora_utc, lat, lon, sensor, frp_mw, confianza, dia_noche, satelite FROM ({sql}) "
                        f"ORDER BY fecha DESC, hora_utc DESC LIMIT {MAX_PUNTOS_MAPA}", valores).fetchall()

    def propiedades(fe, ho, se, frp, co, dn, sat):
        p = {"fecha": fe.isoformat(), "sensor": se, "frp_mw": frp, "confianza": co, "hora_utc": ho,
             "dia_noche": dn, "satelite": sat}
        if sat == "NOAA20":          # días sin S-NPP llenados con NOAA-20 (contrato v0.4)
            p["preliminar"] = True
        return p

    return {"type": "FeatureCollection", "total": total, "truncado": total > MAX_PUNTOS_MAPA,
            "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                          "properties": propiedades(fe, ho, se, frp, co, dn, sat)}
                         for fe, ho, lat, lon, se, frp, co, dn, sat in filas]}


def globo(desde=None, hasta=None) -> dict:
    """B6: conteos armonizados de toda América en celdas de 0.5° y por país (globo de la portada).

    Sin periodo, usa los 12 meses que terminan en el último mes completo del histórico. Los focos
    recientes (NRT) solo se suman si el periodo pasa del histórico.
    """
    f = datos.fuentes()
    ultimo = _ym(f["metadata"]["ultimo_mes_completo"])
    hasta = hasta or ultimo
    desde = desde or ((hasta[0], 1) if hasta[1] == 12 else (hasta[0] - 1, hasta[1] + 1))
    if desde > hasta:
        raise ErrorApi("fecha_invalida")
    rutas = [f["conteos"]]
    rec = datos.nrt() if hasta > ultimo else None
    if rec:
        rutas.append(rec["conteos"])
    cur = datos.cursor(*rutas)
    try:
        return _globo.globo(cur, rutas, _txt(desde), _txt(hasta))
    except ValueError as e:
        raise ErrorApi("fecha_invalida") from e
    except Exception as e:
        if len(rutas) == 1:
            raise
        datos.log.warning("No se pudieron leer los focos recientes para el globo: %s", e)  # el histórico sigue
        return _globo.globo(datos.cursor(rutas[0]), rutas[:1], _txt(desde), _txt(hasta))


def metadata() -> dict:
    f = datos.fuentes()
    out = dict(f["metadata"])
    rec = datos.nrt()
    if rec:
        m = rec["metadata"]
        out["recientes"] = {k: m.get(k) for k in ("generado", "paises", "desde", "hasta", "fuentes", "dias_por_mes", "dias_sin_datos")}
        if m.get("noaa20"):
            out["recientes"]["noaa20"] = m["noaa20"]
    return out
