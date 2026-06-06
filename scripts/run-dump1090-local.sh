#!/usr/bin/env bash
# Build (once) and run dump1090-fa locally on Fedora, writing aircraft.json and
# serving it over HTTP so the tracker server's `radio` source can read it.
# Mirrors the Raspberry Pi decode path for local testing.
set -euo pipefail

SRC="${SRC:-/tmp/dump1090-fa}"
JSON_DIR="${JSON_DIR:-/tmp/adsb-json}"
PORT="${PORT:-8080}"
LAT="${LAT:-37.6213}"
LON="${LON:--122.379}"

# Use the rtl-sdr-blog build we installed to /usr/local.
export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:/usr/local/lib64/pkgconfig:${PKG_CONFIG_PATH:-}"

if [ ! -x "$SRC/dump1090" ]; then
  echo "==> Building dump1090-fa"
  sudo dnf install -y git make gcc ncurses-devel libusb1-devel
  rm -rf "$SRC"
  git clone --depth 1 https://github.com/flightaware/dump1090 "$SRC"
  make -C "$SRC" RTLSDR=yes
fi

mkdir -p "$JSON_DIR"

# Serve the JSON directory (dump1090-fa writes files; it has no built-in HTTP).
( cd "$JSON_DIR" && exec python3 -m http.server "$PORT" --bind 0.0.0.0 ) &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT

echo
echo "aircraft.json  ->  http://localhost:$PORT/aircraft.json"
echo "Run the tracker with:"
echo "    AIRCRAFT_JSON_URL=http://localhost:$PORT/aircraft.json DATA_SOURCE=radio pnpm dev"
echo

exec "$SRC/dump1090" --device-type rtlsdr \
  --lat "$LAT" --lon "$LON" \
  --write-json "$JSON_DIR" --write-json-every 1 --quiet
