# Virtual Lab

A browser-based virtual electronics lab. You build a circuit on a real-looking breadboard, write **real Arduino C++**, and press
Run: the sketch is compiled by **Arduino CLI** (avr-gcc + the official Arduino AVR core) and the resulting firmware executes on a
simulated **ATmega328P** ([avr8js](https://github.com/wokwi/avr8js)) wired into the circuit you drew.

```
sketch.ino ──► compile service (Arduino CLI) ──► firmware.hex ──► ATmega328P (avr8js) ◄──► circuit solver ◄── your breadboard
                     ▲                                                  │  Serial, GPIO, PWM, ADC
                     └── GCC errors, sizes, output ─────────────────────┴──► Output tab · Serial Monitor · LEDs · displays
```

## Quick start

```bash
npm install
npm run dev          # the app on http://localhost:5173  (proxies /api to the compile service)
npm run server       # in a second terminal: the compile service on http://127.0.0.1:8787
```

Or as one process: `npm start` (builds, then serves `dist/` and `/api` together on :8787).

**Run `npm run doctor` first if you're unsure** — it checks, in order, whether the compile service is running, Arduino CLI is installed, and a test sketch actually builds, and prints the exact fix for anything missing. If the Output tab says *"Compile service not reachable"*, one of those three is the reason: the page can only compile your own sketches while `npm run server` is running in a second terminal. (The Examples menu's sketches run without it — but as soon as you edit one, it needs compiling.)

The bundled **example sketches run without the compile service** (their firmware is prebuilt). Compiling *your own* sketch needs it.

### The compile service needs Arduino CLI + the AVR core

| Situation | Do this |
|---|---|
| Normal machine | `arduino-cli core update-index && arduino-cli core install arduino:avr` ([install Arduino CLI](https://arduino.github.io/arduino-cli/latest/installation/)) |
| `downloads.arduino.cc` is blocked (firewall, some CI) | `./scripts/setup-toolchain.sh` — gets the CLI + core from GitHub and avr-gcc from apt, builds Arduino's `ctags`, then prints the `export` lines to use |
| Docker | see `Dockerfile` (untested — no Docker where it was written) |

Check it with `curl localhost:8787/api/health`.

| Env var | Meaning | Default |
|---|---|---|
| `PORT`, `HOST` | listen address | `8787`, `127.0.0.1` |
| `ARDUINO_CLI` | path to `arduino-cli` | `arduino-cli` on `PATH` |
| `AVR_GCC_DIR`, `ARDUINO_CTAGS_DIR` | only for non-standard toolchain layouts (the setup script prints them) | unset |
| `ARDUINO_DIRECTORIES_USER` etc. | Arduino CLI's own directory variables | Arduino CLI defaults |
| `VLAB_BUILD_CACHE` | shared core-build cache (makes repeat builds fast) | `$TMPDIR/vlab-build-cache` |
| `VLAB_CORS_ORIGIN` | set (e.g. `*`) only if the page is served from another origin | off |

The single-file build (`npm run build:single`, ~5 MB because Monaco is inlined) opens straight from disk: the editor, the circuit and the
bundled examples all work; compiling your own sketch needs a service. Page served from elsewhere (for example that file)? Point it at the service with `?compiler=http://127.0.0.1:8787` and
start the service with `VLAB_CORS_ORIGIN=*` (or your page's origin).

### First visit: the tour and "Build it with me"

A first-time visitor gets **Welcome to CircuitBench!**: what it is, then a popup pointing at each button and area (workbench,
Parts, search, Select/Wire, rotate/delete, undo, zoom, hints line, Run, Code, Ask AI, projects, help), ending with what a first
project needs. **Build it with me** then guides a first circuit (blink an LED) in a new project: it highlights the exact part to add,
the exact breadboard holes and Arduino pins to use, in order, and only moves on once the circuit really is wired that way (checked on
the live netlist). The **?** button in the top bar brings it back any time (`src/ui/tour.js`).

Wiring needs no tool switching: in the normal Select mode, pressing on any pin, hole or lead and dragging to another draws a wire;
pressing anywhere else on a part moves it. Wire-only mode (`W`) is still there for crowded spots.

### I²C parts: MPU-6050 and SSD1306 OLED

The simulated ATmega328P now has a working I²C bus (`Wire`): `src/sim/i2c.js` answers for whatever is wired to A4/SDA and A5/SCL,
using register-level device models in `src/parts/` — the **MPU-6050** (accelerometer + gyro + temperature, 0x68 / 0x69 via AD0) and
the **SSD1306 128×64 OLED** (0x3C, the full command set Adafruit_SSD1306 / U8g2 use, drawn pixel for pixel). Raw `Wire` code,
`Adafruit_MPU6050` and `Adafruit_SSD1306` + `Adafruit_GFX` all run unmodified (the libraries are installed on the compile server).
A part is only on the bus if it's really wired and powered; otherwise it NACKs like real hardware and the tray says which wire is
missing. Right-click the MPU-6050 to tilt it in 3D (three.js, loaded only when that panel first opens) or with sliders/presets —
the running sketch sees gravity move, and the gyro reads how fast you turn it. The **Tilt meter** example shows both together.

RAM is real too: Adafruit_SSD1306 mallocs a 1 KB screen buffer at run time, which the compiler's RAM figure doesn't count, so
`Adafruit_MPU6050` + a 128×64 OLED leaves the next allocations failing on a 2 KB Uno — a blank display, exactly as on hardware. After a
compile, the Output pane (and the AI) get a **Memory** note with the real budget whenever a sketch uses that buffer.

### Projects

The name under **CircuitBench** in the top bar opens **My projects**: create, open, rename, duplicate and delete projects, each with
its own circuit and code, autosaved as you work (in this browser for now; Google sign-in with cloud sync is next). Every project records
its **workspace** — the environment it was made in. Today that is *Arduino Uno + breadboard*; PCB/KiCad, 3D/CAD assembly and robotics
workspaces are listed as coming soon and will be added as new workspace types (`src/core/projects.js`), not as a change to how projects
are stored. Importing a project file now creates a new project instead of overwriting the open one.

### AI "Ask AI" (beta, bring-your-own-key)

The ✨ Ask AI button in the code dock turns a plain-English instruction + the circuit you've built + the current sketch into an edit —
via Gemini or Groq, your choice. The AI can now change the **circuit itself**, not just the firmware: add, move, rotate or remove
parts, wire them up, and tweak properties (resistor value, LED color, and so on), in the same request as a sketch rewrite. A reply
like "add a pushbutton on pin 2 with a pull-down resistor" lands on the board, wired, with the matching code — all in one step.

It also **diagnoses from what actually happened**, not just what the code says should happen. Every request carries the last
compile result (errors, full compiler output, and whether you've edited since), a snapshot of the running simulation (each Uno pin's
mode and voltage, what `analogRead` returns on A0–A5, every LED's on/off state and current, held buttons, electrical warnings,
wiring problems), the recent Serial Monitor output and any other project files. A failed compile shows **✨ Fix with AI**; the
simulator tray has **✨ Ask AI why** for "it runs but does the wrong thing".

Under the hood the model only ever proposes a JSON list of actions (`add_part`, `move_part`, `rotate_part`, `set_prop`,
`remove_part`, `add_wire`, `remove_wire`); `src/core/ai-actions.js` — plain, DOM-free JS shared verbatim between the server and the
browser — is the sole gatekeeper that validates every action against the real part/pin catalogue before anything touches your
project. A hallucinated part type or pin name is dropped with a warning instead of corrupting the circuit, and you see those
warnings (and a summary of what changed) before deciding whether to Apply.

**v0.1 is bring-your-own-key only** — each visitor pastes their own free key (Gemini at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey), or Groq at
[console.groq.com/keys](https://console.groq.com/keys) if the Gemini flow hits Google's "project creation failed" bug); it's stored
in their browser only (`localStorage`) and sent with each request, so CircuitBench's own server never sees or pays for anyone's
usage. Nothing needs configuring server-side for this to work. (A server-funded free quota before asking for a key is the intended
next step — `server/ai-service.mjs` is written so that slots in as a second way to satisfy the same request, without the client
changing.)

### Security

The service compiles code it is sent. It validates file names and sizes, rate-limits, queues (2 at a time), times out at 90 s, and refuses
absolute / `..` `#include`s and `.incbin` / `.include` — but that is defence in depth, not a sandbox. **Run it in a container** (see the
`docker run` line in the Dockerfile: read-only root, no capabilities, memory/pid limits) and block its outbound network.

## What's in the box

**Editor**: drag parts, snap leads into breadboard holes, draw wires (straight / 90° / curved, colours, draggable ends), undo/redo, pan/zoom,
autosave, JSON export/import. Breadboard topology is real (A–E and F–J per column are separate strips; rails are continuous).

| Part | Notes |
|---|---|
| Arduino Uno R3, solderless breadboard | real ATmega328P |
| LED | right-click → colour (red, yellow, orange, green, blue, white); colour sets forward voltage (≈1.9 V … 3.1 V) |
| RGB LED | common cathode; each colour is its own diode |
| Resistor | **bendable legs**: it stretches and turns to fit exactly between any two holes (minimum 4 pitches, the body length) — drop it and both leads snap dead-centre into the nearest free holes; select it and drag either lead handle to move just that leg (Alt = no hole snapping). Right-click → value (`220`, `4.7k`, `4k7`, `1M`, `330 ohm`; colour bands follow; 1 Ω – 10 MΩ) |
| Pushbutton | hold while running |
| Slide switch | SPDT; click to flip |
| Potentiometer | 10 kΩ divider; right-click → position, live while running |
| 7-segment display | 1 digit, common cathode |
| PIR motion sensor | needs VCC ≥ 4.5 V + GND; click it while running to trigger OUT |
| Photoresistor module | AO falls as light rises (Wokwi convention); DO HIGH below ≈100 lux; right-click → lux |
| NTC temperature sensor | β = 3950, 10 kΩ @ 25 °C; OUT falls as it heats; right-click → °C |

Adding a part = a `PART_DEFS` entry (`src/core/parts.js`), pin geometry (`npm run extract-pins`), a netlist/solver model and, if it
animates, a few lines in `src/ui/simulation.js`.

**Simulation**: a DC nodal solver (LED diodes with per-colour Vf, resistors, switches, potentiometers, sensor modules with comparators)
is re-solved whenever the circuit or the firmware's pin states change. PWM (`analogWrite`) is simulated by duty cycle — the timer
registers give the duty and the solver averages the HIGH/LOW circuits (exact for LED brightness). Warnings are plain electrical facts
(pin/LED currents, unpowered modules).

**Electrical model** (what the solver assumes — `src/core/solver.js`, `led-colors.js`, `sensors.js`):

| Element | Model |
|---|---|
| Uno I/O pin driving HIGH/LOW | 5 V / 0 V behind ≈ 25 Ω (warns above 40 mA) |
| Uno 5V pin | USB supply: 5 V behind ≈ 0.5 Ω, 500 mA limit (polyfuse) — it sags under load |
| Uno 3.3V pin | 3.3 V behind ≈ 1 Ω, 150 mA limit |
| LED | conducts above its colour's knee `Vf` (red 1.9 V … blue/white 3.1 V) with its own slope resistance `rd` (15 Ω red/yellow/orange/green, 25 Ω blue/white); warns above ~30 mA |
| Resistor, potentiometer, NTC, LDR | ideal resistances (values as set) |
| Breadboard | A–E and F–J per column are separate strips; power rails run the full length |

Not modelled: LED burn-out, exponential LED curve, polyfuse tripping, thermal effects, capacitance/inductance. It is a DC solver.

**Messages are facts, not advice.** The tray reports what is connected and what flows — `An LED is carrying 200 mA (5 mm LED rating: ~30 mA); its anode is
connected directly to 5V and its cathode directly to GND`, `Resistor 220 Ω: lead 2 is not connected to anything, so no current flows through it`,
`5V is delivering 588 mA (supply limit 500 mA)`, `Short circuit: 5V is connected to GND through about 0.0 Ω` (external path under 2 Ω). Suggesting fixes
is deliberately left to a later phase.

**Code**: the **Code** button opens the sketch dock, a small IDE. The editor is **Monaco** (the VS Code editor): C++ highlighting, Arduino autocomplete (`pinMode`, `Serial.println` …), error squiggles from the real compiler, Ctrl/Cmd+Enter to Run. It loads on demand the first time you open the dock (a ~4 MB chunk, ~1 MB gzipped), so the rest of the app starts fast. **Projects are multi-file**: tabs for `sketch.ino` plus any `.ino` / `.h` / `.hpp` / `.c` / `.cpp` files (`+` to add, double-click to rename, × to delete). The project autosaves in your browser and is included in exported project JSON. **Verify** compiles; **Run** compiles then runs. The **Output** tab shows the real
compiler report (error lines are clickable; sizes as the Arduino IDE prints them). The **Serial Monitor** shows `Serial` output at the
baud rate the firmware set and sends text back to `Serial.read()`.

Everything Arduino C++ supports compiles — `float`, `long`, classes, `String`, `millis()`, libraries shipped with the AVR core.

**What the simulated chip actually implements** (so what works at run time): GPIO ports B/C/D, Timer0/1/2 (incl. interrupts and PWM),
the 10-bit ADC, and UART0. **Not emulated yet:** I²C (`Wire` compiles, but transfers wait forever for hardware that isn't there),
SPI, EEPROM, external-pin interrupts (`attachInterrupt`), watchdog. Sketches that use them compile and run up to that point.

## Troubleshooting

**Console: "Could not create web worker(s). Falling back to loading web worker code in main thread"** — Monaco's helper worker was
refused by the browser (strict Content-Security-Policy, a sandboxed preview, some browsers with `file://`). The served app loads the
worker as a same-origin file (works under `worker-src 'self'`); the single-file build inlines it as a `blob:` worker. If a page blocks
workers altogether, the editor detects that up front, switches off the few features that need one (links, word-based suggestions, colour
swatches) and logs one plain `console.info` instead — everything else, including Arduino autocomplete, works the same.

**The code panel shows only Output / Serial Monitor, no editor** — the dock adapts to its width. Wide: the editor sits beside a side panel
(Output or Serial Monitor). Narrow (a small window, or browser zoom above 100 %): it becomes one tab bar, **Code | Output | Serial Monitor**,
one view at a time, so the editor can never be squeezed out. Separately, the **Simple editor / Monaco editor** button in the dock header
switches editors, and if Monaco ever fails to paint your code the app switches to the simple editor by itself (and remembers that until you
press the button again). A saved project that is a single empty file is treated as "nothing saved" and loads the default sketch.

## Tests

```bash
npm test     # 107 tests
```

- `core` — geometry, snapping, netlist, solver, sensors, project files
- `firmware` — **real Arduino firmware** (Blink timing, `millis()`, Serial TX/RX, `float`/`String`, ADC, PWM) on the simulated chip
- `compile-client` / `server` — request validation, guards, diagnostics; the service tests that need Arduino CLI **skip themselves** if it isn't installed
- `ui-smoke` — jsdom driving the real UI code with pointer events

The firmware tests use prebuilt results in `test/fixtures/firmware.json`, so they need no toolchain. Regenerate them (and the bundled
examples' prebuilt firmware) with `npm run build-firmware` on a machine that has the toolchain.

## Layout

```
server/            compile-service.mjs (Arduino CLI wrapper), server.mjs (HTTP + static)
src/core/          parts, geometry, snapping, netlist, DC solver, sensor models, project files (no DOM)
src/sim/           mcu.js (avr8js ATmega328P + UART/ADC/PWM), compile-client.js, examples, prebuilt firmware
src/ui/            editor, sidebar, simulation glue, code dock (files, output, serial), value editors
src/ui/editors/    the CodeEditor interface's two implementations: text-editor.js (fallback / tests) and monaco-editor.js
scripts/           extract-pins, build-firmware, setup-toolchain.sh
test/              see above
```

## Roadmap position

Phase 1 (editor) and 2 (real MCU simulation) are done, and so are Phase 2's development-environment items: real Arduino compiler,
compile output, Serial Monitor, Monaco and multi-file `.ino` projects. Not built yet: the rest of the project system (save/load to a
file or account, project URLs, sharing, better snapping), then the AI layer, extensions and everything after. New parts and sensors are deliberately not being added to the core; they belong in Parts Extensions.
