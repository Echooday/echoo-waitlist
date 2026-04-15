#!/usr/bin/env bash
# Regenerates public/flower-meadow/* from src/assets/flower_meadow.png (macOS sips).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src/assets/flower_meadow.png"
OUT="$ROOT/public/flower-meadow"
if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC" >&2
  exit 1
fi
mkdir -p "$OUT"
TMP="$OUT/.square-tmp.png"
# Center crop to square (1008×1057 → 1008×1008)
sips -c 1008 1008 --cropOffset 24 0 "$SRC" --out "$TMP"
for z in 16 32 48 64 128 180 192 256; do
  sips -z "$z" "$z" "$TMP" --out "$OUT/icon-${z}.png"
done
cp "$OUT/icon-32.png" "$OUT/favicon-32.png"
cp "$OUT/icon-16.png" "$OUT/favicon-16.png"
cp "$OUT/icon-180.png" "$OUT/apple-touch-icon.png"
cp "$OUT/icon-64.png" "$OUT/logo-64w.png"
cp "$OUT/icon-128.png" "$OUT/logo-128w.png"
cp "$OUT/icon-256.png" "$OUT/logo-256w.png"
rm -f "$TMP"
echo "Wrote icons under $OUT"
