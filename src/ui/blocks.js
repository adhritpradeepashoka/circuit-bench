// Block coding in the code dock. Blockly is loaded the first time Blocks mode is opened (it is big), everything else about
// blocks — what they are, how they become a sketch — lives in src/core/blocks*.js and is tested without a browser.
//
// The blocks write sketch.ino for you: every change regenerates the main file, so "Verify" and "Run" work exactly as they do for
// typed code, and a child can flip to Code to see (and later edit) what their blocks made.
import { describeBench, deviceOptions, pinLabel } from '../core/bench-devices.js';
import { BLOCKS, generateSketch, emptyMayReplace } from '../core/blocks.js';
import { buildToolbox, starterProgram } from '../core/blocks-toolbox.js';
import { DEFAULT_SKETCH } from '../sim/examples.js';

const $ = id => document.getElementById(id);

export function initBlocks({ editor, code }) {
  const dock = $('codeDock'), body = $('codeBody'), pane = $('blocksPane');
  const btns = { blocks: $('modeBlocks'), code: $('modeCode') };
  let mode = 'code', Blockly = null, ws = null, loading = null, bench = { devices: [], pins: [] }, benchKey = '', toolboxKey = '';
  let lastCode = null, ghosts = new Set(), quiet = false, savedHeight = null, msg = null, timer = 0, benchTimer = 0;

  const state = code.blocks;
  const fresh = !state && (code.source.trim() === DEFAULT_SKETCH.trim() || !code.source.trim());
  mode = state?.mode || (fresh ? 'blocks' : 'code');

  const say = (text, ms = 4000) => {
    if (!msg) return;
    msg.textContent = text || ''; msg.hidden = !text;
    clearTimeout(say.t); if (text && ms) say.t = setTimeout(() => { msg.hidden = true; }, ms);
  };

  /* ── mode switch ───────────────────────── */
  function paint() {
    for (const [k, b] of Object.entries(btns)) b.setAttribute('aria-pressed', String(mode === k));
    dock.classList.toggle('blocks-on', mode === 'blocks'); body.classList.toggle('blocks-on', mode === 'blocks'); pane.hidden = mode !== 'blocks';
  }
  async function setMode(next, { quiet: q = false } = {}) {
    if (next === mode && (next === 'code' || ws)) return;
    mode = next; paint();
    if (next === 'blocks') {
      const el = dock.style.getPropertyValue('--code-h'); savedHeight = el || null;
      const cur = parseInt(el, 10) || 260; if (cur < 400) dock.style.setProperty('--code-h', `${Math.min(440, Math.max(300, window.innerHeight - 260))}px`);
      if (!q || !dock.classList.contains('collapsed')) code.open();          // opening a project (quiet) must not pop the code panel over the circuit; a click on Blocks does
      try { await ensure(); } catch (err) { console.warn('[circuitbench] blocks failed to load', err); mode = 'code'; paint(); code.setBlocks({ program: code.blocks?.program || null, mode: 'code' }); editor.status('Blocks could not load — you can still type code'); return; }
      refreshBench(true); Blockly.svgResize(ws); regenerate(true);
    } else if (savedHeight !== null) { dock.style.setProperty('--code-h', savedHeight); }
    if (!q) code.setBlocks({ program: ws ? save() : code.blocks?.program || null, mode });
  }
  for (const b of Object.values(btns)) b.addEventListener('click', () => setMode(b.dataset.mode));

  /* ── the Blockly workspace ─────────────── */
  const save = () => Blockly.serialization.workspaces.save(ws);

  function ensure() {
    if (ws) return Promise.resolve();
    return (loading ||= (async () => {
      const [B, en] = await Promise.all([import('blockly'), import('blockly/msg/en'), import('blockly/blocks')]);
      Blockly = B.default?.inject ? B.default : B;
      Blockly.setLocale(en.default || en);
      defineBlocks();
      Blockly.Themes.circuitbench = Blockly.Theme.defineTheme('circuitbench', {
        name: 'circuitbench', base: Blockly.Themes.Classic,
        componentStyles: { workspaceBackgroundColour: '#1b2328', toolboxBackgroundColour: '#12181b', toolboxForegroundColour: '#dce6e1', flyoutBackgroundColour: '#232e35', flyoutForegroundColour: '#dce6e1', flyoutOpacity: 0.98, scrollbarColour: '#4a5d66', insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3 },
        fontStyle: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', weight: '600', size: 12 },
      });
      pane.textContent = '';
      const host = document.createElement('div'); host.className = 'blocks-host'; host.style.cssText = 'position:absolute;inset:0';
      pane.append(host);
      ws = Blockly.inject(host, {
        toolbox: buildToolbox(bench), renderer: 'zelos', theme: Blockly.Themes.circuitbench, sounds: false,
        grid: { spacing: 24, length: 2, colour: '#2a363d', snap: true }, zoom: { controls: false, wheel: true, startScale: 0.95, minScale: 0.5, maxScale: 1.6 },
        move: { scrollbars: true, drag: true, wheel: false }, trashcan: false,
      });
      ws.registerToolboxCategoryCallback('VARIABLE', variableFlyout);
      ws.registerButtonCallback('CB_MAKEVAR', () => Blockly.Variables.createVariableButtonHandler(ws, null, ''));
      const tools = document.createElement('div'); tools.className = 'blocks-tools';
      tools.innerHTML = '<button type="button" data-a="start" title="Start from a small program for the parts on your bench">✨ Start from my circuit</button><button type="button" data-a="clear" title="Remove every block">Clear</button>';
      tools.addEventListener('click', e => { const a = e.target.closest('button')?.dataset.a; if (a === 'start') start(); if (a === 'clear') clear(); });
      msg = document.createElement('div'); msg.className = 'blocks-msg'; msg.hidden = true; msg.setAttribute('role', 'status');
      pane.append(tools, msg);
      ws.addChangeListener(e => { if (e.isUiEvent || quiet) return; clearTimeout(timer); timer = setTimeout(() => { persistProgram(); regenerate(); }, 120); });
      new ResizeObserver(() => { if (mode === 'blocks') Blockly.svgResize(ws); }).observe(pane);
      load(code.blocks?.program);
    })());
  }

  /** Blockly's own variable blocks, with number boxes already in them. */
  function variableFlyout(w) {
    const out = [{ kind: 'button', text: 'Make a variable', callbackKey: 'CB_MAKEVAR' }];
    const vars = w.getVariableMap().getAllVariables();
    if (!vars.length) return out;
    const f = v => ({ id: v.getId(), name: v.getName(), type: v.getType() });
    out.push({ kind: 'block', type: 'variables_set', fields: { VAR: f(vars[0]) }, inputs: { VALUE: { shadow: { type: 'cb_number', fields: { NUM: 0 } } } } });
    out.push({ kind: 'block', type: 'math_change', fields: { VAR: f(vars[0]) }, inputs: { DELTA: { shadow: { type: 'cb_number', fields: { NUM: 1 } } } } });
    for (const v of vars) out.push({ kind: 'block', type: 'variables_get', fields: { VAR: f(v) } });
    return out;
  }

  function defineBlocks() {
    const defs = [];
    for (const [type, b] of Object.entries(BLOCKS)) {
      if (!b.json) continue;
      const json = JSON.parse(JSON.stringify(b.json));
      const devArg = (json.args0 || []).findIndex(a => a._dev), pinArg = (json.args0 || []).findIndex(a => a._pin);
      const kind = devArg >= 0 ? json.args0[devArg]._dev : null;
      if (devArg >= 0) json.args0[devArg] = { type: 'field_dropdown', name: 'DEV', options: [['(none on the bench)', '']] };
      if (pinArg >= 0) json.args0[pinArg] = { type: 'field_dropdown', name: 'PIN', options: [['(no board)', '']] };
      defs.push({ ...json, _kind: kind });
    }
    for (const j of defs) {
      const kind = j._kind; delete j._kind;
      Blockly.Blocks[j.type] = {
        init() {
          this.jsonInit(j);
          const d = this.getField('DEV');
          if (d) d.menuGenerator_ = () => withGhosts(deviceOptions(bench, kind));
          const p = this.getField('PIN');
          if (p) p.menuGenerator_ = () => (bench.pins.length ? bench.pins.map(x => [`${pinLabel(x)}${x.pwm ? ' ~' : ''}`, x.name]) : [['(no board)', '']]);
        },
      };
    }
  }
  /** A part that was on the bench when the program was saved but is not now stays selectable, so loading never silently re-targets a block. */
  const withGhosts = opts => {
    const have = new Set(opts.map(o => o[1])); const extra = [...ghosts].filter(g => !have.has(g)).map(g => ['(part removed)', g]);
    return opts[0]?.[1] === '' ? (extra.length ? extra : opts) : [...opts, ...extra];
  };

  /* ── loading, saving, generating ───────── */
  function load(program) {
    quiet = true;
    try {
      ws.clear(); ghosts = new Set();
      const walk = n => { if (!n || typeof n !== 'object') return; if (typeof n.fields?.DEV === 'string') ghosts.add(n.fields.DEV); for (const i of Object.values(n.inputs || {})) { walk(i.block); walk(i.shadow); } walk(n.next?.block); };
      for (const b of program?.blocks?.blocks || []) walk(b);
      if (program?.blocks?.blocks?.length) Blockly.serialization.workspaces.load(program, ws);
    } catch (err) { console.warn('[circuitbench] could not load blocks', err); try { ws.clear(); } catch { /* ignore */ } }
    quiet = false;
  }
  function persistProgram() { if (ws) code.setBlocks({ program: save(), mode }); }

  function regenerate(force = false) {
    if (!ws || mode !== 'blocks') return;
    const program = save();
    const res = generateSketch(program, bench);
    const per = new Map();
    for (const w of res.warnings) if (w.block) per.set(w.block, [...(per.get(w.block) || []), w.text]);
    for (const b of ws.getAllBlocks(false)) { const t = per.get(b.id); if (t || b.getWarningText?.()) b.setWarningText(t ? t.join('\n') : null); }
    const general = res.warnings.filter(w => !w.block).map(w => w.text);
    if (res.empty) say('Drag blocks in from the left. Put them inside “forever” to make them run again and again.', 0);
    else if (general.length) say(general[0], 6000);
    else if (!msg.hidden) say('');
    if (force || res.code !== lastCode) {
      lastCode = res.code;
      if (res.empty && !emptyMayReplace(code.source, force)) return;       // an empty workspace never wipes a sketch the blocks did not write
      if (code.source !== res.code) code.source = res.code;
    }
  }

  function start() {
    const s = starterProgram(bench);
    if (!s) return;
    if (ws.getAllBlocks(false).length && !confirm('Replace your blocks with a fresh starter program?')) return;
    load(s); persistProgram(); regenerate(true);
    say(bench.devices.length ? 'Here is a starter for your circuit. Change it however you like!' : 'Nothing is wired to the board yet, so this starter just talks. Wire up a light or a button and press ✨ again.', 6000);
  }
  function clear() {
    if (ws.getAllBlocks(false).length > 3 && !confirm('Remove every block?')) return;
    load(null); persistProgram(); regenerate(true);
  }

  /* ── follow the circuit ────────────────── */
  function refreshBench(force = false) {
    let next;
    try { next = describeBench(editor.state.parts, editor.getCircuit()); } catch (err) { console.warn('[circuitbench] bench scan failed', err); return; }
    const key = JSON.stringify([next.board?.id, next.devices.map(d => [d.id, d.label, d.kind, d.warn.length, Object.entries(d.pins).map(([r, p]) => [r, p?.name])]), next.pins.map(p => p.name)]);
    if (!force && key === benchKey) return;
    benchKey = key; bench = next;
    if (!ws) return;
    // labels in already-placed blocks follow the new names (LED numbering, ⚠ marks)
    quiet = true;
    try {
      for (const b of ws.getAllBlocks(false)) {
        const f = b.getField('DEV'); if (!f) continue;
        const v = f.getValue(), o = f.getOptions(false).find(x => x[1] === v);
        if (o) { f.selectedOption = o; f.forceRerender?.(); }
      }
    } catch { /* cosmetic */ }
    quiet = false;
    const tb = JSON.stringify(buildToolbox(bench));
    if (tb !== toolboxKey) { toolboxKey = tb; try { ws.updateToolbox(JSON.parse(tb)); } catch { /* ignore */ } }
    regenerate();
  }
  editor.on('change', () => { clearTimeout(benchTimer); benchTimer = setTimeout(() => refreshBench(), 250); });

  /* ── the sketch changed under us ───────── */
  code.onChange(() => {                                  // typed in Code mode, loaded an example, the AI wrote code…
    // before Blockly has loaded there is no generated code yet: anything but the starter sketch was put there by someone else (the AI, an example)
    const foreign = lastCode !== null ? code.source !== lastCode : code.source.trim() !== '' && code.source.trim() !== DEFAULT_SKETCH.trim();
    if (mode === 'blocks' && foreign) { setMode('code'); editor.status('The code was changed outside the blocks, so you are now in Code mode'); }
  });
  code.onBlocks(() => {                                  // a project was opened
    const s = code.blocks;
    lastCode = null;
    if (ws) { load(s?.program); }
    setMode(s?.mode || (code.source.trim() === DEFAULT_SKETCH.trim() ? 'blocks' : 'code'), { quiet: true });
  });

  paint();
  if (mode === 'blocks') {
    // a fresh visitor sees the blocks as soon as the dock opens; the library loads in the background
    code.onFirstOpen(() => { if (mode !== 'blocks') return; mode = 'code'; setMode('blocks', { quiet: true }); });      // unless the sketch was replaced before the dock ever opened
  }
  return { setMode, get mode() { return mode; }, start, get workspace() { return ws; } };
}
