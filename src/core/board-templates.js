// Development boards for the resource packs: the ESP chips (ESP32, ESP8266, C3, S3, CAM, XIAO…) and the wider Arduino family. Each is a ready-made
// "sprite" part: drawn like the real board (USB socket, chip, header pads with their silkscreen names) with a pin on every header hole, so a student can
// wire real circuits to it and the wiring checker and bill of materials know it. CircuitBench does not run sketches for these boards yet — they are for
// wiring, planning and parts lists — and each description says so. Pure data; src/core/part-templates.js adds them to the template list.

const PITCH = 9.6;                                   // 2.54 mm in px
const r1 = n => Math.round(n * 10) / 10;
const ID_OK = s => String(s).replace(/[^A-Za-z0-9+\-_.]/g, '').slice(0, 12);

/** pins: [id, label?] entries → {id, label, x, y} on two columns (vertical board, USB at the top) or two rows (horizontal board, USB at the left). */
function layout(rows, horiz, bare) {
  const [first, second] = rows, n = Math.max(first.length, second.length);
  const seen = new Set();
  const norm = list => list.map(e => {
    const [rawId, label] = Array.isArray(e) ? e : [e, e];
    let id = ID_OK(rawId) || 'P', k = 2; const base = id;
    while (seen.has(id.toLowerCase())) id = `${base}.${k++}`;
    seen.add(id.toLowerCase());
    return { id, label: label || rawId };
  });
  const A = norm(first), B = norm(second);
  if (horiz) {
    const x0 = bare ? 14 : 28, w = Math.ceil(x0 + (n - 1) * PITCH + 14), h = 88;
    return { w, h, pins: [...A.map((p, i) => ({ ...p, x: r1(x0 + i * PITCH), y: 7 })), ...B.map((p, i) => ({ ...p, x: r1(x0 + i * PITCH), y: h - 7 }))] };
  }
  const y0 = bare ? 14 : 26, h = Math.ceil(y0 + (n - 1) * PITCH + 14), w = 88;
  return { w, h, pins: [...A.map((p, i) => ({ ...p, x: 7, y: r1(y0 + i * PITCH) })), ...B.map((p, i) => ({ ...p, x: w - 7, y: r1(y0 + i * PITCH) }))] };
}

const board = ({ id, name, label, color, chip, desc, rows, horiz = false, bare = false }) => {
  const { w, h, pins } = layout(rows, horiz, bare);
  return {
    group: 8, id, name, label, color, textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: `${desc} CircuitBench draws and wires it but does not run sketches for this board yet.`,
    pins, sprite: { art: bare ? 'drone-devboard-bare' : 'drone-devboard', w, h, note: chip }, behaviour: { kind: 'none' },
  };
};
const G = (n, extra) => [`GPIO${n}`, extra ? `GPIO${n} (${extra})` : `GPIO${n}`];

