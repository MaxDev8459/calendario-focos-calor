"""NOAA-20 en unidades de S-NPP para los días sin S-NPP (decisión P18; contrato v0.4, `VIIRS_NRT_N20`).

S-NPP dejó de reportar el 2026-11-02 y le faltan algunos días sueltos. NOAA-20 lleva el mismo sensor
VIIRS, pero pasa a otra hora y con otra geometría, así que sus conteos no son iguales. El factor se mide
en los días en que hay datos de los dos satélites, con los mismos filtros de la serie (huella del país,
fuentes fijas, celdas persistentes y celdas-día de 0.01°):

    razón del mes = celdas-día S-NPP / celdas-día NOAA-20      (solo días comunes)
    factor        = mediana de las razones mensuales del país

Si el país tiene menos de MESES_MINIMOS meses comparables, se usa el factor de toda la zona descargada.
Validación: dejar un mes fuera (el factor sin ese mes predice su conteo S-NPP a partir de NOAA-20).
"""
import statistics

import numpy as np
import pandas as pd

DIAS_MINIMOS_MES = 20     # días comunes para que un mes cuente en el factor
MESES_MINIMOS = 3         # meses comparables para tener factor propio por país


def _celdas_mes(det: pd.DataFrame, dias: set) -> pd.DataFrame:
    """Celdas-día únicas de 0.01° por país y mes, solo en `dias`."""
    if det is None or det.empty:
        return pd.DataFrame(columns=["pais", "mes", "n"])
    d = det[det["fecha"].isin(dias)]
    cd = pd.DataFrame({"pais": d["pais"], "fecha": d["fecha"],
                       "fy": np.floor(d["lat"] / 0.01).astype("int64"),
                       "fx": np.floor(d["lon"] / 0.01).astype("int64")}).drop_duplicates()
    cd["mes"] = [f"{f.year}-{f.month:02d}" for f in cd["fecha"]]
    return cd.groupby(["pais", "mes"]).size().rename("n").reset_index()


def _medir(meses: list[dict]) -> dict:
    """meses: [{mes, snpp, n20}] → factor (mediana de razones) y validación dejando un mes fuera."""
    razones = [m["snpp"] / m["n20"] for m in meses]
    factor = statistics.median(razones)
    detalle = []
    for i, m in enumerate(meses):
        otras = razones[:i] + razones[i + 1:]
        f_sin = statistics.median(otras) if otras else factor
        pred = f_sin * m["n20"]
        detalle.append({**m, "razon": round(razones[i], 4), "factor_sin_el_mes": round(f_sin, 4),
                        "error_pct": round(100 * (pred - m["snpp"]) / m["snpp"], 1) if m["snpp"] else None})
    errores = [abs(x["error_pct"]) for x in detalle if x["error_pct"] is not None]
    return {"factor": round(factor, 4), "meses": len(meses),
            "error_medio_abs_pct": round(sum(errores) / len(errores), 1) if errores else None,
            "error_max_abs_pct": max(errores) if errores else None,
            "por_mes": detalle}


def medir_factores(snpp: pd.DataFrame, n20: pd.DataFrame, dias_comunes: set, paises) -> dict:
    """Factor S-NPP/NOAA-20 por país, con respaldo en el de toda la zona y, si no hay nada, 1.0.

    Devuelve {"factores": {pais: valor}, "por_pais": {...}, "zona": {...} | None}.
    """
    dias_comunes = set(dias_comunes)
    por_mes_comun = pd.Series([f"{d.year}-{d.month:02d}" for d in dias_comunes], dtype="object").value_counts()
    validos = set(por_mes_comun[por_mes_comun >= DIAS_MINIMOS_MES].index)

    s, n = _celdas_mes(snpp, dias_comunes), _celdas_mes(n20, dias_comunes)
    t = s.merge(n, on=["pais", "mes"], how="outer", suffixes=("_snpp", "_n20")).fillna(0)
    t = t[t["mes"].isin(validos) & (t["n_n20"] > 0) & (t["n_snpp"] > 0)].sort_values(["pais", "mes"])

    def lista(df):
        return [{"mes": r.mes, "dias_comunes": int(por_mes_comun[r.mes]), "snpp": int(r.n_snpp), "n20": int(r.n_n20)}
                for r in df.itertuples()]

    zona_meses = lista(t.groupby("mes")[["n_snpp", "n_n20"]].sum().reset_index().assign(pais="*"))
    zona = _medir(zona_meses) if zona_meses else None

    factores, por_pais = {}, {}
    for pais in paises:
        meses = lista(t[t["pais"] == pais])
        if len(meses) >= MESES_MINIMOS:
            por_pais[pais] = {**_medir(meses), "origen": "pais"}
        elif zona:
            por_pais[pais] = {"factor": zona["factor"], "meses": len(meses), "origen": "zona"}
        else:
            por_pais[pais] = {"factor": 1.0, "meses": len(meses), "origen": "respaldo_factor_1"}
        factores[pais] = por_pais[pais]["factor"]
    return {"factores": factores, "por_pais": por_pais, "zona": zona}
