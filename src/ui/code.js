import { compileSketch as defaultCompile } from '../sim/compile-client.js';
import { DEFAULT_SKETCH, EXAMPLES } from '../sim/examples.js';
import { createTextEditor } from './editors/text-editor.js';

export { EXAMPLES };

const $ = id => document.getElementById(id);
const PROJECT_KEY = 'virtual-lab:v1:project';
const LEGACY_KEY = 'virtual-lab:v0.1:sketch';
const HEIGHT_KEY = 'virtual-lab:v0.1:code-height';
export const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(ino|h|hpp|c|cpp)$/;
const MAIN = 'sketch.ino';

const pct = (n, max) => (max ? Math.round((100 * n) / max) : 0);
const DIAG_RE = /^(\S+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):/;
export const NARROW_PX = 760;
const EOL = { none: '', nl: '\n', cr: '\r', crnl: '\r\n' };
const TEMPLATES = { h: '#pragma once\n\n', hpp: '#pragma once\n\n', c: '#include <Arduino.h>\n\n', cpp: '#include <Arduino.h>\n\n', ino: '\n' };

/**
 * The code dock: project files (tabs), the editor, compile orchestration, compiler output, Serial Monitor.
 * @param {{compile?: Function, editor?: object}} opts  compile(files, {signal}) → build result; editor = a CodeEditor implementation
 */