// ── ESP, "normal" pack: the three boards almost everyone starts with (the ESP32-C3 Super Mini lives in part-templates.js) ──
const ESP_NORMAL = [
  board({ id: 'esp32-devkit', name: 'ESP32 DevKit V1 (30 pins)', label: 'ESP32', color: '#14181f', chip: 'ESP32', horiz: false,
    desc: 'The classic ESP32 development board: dual-core 240 MHz, Wi-Fi and Bluetooth, 3.3 V logic, 30 pins. GPIO34, 35, 36 and 39 are input-only, GPIO6 to 11 are used by the flash.',
    rows: [[['EN', 'EN (reset)'], G(36, 'VP, input only'), G(39, 'VN, input only'), G(34, 'input only'), G(35, 'input only'), G(32), G(33), G(25, 'DAC1'), G(26, 'DAC2'), G(27), G(14), G(12), G(13), 'GND', ['VIN', 'VIN (5 V in)']],
      [G(23, 'MOSI'), G(22, 'SCL'), G(1, 'TX0'), G(3, 'RX0'), G(21, 'SDA'), G(19, 'MISO'), G(18, 'SCK'), G(5), G(17), G(16), G(4), G(2, 'on-board LED'), G(15), 'GND', ['3V3', '3.3 V out']]] }),
  board({ id: 'esp8266-nodemcu', name: 'ESP8266 NodeMCU v3 (30 pins)', label: 'NodeMCU', color: '#1c2a3a', chip: 'ESP8266', horiz: false,
    desc: 'The popular ESP8266 board: 80 MHz, Wi-Fi, 3.3 V logic, one analog input (A0, 0 to 3.3 V on most boards) and the pins named D0 to D8 on the silkscreen.',
    rows: [[['A0', 'A0 (analog in, 0-3.3 V)'], 'RSV', 'RSV', ['SD3', 'SD3 (GPIO10)'], ['SD2', 'SD2 (GPIO9)'], 'SD1', 'CMD', 'SD0', 'CLK', 'GND', ['3V3', '3.3 V'], 'EN', 'RST', 'GND', ['VIN', 'VIN (5 V in)']],
      [['D0', 'D0 (GPIO16)'], ['D1', 'D1 (GPIO5, SCL)'], ['D2', 'D2 (GPIO4, SDA)'], ['D3', 'D3 (GPIO0, FLASH)'], ['D4', 'D4 (GPIO2, LED)'], ['3V3', '3.3 V'], 'GND', ['D5', 'D5 (GPIO14, SCK)'], ['D6', 'D6 (GPIO12, MISO)'], ['D7', 'D7 (GPIO13, MOSI)'], ['D8', 'D8 (GPIO15)'], ['RX', 'RX (GPIO3)'], ['TX', 'TX (GPIO1)'], 'GND', ['3V3', '3.3 V']]] }),
];

