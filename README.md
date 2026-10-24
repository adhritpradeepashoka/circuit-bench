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

### Sign in with Google

Set `GOOGLE_CLIENT_ID` (a Google OAuth *web* client ID, public by design) on the host and a **Sign in with Google** button appears
in the top bar (`/api/config` hands it to the page; unset → no button). It is display-only for now: the signed-in name and picture
are kept in that browser; nothing is sent to or stored on CircuitBench's server, and the token isn't used to authorize anything.
Cloud-synced projects will verify it server-side when they arrive.

### First visit: the tour and "Build it with me"

A first-time visitor gets **Welcome to CircuitBench!**: what it is, then a popup pointing at each button and area (workbench,
Parts, search, Select/Wire, rotate/delete, undo, zoom, hints line, Run, Code, Ask AI, projects, help), ending with what a first
project needs. **Build it with me** then guides a first circuit (blink an LED) in a new project: it highlights the exact part to add,
the exact breadboard holes and Arduino pins to use, in order, and only moves on once the circuit really is wired that way (checked on
the live netlist). The **?** button in the top bar brings it back any time (`src/ui/tour.js`).

Wiring needs no tool switching: in the normal Select mode, pressing on any pin, hole or lead and dragging to another draws a wire;
pressing anywhere else on a part moves it. Wire-only mode (`W`) is still there for crowded spots.

### Part Creator: make your own parts

Parts → My parts → **Create a part**. Give it a name, colour and pins, then say what it does.

**Package** decides the shape. For every chip package you list the pins in the datasheet's own order, from pin 1,
and the simulator places each leg from its pin number — you never pick sides:

| Package | Shape | Pins |
|---|---|---|
| Module / breakout | you place each pin on any side; with *breadboard* ticked, one header row along the bottom | any |
| DIP, 0.3" | two rows 0.3" apart — the width of the breadboard trench — notch and pin 1 at the left, numbering down the bottom row and back along the top | even, 4+ |
| DIP, 0.6" wide | the same for the big through-hole chips (ATmega328P, 8051) | even, 4+ |
| Quad flat pack | QFP/QFN — pins on all four sides, the way microprocessors and FPGAs are really packaged. Numbered anticlockwise from the top of the left side: down the left, along the bottom, up the right, back along the top. Surface mount, so it doesn't plug into a breadboard | multiple of 4, 8+ |

The shape is enforced, not suggested: a 16-pin chip cannot come back as one long comb of pins, and a quad package
cannot come back lopsided. Simple parts pick a ready-made behaviour: just connections, a
resistor/load, an LED, a push button, an analog sensor (a slider sets OUT = VCC × position), a digital sensor
(click to trigger), or a multiplexer (select pins pick which channel reaches the common pin).

**Rules parts.** A menu of behaviours always runs out, so a part can instead be described by *rules* — enough for
most discrete logic: gates, shift registers, counters, flip-flops, latches, decoders. A rules part says what it
remembers (`vars`), what changes it (`rules`: `when` an expression is true, `set` a value) and what it drives
(`outputs`: one expression per pin). For example a 74HC595:

```json
"vars":    { "shift": 0, "latch": 0 },
"rules":   [ { "when": "rising(SHCP) && MR", "set": { "shift": "(shift * 2 + DS) % 256" } },
             { "when": "rising(STCP)",       "set": { "latch": "shift" } } ],
"outputs": { "Q0": "latch & 1", "Q1": "(latch >> 1) & 1" }
```

Those expressions are **not code**. `src/core/expr.js` parses them into a tree of numbers and arithmetic and
evaluates that tree directly — no `eval`, no `Function`, no strings, no property access, no loops, and the only
callable names are a fixed list (`min`, `max`, `abs`, `clamp`, `v`, `rising`, `falling`, `changed`, …). The worst a
hostile expression can do is return a wrong number. Depth, length and node count are capped so it can't hang the
page. A pin reads 1 above half the supply; below 2 V the part switches off and forgets its state, like a real chip.

Rules parts are evaluated on **every MCU pin change**, not once per frame, so a `shiftOut()` burst of thousands of
clock pulses inside one animation frame is seen edge by edge exactly as the firmware sent it.

**Describe it to the AI.** Type what the part is and press *Make it*: the AI searches the web for the real
datasheet first (Google Search grounding on Gemini, browser search on Groq), so it uses the actual pin names and
order, then fills in the same form — including the rules for a logic chip. It shows which pages it used. Its reply
is a spec like any other: it goes through `validatePartSpec()`, and if it doesn't check out the AI gets the exact
reasons and one repair round. Nothing the AI returns is ever executed.

Saved parts stay in this browser's "My parts" and are embedded in any project file that uses them (`customParts`),
so a shared project opens with its parts. The AI chat sees them in its catalogue and can place and wire them.

### Boards: Uno, Nano, Mega 2560

