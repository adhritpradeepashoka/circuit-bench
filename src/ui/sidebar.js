import { PART_DEFS, CATALOG_ORDER } from '../core/parts.js';
import { createModelElement, DRAG_MIME } from './editor.js';
import { formatOhms } from '../core/resistance.js';
import { LED_COLORS } from '../core/led-colors.js';
import { sidePanes } from './side-panes.js';
import { customTypes, builtinTypes, BEHAVIOURS } from '../core/custom-parts.js';

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
    const blurb = d => BLURB[d.type] || (d.custom ? d.spec.description || BEHAVIOURS[d.spec.behaviour.kind].label : '');
    const items = [...CATALOG_ORDER, ...builtinTypes(), ...customTypes()].map(t => PART_DEFS[t]).filter(d => !q || `${d.name} ${d.category} ${KEYWORDS[d.type] || ''} ${d.custom ? `${d.spec.description} custom` : ''}`.toLowerCase().includes(q));
    const showCreate = !q || 'my parts create make new custom part creator'.includes(q) || items.some(d => d.custom && !d.builtin);
    const cats = [...new Set(items.map(d => d.category))];
    if (showCreate && !cats.includes('My parts')) cats.push('My parts');
    for (const cat of cats) {
      const h = document.createElement('div');
      h.className = 'group-title'; h.textContent = cat;
      host.append(h);
      for (const def of items.filter(d => d.category === cat)) {
        const card = document.createElement('div');
        card.className = 'part-card'; card.draggable = true; card.tabIndex = 0; card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Add ${def.name}`);
        const copy = document.createElement('span');
        copy.className = 'copy';
        const nm = document.createElement('b'); nm.textContent = def.name;
        const bl = document.createElement('span'); bl.textContent = blurb(def);
        copy.append(nm, bl);
        const add = document.createElement('span');
        add.className = 'add'; add.textContent = 'Add';
        card.append(thumb(def.type), copy);
        if (def.custom && !def.builtin) {
          const edit = document.createElement('button');
          edit.type = 'button'; edit.className = 'edit-part'; edit.title = `Edit ${def.name}`; edit.setAttribute('aria-label', `Edit ${def.name}`); edit.textContent = '✎';
          edit.addEventListener('click', e => { e.stopPropagation(); editor.emit('edit-part', def.type); });
          card.append(edit);
        }
        card.append(add);
        card.addEventListener('click', () => editor.addPart(def.type));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editor.addPart(def.type); } });
        card.addEventListener('dragstart', e => { e.dataTransfer.setData(DRAG_MIME, def.type); e.dataTransfer.effectAllowed = 'copy'; });
        host.append(card);
      }
      if (cat === 'My parts' && showCreate) {
        const mk = document.createElement('button');
        mk.type = 'button'; mk.className = 'create-part'; mk.id = 'createPartBtn';
        mk.innerHTML = '<span class="plus">+</span><span><b>Create a part</b><span>Draw your own, or describe it to the AI</span></span>';
        mk.addEventListener('click', () => editor.emit('create-part'));
        host.append(mk);
      }
    }
    if (!items.length) {
      const q0 = query.trim();
      const d = document.createElement('div'); d.className = 'empty no-match';
      const msg = document.createElement('p');
      msg.textContent = q0 ? `No part called “${q0}” yet.` : 'No matching parts';
      d.append(msg);
      if (q0) {
        const sub = document.createElement('p'); sub.className = 'hint'; sub.textContent = 'Make it: the AI can look it up on the web and build it, or you can draw it yourself.';
        const ai = document.createElement('button'); ai.type = 'button'; ai.className = 'create-part'; ai.id = 'makeMissingBtn';
        ai.innerHTML = '<span class="plus">+</span><span><b></b><span>Let the AI look it up and build it</span></span>';
        ai.querySelector('b').textContent = `Make “${q0.slice(0, 40)}”`;
        ai.addEventListener('click', () => editor.emit('create-part', { name: q0, ask: true }));
        const own = document.createElement('button'); own.type = 'button'; own.className = 'link-btn'; own.id = 'drawMissingBtn'; own.textContent = 'Or draw it myself';
        own.addEventListener('click', () => editor.emit('create-part', { name: q0 }));
        d.append(sub, ai, own);
      }
      host.append(d);
    }
  }

  function renderWorkspace() {
    const host = $('workspaceList');
    host.innerHTML = '';
    if (!editor.state.parts.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'Nothing placed yet'; host.append(d); return; }
    for (const p of editor.state.parts) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `workspace-row${editor.sel?.kind === 'part' && editor.sel.id === p.id ? ' sel' : ''}`;
      const dot = document.createElement('span'); dot.className = 'dot';
      const txt = document.createElement('span'); txt.textContent = `${PART_DEFS[p.type].name}${p.type === 'resistor' ? ` · ${formatOhms(p.ohms)}` : p.type === 'led' ? ` · ${LED_COLORS[p.color]?.name || ''}` : ''}`;
      row.append(dot, txt);
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
  editor.on('catalog', renderCatalog);
  editor.on('select', renderWorkspace);
  renderCatalog(); renderWorkspace();
  return { setCollapsed };
}
