"""Agregado para el globo de la portada (ruta /api/globo).

Suma los conteos armonizados (A2) de un periodo en celdas de 0.5° y por país, con la forma que
espera el frontend:

    {"desde": "2025-01", "hasta": "2025-12", "unidad": "focos_armonizados",
     "celdas": [{"lat": 18.75, "lon": -99.25, "conteo": 512.0, "region": "central_america"}, ...],
     "paises": [{"iso_a2": "MX", "conteo": 150000}, ...]}

Solo depende de DuckDB, así que el backend puede copiar este archivo tal cual. `fuentes` es una
lista de rutas o URLs a Parquet con el esquema de A2 (por ejemplo, el histórico y los focos NRT).

Uso, desde data/:
    python pipeline/globo.py --conteos salida/conteos_celda_mes.parquet --desde 2025-01 --hasta 2025-12
"""
import argparse
import json
import re

import duckdb

MALLA_GLOBO = 0.5  # grados; con el año más reciente da unas 8 a 10 mil celdas para toda América

# Nombre del país en FIRMS (columna `pais`) → (código ISO de 2 letras, región del frontend)
PAISES = {
    "Antigua_and_Barbuda": ("AG", "caribbean"), "Argentina": ("AR", "south_america"),
    "Bahamas": ("BS", "caribbean"), "Barbados": ("BB", "caribbean"), "Belize": ("BZ", "central_america"),
    "Bolivia": ("BO", "south_america"), "Brazil": ("BR", "south_america"), "Canada": ("CA", "north_america"),
    "Chile": ("CL", "south_america"), "Colombia": ("CO", "south_america"),
    "Costa_Rica": ("CR", "central_america"), "Cuba": ("CU", "caribbean"), "Dominica": ("DM", "caribbean"),
    "Dominican_Republic": ("DO", "caribbean"), "Ecuador": ("EC", "south_america"),
    "El_Salvador": ("SV", "central_america"), "Grenada": ("GD", "caribbean"),
    "Guatemala": ("GT", "central_america"), "Guyana": ("GY", "south_america"), "Haiti": ("HT", "caribbean"),
    "Honduras": ("HN", "central_america"), "Jamaica": ("JM", "caribbean"), "Mexico": ("MX", "central_america"),
    "Nicaragua": ("NI", "central_america"), "Panama": ("PA", "central_america"),
    "Paraguay": ("PY", "south_america"), "Peru": ("PE", "south_america"),
    "Saint_Kitts_and_Nevis": ("KN", "caribbean"), "Saint_Lucia": ("LC", "caribbean"),
    "Saint_Vincent_and_the_Grenadines": ("VC", "caribbean"), "Suriname": ("SR", "south_america"),
    "Trinidad_and_Tobago": ("TT", "caribbean"), "United_States": ("US", "north_america"),
    "Uruguay": ("UY", "south_america"), "Venezuela": ("VE", "south_america"),
}

_MES = re.compile(r"^(\d{4})-(\d{2})$")


def _clave_mes(texto):
    m = _MES.match(texto or "")
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise ValueError(f"fecha_invalida: {texto!r} debe ser AAAA-MM")
    return int(m.group(1)) * 100 + int(m.group(2))


def globo(con, fuentes, desde, hasta, malla=MALLA_GLOBO):
    """Devuelve el dict de /api/globo. `con` es una conexión DuckDB (con httpfs si las fuentes son URLs)."""
    d, h = _clave_mes(desde), _clave_mes(hasta)
    if d > h:
        raise ValueError("fecha_invalida: desde > hasta")
    if isinstance(fuentes, str):
        fuentes = [fuentes]
    con.execute("CREATE OR REPLACE TEMP TABLE _paises_globo (pais VARCHAR, iso_a2 VARCHAR, region VARCHAR)")
    con.executemany("INSERT INTO _paises_globo VALUES (?, ?, ?)", [(p, i, r) for p, (i, r) in PAISES.items()])
    lista = ", ".join("'" + f.replace("'", "''") + "'" for f in fuentes)
    base = f"""
        SELECT c.pais, p.iso_a2, p.region, c.lat_c, c.lon_c, c.conteo_armonizado AS conteo
        FROM read_parquet([{lista}], union_by_name = true) c
        LEFT JOIN _paises_globo p USING (pais)
        WHERE c.anio * 100 + c.mes BETWEEN $d AND $h AND c.conteo_armonizado > 0
    """
    celdas = con.execute(f"""
        SELECT round((floor(lat_c / $m) + 0.5) * $m, 3) AS lat,
               round((floor(lon_c / $m) + 0.5) * $m, 3) AS lon,
               round(sum(conteo), 1) AS conteo,
               arg_max(coalesce(region, 'north_america'), (conteo, coalesce(region, 'north_america'))) AS region
        FROM ({base})
        GROUP BY 1, 2 ORDER BY conteo DESC, lat, lon
    """, {"m": malla, "d": d, "h": h}).fetchall()
    paises = con.execute(f"""
        SELECT iso_a2, round(sum(conteo)) AS conteo
        FROM ({base})
        WHERE iso_a2 IS NOT NULL GROUP BY 1 ORDER BY conteo DESC
    """, {"d": d, "h": h}).fetchall()
    return {
        "desde": desde, "hasta": hasta, "unidad": "focos_armonizados", "malla_grados": malla,
        "celdas": [{"lat": la, "lon": lo, "conteo": c, "region": r} for la, lo, c, r in celdas],
        "paises": [{"iso_a2": i, "conteo": int(c)} for i, c in paises],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conteos", nargs="+", default=["salida/conteos_celda_mes.parquet"])
    ap.add_argument("--desde", default="2025-01")
    ap.add_argument("--hasta", default="2025-12")
    ap.add_argument("--salida", help="archivo JSON de salida (opcional)")
    a = ap.parse_args()
    r = globo(duckdb.connect(), a.conteos, a.desde, a.hasta)
    if a.salida:
        with open(a.salida, "w") as f:
            json.dump(r, f, separators=(",", ":"))
    print(f"{len(r['celdas'])} celdas de {MALLA_GLOBO}° | {len(r['paises'])} países | "
          f"total {sum(p['conteo'] for p in r['paises']):,} focos armonizados ({a.desde} a {a.hasta})")
    print("top 5 países:", ", ".join(f"{p['iso_a2']} {p['conteo']:,}" for p in r["paises"][:5]))


if __name__ == "__main__":
    main()