// ── ESP, "expanded" pack: more boards, modules and tiny boards ──
const ESP_EXPANDED = [
  board({ id: 'esp32-devkitc', name: 'ESP32-DevKitC (38 pins)', label: 'DevKitC', color: '#101820', chip: 'ESP32', horiz: false,
    desc: 'Espressif\'s own ESP32-WROOM-32 board with 38 pins and a 5 V pin. GPIO34 to 39 are input-only; GPIO6 to 11 are tied to the flash, leave them alone.',
    rows: [[['3V3', '3.3 V'], 'EN', G(36, 'VP'), G(39, 'VN'), G(34), G(35), G(32), G(33), G(25), G(26), G(27), G(14), G(12), 'GND', G(13), G(9, 'SD2'), G(10, 'SD3'), G(11, 'CMD'), ['5V', '5 V']],
      ['GND', G(23), G(22), G(1, 'TX0'), G(3, 'RX0'), G(21), 'GND', G(19), G(18), G(5), G(17), G(16), G(4), G(0, 'BOOT'), G(2), G(15), G(8, 'SD1'), G(7, 'SD0'), G(6, 'CLK')]] }),
  board({ id: 'esp32-s3-devkitc', name: 'ESP32-S3-DevKitC-1 (44 pins)', label: 'S3 DevKit', color: '#0f1a24', chip: 'ESP32-S3', horiz: false,
    desc: 'ESP32-S3 with Wi-Fi, Bluetooth 5, native USB and an AI-friendly dual core. 3.3 V logic. GPIO19 and 20 are the USB pair, GPIO0 is the BOOT button, GPIO48 drives the RGB LED.',
    rows: [[['3V3', '3.3 V'], ['3V3', '3.3 V'], 'RST', G(4), G(5), G(6), G(7), G(15), G(16), G(17), G(18), G(8), G(3), G(46), G(9), G(10), G(11), G(12), G(13), G(14), ['5V', '5 V'], 'GND'],
      ['GND', G(43, 'TX'), G(44, 'RX'), G(1), G(2), G(42), G(41), G(40), G(39), G(38), G(37), G(36), G(35), G(0, 'BOOT'), G(45), G(48, 'RGB LED'), G(47), G(21), G(20, 'USB D+'), G(19, 'USB D-'), 'GND', 'GND']] }),
  board({ id: 'esp32-cam', name: 'ESP32-CAM (AI-Thinker)', label: 'ESP32-CAM', color: '#1a1f27', chip: 'ESP32', horiz: true, bare: true,
    desc: 'ESP32 with an OV2640 camera and a micro-SD slot, but no USB socket: program it through GPIO1 / GPIO3 with a USB-serial adapter, with GPIO0 held to GND while it uploads. Several pins are used by the camera and SD card.',
    rows: [[['5V', '5 V'], 'GND', G(12), G(13), G(15), G(14), G(2), G(4)], [['3V3', '3.3 V'], G(16), G(0, 'hold LOW to flash'), 'GND', ['VCC', '3.3 V or 5 V'], G(3, 'U0R'), G(1, 'U0T'), 'GND']] }),
  board({ id: 'esp8266-d1-mini', name: 'ESP8266 Wemos D1 Mini', label: 'D1 mini', color: '#202a3a', chip: 'ESP8266', horiz: false,
    desc: 'The small ESP8266 board with a micro-USB socket and 16 pins. 3.3 V logic; A0 takes 0 to 3.3 V (the board has a divider for 0 to 3.2 V).',
    rows: [['RST', ['A0', 'A0 (analog in)'], ['D0', 'D0 (GPIO16)'], ['D5', 'D5 (GPIO14, SCK)'], ['D6', 'D6 (GPIO12, MISO)'], ['D7', 'D7 (GPIO13, MOSI)'], ['D8', 'D8 (GPIO15)'], ['3V3', '3.3 V']],
      [['TX', 'TX (GPIO1)'], ['RX', 'RX (GPIO3)'], ['D1', 'D1 (GPIO5, SCL)'], ['D2', 'D2 (GPIO4, SDA)'], ['D3', 'D3 (GPIO0)'], ['D4', 'D4 (GPIO2, LED)'], 'GND', ['5V', '5 V']]] }),
  board({ id: 'esp01', name: 'ESP-01 (ESP8266, 8 pins)', label: 'ESP-01', color: '#1c3a63', chip: 'ESP8266', horiz: true, bare: true,
    desc: 'The tiny ESP8266 Wi-Fi module with an 8-pin header. 3.3 V ONLY (5 V kills it). CH_PD must be HIGH; GPIO0 LOW at power-up puts it in flash mode.',
    rows: [['GND', G(2), G(0), ['RX', 'RXD (GPIO3)']], [['TX', 'TXD (GPIO1)'], ['CH_PD', 'CH_PD / EN (keep HIGH)'], 'RST', ['VCC', 'VCC (3.3 V)']]] }),
  board({ id: 'esp12f', name: 'ESP-12F module (ESP8266)', label: 'ESP-12F', color: '#10294a', chip: 'ESP-12F', horiz: false, bare: true,
    desc: 'The bare ESP8266 module you solder onto your own board (16 pads, 3.3 V). EN high, GPIO15 low and GPIO0 high to boot normally.',
    rows: [['RST', ['ADC', 'ADC (0-1 V)'], ['EN', 'EN (keep HIGH)'], G(16), G(14), G(12), G(13), ['VCC', 'VCC (3.3 V)']], ['GND', G(15, 'keep LOW'), G(2), G(0), G(4), G(5), ['RX', 'RXD (GPIO3)'], ['TX', 'TXD (GPIO1)']]] }),
  board({ id: 'xiao-esp32c3', name: 'Seeed XIAO ESP32-C3', label: 'XIAO C3', color: '#1d2b22', chip: 'ESP32-C3', horiz: false,
    desc: 'A thumb-sized ESP32-C3 board with 14 pins, USB-C, a battery charger and 3.3 V logic.',
    rows: [[['D0', 'D0 (GPIO2)'], ['D1', 'D1 (GPIO3)'], ['D2', 'D2 (GPIO4)'], ['D3', 'D3 (GPIO5)'], ['D4', 'D4 (GPIO6, SDA)'], ['D5', 'D5 (GPIO7, SCL)'], ['D6', 'D6 (GPIO21, TX)']],
      [['5V', '5 V'], 'GND', ['3V3', '3.3 V'], ['D10', 'D10 (GPIO10, MOSI)'], ['D9', 'D9 (GPIO9, MISO)'], ['D8', 'D8 (GPIO8, SCK)'], ['D7', 'D7 (GPIO20, RX)']]] }),
  board({ id: 'xiao-esp32s3', name: 'Seeed XIAO ESP32-S3', label: 'XIAO S3', color: '#1d2b22', chip: 'ESP32-S3', horiz: false,
    desc: 'A thumb-sized ESP32-S3 board with 14 pins, USB-C, 8 MB flash and 3.3 V logic (the Sense version adds a camera).',
    rows: [[['D0', 'D0 (GPIO1)'], ['D1', 'D1 (GPIO2)'], ['D2', 'D2 (GPIO3)'], ['D3', 'D3 (GPIO4)'], ['D4', 'D4 (GPIO5, SDA)'], ['D5', 'D5 (GPIO6, SCL)'], ['D6', 'D6 (GPIO43, TX)']],
      [['5V', '5 V'], 'GND', ['3V3', '3.3 V'], ['D10', 'D10 (GPIO9, MOSI)'], ['D9', 'D9 (GPIO8, MISO)'], ['D8', 'D8 (GPIO7, SCK)'], ['D7', 'D7 (GPIO44, RX)']]] }),
];