Pick the board when you make a new project (or add one from Parts). Everything board-specific — pin → port/bit, ADC
channels, power pins, I²C pins, the arduino-cli FQBN — lives in `src/core/boards.js`; the chips themselves (vector tables,
timers, ports, PWM map) are in `src/sim/chips.js`. The sketch is compiled for whichever board is on the canvas, and the Mega runs
on a real ATmega2560 model (22-bit PC, extended I/O, timers 3–5, 16-channel ADC). 
**Several boards on one bench.** Drop as many boards as you like (any mix of Uno, Nano, Mega, R4 and Pico) and press Run once: every board
gets its own chip emulation running its own sketch. The code dock shows a board picker when there is more than one; each board's sketch is
saved with the project (`boardSketches` in the project file; the first board keeps the project's own `sketch`/`files`). Boards talk by
serial: wire one board's TX to another's RX and join their GND, and real bytes flow between the chips (Mega Serial1–3 and Pico Serial1/2
work too). The simulator tells you about a missing shared ground, TX wired to TX, a baud-rate mismatch and 5 V into a 3.3 V board. Plain
wires between boards go through the same circuit solver as everything else. Not done yet: I²C/SPI between two boards (a board is an I²C
master only) and a ready-made multi-board example.

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

**v0.1 is bring-your-own-key only** — each visitor pastes their own free key for any of five providers: Gemini
([aistudio.google.com/apikey](https://aistudio.google.com/apikey)), Groq ([console.groq.com/keys](https://console.groq.com/keys)),
NVIDIA ([build.nvidia.com](https://build.nvidia.com/settings/api-keys)), Meta Llama ([llama.developer.meta.com](https://llama.developer.meta.com/))
or OpenRouter ([openrouter.ai/keys](https://openrouter.ai/keys)). Each provider keeps its own saved key, so switching is one click
(✨ Ask AI → "AI provider…"), and you can type any model id to override the built-in list (Google and others retire models without
warning, so the server asks each provider which models your key can use, picks the newest free one — never a preview, TTS or
image model — and caches the answer for 30 minutes; the built-in list is only the fallback). it's stored
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
| Arduino Nano | same chip as the Uno; plugs into the breadboard; A6/A7 are analog-input only |
| Arduino Mega 2560 | real ATmega2560: 54 digital pins, A0–A15, timers 0–5 (PWM on D2–D13, D44–D46), I²C on D20/D21 |
| DHT22 / DHT11 | single-wire protocol timed in CPU cycles, so the real Adafruit `DHT` library reads it; right-click to set model, temperature, humidity |
| LCD 16×2 (I²C) | PCF8574 backpack at 0x27 + HD44780 in 4-bit mode; the real `LiquidCrystal_I2C` library drives it, custom characters included |
| L298N motor driver | two H-bridges: IN1/IN2 direction, ENA/ENB enable (PWM = speed; unconnected = jumper on), outputs ≈ supply − 1.4 V |
| DC motor | ≈ 20 Ω load, ~250 rpm at 6 V; spins on screen with speed and direction; flagged if wired straight to a pin |
| Battery | 1.5–12 V source (0.5 Ω internal); right-click to set the voltage |
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

## Catalogue parts that are the real Wokwi elements

Servo, HC-SR04, KY-040 encoder, buzzer, 10-segment LED bar graph, KS2E relay, tilt switch, sound sensor, slide
potentiometer, 4×4 membrane keypad, 8-way DIP switch, analog joystick, MQ-2 gas sensor and flame sensor are the actual `@wokwi/elements` components (same look, same pin names and positions — see
`src/core/native-parts.js`; pin tables are generated by `npm run extract-native-pins`). What they *do* is described with
the same behaviours the Part Creator offers, so they are simulated by the same solver and timing code. Parts Wokwi has no
element for (diodes, transistors, regulators, capacitors, the 28BYJ-48 stepper, the 74HC595…) are catalogue parts drawn by
CircuitBench; everything else is a template in the Part Creator. Keypad keys, DIP switches and the joystick are operated by
clicking the element while the simulation runs (hit-testing in `beginPartInput`, `src/ui/editor.js`); the analog sensors
also drive a DOUT pin that flips at a threshold, like the comparator on the real module.

## Importing a circuit board (KiCad)

File ▾ → **Import PCB (KiCad .kicad_pcb)…** turns a board you designed in KiCad into a part: drawn at true size from the
real outline, pads and copper tracks, with a connection point on every node that reaches a header pad. Connectivity
comes from net names when the file has them and otherwise from the copper itself (pads and track ends that touch are one
node — `src/core/kicad-import.js`), so boards drawn without a schematic, like electrode arrays, import too. The board is
one part (package `board`, saved in My parts and inside projects). Splitting a board's components out into separately
simulated parts is the next step.

## Bioelectronics workspace: head visualizer and slime mold

- **Visualizer** (toggle next to the toolbar): a 3D head scan (“3D human head scan” by celer, CC BY — see `ATTRIBUTION.md`). Every BioAmp EXG Pill in the circuit is a channel with its own E+ and E−; drag them onto EEG / EOG / EMG sites (or pick from the lists). One reference electrode is shared. The signal each Pill receives depends on where its electrodes sit (illustrative model in `src/core/body-sites.js`, not medical data).
- **Slime mold (Physarum)**: lay it over an imported electrode board (File → Import PCB). The pads it covers pick up its slow oscillation and pass it to their pins, measured against its REF pin; read them with Pills and an Arduino (example sketch “Slime mold electrode reader”). Model in `src/core/slime.js`; illustrative, not real culture data.


## Accounts, roles and beta access

Sign in with Google; the server verifies the Google token and keeps each account's role.

| Role | Can do |
|---|---|
| owner (`OWNER_EMAIL`) | everything; makes and removes admins; can't be changed |
| admin | grants and revokes beta |
| beta | lifetime free access to everything (included AI, premium features); never limited when busy |
| user | free tier; loses the free extras first when `MAX_FREE_CONCURRENT` is reached |

Manage members in the app: **⚙ Settings → Members** (admins only). You can add an email before the person has ever signed in; revoking applies on their next request.

Server env: `OWNER_EMAIL`, `DATABASE_URL` (Supabase Postgres; without it roles live in memory and reset on restart), `SESSION_SECRET`, `MAX_FREE_CONCURRENT`, `HOSTED_AI_KEY` / `HOSTED_AI_PROVIDER` / `HOSTED_AI_MODEL`, `FREE_HOSTED_AI=1`.