export function initCode({ compile = defaultCompile, editor = createTextEditor() } = {}) {
  const dock = $('codeDock'), status = $('codeStatus'), outPane = $('outputPane'), examples = $('codeExamples'), tabsEl = $('fileTabs');
  const listeners = { change: [], open: [], toggle: null };
  let ed = editor;
  const simpleEditor = editor;                              // always kept: the fallback if Monaco can't be used
  let files = [], active = MAIN;                         // the project: [{ name, content }] — first .ino is the main sketch
  let diagnostics = [];
  let running = false, runSnapshot = null, last = null, lastBuiltFrom = null, buildId = 0, controller = null;
  let onAiFix = null;                                      // set by the AI panel: "✨ Fix with AI" on a failed compile

  /* ── project state ────────────────────── */
  function loadProject() {
    try {
      const raw = localStorage.getItem(PROJECT_KEY);
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p.files) && p.files.length && p.files.every(f => FILE_NAME_RE.test(f.name) && typeof f.content === 'string') && !(p.files.length === 1 && !p.files[0].content.trim())) return p; }   // a lone empty file is treated as "nothing saved"
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && legacy.trim()) return { files: [{ name: MAIN, content: legacy }], active: MAIN };
    } catch { /* storage unavailable or corrupt */ }
    return { files: [{ name: MAIN, content: DEFAULT_SKETCH }], active: MAIN };
  }
  const persist = () => { try { localStorage.setItem(PROJECT_KEY, JSON.stringify({ files, active })); } catch { /* ignore */ } };
  const mainName = () => (files.find(f => f.name === MAIN) || files.find(f => f.name.endsWith('.ino')) || files[0]).name;
  const snapshot = () => JSON.stringify(files);
  const fileByName = n => files.find(f => f.name === n);

  examples.innerHTML = '<option value="">Examples…</option>' + Object.entries(EXAMPLES).map(([k, e]) => `<option value="${k}">${e.name}</option>`).join('');

  const setStatus = (text, cls = '') => { status.textContent = text; status.className = `code-status ${cls}`.trim(); };

  /* ── file tabs ────────────────────────── */
  let editing = null;                                      // { kind: 'new' } | { kind: 'rename', name }
  function renderTabs() {
    tabsEl.replaceChildren();
    const errorFiles = new Set(diagnostics.filter(d => d.severity === 'error').map(d => d.file));
    for (const f of files) {
      if (editing?.kind === 'rename' && editing.name === f.name) { tabsEl.append(nameInput(f.name)); continue; }
      const tab = document.createElement('div');
      tab.className = `ftab${f.name === active ? ' on' : ''}${errorFiles.has(f.name) ? ' has-error' : ''}`; tab.dataset.name = f.name;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(f.name === active));
      const label = document.createElement('button'); label.type = 'button'; label.className = 'ftab-name'; label.textContent = f.name; label.title = 'Double-click to rename';
      label.addEventListener('click', () => selectFile(f.name)); label.addEventListener('dblclick', () => { editing = { kind: 'rename', name: f.name }; renderTabs(); });
      tab.append(label);
      if (files.length > 1) { const x = document.createElement('button'); x.type = 'button'; x.className = 'ftab-x'; x.textContent = '×'; x.title = `Delete ${f.name}`; x.setAttribute('aria-label', `Delete ${f.name}`); x.addEventListener('click', () => removeFile(f.name)); tab.append(x); }
      tabsEl.append(tab);
    }
    if (editing?.kind === 'new') tabsEl.append(nameInput(''));
    else { const add = document.createElement('button'); add.type = 'button'; add.id = 'fileAdd'; add.className = 'ftab-add'; add.textContent = '+'; add.title = 'New file (.ino, .h, .cpp …)'; add.setAttribute('aria-label', 'New file'); add.addEventListener('click', () => { editing = { kind: 'new' }; renderTabs(); }); tabsEl.append(add); }
    tabsEl.querySelector('.ftab-input')?.focus();
  }
  function nameInput(value) {
    const i = document.createElement('input'); i.className = 'ftab-input'; i.value = value; i.placeholder = 'name.h'; i.spellcheck = false; i.setAttribute('aria-label', 'File name');
    const done = ok => {
      const mode = editing; editing = null;
      if (ok) { const err = mode.kind === 'new' ? addFile(i.value.trim()) : renameFile(mode.name, i.value.trim()); if (err) { setStatus(err, 'bad'); } }
      renderTabs();
    };
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    i.addEventListener('blur', () => { if (editing) done(true); });
    return i;
  }
  function nameError(name, except = null) {
    if (!FILE_NAME_RE.test(name)) return `“${name || ' '}” is not a valid file name — letters, digits, _ - . and one of .ino .h .hpp .c .cpp`;
    if (files.some(f => f.name === name && f.name !== except)) return `${name} already exists`;
    return null;
  }
  function selectFile(name) { if (!fileByName(name)) return; active = name; ed.showFile(name); persist(); renderTabs(); }
  function addFile(name) {
    if (!name) return null;
    const err = nameError(name); if (err) return err;
    files.push({ name, content: TEMPLATES[name.split('.').pop()] ?? '' }); ed.addFile(name, files[files.length - 1].content);
    selectFile(name); changed(); return null;
  }
  function removeFile(name) {
    if (files.length <= 1) return;
    const f = fileByName(name); if (!f) return;
    if (name === mainName() && files.filter(x => x.name.endsWith('.ino')).length === 1) { setStatus('A sketch needs at least one .ino file', 'bad'); return; }
    files = files.filter(x => x !== f); ed.removeFile(name);
    diagnostics = diagnostics.filter(d => d.file !== name);
    if (active === name) active = files[0].name;
    ed.showFile(active); ed.setMarkers(diagnostics); persist(); renderTabs(); changed();
  }
  function renameFile(from, to) {
    if (!to || to === from) return null;
    const err = nameError(to, from); if (err) return err;
    if (from.endsWith('.ino') && !to.endsWith('.ino') && files.filter(x => x.name.endsWith('.ino')).length === 1) return 'A sketch needs at least one .ino file';
    fileByName(from).name = to; ed.renameFile(from, to);
    diagnostics = diagnostics.map(d => (d.file === from ? { ...d, file: to } : d));
    if (active === from) active = to;
    persist(); renderTabs(); changed(); return null;
  }

  /* ── compiler output ──────────────────── */
  function head(text, cls) { const h = document.createElement('div'); h.className = `out-head ${cls}`; h.textContent = text; return h; }
  function renderOutput(res, busyText) {
    outPane.replaceChildren();
    if (busyText) { outPane.append(head(busyText, 'busy')); return; }
    if (!res) { const e = document.createElement('div'); e.className = 'out-empty'; e.textContent = 'Compiler output appears here. Press Verify to compile with Arduino CLI, or Run to compile and run.'; outPane.append(e); return; }
    const errors = res.diagnostics.filter(d => d.severity === 'error').length, warns = res.diagnostics.filter(d => d.severity === 'warning').length;
    if (res.ok) outPane.append(head(`Compiled successfully${res.prebuilt ? ' (prebuilt example)' : res.cached ? ' (cached)' : res.ms ? ` in ${(res.ms / 1000).toFixed(1)} s` : ''}${warns ? ` · ${warns} warning${warns > 1 ? 's' : ''}` : ''}`, 'ok'));
    else {
      const h = head(res.unreachable ? 'Compile service not reachable' : `Compilation failed · ${errors || 1} error${errors === 1 ? '' : 's'}${warns ? ` · ${warns} warning${warns > 1 ? 's' : ''}` : ''}`, 'bad');
      if (!res.unreachable && onAiFix) {
        const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'out-ai-fix'; fix.id = 'aiFixCompile'; fix.textContent = '✨ Fix with AI';
        fix.addEventListener('click', e => { e.stopPropagation(); onAiFix(); });
        h.append(fix);
      }
      outPane.append(h);
    }
    let ctx = false;
    for (const line of (res.output || '').replace(/\n+$/, '').split('\n')) {
      const el = document.createElement('span'), m = DIAG_RE.exec(line);
      el.className = 'out-line'; el.textContent = line;
      if (m && fileByName(m[1])) { el.classList.add('diag', m[4] === 'fatal error' ? 'error' : m[4]); el.dataset.file = m[1]; el.dataset.line = m[2]; el.title = 'Go to line'; ctx = true; }
      else if (ctx && /^\s/.test(line)) el.classList.add('ctx');
      else ctx = false;
      outPane.append(el);
    }
  }
  outPane.addEventListener('click', e => { const d = e.target.closest?.('.out-line.diag'); if (d) goToLine(Number(d.dataset.line), d.dataset.file); });
  function goToLine(n, file = active) { if (!fileByName(file)) return; if (narrow) showTab('code'); if (file !== active) selectFile(file); ed.reveal(file, n); }

  function showResult(res) {
    last = res;
    diagnostics = (res.diagnostics || []).filter(d => fileByName(d.file));
    ed.setMarkers(diagnostics);
    dock.classList.toggle('has-error', !res.ok);
    if (res.ok) {
      const s = res.size || {};
      setStatus(`Compiled · ${s.flash ?? '?'} bytes (${pct(s.flash, s.flashMax)} %) of flash · ${s.ram ?? '?'} bytes (${pct(s.ram, s.ramMax)} %) of RAM`, 'ok');
    } else setStatus(res.unreachable ? 'Compile service not reachable' : 'Compile error', 'bad');
    if (running && runSnapshot !== null && snapshot() !== runSnapshot) status.textContent += ' · edited while running — Stop, then Run to upload';
    renderOutput(res); renderTabs();
    if (!res.ok) showTab('output');                            // (narrow: the Code tab is one click away; the failing line is marked in the editor)
  }

  /** Compile the project with Arduino CLI. Resolves to the build result, or null if a newer build superseded this one. */
  async function build() {
    const id = ++buildId; controller?.abort(); controller = new AbortController();
    dock.classList.add('compiling'); $('codeCompile').disabled = true;
    setStatus('Compiling…', 'busy'); renderOutput(null, 'Compiling with Arduino CLI…');
    let res; const sent = snapshot();
    try { res = await compile(files.map(f => ({ name: f.name, content: f.content })), { signal: controller.signal }); }
    catch (err) { if (err?.name === 'AbortError') res = null; else res = { ok: false, diagnostics: [], output: String(err?.message || err), error: String(err?.message || err) }; }
    if (id !== buildId) return null;
    dock.classList.remove('compiling'); $('codeCompile').disabled = false;
    if (!res) return null;
    lastBuiltFrom = sent;
    showResult(res);
    return res;
  }

  function changed() {
    if (diagnostics.length) { diagnostics = []; ed.setMarkers([]); dock.classList.remove('has-error'); renderTabs(); }
    if (last && !dock.classList.contains('compiling')) setStatus(running ? 'Edited while running — Stop, then Run to upload' : 'Edited — press Verify or Run to compile', '');
    persist(); listeners.change.forEach(fn => fn());
  }
  function bindEditor(impl) {
    impl.onChange((name, content) => { const f = fileByName(name); if (f && f.content !== content) { f.content = content; changed(); } });
  }
  function mountProject() { ed.setFiles(files.map(f => ({ ...f }))); ed.showFile(active); ed.setMarkers(diagnostics); renderTabs(); }

  examples.addEventListener('change', () => {
    const ex = EXAMPLES[examples.value]; examples.value = '';
    if (!ex) return;
    const dirty = files.length > 1 || files[0].content !== ex.code;
    if (dirty && !confirm('Replace the current project with this example?')) return;
    setFiles([{ name: MAIN, content: ex.code }]); build();
  });
  $('codeCompile').addEventListener('click', () => build());
  $('codeReset').addEventListener('click', () => { setFiles([{ name: MAIN, content: DEFAULT_SKETCH }]); build(); });

  function setFiles(list, activeName) {
    files = list.map(f => ({ name: f.name, content: f.content }));
    active = activeName && fileByName(activeName) ? activeName : files[0].name;
    diagnostics = []; last = null; dock.classList.remove('has-error');
    mountProject(); persist(); setStatus('Not compiled yet'); renderOutput(null);
    listeners.change.forEach(fn => fn());
  }

  /* ── tabs + serial monitor ────────────── */
  // Wide dock: the editor sits beside a side panel that shows Output or Serial Monitor (`side`).
  // Narrow dock (small window / browser zoom): Code · Output · Serial Monitor are one tab bar and one view shows at a time (`view`),
  // so the editor can never be squeezed out by the side panel.
  const main = $('codeMain');
  const tabs = { code: [$('tabCode'), null], output: [$('tabOutput'), outPane], serial: [$('tabSerial'), $('serialPane')] };
  const NARROW_PX = 760;
  let narrow = false, side = 'output', view = 'code';
  function paintTabs() {
    const active = narrow ? view : side;
    for (const [k, [btn, pane]] of Object.entries(tabs)) {
      const on = k === active;
      btn.classList.toggle('on', on); btn.setAttribute('aria-selected', String(on));
      if (pane) pane.hidden = narrow ? view !== k : side !== k;
    }
    main.classList.toggle('off', narrow && view !== 'code');
    dock.classList.toggle('narrow', narrow);
    if (!main.classList.contains('off')) requestAnimationFrame(() => ed.layout?.());     // Monaco must re-measure after being hidden
  }
  function showTab(name) {
    if (name === 'code') { if (narrow) view = 'code'; paintTabs(); return; }        // wide: the editor is already beside the panels
    side = name; if (narrow) view = name;
    paintTabs();
    if (name === 'serial') { $('tabSerial').classList.remove('unread'); scrollLog(true); }
  }
  function measure() {                                                          // a collapsed dock (width 0) never flips the layout
    const w = dock.clientWidth; if (!w) return;
    const n = w < NARROW_PX;
    if (n !== narrow) { narrow = n; paintTabs(); ed.layout?.(); }
  }
  $('tabCode').addEventListener('click', () => showTab('code'));
  $('tabOutput').addEventListener('click', () => showTab('output'));
  $('tabSerial').addEventListener('click', () => showTab('serial'));
  window.addEventListener('resize', measure);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(dock);

  const logEl = $('serialLog'), MAX_LOG = 120_000;
  let logText = '', decoder = new TextDecoder('utf-8'), paint = 0;
  const sendListeners = [];
  const scrollLog = force => { if (force || $('serialAuto').checked) logEl.scrollTop = logEl.scrollHeight; };
  function flush() { paint = 0; logEl.textContent = logText; scrollLog(false); }
  const schedule = () => { if (!paint) paint = setTimeout(flush, 30); };
  const serial = {
    /** One byte from the firmware's Serial.write/print. */
    push(byte) {
      logText += decoder.decode(new Uint8Array([byte]), { stream: true });
      if (logText.length > MAX_LOG) logText = logText.slice(-MAX_LOG * 0.8);
      if (tabs.serial[1].hidden) $('tabSerial').classList.add('unread');
      schedule();
    },
    clear() { logText = ''; decoder = new TextDecoder('utf-8'); clearTimeout(paint); flush(); },
    flush,
    get text() { return logText; },
    setBaud(baud) { $('serialBaud').textContent = baud ? `${baud} baud` : ''; },
    onSend(fn) { sendListeners.push(fn); },
    show() { showTab('serial'); },
  };
  function send() {
    const input = $('serialInput'), eol = EOL[$('serialEol').value] ?? '', text = input.value + eol;
    if (!input.value && !eol) return;
    const delivered = sendListeners.map(fn => fn(text)).some(Boolean);
    if (delivered) input.value = '';
    else setStatus('Serial Monitor: the sketch is not running — press Run first', 'bad');
  }
  $('serialSend').addEventListener('click', send);
  $('serialInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('serialClear').addEventListener('click', () => serial.clear());

  /* ── dock open/close + resize ─────────── */
  let opened = false;
  const setOpen = open => {
    dock.classList.toggle('collapsed', !open); $('codeToggle').setAttribute('aria-pressed', String(open)); $('codeToggle').classList.toggle('on', open);
    if (open && !opened) { opened = true; listeners.open.forEach(fn => fn()); }
    if (open) queueMicrotask(() => { measure(); ed.layout?.(); });
  };
  $('codeToggle').addEventListener('click', () => setOpen(dock.classList.contains('collapsed')));
  $('codeCollapse').addEventListener('click', () => setOpen(false));
  let h = 260; try { h = Number(localStorage.getItem(HEIGHT_KEY)) || 260; } catch { /* ignore */ }
  const setHeight = v => { h = Math.max(140, Math.min(v, window.innerHeight - 220)); dock.style.setProperty('--code-h', `${h}px`); ed.layout?.(); };
  setHeight(h);
  $('codeResize').addEventListener('pointerdown', e => {
    e.preventDefault(); const y0 = e.clientY, h0 = h;
    const move = ev => setHeight(h0 + (y0 - ev.clientY));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem(HEIGHT_KEY, String(h)); } catch { /* ignore */ } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  /* ── editor switch (Monaco ⇄ simple) ──── */
  const kindBtn = $('codeEditorKind');
  function renderEditorKind() { kindBtn.textContent = ed.kind === 'monaco' ? 'Simple editor' : 'Monaco editor'; kindBtn.title = ed.kind === 'monaco' ? 'Switch to the lightweight editor' : 'Switch to the full Monaco editor'; }
  kindBtn.addEventListener('click', () => listeners.toggle?.());

  /* ── start ────────────────────────────── */
  const initial = loadProject();
  files = initial.files.map(f => ({ ...f })); active = fileByName(initial.active) ? initial.active : files[0].name;
  bindEditor(ed); mountProject(); renderOutput(null); setStatus('Not compiled yet'); renderEditorKind(); paintTabs(); measure();

  return {
    /** Content of the main sketch (kept for the single-file case). */
    get source() { return fileByName(mainName()).content; },
    set source(v) { fileByName(mainName()).content = v; mountProject(); changed(); },
    get files() { return files.map(f => ({ ...f })); },
    /** What goes into a project file: `sketch` (main file, for older readers) + all `files`. */
    exportState() { return { sketch: fileByName(mainName()).content, files: files.map(f => ({ ...f })), activeFile: active }; },
    /** Accepts new ({files}) and older ({sketch}) project files; ignores anything malformed. */
    importState(data) {
      const ok = Array.isArray(data?.files) && data.files.length && data.files.every(f => f && FILE_NAME_RE.test(f.name) && typeof f.content === 'string') && new Set(data.files.map(f => f.name)).size === data.files.length && data.files.some(f => f.name.endsWith('.ino'));
      if (ok) { setFiles(data.files, data.activeFile); return true; }
      if (typeof data?.sketch === 'string') { setFiles([{ name: MAIN, content: data.sketch }]); return true; }
      return false;
    },
    get active() { return active; },
    setFiles, addFile, removeFile, renameFile, selectFile,
    compile: build, open: () => setOpen(true), goToLine,
    onChange: fn => listeners.change.push(fn),
    /** Runs once, the first time the dock is opened — where the app upgrades to Monaco. */
    onFirstOpen: fn => { if (opened) fn(); else listeners.open.push(fn); },
    /** Swap the editor implementation, carrying the project, active file and markers across. Returns false (and keeps the old editor) if the new one fails. */
    setEditor(impl) {
      const previous = ed;
      try { previous.dispose?.(); ed = impl; bindEditor(ed); mountProject(); }
      catch (err) { console.warn('[virtual-lab] editor swap failed — keeping the previous editor.', err); impl.dispose?.(); ed = previous; if (ed === simpleEditor) { mountProject(); } return false; }
      renderEditorKind(); return true;
    },
    /** Go back to the lightweight editor (always works). */
    useSimpleEditor() { if (ed === simpleEditor) return true; const monaco = ed; monaco.dispose?.(); ed = simpleEditor; mountProject(); renderEditorKind(); return true; },
    onEditorToggle: fn => { listeners.toggle = fn; },
    get editor() { return ed; },
    /** The most recent compile result (or null), and whether the files have been edited since it ran. */
    get lastBuild() { return last ? { ...last, stale: lastBuiltFrom !== snapshot() } : null; },
    /** Registers the "✨ Fix with AI" handler shown on a failed compile (re-renders the current output so it appears). */
    onAiFix(fn) { onAiFix = fn; if (last && !last.ok) renderOutput(last); },
    setRunning(on) { running = on; runSnapshot = on ? snapshot() : null; if (last && !on) showResult(last); },
    serial,
  };
}
