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
# Then it prints the environment variables to export before `npm run server`.
#
# One known difference from the official toolchain: Debian's avr-libc sets __malloc_margin = 32, Arduino's = 128.
# Heap-hungry sketches (e.g. Adafruit_SSD1306 128×64 + Adafruit_MPU6050) can run here and fail on a real board / on the
# Docker image. test/i2c.test.mjs patches the margin to 128 (officialMallocMargin) where it matters.
set -euo pipefail

CLI_VERSION="${CLI_VERSION:-1.5.1}"
CORE_VERSION="${CORE_VERSION:-1.8.6}"
CTAGS_TAG="${CTAGS_TAG:-5.8-arduino11}"
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
