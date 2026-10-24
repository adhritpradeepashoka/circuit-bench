# Virtual Lab: web app + Arduino compile service in one container.
#   docker build -t virtual-lab .
#   docker run --rm -p 8787:8787 --read-only --tmpfs /tmp:size=256m,exec --cap-drop ALL \
#              --security-opt no-new-privileges --memory 1g --pids-limit 256 virtual-lab
# Then open http://localhost:8787
#
# NOTE: this file has not been built in the environment it was written in (no Docker there) — treat the first build as a test.
# The toolchain is installed the standard way (Arduino CLI + `core install arduino:avr`), which needs to reach downloads.arduino.cc
# at *build* time only. Nothing needs network access at run time, so you can (and should) block the container's egress.

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# python3: the Raspberry Pi Pico core's build scripts run on the host's Python
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 \
 && rm -rf /var/lib/apt/lists/*

ENV PICO_INDEX=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json \
    ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/downloads \
    ARDUINO_UPDATER_ENABLE_NOTIFICATION=false \
    ARDUINO_CLI=/usr/local/bin/arduino-cli
RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh \
 && arduino-cli core update-index \
 && arduino-cli core install arduino:avr@1.8.6 \
 && (arduino-cli core update-index --additional-urls "$PICO_INDEX" \
     && arduino-cli core install rp2040:rp2040@6.3.1 --additional-urls "$PICO_INDEX" \
     || echo "WARNING: the Raspberry Pi Pico core could not be installed; Uno/Nano/Mega still work") \
 && arduino-cli lib install "Adafruit MPU6050@2.2.6" "Adafruit Unified Sensor@1.1.15" "Adafruit BusIO@1.17.4" \
                            "Adafruit SSD1306@2.5.13" "Adafruit GFX Library@1.12.1" \
                            "LiquidCrystal I2C@1.1.2" "DHT sensor library@1.4.6" "Servo@1.2.2" "Stepper@1.1.3" \
 && arduino-cli version

# Unprivileged user; the toolchain stays read-only at run time, builds happen in /tmp
RUN useradd --system --create-home --uid 10001 vlab \
 && mkdir -p /tmp/vlab && chown -R vlab /tmp/vlab
WORKDIR /srv/vlab
COPY --from=web /app/dist ./dist
COPY server ./server
# Pre-build the Raspberry Pi Pico core once, here, where the build machine has CPU to spare: the first ARM compile otherwise
# builds hundreds of core files, which takes minutes on a small server. The result is seeded into the build cache at start-up.
RUN node -e "import('./server/compile-service.mjs').then(async m => { const c = m.createCompiler({ cacheDir: '/opt/arduino/cache-seed', timeoutMs: 900000 }); const r = await c.compile({ sketch: 'void setup() {}\nvoid loop() {}\n', fqbn: 'rp2040:rp2040:rpipico' }); console.log(r.ok ? 'Pico core pre-built' : 'Pico core NOT pre-built: ' + String(r.output).slice(0, 300)); })" \
 || echo "WARNING: could not pre-build the Pico core cache"
# server/ai-service.mjs imports src/core/ai-actions.js directly (not through the Vite bundle, which only
# covers dist/) — src/core/* is plain, dependency-free JS shared between server and browser, so it has to
# ship in the runtime image too, not just get built into dist/. Missing this made every deploy since
# bd123fc crash on startup with ERR_MODULE_NOT_FOUND, while Render kept serving the last image that
# built — so restarts looked like no-ops no matter how many commits actually fixed something.
COPY src/core ./src/core
COPY package.json package-lock.json ./
# Runtime packages (pg, jose, ...) — the server imports them; without node_modules it crashed on start.
RUN npm ci --omit=dev && npm cache clean --force
ENV HOST=0.0.0.0 PORT=8787 VLAB_BUILD_CACHE=/tmp/vlab/cache NODE_ENV=production
USER vlab
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "mkdir -p /tmp/vlab/cache && cp -a /opt/arduino/cache-seed/. /tmp/vlab/cache/ 2>/dev/null; exec node server/server.mjs"]
