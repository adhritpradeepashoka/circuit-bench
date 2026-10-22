import { PART_DEFS, CATALOG_ORDER } from '../core/parts.js';
import { createModelElement, DRAG_MIME } from './editor.js';
import { formatOhms } from '../core/resistance.js';
import { LED_COLORS } from '../core/led-colors.js';
import { sidePanes } from './side-panes.js';

const $ = id => document.getElementById(id);
const BLURB = {
  'arduino-uno': 'ATmega328P board',
  'arduino-nano': 'Small Uno · plugs into a breadboard',
  'arduino-mega': 'ATmega2560 · 54 digital, 16 analog pins',
  dht: 'Temperature + humidity · right-click to set',
  lcd1602: '2 lines of text over I²C (0x27)',
  'dc-motor': 'Spins with the voltage across it',
  l298n: 'Dual H-bridge: direction + PWM speed',
  battery: '1.5–12 V supply · right-click to set',
  breadboard: '400 tie points',
  led: '5 mm, right-click to set colour',
  resistor: '¼ W, ±5 %, bendable legs, right-click for value',
  pushbutton: '6 mm tactile switch',
  'rgb-led': 'Common cathode, 3 colour pins',
  'slide-switch': 'SPDT — click to flip',
  'seven-segment': '1 digit, common cathode',
  'pir-sensor': 'Click while running to trigger',
  potentiometer: '10 kΩ, right-click to turn',
  'ldr-module': 'AO + DO, right-click for light level',
  'ntc-sensor': 'β 3950, right-click for temperature',
  mpu6050: 'I²C, right-click to tilt it in 3D',
  ssd1306: 'I²C graphics display, 0x3C',
};
const KEYWORDS = { led: 'diode light', resistor: 'ohm resistance value 220 pullup', pushbutton: 'switch button input', 'rgb-led': 'rgb colour multicolor tricolor light', 'slide-switch': 'switch toggle spdt input', 'seven-segment': 'display digit number 7 segment 7seg numeric', 'pir-sensor': 'motion sensor pir hc-sr501 presence detector', potentiometer: 'pot knob dial trimmer analog variable resistor volume', 'ldr-module': 'ldr light sensor photoresistor brightness lux analog', 'ntc-sensor': 'temperature thermistor ntc sensor heat analog', breadboard: 'protoboard solderless', 'arduino-uno': 'mcu atmega328p microcontroller', 'arduino-nano': 'nano mcu atmega328p microcontroller small breadboard', 'arduino-mega': 'mega 2560 atmega2560 mcu microcontroller big many pins', mpu6050: 'mpu6050 mpu-6050 gy-521 accelerometer gyroscope gyro imu tilt motion orientation i2c', ssd1306: 'oled display screen ssd1306 128x64 graphics lcd i2c', dht: 'dht dht11 dht22 am2302 temperature humidity weather sensor', lcd1602: 'lcd 16x2 1602 character display text screen i2c liquidcrystal', 'dc-motor': 'motor dc spin wheel fan robot', l298n: 'l298n motor driver h-bridge h bridge robot', battery: 'battery 9v power supply cell aa' };

export function initSidebar(editor) {
  let query = '';

  function thumb(type) {
    const def = PART_DEFS[type];
    const box = document.createElement('span');
    box.className = 'thumb';
    const inner = document.createElement('span');
    inner.className = 'thumb-inner';
    inner.style.width = `${def.w}px`; inner.style.height = `${def.h}px`;
    const s = Math.min(1, 50 / def.w, 36 / def.h);
    inner.style.transform = `translate(${(-def.w * s) / 2}px, ${(-def.h * s) / 2}px) scale(${s})`;
    inner.append(createModelElement(type));
    box.append(inner);
    return box;
  }

  function renderCatalog() {
    const host = $('catalog');
    host.innerHTML = '';
    const q = query.trim().toLowerCase();
    const items = CATALOG_ORDER.map(t => PART_DEFS[t]).filter(d => !q || `${d.name} ${d.category} ${KEYWORDS[d.type] || ''}`.toLowerCase().includes(q));
    for (const cat of [...new Set(items.map(d => d.category))]) {
      const h = document.createElement('div');
      h.className = 'group-title'; h.textContent = cat;
      host.append(h);
      for (const def of items.filter(d => d.category === cat)) {
        const card = document.createElement('div');
        card.className = 'part-card'; card.draggable = true; card.tabIndex = 0; card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Add ${def.name}`);
        const copy = document.createElement('span');
        copy.className = 'copy'; copy.innerHTML = `<b>${def.name}</b><span>${BLURB[def.type]}</span>`;
        const add = document.createElement('span');
        add.className = 'add'; add.textContent = 'Add';
        card.append(thumb(def.type), copy, add);
        card.addEventListener('click', () => editor.addPart(def.type));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editor.addPart(def.type); } });
        card.addEventListener('dragstart', e => { e.dataTransfer.setData(DRAG_MIME, def.type); e.dataTransfer.effectAllowed = 'copy'; });
        host.append(card);
      }
    }
    if (!items.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No matching parts'; host.append(d); }
  }

  function renderWorkspace() {
    const host = $('workspaceList');
    host.innerHTML = '';
    if (!editor.state.parts.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'Nothing placed yet'; host.append(d); return; }
    for (const p of editor.state.parts) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `workspace-row${editor.sel?.kind === 'part' && editor.sel.id === p.id ? ' sel' : ''}`;
      row.innerHTML = `<span class="dot"></span><span>${PART_DEFS[p.type].name}${p.type === 'resistor' ? ` · ${formatOhms(p.ohms)}` : p.type === 'led' ? ` · ${LED_COLORS[p.color]?.name || ''}` : ''}</span>`;
      row.addEventListener('click', () => { editor.select({ kind: 'part', id: p.id }); editor.status(`${PART_DEFS[p.type].name} selected`); });
      host.append(row);
    }
  }

  const setQuery = v => { query = v; $('partsSearch').value = v; $('topSearch').value = v; renderCatalog(); };
  $('partsSearch').addEventListener('input', e => setQuery(e.target.value));
  $('topSearch').addEventListener('input', e => { setCollapsed(false); setQuery(e.target.value); });
  $('topSearch').addEventListener('focus', () => setCollapsed(false));

  const panes = sidePanes(editor);
  // Kept for callers that still think in "collapse the parts column": collapsed = Parts pane closed.
  const setCollapsed = collapsed => (collapsed ? panes.close('parts') : panes.open('parts'));
  $('collapseBtn').addEventListener('click', () => panes.close('parts'));
  $('main').addEventListener('transitionend', e => { if (e.propertyName.startsWith('grid-template-columns')) { editor.positionWireEditor(); } });

  editor.on('workspace', renderWorkspace);
  editor.on('select', renderWorkspace);
  renderCatalog(); renderWorkspace();
  return { setCollapsed };
}
