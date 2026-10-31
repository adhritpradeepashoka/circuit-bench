// Part Creator: make your own component — by hand (name, look, pins, what it does) or by describing it to the
// AI, which fills in the same form. Either way the result is a declarative spec checked by validatePartSpec()
// (src/core/custom-parts.js): it can only describe a part, never run code. Saved parts live in "My parts"
// (this browser) and travel inside any project that uses them.
import { BEHAVIOURS, PACKAGES, validatePartSpec, registerCustomPart, customTypes, newCustomId } from '../core/custom-parts.js';
import { FUNCTIONS } from '../core/expr.js';
import { PART_DEFS } from '../core/parts.js';
import { LED_COLORS } from '../core/led-colors.js';
import { customPartSVG } from '../parts/elements.js';
import { createPart as defaultCreatePart, getStoredKey, setStoredKey, getStoredProvider, setStoredProvider, getStoredModel, setStoredModel, PROVIDER_INFO, PROVIDER_IDS } from '../sim/ai-client.mjs';

const LIBRARY = 'circuitbench:my-parts';
const clone = o => JSON.parse(JSON.stringify(o));
const SIDES = [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']];

export function loadLibrary(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(LIBRARY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveLibrary(list, storage = globalThis.localStorage) { try { storage.setItem(LIBRARY, JSON.stringify(list)); } catch { /* full / blocked */ } }

/** Put a finished spec in My parts (this browser) and in the live catalogue. Used by the PCB importer. */
export function addToLibrary(spec) {
  registerCustomPart(spec);
  saveLibrary(loadLibrary().filter(s => s.id !== spec.id).concat([spec]));
}

const blank = () => ({
  id: newCustomId(), package: 'module', name: '', label: '', description: '', color: '#2b6cb0', textColor: '#ffffff', breadboard: false,
  pins: [{ id: 'VCC', label: 'Power', side: 'bottom' }, { id: 'GND', label: 'Ground', side: 'bottom' }, { id: 'OUT', label: 'Signal out', side: 'bottom' }],
  behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'OUT' } },
});

import { activeWorkspace } from '../core/workspaces.js';
export function initPartCreator(editor, { createPart = defaultCreatePart } = {}) {
  const $ = id => document.getElementById(id);
  const modal = $('partModal'), pinsEl = $('pcPins'), rolesEl = $('pcRoles'), kindSel = $('pcKind');
  let draft = blank(), editing = null, aiBusy = null;

  // Everything in the library is part of the catalogue from the start.
  for (const raw of loadLibrary()) { const v = validatePartSpec(raw); if (v.ok) registerCustomPart(v.spec); }

  $('pcPackage').replaceChildren(...Object.entries(PACKAGES).filter(([, v]) => !v.hidden).map(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; return o; }));
  const KIND_GROUPS = [
    ['Basics', ['none', 'resistor', 'variable-resistor', 'led', 'led-array', 'switch', 'button']],
    ['Diodes, transistors & power', ['diode', 'npn', 'pnp', 'nmos', 'pmos', 'regulator', 'opamp', 'inamp', 'relay', 'capacitor', 'inductor']],
    ['Sound, motors & motion', ['buzzer', 'motor', 'hbridge', 'servo', 'stepper', 'bldc', 'bldc-esc']],
    ['Sensors & inputs', ['analog-sensor', 'digital-sensor', 'ultrasonic', 'encoder', 'signal-source']],
    ['Chips', ['mux', 'logic']],
  ];
  const kindOption = k => { const o = document.createElement('option'); o.value = k; o.textContent = BEHAVIOURS[k].label; return o; };
  const grouped = new Set(KIND_GROUPS.flatMap(([, ks]) => ks));
  kindSel.replaceChildren(...KIND_GROUPS.map(([name, ks]) => { const g = document.createElement('optgroup'); g.label = name; g.append(...ks.filter(k => BEHAVIOURS[k]).map(kindOption)); return g; }),
    ...Object.keys(BEHAVIOURS).filter(k => !grouped.has(k)).map(kindOption));

  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  function paintPins() {
    pinsEl.replaceChildren(...draft.pins.map((p, i) => {
      const row = el('div', { className: 'pc-pin' });
      const id = el('input', { value: p.id, maxLength: 12, placeholder: 'Name', ariaLabel: `Pin ${i + 1} name` });
      const label = el('input', { value: p.label === p.id ? '' : p.label, maxLength: 40, placeholder: 'What it is for', ariaLabel: `Pin ${i + 1} purpose` });
      const dip = !!PACKAGES[draft.package]?.auto;
      // On a DIP the datasheet's pin number decides where a leg goes, so the side is shown, not chosen.
      const side = dip
        ? el('span', { className: 'pc-pin-no', textContent: `pin ${i + 1}`, title: 'The datasheet numbering decides which side this leg is on' })
        : el('select', { ariaLabel: `Pin ${i + 1} side` });
      if (!dip) {
        for (const [v, t] of SIDES) side.append(el('option', { value: v, textContent: t }));
        side.value = p.side; side.disabled = draft.breadboard;
        side.addEventListener('change', () => { p.side = side.value; preview(); });
      }
      const del = el('button', { type: 'button', textContent: '×', title: 'Remove pin', ariaLabel: `Remove pin ${p.id}` });
      id.addEventListener('input', () => {
        const old = p.id; p.id = id.value.trim().replace(/\s+/g, '_');
        for (const r of Object.keys(draft.behaviour.roles)) if (draft.behaviour.roles[r] === old) draft.behaviour.roles[r] = p.id;
        for (const l of ['select', 'channels', 'segments', 'coils']) if (Array.isArray(draft.behaviour[l])) draft.behaviour[l] = draft.behaviour[l].map(v => (v === old ? p.id : v));
        paintRoles(); preview();
      });
      label.addEventListener('input', () => { p.label = label.value.trim() || p.id; preview(); });
      del.addEventListener('click', () => { draft.pins.splice(i, 1); paintPins(); paintRoles(); preview(); });
      row.append(id, label, side, del);
      return row;
    }));
  }

  function paintRoles() {
    const b = BEHAVIOURS[draft.behaviour.kind];
    kindSel.value = draft.behaviour.kind;
    $('pcKindNote').textContent = b.note;
    const fields = [...b.roles, ...(b.optional || [])].map(role => {
      const f = el('label', { className: 'pc-field' });
      const sel = el('select', { id: `pcRole-${role}` });
      sel.append(el('option', { value: '', textContent: (b.optional || []).includes(role) ? '— none —' : '— pick a pin —' }));
      for (const p of draft.pins) if (p.id) sel.append(el('option', { value: p.id, textContent: p.id }));
      sel.value = draft.behaviour.roles[role] || '';
      sel.addEventListener('change', () => { draft.behaviour.roles[role] = sel.value; preview(); });
      f.append(el('span', { textContent: b.roleLabels[role] }), sel);
      return f;
    });
    for (const [list, what] of Object.entries(b.lists || {})) {
      const f = el('label', { className: 'pc-field pc-wide' });
      const inp = el('input', { id: `pcList-${list}`, value: (draft.behaviour[list] || []).join(', '), placeholder: { select: 'S0, S1, S2, S3', channels: 'C0, C1, C2, …', segments: 'A1, A2, A3, …', coils: 'IN1, IN2, IN3, IN4' }[list] || '' });
      inp.addEventListener('input', () => { draft.behaviour[list] = inp.value.split(/[\s,]+/).filter(Boolean); preview(); });
      f.append(el('span', { textContent: `${what} (comma-separated)` }), inp); fields.push(f);
    }
    for (const p of b.params || []) {
      const f = el('label', { className: 'pc-field' });
      const cur = draft.behaviour[p.key] ?? p.def;
      let inp;
      if (p.options) {
        inp = el('select', { id: `pcParam-${p.key}` });
        for (const [v, t] of p.options) inp.append(el('option', { value: v, textContent: t }));
        inp.value = cur;
        inp.addEventListener('change', () => { draft.behaviour[p.key] = inp.value; preview(); });
      } else {
        inp = el('input', { id: `pcParam-${p.key}`, type: 'number', min: p.min, max: p.max, step: 'any', value: String(cur) });
        inp.addEventListener('input', () => { draft.behaviour[p.key] = Number(inp.value); preview(); });
      }
      f.append(el('span', { textContent: p.unit ? `${p.label} (${p.unit})` : p.label }), inp); fields.push(f);
    }
    if (draft.behaviour.kind === 'resistor') {
      const f = el('label', { className: 'pc-field' });
      const inp = el('input', { id: 'pcOhms', type: 'number', min: 1, max: 1e7, value: draft.behaviour.ohms ?? 1000 });
      inp.addEventListener('input', () => { draft.behaviour.ohms = Number(inp.value); preview(); });
      f.append(el('span', { textContent: 'Resistance (Ω)' }), inp); fields.push(f);
    }
    if (draft.behaviour.kind === 'led' || draft.behaviour.kind === 'led-array') {
      const f = el('label', { className: 'pc-field' });
      const sel = el('select', { id: 'pcLedColor' });
      for (const [k, c] of Object.entries(LED_COLORS)) sel.append(el('option', { value: k, textContent: c.name }));
      sel.value = draft.behaviour.color || 'red';
      sel.addEventListener('change', () => { draft.behaviour.color = sel.value; preview(); });
      f.append(el('span', { textContent: 'Light colour' }), sel); fields.push(f);
    }
    rolesEl.replaceChildren(...fields);
    paintLogic();
  }

  /** The rules editor: what the chip remembers, what changes it, and what it drives. */
  function paintLogic() {
    const host = $('pcLogic');
    if (draft.behaviour.kind !== 'logic') { host.replaceChildren(); return; }
    const b = draft.behaviour;
    b.vars ||= {}; b.rules ||= []; b.outputs ||= {}; b.analog ||= [];
    const redraw = () => { paintLogic(); preview(); };
    const expr = (value, placeholder, onChange) => {
      const i = el('input', { className: 'pc-expr', value: value ?? '', placeholder, spellcheck: false });
      i.addEventListener('input', () => { onChange(i.value); preview(); });
      return i;
    };
    const section = (title, hint, addLabel, onAdd) => {
      const h = el('div', { className: 'pc-pins-head' });
      const left = el('b', { textContent: title });
      if (hint) { const s = el('i', { textContent: ` ${hint}` }); left.append(s); }
      const add = el('button', { type: 'button', textContent: addLabel });
      add.addEventListener('click', () => { onAdd(); redraw(); });
      h.append(left, add);
      return h;
    };
    const rows = [];

    rows.push(section('Memory', 'what it remembers', '+ Add', () => {
      let n = 1; while (`n${n}` in draft.behaviour.vars) n++;
      draft.behaviour.vars[`n${n}`] = 0;
    }));
    for (const [name, value] of Object.entries(b.vars)) {
      const row = el('div', { className: 'pc-logic-row' });
      const nm = el('input', { value: name, maxLength: 24, placeholder: 'name', spellcheck: false });
      nm.addEventListener('change', () => {
        const next = nm.value.trim(); if (!next || next === name) return;
        const entries = Object.entries(draft.behaviour.vars).map(([k, v]) => [k === name ? next : k, v]);
        draft.behaviour.vars = Object.fromEntries(entries);
        for (const r of draft.behaviour.rules) if (name in (r.set || {})) { r.set[next] = r.set[name]; delete r.set[name]; }
        redraw();
      });
      const val = el('input', { type: 'number', value: String(value), title: 'Value at power-up' });
      val.addEventListener('input', () => { draft.behaviour.vars[name] = Number(val.value) || 0; preview(); });
      const del = el('button', { type: 'button', textContent: '×', ariaLabel: `Remove ${name}` });
      del.addEventListener('click', () => { delete draft.behaviour.vars[name]; redraw(); });
      row.append(nm, el('span', { className: 'pc-eq', textContent: 'starts at' }), val, del);
      rows.push(row);
    }

    rows.push(section('Rules', 'when this happens, set that', '+ Add', () => draft.behaviour.rules.push({ when: '', set: {} })));
    b.rules.forEach((rule, ri) => {
      const box = el('div', { className: 'pc-rule' });
      const head = el('div', { className: 'pc-logic-row' });
      head.append(el('span', { className: 'pc-eq', textContent: 'when' }), expr(rule.when, 'rising(CLK)', v => { rule.when = v; }));
      const delRule = el('button', { type: 'button', textContent: '×', ariaLabel: `Remove rule ${ri + 1}` });
      delRule.addEventListener('click', () => { draft.behaviour.rules.splice(ri, 1); redraw(); });
      head.append(delRule);
      box.append(head);
      for (const [name, e] of Object.entries(rule.set || {})) {
        const row = el('div', { className: 'pc-logic-row pc-set' });
        const sel = el('select', { ariaLabel: 'Which memory value' });
        for (const v of Object.keys(b.vars)) sel.append(el('option', { value: v, textContent: v }));
        sel.value = name;
        sel.addEventListener('change', () => { const val = rule.set[name]; delete rule.set[name]; rule.set[sel.value] = val; redraw(); });
        const del = el('button', { type: 'button', textContent: '×', ariaLabel: `Remove ${name}` });
        del.addEventListener('click', () => { delete rule.set[name]; redraw(); });
        row.append(sel, el('span', { className: 'pc-eq', textContent: '=' }), expr(e, 'shift * 2 + DS', v => { rule.set[name] = v; }), del);
        box.append(row);
      }
      const addSet = el('button', { type: 'button', className: 'pc-mini', textContent: '+ set a memory value' });
      addSet.disabled = !Object.keys(b.vars).length;
      addSet.title = addSet.disabled ? 'Add a memory value first' : '';
      addSet.addEventListener('click', () => { const free = Object.keys(b.vars).find(v => !(v in rule.set)) || Object.keys(b.vars)[0]; rule.set[free] = ''; redraw(); });
      box.append(addSet);
      rows.push(box);
    });

    rows.push(section('Drives', 'what each pin puts out', '+ Add', () => {
      const free = draft.pins.find(p => !(p.id in draft.behaviour.outputs) && p.id !== draft.behaviour.roles.vcc && p.id !== draft.behaviour.roles.gnd);
      if (free) draft.behaviour.outputs[free.id] = '';
    }));
    for (const [pin, e] of Object.entries(b.outputs)) {
      const row = el('div', { className: 'pc-logic-row' });
      const sel = el('select', { ariaLabel: 'Which pin' });
      for (const p of draft.pins) sel.append(el('option', { value: p.id, textContent: p.id }));
      sel.value = pin;
      sel.addEventListener('change', () => { const v = draft.behaviour.outputs[pin]; delete draft.behaviour.outputs[pin]; draft.behaviour.outputs[sel.value] = v; redraw(); });
      const del = el('button', { type: 'button', textContent: '×', ariaLabel: `Stop driving ${pin}` });
      del.addEventListener('click', () => { delete draft.behaviour.outputs[pin]; draft.behaviour.analog = draft.behaviour.analog.filter(a => a !== pin); redraw(); });
      const an = el('input', { type: 'checkbox', checked: b.analog.includes(pin), title: 'Drive volts instead of HIGH/LOW' });
      an.addEventListener('change', () => { draft.behaviour.analog = an.checked ? [...draft.behaviour.analog, pin] : draft.behaviour.analog.filter(a => a !== pin); preview(); });
      const anLabel = el('label', { className: 'pc-analog', title: 'Drive volts instead of HIGH/LOW' });
      anLabel.append(an, el('span', { textContent: 'V' }));
      row.append(sel, el('span', { className: 'pc-eq', textContent: '=' }), expr(e, '(latch >> 0) & 1', v => { draft.behaviour.outputs[pin] = v; }), anLabel, del);
      rows.push(row);
    }

    rows.push(el('div', { className: 'pc-note', textContent: `In an expression: pin names (1 above half the supply), your memory names, numbers, + - * / % & | ^ ~ << >>, comparisons, ? :, and ${Object.keys(FUNCTIONS).join(', ')}. rising(PIN) is true on the edge that just happened.` }));
    host.replaceChildren(...rows);
  }

  function paintForm() {
    $('pcName').value = draft.name; $('pcLabel').value = draft.label === draft.name.slice(0, 16) ? '' : draft.label;
    $('pcColor').value = draft.color; $('pcTextColor').value = draft.textColor; $('pcDesc').value = draft.description || '';
    const shape = PACKAGES[draft.package] || PACKAGES.module;
    $('pcPackage').value = PACKAGES[draft.package] ? draft.package : 'module';
    $('pcBreadboard').checked = !!draft.breadboard;
    $('pcBreadboard').closest('.pc-check').hidden = shape.auto;   // a chip's package already decides this
    const short = shape.step && draft.pins.length % shape.step ? ` — needs a multiple of ${shape.step}` : '';
    $('pcPinsHint').textContent = shape.auto ? `${shape.hint}${short}` : '';
    paintPins(); paintRoles(); preview();
  }

  /** Re-validate and redraw. The preview shows even an incomplete part, with what's missing listed beside it. */
  function preview() {
    const v = validatePartSpec({ ...draft, label: draft.label || draft.name }, { id: draft.id });
    const errs = $('pcErrors');
    errs.replaceChildren(...(v.ok ? [] : v.errors.map(t => el('li', { textContent: t }))));
    $('pcSave').disabled = !v.ok;
    const shown = v.ok ? v.spec : { ...draft, name: draft.name || 'My part', label: draft.label || draft.name || 'My part', pins: draft.pins.filter(p => /^[A-Za-z0-9+\-_.]{1,12}$/.test(p.id)) };
    const svg = shown.pins.length ? customPartSVG(shown) : '';
    $('pcPreview').innerHTML = svg.replace(/width="([\d.]+)" height="([\d.]+)"/, (m, w, h) => `width="${w * 2}" height="${h * 2}"`);
    return v;
  }

  function open(type = null, prefill = null) {
    if (typeof paintProvider === 'function') paintProvider();
    editing = type && PART_DEFS[type]?.custom ? type : null;
    draft = editing ? clone(PART_DEFS[editing].spec) : prefill?.spec ? { ...blank(), ...clone(prefill.spec), id: newCustomId() } : blank();
    $('partTitle').textContent = editing ? `Edit “${PART_DEFS[editing].name}”` : 'Create a part';
    $('pcSave').textContent = editing ? 'Save changes' : 'Save & place';
    $('pcDelete').hidden = !editing;
    $('pcAiStatus').textContent = ''; $('pcAiStatus').className = 'pc-ai-status';
    paintForm();
    lastPhoto = null; $('pcPhoto').hidden = true; $('pcFix').hidden = true;
    modal.hidden = false;
    if (!editing && prefill?.name) {
      const n = String(prefill.name).slice(0, 40);
      draft.name = n; draft.label = n.slice(0, 16); $('pcName').value = n;
      $('pcDescribe').value = `${n}. Look up its datasheet, pinout and photo.`;
      preview();
    }
    (editing ? $('pcName') : $('pcDescribe')).focus();
    if (!editing && prefill?.ask) askAi();
  }
  function close() { modal.hidden = true; aiBusy?.abort(); aiBusy = null; }

  function save() {
    const v = preview();
    if (!v.ok) return;
    const spec = v.spec;
    registerCustomPart(spec);
    const lib = loadLibrary().filter(s => s.id !== spec.id); lib.push(spec); saveLibrary(lib);
    editor.emit('catalog');
    if (editing) { editor.refreshPartType(spec.id); editor.status(`Updated “${spec.name}” everywhere it's used`); }
    else { editor.addPart(spec.id); editor.status(`“${spec.name}” is in My parts — and on your workbench`); }
    close();
  }

  function removeFromLibrary() {
    if (!editing) return;
    saveLibrary(loadLibrary().filter(s => s.id !== editing));
    const inUse = editor.state.parts.some(p => p.type === editing);
    if (!inUse) delete PART_DEFS[editing];
    editor.emit('catalog');
    editor.status(inUse ? 'Removed from My parts (the copies in this project stay)' : 'Removed from My parts');
    close();
  }

  // Which AI makes the part: the same provider / keys / model as the chat (they share the one saved setting)
  const provSel = $('pcProvider'), provModel = $('pcModel'), provKey = $('pcKey'), provGet = $('pcGetKey');
  function paintProvider() {
    const cur = getStoredProvider(), info = PROVIDER_INFO[cur];
    provSel.replaceChildren(...PROVIDER_IDS.map(id => el('option', { value: id, textContent: `${PROVIDER_INFO[id].label}${getStoredKey(id) ? ' ✓' : ' (no key)'}`, selected: id === cur })));
    provModel.placeholder = `Model (optional, default ${info.model})`; provModel.value = getStoredModel(cur);
    const need = !getStoredKey(cur);
    provKey.hidden = !need; provGet.hidden = !need; provKey.value = '';
    provGet.href = info.keyUrl; provGet.textContent = `Get a ${info.label} key ↗`;
  }
  provSel.addEventListener('change', () => { setStoredProvider(provSel.value); paintProvider(); });
  provModel.addEventListener('change', () => setStoredModel(provModel.value.trim()));
  provKey.addEventListener('input', () => { const v = provKey.value.trim(); if (/^[\w.-]{20,}$/.test(v)) { setStoredKey(v); paintProvider(); $('pcAiStatus').textContent = `${PROVIDER_INFO[getStoredProvider()].label} key saved — only in this browser.`; $('pcAiStatus').className = 'pc-ai-status'; } });
  paintProvider();

  let lastPhoto = null;
  async function askAi(opts = {}) {
    const description = $('pcDescribe').value.trim();
    const status = $('pcAiStatus');
    if (!description) { status.textContent = 'Describe the part first — what it is and which pins it has.'; status.className = 'pc-ai-status bad'; return; }
    aiBusy?.abort(); aiBusy = new AbortController();
    setStoredModel(provModel.value.trim());
    $('pcAiGo').disabled = true; status.className = 'pc-ai-status'; status.textContent = `Designing your part with ${PROVIDER_INFO[getStoredProvider()].label}…`;
    let res;
    const refine = opts.refine ? { spec: JSON.stringify(opts.refine.spec), instruction: opts.refine.instruction } : null;
    try { res = await createPart({ description, workspace: activeWorkspace().id, refine, photoUrl: opts.photoUrl || '', signal: aiBusy.signal }); } catch (err) { if (err?.name === 'AbortError') return; res = { ok: false, error: String(err?.message || err) }; }
    finally { $('pcAiGo').disabled = false; }
    if (!res?.ok && res?.needsKey) { paintProvider(); provKey.focus(); res = { ...res, error: `Paste your ${PROVIDER_INFO[getStoredProvider()].label} key above (or pick a provider that has one), then try again.` }; }
    if (!res?.ok) { status.textContent = res?.error || 'The AI could not make that part.'; status.className = 'pc-ai-status bad'; return; }
    const keepId = draft.id;
    draft = { ...clone(res.spec), id: editing || keepId };
    paintForm();
    lastPhoto = res.photo || null;
    $('pcPhoto').hidden = !lastPhoto; $('pcFix').hidden = false; $('pcFixText').value = '';
    if (lastPhoto) { $('pcPhotoImg').src = lastPhoto.url; $('pcPhotoCap').textContent = lastPhoto.grounded ? 'The real part: the drawing was traced from this photo. Compare them.' : 'The real part (the AI could not look at it, so check the drawing against it).'; }
    status.replaceChildren(el('span', { textContent: `Here it is — check the pins, then save.${res.meta ? ` (${res.meta.provider} · ${res.meta.model} · ${(res.meta.ms / 1000).toFixed(1)} s)` : ''}${res.note ? ` Note: ${res.note}` : ''}` }));
    if (res.sources?.length) {
      const list = el('span', { className: 'pc-sources' });
      list.append(el('span', { textContent: ' Looked at: ' }));
      res.sources.slice(0, 4).forEach((s, i) => {
        if (i) list.append(el('span', { textContent: ', ' }));
        const a = el('a', { href: s.url, textContent: s.title || s.url, target: '_blank', rel: 'noreferrer noopener' });
        list.append(a);
      });
      status.append(list);
    }
  }

  $('pcName').addEventListener('input', e => { draft.name = e.target.value; preview(); });
  $('pcLabel').addEventListener('input', e => { draft.label = e.target.value; preview(); });
  $('pcColor').addEventListener('input', e => { draft.color = e.target.value; preview(); });
  $('pcTextColor').addEventListener('input', e => { draft.textColor = e.target.value; preview(); });
  $('pcDesc').addEventListener('input', e => { draft.description = e.target.value; preview(); });
  $('pcPackage').addEventListener('change', e => {
    const shape = PACKAGES[e.target.value] ? e.target.value : 'module';
    draft.package = shape;
    if (PACKAGES[shape].auto) { draft.breadboard = !!PACKAGES[shape].insert; for (const p of draft.pins) p.side = 'bottom'; }
    paintForm();
  });
  $('pcBreadboard').addEventListener('change', e => {
    draft.breadboard = e.target.checked;
    if (draft.breadboard) for (const p of draft.pins) p.side = 'bottom';
    paintPins(); preview();
  });
  kindSel.addEventListener('change', () => {
    const kind = kindSel.value, roles = {};
    BEHAVIOURS[kind].roles.forEach((r, i) => { roles[r] = draft.pins.find(p => p.id.toLowerCase() === r)?.id || draft.pins[i]?.id || ''; });
    const byNum = re => draft.pins.filter(p => re.test(p.id)).sort((a, c) => +a.id.replace(/\D/g, '') - +c.id.replace(/\D/g, '')).map(p => p.id);
    if (kind === 'mux') {                    // guess the usual CD74HC4067 / 74HC4051 names
      const pick = re => draft.pins.find(p => re.test(p.id))?.id || '';
      Object.assign(roles, { vcc: pick(/^(vcc|vdd|5v)$/i), gnd: pick(/^(gnd|vss)$/i), common: pick(/^(sig|z|com|common)$/i) });
      const en = pick(/^(en|e|inh)$/i); if (en) roles.enable = en;
    }
    const GUESS = {
      vcc: /^(vcc|vdd|5v|3v3|\+5v?|v\+|vin)$/i, gnd: /^(gnd|vss|0v|-|−)$/i, anode: /^(a|anode|\+)$/i, cathode: /^(k|c|cathode|-)$/i,
      base: /^b(ase)?$/i, collector: /^c(ollector)?$/i, emitter: /^e(mitter)?$/i, gate: /^g(ate)?$/i, drain: /^d(rain)?$/i, source: /^s(ource)?$/i,
      vin: /^(in|vin|input)$/i, out: /^(out|vout|output|sig|signal|ao)$/i, signal: /^(sig|signal|pwm|ctrl)$/i, trig: /^trig/i, echo: /^echo/i,
      coilA: /^(c\+|coil\+|coila|a1)$/i, coilB: /^(c-|coil-|coilb|a2)$/i, common: /^(com|common|c|sig|z)$/i, no: /^no$/i, nc: /^nc$/i,
      throw1: /^(t1|throw1|nc|1)$/i, throw2: /^(t2|throw2|no|3)$/i, wiper: /^(w|wiper|sig)$/i, sw: /^sw/i,
    };
    for (const role of [...BEHAVIOURS[kind].roles, ...(BEHAVIOURS[kind].optional || [])]) {
      const hit = GUESS[role] && draft.pins.find(p => GUESS[role].test(p.id) && !Object.values(roles).includes(p.id));
      if (hit && !(role in roles && roles[role] === hit.id)) roles[role] = hit.id;
    }
    const params = Object.fromEntries((BEHAVIOURS[kind].params || []).map(p => [p.key, p.def]));
    draft.behaviour = { kind, roles, ...params, ...(kind === 'resistor' ? { ohms: 1000 } : {}), ...(kind === 'led' || kind === 'led-array' ? { color: kind === 'led' ? 'red' : 'green' } : {}),
      ...(kind === 'led-array' ? { segments: draft.pins.filter(p => !Object.values(roles).includes(p.id)).map(p => p.id) } : {}),
      ...(kind === 'stepper' ? { coils: draft.pins.filter(p => /^in?[1-4]$/i.test(p.id)).map(p => p.id) } : {}),
      ...(kind === 'mux' ? { select: byNum(/^S\d+$/i), channels: byNum(/^(C|Y|CH)\d+$/i) } : {}) };
    paintRoles(); preview();
  });
  $('pcAddPin').addEventListener('click', () => {
    let n = draft.pins.length + 1; while (draft.pins.some(p => p.id === `P${n}`)) n++;
    draft.pins.push({ id: `P${n}`, label: `P${n}`, side: draft.breadboard ? 'bottom' : 'right' });
    paintPins(); paintRoles(); preview();
    pinsEl.lastElementChild?.querySelector('input')?.select();
  });
  $('pcAiGo').addEventListener('click', () => askAi());
  const fix = () => { const t = $('pcFixText').value.trim(); if (t) askAi({ refine: { spec: draft, instruction: t }, photoUrl: lastPhoto?.url || '' }); };
  $('pcFixGo').addEventListener('click', fix);
  $('pcFixText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fix(); } });
  $('pcDescribe').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAi(); } });
  $('pcSave').addEventListener('click', save);
  $('pcCancel').addEventListener('click', close);
  $('partClose').addEventListener('click', close);
  $('pcDelete').addEventListener('click', removeFromLibrary);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  editor.on('create-part', arg => open(null, arg && typeof arg === 'object' ? arg : null));
  editor.on('edit-part', type => open(type));
  editor.emit('catalog');
  return { open, close, isOpen: () => !modal.hidden, library: () => loadLibrary(), customTypes };
}
