#!/usr/bin/env bash
# Sets up the Arduino toolchain the compile service needs: Arduino CLI + the official Arduino AVR core + avr-gcc.
#
# ── On a normal machine you do NOT need this script ──────────────────────────────────────────────
#     curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
#     arduino-cli core update-index && arduino-cli core install arduino:avr
#     npm run server
#
# ── Use this script when downloads.arduino.cc is unreachable (firewalls, some CI / sandboxes) ─────
# It fetches everything from GitHub + your distro instead:
#   • Arduino CLI            – GitHub release
#   • Arduino AVR core 1.8.6 – github.com/arduino/ArduinoCore-avr   (the same core the IDE installs)
#   • avr-gcc / avr-libc     – apt (Debian/Ubuntu)                    (GCC 7.3, same generation as the IDE's)
#   • Arduino's ctags fork   – github.com/arduino/ctags, built here   (used for automatic function prototypes)
#   • Raspberry Pi Pico      – Arduino-Pico (earlephilhower) core + its arm-none-eabi toolchain, from the same GitHub releases
#                              the Arduino IDE's Boards Manager uses (skipped on machines that are not x86-64 Linux; set SKIP_PICO=1 to skip)
# Then it prints the environment variables to export before `npm run server`.
#
# One known difference from the official toolchain: Debian's avr-libc sets __malloc_margin = 32, Arduino's = 128.
# Heap-hungry sketches (e.g. Adafruit_SSD1306 128×64 + Adafruit_MPU6050) can run here and fail on a real board / on the
# Docker image. test/i2c.test.mjs patches the margin to 128 (officialMallocMargin) where it matters.
set -euo pipefail

CLI_VERSION="${CLI_VERSION:-1.5.1}"
CORE_VERSION="${CORE_VERSION:-1.8.6}"
CTAGS_TAG="${CTAGS_TAG:-5.8-arduino11}"
PICO_VERSION="${PICO_VERSION:-6.3.1}"            # Arduino-Pico core; its toolchain versions come from the core's own package index
TOOLS_DIR="${TOOLS_DIR:-$HOME/.vlab-toolchain}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

mkdir -p "$TOOLS_DIR/bin" "$TOOLS_DIR/data" "$TOOLS_DIR/downloads" "$TOOLS_DIR/sketchbook/hardware/arduino" "$TOOLS_DIR/ctags"

echo "▸ avr-gcc, avr-libc, build tools (apt)"
if ! command -v avr-gcc >/dev/null; then $SUDO apt-get install -y gcc-avr avr-libc binutils-avr build-essential git curl; fi
avr-gcc --version | head -1

echo "▸ Arduino CLI $CLI_VERSION"
if [ ! -x "$TOOLS_DIR/bin/arduino-cli" ]; then
  curl -fsSL -o "$TOOLS_DIR/cli.tgz" "https://github.com/arduino/arduino-cli/releases/download/v${CLI_VERSION}/arduino-cli_${CLI_VERSION}_Linux_64bit.tar.gz"
  tar -xzf "$TOOLS_DIR/cli.tgz" -C "$TOOLS_DIR/bin" arduino-cli && rm "$TOOLS_DIR/cli.tgz"
fi
"$TOOLS_DIR/bin/arduino-cli" version | head -1

echo "▸ Arduino AVR core $CORE_VERSION"
CORE_DIR="$TOOLS_DIR/sketchbook/hardware/arduino/avr"
[ -d "$CORE_DIR" ] || git clone --quiet --depth 1 --branch "$CORE_VERSION" https://github.com/arduino/ArduinoCore-avr.git "$CORE_DIR"

echo "▸ Arduino ctags $CTAGS_TAG"
if [ ! -x "$TOOLS_DIR/ctags/ctags" ]; then
  SRC="$(mktemp -d)"
  git clone --quiet --depth 1 --branch "$CTAGS_TAG" https://github.com/arduino/ctags.git "$SRC"
  # modern glibc defines __unused__ itself; ctags' own macro of that name breaks the build
  grep -rl "__unused__" --include=*.c --include=*.h "$SRC" | xargs sed -i 's/__unused__/ctags_unused__/g'
  (cd "$SRC" && ./configure >/dev/null && make -j"$(nproc)" >/dev/null)
  cp "$SRC/ctags" "$TOOLS_DIR/ctags/ctags"; rm -rf "$SRC"
fi

if [ -z "${SKIP_PICO:-}" ] && [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ]; then
  echo "▸ Raspberry Pi Pico core $PICO_VERSION (Arduino-Pico)"
  PICO_PKG="$TOOLS_DIR/data/packages/rp2040"
  if [ ! -f "$PICO_PKG/hardware/rp2040/$PICO_VERSION/platform.txt" ]; then
    command -v python3 >/dev/null || $SUDO apt-get install -y python3        # the core's build scripts (and its "python3" tool) need a host Python
    command -v unzip >/dev/null || $SUDO apt-get install -y unzip
    WORK="$(mktemp -d)"
    curl -fsSL -o "$WORK/index.json" "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json"
    python3 - "$WORK/index.json" "$PICO_VERSION" > "$WORK/list.txt" <<'PY'
import json, sys
pkg = json.load(open(sys.argv[1]))['packages'][0]
pl = next(p for p in pkg['platforms'] if p['version'] == sys.argv[2])
print('platform', pl['version'], pl['url'])
need = {(t['name'], t['version']) for t in pl['toolsDependencies']}
for t in pkg['tools']:
    if (t['name'], t['version']) in need and t['name'] in ('pqt-gcc', 'pqt-picotool', 'pqt-pioasm', 'pqt-python3'):
        s = next(x for x in t['systems'] if x['host'] == 'x86_64-pc-linux-gnu')
        print('tool', t['name'], t['version'], s['url'])
PY
    while read -r kind a b c; do
      if [ "$kind" = platform ]; then
        curl -fsSL -o "$WORK/core.zip" "$b" && unzip -q "$WORK/core.zip" -d "$WORK/core"
        mkdir -p "$PICO_PKG/hardware/rp2040" && rm -rf "$PICO_PKG/hardware/rp2040/$a" && mv "$WORK/core"/* "$PICO_PKG/hardware/rp2040/$a"
      else
        dest="$PICO_PKG/tools/$a/$b"; mkdir -p "$dest"
        curl -fsSL "$c" | tar -xz --strip-components=1 -C "$dest"
      fi
    done < "$WORK/list.txt"
    chmod +x "$PICO_PKG"/tools/pqt-python3/*/python3 2>/dev/null || true
    rm -rf "$WORK"
  fi
  echo "   $(ls "$PICO_PKG/hardware/rp2040")"
fi

cat <<OUT

Done. Start the service with:

  export ARDUINO_CLI="$TOOLS_DIR/bin/arduino-cli"
  export AVR_GCC_DIR="$(dirname "$(command -v avr-gcc)")/"
  export ARDUINO_CTAGS_DIR="$TOOLS_DIR/ctags"
  export ARDUINO_DIRECTORIES_DATA="$TOOLS_DIR/data"
  export ARDUINO_DIRECTORIES_USER="$TOOLS_DIR/sketchbook"
  export ARDUINO_DIRECTORIES_DOWNLOADS="$TOOLS_DIR/downloads"
  npm run server

(arduino-cli prints harmless "index download failed" lines when the Arduino servers are unreachable.)
OUT
