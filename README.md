# Calendario de focos de calor

Aplicación web que **armoniza los focos de calor de MODIS y VIIRS** (NASA FIRMS) en una sola serie de tiempo coherente, de 2002 a la fecha, y la presenta como un **calendario de actividad de quema** para cualquier área que el usuario elija.

Proyecto para el reto [*Harmonization of MODIS and VIIRS Hot Spots*](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/) de NASA Space Apps Challenge 2026.

> Documento en construcción durante el hackathon.

## El problema
Los satélites registran focos de calor desde el año 2000, pero ese historial está dividido entre dos sensores, **MODIS** (de 2000 a la fecha, al final de su vida útil) y **VIIRS** (de 2012 a la fecha). Tienen distinta resolución y sensibilidad, así que sus conteos no se pueden comparar directamente: sin ajuste, parecería que los incendios se multiplicaron en 2012.

## Qué hace
- Une las dos series en una sola, calibrada en los años en que ambos sensores funcionan a la vez.
- Muestra un calendario de años × meses con la actividad de quema del área elegida.
- Compara el mes actual con la mediana histórica (anomalías).
- Permite descargar en CSV los focos de la búsqueda.

## Estructura
| Carpeta | Contenido |
|---|---|
| `data/` | Pipeline de limpieza, armonización y validación (Python) |
| `backend/` | API (Python + FastAPI) |
| `frontend/` | Interfaz web: mapa y calendario |
| `docs/` | Documentación del proyecto |

## Datos
- NASA FIRMS: focos de calor de MODIS (Collection 6.1) y de VIIRS S-NPP (375 m). https://firms.modaps.eosdis.nasa.gov

## Equipo
- Maximiliano Vasquez Arroyo: datos y ciencia
- Luis Angel Suárez Degante: backend
- Denzel Yahir Morantes Pereida: backend
- Mia Alexandra Sánchez Morante: frontend
- Karol Paola López Mariaca: documentación y negocio
