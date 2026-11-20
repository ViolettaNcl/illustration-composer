#!/usr/bin/env bash
# Rebuilds public/library/*.svg from the two flat Figma exports in tools/source/.
# Needs node + playwright (headless Chromium) and python3.
set -euo pipefail
cd "$(dirname "$0")/.."
C=tools/.cache; mkdir -p "$C"
node tools/bbox.cjs tools/source/library_L.svg "$C/bbL.json"
node tools/bbox.cjs tools/source/library_S.svg "$C/bbS.json"
# y-thresholds skip the palette block at the top of each sheet; 15 = bbox merge tolerance
python3 tools/cluster.py "$C/bbL.json" "$C/clL.json" 2700 15 >/dev/null
python3 tools/cluster.py "$C/bbS.json" "$C/clS.json" 1700 15 >/dev/null
python3 tools/extract.py "$C" public/library
node tools/build-manifest.mjs