// ── Arduino, "expanded" pack ──
const nanoRows = () => [[['D13', 'D13 (SCK, LED)'], ['3V3', '3.3 V out'], ['AREF', 'AREF'], 'A0', 'A1', 'A2', 'A3', ['A4', 'A4 (SDA)'], ['A5', 'A5 (SCL)'], 'A6', 'A7', ['5V', '5 V'], 'RST', 'GND', ['VIN', 'VIN (5-21 V in)']],
  [['D12', 'D12 (MISO)'], ['D11', 'D11 (MOSI)'], 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', ['RX0', 'RX0 (D0)'], ['TX1', 'TX1 (D1)']]];
const unoRows = () => [[['SCL', 'SCL'], ['SDA', 'SDA'], 'AREF', 'GND', ['D13', 'D13 (SCK, LED)'], ['D12', 'D12 (MISO)'], ['D11', 'D11 (MOSI)'], 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', ['D1', 'D1 (TX)'], ['D0', 'D0 (RX)']],
  ['NC', 'IOREF', 'RESET', ['3V3', '3.3 V out'], ['5V', '5 V'], 'GND', 'GND', ['VIN', 'VIN (7-12 V in)'], 'A0', 'A1', 'A2', 'A3', 'A4', 'A5']];
const ARDUINO_EXPANDED = [
  board({ id: 'arduino-pro-mini', name: 'Arduino Pro Mini (5 V, 16 MHz)', label: 'Pro Mini', color: '#a02b2b', chip: 'ATmega328P', horiz: true, bare: true,
    desc: 'The small, USB-less ATmega328P board: upload through the six-pin FTDI header (not drawn) or a USB-serial adapter. Same pins as an Uno, in two rows of 12; A4 and A5 are inner pads here listed at the end of the bottom row.',
    rows: [[['TXO', 'TXO (D1)'], ['RXI', 'RXI (D0)'], 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], [['RAW', 'RAW (5-12 V in)'], 'GND', 'RST', ['VCC', 'VCC (5 V)'], 'A3', 'A2', 'A1', 'A0', ['D13', 'D13 (SCK, LED)'], ['D12', 'D12 (MISO)'], ['D11', 'D11 (MOSI)'], 'D10', ['A4', 'A4 (SDA)'], ['A5', 'A5 (SCL)']]] }),
  board({ id: 'arduino-pro-micro', name: 'Pro Micro (ATmega32U4, 5 V)', label: 'Pro Micro', color: '#a02b2b', chip: 'ATmega32U4', horiz: true,
    desc: 'A Leonardo-style board in a Nano-sized shape with native USB (it can act as a keyboard or mouse). 24 pins, RAW takes 5 to 12 V.',
    rows: [[['TX0', 'TX0 (D1)'], ['RX1', 'RX1 (D0)'], 'GND', 'GND', ['D2', 'D2 (SDA)'], ['D3', 'D3 (SCL)'], 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], [['RAW', 'RAW (5-12 V in)'], 'GND', 'RST', ['VCC', 'VCC (5 V)'], ['A3', 'A3 (D21)'], ['A2', 'A2 (D20)'], ['A1', 'A1 (D19)'], ['A0', 'A0 (D18)'], ['D15', 'D15 (SCK)'], ['D14', 'D14 (MISO)'], ['D16', 'D16 (MOSI)'], 'D10']] }),
  board({ id: 'arduino-leonardo', name: 'Arduino Leonardo', label: 'LEONARDO', color: '#00858f', chip: 'ATmega32U4', horiz: true,
    desc: 'An Uno-shaped board with native USB (ATmega32U4, 5 V): it can act as a keyboard or mouse. Same header layout as the Uno.',
    rows: unoRows() }),
  board({ id: 'arduino-zero', name: 'Arduino Zero (SAMD21, 3.3 V)', label: 'ZERO', color: '#00858f', chip: 'SAMD21', horiz: true,
    desc: 'A 32-bit Arduino in the Uno shape with a 48 MHz ARM Cortex-M0+. All pins are 3.3 V ONLY and there is a real analog output (A0).',
    rows: unoRows() }),
  board({ id: 'arduino-uno-wifi', name: 'Arduino Uno WiFi Rev2', label: 'UNO WiFi', color: '#00858f', chip: 'ATmega4809', horiz: true,
    desc: 'An Uno-shaped board with an ATmega4809 and a Wi-Fi / Bluetooth module (u-blox NINA-W13), 5 V logic.',
    rows: unoRows() }),
  board({ id: 'arduino-nano-every', name: 'Arduino Nano Every', label: 'Nano Every', color: '#00858f', chip: 'ATmega4809', horiz: true,
    desc: 'The Nano shape with a faster ATmega4809, 5 V logic and micro-USB.', rows: nanoRows() }),
  board({ id: 'arduino-nano33-iot', name: 'Arduino Nano 33 IoT', label: 'Nano 33 IoT', color: '#00858f', chip: 'SAMD21', horiz: true,
    desc: 'The Nano shape with a SAMD21 and Wi-Fi / Bluetooth. 3.3 V ONLY: 5 V on a pin damages it. Has an IMU on board.', rows: nanoRows() }),
  board({ id: 'arduino-nano33-ble', name: 'Arduino Nano 33 BLE', label: 'Nano 33 BLE', color: '#00858f', chip: 'nRF52840', horiz: true,
    desc: 'The Nano shape with an nRF52840 (Bluetooth 5) and a motion / environment sensor suite. 3.3 V ONLY.', rows: nanoRows() }),
  board({ id: 'arduino-nano-esp32', name: 'Arduino Nano ESP32', label: 'Nano ESP32', color: '#00858f', chip: 'ESP32-S3', horiz: true,
    desc: 'The Nano shape with an ESP32-S3 (Wi-Fi, Bluetooth, USB-C). 3.3 V ONLY on its pins.', rows: nanoRows() }),
  board({ id: 'arduino-nano-rp2040', name: 'Arduino Nano RP2040 Connect', label: 'Nano RP2040', color: '#00858f', chip: 'RP2040', horiz: true,
    desc: 'The Nano shape with a Raspberry Pi RP2040, Wi-Fi / Bluetooth and an IMU. 3.3 V ONLY.', rows: nanoRows() }),
];

export const BOARD_TEMPLATES = [...ESP_NORMAL, ...ESP_EXPANDED, ...ARDUINO_EXPANDED];
/** Template ids by pack (the ESP32-C3 Super Mini belongs to the normal ESP pack too: see PACKS in packs.js). */
export const BOARD_PACK_IDS = {
  espNormal: ESP_NORMAL.map(t => t.id), espExpanded: ESP_EXPANDED.map(t => t.id), arduinoExpanded: ARDUINO_EXPANDED.map(t => t.id),
};
