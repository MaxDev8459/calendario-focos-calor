# Fire Hotspot Calendar

A web application that **harmonizes MODIS and VIIRS active fire hotspots** (NASA FIRMS) into a single, consistent time series from 2002 to today, and shows it as a **burning activity calendar** for any area the user selects in the Americas.

Built for the [*Harmonization of MODIS and VIIRS Hot Spots*](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/) challenge, NASA Space Apps Challenge 2026.

> Work in progress during the hackathon (November 14–15, 2026).

## The problem
Satellites have recorded fire hotspots for more than two decades, but the record is split between two sensors:

- **MODIS** (Terra and Aqua, 2000 – present): about 1 km pixels, near the end of its mission.
- **VIIRS** (Suomi-NPP, 2012 – present): 375 m pixels and higher sensitivity to small fires.

Because of the different resolution, sensitivity and overpass times, their counts cannot be compared directly. Without harmonization, it looks as if fires multiplied 4 to 7 times in 2012, when only the sensor changed.

## What it does
- Merges both records into one series calibrated on the years when both sensors operate together (2012 – 2025).
- Shows a **year × month calendar** of burning activity for the selected area, with an accessible color ramp.
- Compares the current month with the **historical median** (anomalies).
- Lets users **download the hotspots** of their search as CSV.

## How the harmonization works
1. **Comparable sensors:** MODIS **Aqua** vs VIIRS **Suomi-NPP**, which both pass over at about 13:30 and 01:30 local time.
2. **Cleaning:** vegetation fires only (`type = 0`), low-confidence detections removed.
3. **Same counting unit:** detections are collapsed to **fire cell-days on a 1 km grid**, so several VIIRS pixels of the same fire count once, like MODIS.
4. **Calibration:** a **per-country, per-month factor** (median VIIRS/MODIS ratio over the overlap period) converts 2002 – 2011 MODIS counts into VIIRS-equivalent units. From 2012 on, VIIRS is used directly.
5. **Validation:** leave-one-year-out. Preliminary result for Mexico: mean error 11 %, bias +2 %, r = 0.988.

## Repository structure
| Folder | Content |
|---|---|
| `data/` | Processing pipeline (Python + Polars) and example data |
| `backend/` | API (Python + FastAPI + DuckDB over Parquet) |
| `frontend/` | Web app (HTML, CSS and JavaScript) |
| `docs/` | Project documentation |

## Data
- **NASA FIRMS** – Fire Information for Resource Management System: https://firms.modaps.eosdis.nasa.gov
- MODIS Collection 6.1 active fire product. Giglio, L., Schroeder, W., & Justice, C. O. (2016). *Remote Sensing of Environment*, 178, 31–41.
- VIIRS 375 m active fire product. Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I. A. (2014). *Remote Sensing of Environment*, 143, 85–96.

Raw data are not stored in this repository; download them with `data/pipeline/00_descargar.sh`.

## Team
- Maximiliano Vasquez Arroyo – data and science
- Luis Angel Suárez Degante – backend
- Denzel Yahir Morantes Pereida – backend
- Mia Alexandra Sánchez Morante – frontend
- Karol Paola López Mariaca – documentation and business

## License
Code released under the [MIT License](LICENSE). FIRMS data are provided by NASA under its open data policy.
