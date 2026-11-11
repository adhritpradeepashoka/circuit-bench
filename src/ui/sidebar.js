import { PART_DEFS, CATALOG_ORDER } from '../core/parts.js';
import { createModelElement, DRAG_MIME } from './editor.js';
import { formatOhms } from '../core/resistance.js';
import { LED_COLORS } from '../core/led-colors.js';
import { sidePanes } from './side-panes.js';
import { customTypes, builtinTypes, BEHAVIOURS } from '../core/custom-parts.js';
import { menuFirst, partsFirst, activeWorkspace } from '../core/workspaces.js';
import { getRobotType, showingAll, setShowAll, onRobotType } from '../core/robot-context.js';
import { robotType, circuitPartsFor } from '../core/robot-types.js';
import { partAvailable, onPacksChange } from '../core/packs.js';

const $ = id => document.getElementById(id);
const BLURB = {
  'arduino-uno': 'ATmega328P board',
  'arduino-uno-r4': 'UNO R3 layout · 14-bit ADC + DAC · runs on the Uno emulation',
  'arduino-uno-r4-wifi': 'UNO R3 layout · 12 × 8 LED matrix · 14-bit ADC + DAC · runs on the Uno emulation',
  'arduino-uno-q': 'Uno layout · STM32U585 sketches run in the simulator · 3.3 V · 13 × 8 LED matrix',
  'arduino-ventuno-q': '160 × 100 mm · STM32H5F5 sketches run in the simulator · 40-pin HAT header · 13 × 8 matrix',
  'arduino-nano': 'Small Uno · plugs into a breadboard',
  'arduino-mega': 'ATmega2560 · 54 digital, 16 analog pins',
  'raspberry-pi-pico': 'RP2040 · 3.3 V · runs real firmware · plugs into a breadboard',
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
const KEYWORDS = { led: 'diode light', resistor: 'ohm resistance value 220 pullup', pushbutton: 'switch button input', 'rgb-led': 'rgb colour multicolor tricolor light', 'slide-switch': 'switch toggle spdt input', 'seven-segment': 'display digit number 7 segment 7seg numeric', 'pir-sensor': 'motion sensor pir hc-sr501 presence detector', potentiometer: 'pot knob dial trimmer analog variable resistor volume', 'ldr-module': 'ldr light sensor photoresistor brightness lux analog', 'ntc-sensor': 'temperature thermistor ntc sensor heat analog', breadboard: 'protoboard solderless', 'arduino-uno': 'mcu atmega328p microcontroller', 'arduino-uno-r4': 'uno r4 minima renesas ra4m1 dac 14-bit adc', 'arduino-uno-r4-wifi': 'uno r4 wifi renesas ra4m1 esp32 s3 led matrix dac 14-bit adc', 'arduino-nano': 'nano mcu atmega328p microcontroller small breadboard', 'arduino-mega': 'mega 2560 atmega2560 mcu microcontroller big many pins', mpu6050: 'mpu6050 mpu-6050 gy-521 accelerometer gyroscope gyro imu tilt motion orientation i2c', ssd1306: 'oled display screen ssd1306 128x64 graphics lcd i2c', dht: 'dht dht11 dht22 am2302 temperature humidity weather sensor', lcd1602: 'lcd 16x2 1602 character display text screen i2c liquidcrystal', 'dc-motor': 'motor dc spin wheel fan robot', l298n: 'l298n motor driver h-bridge h bridge robot', battery: 'battery 9v power supply cell aa' };

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

  /** The parts menu points at the dialog where resource packs are added (the Resource packs button). */
  function renderPacks(host, q) {
    if (q && !'resource packs more boards extra nano mega r4'.includes(q)) return;
    const more = document.createElement('button'); more.type = 'button'; more.className = 'pack-more'; more.id = 'morePacksBtn';
    more.textContent = 'More boards and resource packs…';
    more.addEventListener('click', () => editor.emit('open-packs'));
    host.append(more);
  }

  // "drv 8833", "DRV-8833" and "drv8833" all find the same part: compare with spaces and dashes taken out, and every word of the search must appear
  const squash = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const matches = (text, q) => { const t = text.toLowerCase(), c = squash(text); return t.includes(q) || c.includes(squash(q)) || q.split(/\s+/).filter(Boolean).every(w => t.includes(w) || c.includes(squash(w))); };
  /** Every part whose name, category, keywords or description matches q (all parts for an empty q). */
  const defsMatching = q => [...CATALOG_ORDER, ...builtinTypes(), ...customTypes()].map(t => PART_DEFS[t]).filter(d => d && partAvailable(d.type)).filter(d => !q || matches(`${d.name} ${d.category} ${KEYWORDS[d.type] || ''} ${d.custom ? `${d.spec.description} custom` : ''}`, q));
  function renderCatalog() {
    const host = $('catalog');
    host.innerHTML = '';
    const q = query.trim().toLowerCase();
    const blurb = d => BLURB[d.type] || (d.custom ? d.spec.description || BEHAVIOURS[d.spec.behaviour.kind].label : '');
    const items = defsMatching(q);
    // A robotics project that knows what it is building leads with the parts for that robot (everything else is one click away, and search always looks through everything)
    const rt = activeWorkspace().robotics && !q ? robotType(getRobotType()) : null, focus = rt && !showingAll() ? circuitPartsFor(rt.id, t => !!PART_DEFS[t]) : null;
    if (focus) { const order = t => { const i = focus.indexOf(t); return i < 0 ? 999 : i; }; items.splice(0, items.length, ...items.filter(d => focus.includes(d.type) || (d.custom && !d.builtin)).sort((a, b) => order(a.type) - order(b.type))); }
    const showCreate = !q || 'my parts create make new custom part creator'.includes(q) || items.some(d => d.custom && !d.builtin);
    const first = menuFirst(), pf = partsFirst();
    if (pf.length && !focus) { const rank = t => { const i = pf.indexOf(t); return i < 0 ? 999 : i; }; items.sort((a, b) => rank(a.type) - rank(b.type)); }      // the workspace's most relevant parts lead their section
    const cats = focus ? [...new Set(items.map(d => d.category))] : [...new Set(items.map(d => d.category))].sort((a, b) => (first.includes(a) ? first.indexOf(a) : 99) - (first.includes(b) ? first.indexOf(b) : 99));      // the active workspace's sections lead the menu
    if (showCreate && !cats.includes('My parts')) cats.push('My parts');
    if (rt) {
      const bar = document.createElement('div'); bar.className = 'robot-focus';
      const lab = document.createElement('span'); lab.innerHTML = '<b></b>'; lab.querySelector('b').textContent = `${rt.icon ? rt.icon + " " : ""}${rt.name}`; lab.append(document.createTextNode(focus ? ' — showing the parts for it' : ' — showing every part'));
      const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'link-btn'; sw.textContent = focus ? 'Show all parts' : 'Only my robot\'s parts'; sw.addEventListener('click', () => setShowAll(!!focus));
      const ch = document.createElement('button'); ch.type = 'button'; ch.className = 'link-btn'; ch.textContent = 'Change robot'; ch.addEventListener('click', () => editor.emit('pick-robot-type'));
      bar.append(lab, sw, ch); host.append(bar);
    } else if (activeWorkspace().robotics && !q && !getRobotType()) {
      const bar = document.createElement('div'); bar.className = 'robot-focus'; const ch = document.createElement('button'); ch.type = 'button'; ch.className = 'link-btn'; ch.textContent = 'What are you building? Pick a robot type'; ch.addEventListener('click', () => editor.emit('pick-robot-type')); bar.append(ch); host.append(bar);
    }
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
        if (def.custom && !def.builtin && !def.fromWorkspace) {
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
    renderPacks(host, q);
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
  // ── the top-bar search: a drop-down of parts (like search suggestions), with the Part Maker in it — the side panel stays out of the way
  const top = $('topSearch'), box = document.createElement('div');
  box.id = 'topSuggest'; box.className = 'top-suggest'; box.setAttribute('role', 'listbox'); box.hidden = true; document.body.append(box);
  let active = -1, rows = [];
  const closeSuggest = () => { box.hidden = true; active = -1; top.setAttribute('aria-expanded', 'false'); };
  const pick = fn => { closeSuggest(); fn(); };
  const mark = i => { active = rows.length ? (i + rows.length) % rows.length : -1; rows.forEach((r, k) => r.el.classList.toggle('on', k === active)); rows[active]?.el.scrollIntoView({ block: 'nearest' }); };
  function paintSuggest() {
    const q = top.value.trim(), ql = q.toLowerCase();
    const defs = (q ? defsMatching(ql) : CATALOG_ORDER.map(t => PART_DEFS[t]).filter(d => d && partAvailable(d.type))).slice(0, q ? 8 : 6);
    const total = q ? defsMatching(ql).length : 0;
    box.replaceChildren(); rows = [];
    const head = (txt) => { const h = document.createElement('div'); h.className = 'ts-head'; h.textContent = txt; box.append(h); };
    const row = (el, fn) => { el.setAttribute('role', 'option'); el.tabIndex = -1; el.addEventListener('mousedown', e => e.preventDefault()); el.addEventListener('click', () => pick(fn)); el.addEventListener('mousemove', () => mark(rows.findIndex(r => r.el === el))); box.append(el); rows.push({ el, fn }); };
    if (defs.length) head(q ? 'Parts' : 'Popular parts');
    for (const def of defs) {
      const el = document.createElement('div'); el.className = 'ts-row';
      const copy = document.createElement('span'); copy.className = 'ts-copy';
      const nm = document.createElement('b'); nm.textContent = def.name; const cat = document.createElement('span'); cat.textContent = def.category || '';
      copy.append(nm, cat);
      const add = document.createElement('span'); add.className = 'add'; add.textContent = 'Add';
      el.append(thumb(def.type), copy, add);
      el.draggable = true; el.addEventListener('dragstart', e => { e.dataTransfer.setData(DRAG_MIME, def.type); e.dataTransfer.effectAllowed = 'copy'; });
      row(el, () => editor.addPart(def.type));
    }
    if (q && total > defs.length) { const more = document.createElement('button'); more.type = 'button'; more.className = 'ts-link'; more.textContent = `See all ${total} results in the Parts panel`; row(more, () => { panes.open('parts'); setQuery(q); }); }
    head('Make a part');
    if (q) {
      const ai = document.createElement('button'); ai.type = 'button'; ai.className = 'ts-make'; ai.innerHTML = '<span class="plus">+</span><span><b></b><span>Let the AI look it up and build it</span></span>'; ai.querySelector('b').textContent = `Make “${q.slice(0, 40)}”`;
      row(ai, () => editor.emit('create-part', { name: q, ask: true }));
    }
    const own = document.createElement('button'); own.type = 'button'; own.className = 'ts-make'; own.id = 'topMakePart'; own.innerHTML = `<span class="plus">+</span><span><b>${q ? 'Draw it myself' : 'Open the Part Maker'}</b><span>${q ? 'Pick the pins and behaviour yourself' : 'Describe a part to the AI, or draw your own'}</span></span>`;
    row(own, () => editor.emit('create-part', q ? { name: q } : undefined));
    const r = top.getBoundingClientRect(); box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 388))}px`; box.style.top = `${r.bottom + 6}px`; box.style.width = `${Math.min(380, innerWidth - 16)}px`;
    box.hidden = false; top.setAttribute('aria-expanded', 'true'); mark(q && defs.length ? 0 : -1);
  }
  top.setAttribute('role', 'combobox'); top.setAttribute('aria-controls', 'topSuggest'); top.setAttribute('aria-expanded', 'false'); top.autocomplete = 'off';
  top.addEventListener('input', paintSuggest);
  top.addEventListener('focus', paintSuggest);
  top.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) paintSuggest(); else mark(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active - 1); }
    else if (e.key === 'Enter') { if (!box.hidden && rows[active]) { e.preventDefault(); const f = rows[active].fn; pick(f); top.value = ''; } }
    else if (e.key === 'Escape') { closeSuggest(); top.blur(); }
  });
  top.addEventListener('blur', () => setTimeout(closeSuggest, 120));
  window.addEventListener('resize', closeSuggest);

  const panes = sidePanes(editor);
  // Kept for callers that still think in "collapse the parts column": collapsed = Parts pane closed.
  const setCollapsed = collapsed => (collapsed ? panes.close('parts') : panes.open('parts'));
  $('collapseBtn').addEventListener('click', () => panes.close('parts'));
  $('main').addEventListener('transitionend', e => { if (e.propertyName.startsWith('grid-template-columns')) { editor.positionWireEditor(); } });

  editor.on('workspace', renderWorkspace);
  editor.on('catalog', renderCatalog);
  onPacksChange(() => renderCatalog());
  onRobotType(() => renderCatalog());
  editor.on('select', renderWorkspace);
  renderCatalog(); renderWorkspace();
  return { setCollapsed };
}
