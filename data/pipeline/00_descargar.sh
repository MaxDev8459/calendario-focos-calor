#!/bin/sh
# Descarga los focos de calor anuales de FIRMS para México (sin llave).
# Uso, desde la carpeta data/:   sh pipeline/00_descargar.sh
set -u
base="https://firms.modaps.eosdis.nasa.gov/data/country"
mkdir -p crudo/modis crudo/viirs-snpp
bajar() {
  f="crudo/$1/$1_$2_Mexico.csv"
  [ -s "$f" ] && { echo "ya existe $f"; return; }
  curl -sS --fail --retry 3 -o "$f.part" "$base/$1/$2/$1_$2_Mexico.csv" && mv "$f.part" "$f" && echo "OK $f" || echo "FALLO $f"
}
for y in $(seq 2000 2025); do bajar modis "$y"; done
for y in $(seq 2012 2025); do bajar viirs-snpp "$y"; done
