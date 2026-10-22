// Part Creator: make your own component — by hand (name, look, pins, what it does) or by describing it to the
// AI, which fills in the same form. Either way the result is a declarative spec checked by validatePartSpec()
// (src/core/custom-parts.js): it can only describe a part, never run code. Saved parts live in "My parts"
// (this browser) and travel inside any project that uses them.
import { BEHAVIOURS, PACKAGES, validatePartSpec, registerCustomPart, customTypes, newCustomId } from '../core/custom-parts.js';
import { FUNCTIONS } from '../core/expr.js';
import { PART_DEFS } from '../core/parts.js';
import { LED_COLORS } from '../core/led-colors.js';
import { customPartSVG } from '../parts/elements.js';
import { createPart as defaultCreatePart } from '../sim/ai-client.mjs';

const LIBRARY = 'circuitbench:my-parts';
const clone = o => JSON.parse(JSON.stringify(o));
const SIDES = [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']];

export function loadLibrary(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(LIBRARY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveLibrary(list, storage = globalThis.localStorage) { try { storage.setItem(LIBRARY, JSON.stringify(list)); } catch { /* full / blocked */ } }

const blank = () => ({
  id: newCustomId(), package: 'module', name: '', label: '', description: '', color: '#2b6cb0', textColor: '#ffffff', breadboard: false,
  pins: [{ id: 'VCC', label: 'Power', side: 'bottom' }, { id: 'GND', label: 'Ground', side: 'bottom' }, { id: 'OUT', label: 'Signal out', side: 'bottom' }],
  behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'OUT' } },
});

export function initPartCreator(editor, { createPart = defaultCreatePart } = {}) {
  const $ = id => document.getElementById(id);
  const modal = $('partModal'), pinsEl = $('pcPins'), rolesEl = $('pcRoles'), kindSel = $('pcKind');
  let draft = blank(), editing = null, aiBusy = null;

  // Everything in the library is part of the catalogue from the start.
  for (const raw of loadLibrary()) { const v = validatePartSpec(raw); if (v.ok) registerCustomPart(v.spec); }

  $('pcPackage').replaceChildren(...Object.entries(PACKAGES).map(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; return o; }));
  kindSel.replaceChildren(...Object.entries(BEHAVIOURS).map(([k, b]) => { const o = document.createElement('option'); o.value = k; o.textContent = b.label; return o; }));

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
        for (const l of ['select', 'channels']) if (Array.isArray(draft.behaviour[l])) draft.behaviour[l] = draft.behaviour[l].map(v => (v === old ? p.id : v));
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
      const inp = el('input', { id: `pcList-${list}`, value: (draft.behaviour[list] || []).join(', '), placeholder: list === 'select' ? 'S0, S1, S2, S3' : 'C0, C1, C2, …' });
      inp.addEventListener('input', () => { draft.behaviour[list] = inp.value.split(/[\s,]+/).filter(Boolean); preview(); });
      f.append(el('span', { textContent: `${what} (comma-separated)` }), inp); fields.push(f);
    }
    if (draft.behaviour.kind === 'resistor') {
      const f = el('label', { className: 'pc-field' });
      const inp = el('input', { id: 'pcOhms', type: 'number', min: 1, max: 1e7, value: draft.behaviour.ohms ?? 1000 });
      inp.addEventListener('input', () => { draft.behaviour.ohms = Number(inp.value); preview(); });
      f.append(el('span', { textContent: 'Resistance (Ω)' }), inp); fields.push(f);
    }
    if (draft.behaviour.kind === 'led') {
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

  function open(type = null) {
    editing = type && PART_DEFS[type]?.custom ? type : null;
    draft = editing ? clone(PART_DEFS[editing].spec) : blank();
    $('partTitle').textContent = editing ? `Edit “${PART_DEFS[editing].name}”` : 'Create a part';
    $('pcSave').textContent = editing ? 'Save changes' : 'Save & place';
    $('pcDelete').hidden = !editing;
    $('pcAiStatus').textContent = ''; $('pcAiStatus').className = 'pc-ai-status';
    paintForm();
    modal.hidden = false;
    (editing ? $('pcName') : $('pcDescribe')).focus();
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

  async function askAi() {
    const description = $('pcDescribe').value.trim();
    const status = $('pcAiStatus');
    if (!description) { status.textContent = 'Describe the part first — what it is and which pins it has.'; status.className = 'pc-ai-status bad'; return; }
    aiBusy?.abort(); aiBusy = new AbortController();
    $('pcAiGo').disabled = true; status.className = 'pc-ai-status'; status.textContent = 'Designing your part…';
    let res;
    try { res = await createPart({ description, signal: aiBusy.signal }); } catch (err) { if (err?.name === 'AbortError') return; res = { ok: false, error: String(err?.message || err) }; }
    finally { $('pcAiGo').disabled = false; }
    if (!res?.ok) { status.textContent = res?.error || 'The AI could not make that part.'; status.className = 'pc-ai-status bad'; return; }
    const keepId = draft.id;
    draft = { ...clone(res.spec), id: editing || keepId };
    paintForm();
    status.replaceChildren(el('span', { textContent: `Here it is — check the pins, then save.${res.note ? ` Note: ${res.note}` : ''}` }));
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
    draft.behaviour = { kind, roles, ...(kind === 'resistor' ? { ohms: 1000 } : {}), ...(kind === 'led' ? { color: 'red' } : {}),
      ...(kind === 'mux' ? { select: byNum(/^S\d+$/i), channels: byNum(/^(C|Y|CH)\d+$/i) } : {}) };
    paintRoles(); preview();
  });
  $('pcAddPin').addEventListener('click', () => {
    let n = draft.pins.length + 1; while (draft.pins.some(p => p.id === `P${n}`)) n++;
    draft.pins.push({ id: `P${n}`, label: `P${n}`, side: draft.breadboard ? 'bottom' : 'right' });
    paintPins(); paintRoles(); preview();
    pinsEl.lastElementChild?.querySelector('input')?.select();
  });
  $('pcAiGo').addEventListener('click', askAi);
  $('pcDescribe').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAi(); } });
  $('pcSave').addEventListener('click', save);
  $('pcCancel').addEventListener('click', close);
  $('partClose').addEventListener('click', close);
  $('pcDelete').addEventListener('click', removeFromLibrary);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  editor.on('create-part', () => open());
  editor.on('edit-part', type => open(type));
  editor.emit('catalog');
  return { open, close, isOpen: () => !modal.hidden, library: () => loadLibrary(), customTypes };
}
