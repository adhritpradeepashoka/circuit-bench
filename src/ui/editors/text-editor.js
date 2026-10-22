// Lightweight editor (a textarea with a syntax-highlight layer). Used as the fallback and in tests; the app upgrades to Monaco
// (./monaco-editor.js) the first time the code dock is opened. Both implement the same small interface:
//
//   setFiles(files) · getFiles() · showFile(name) · getActive()
//   addFile(name, content) · removeFile(name) · renameFile(from, to)
//   onChange(fn(name, content)) · setMarkers([{ file, line, col, severity, message }])
//   reveal(name, line) · focus() · dispose()
//
const $ = id => document.getElementById(id);

const KEYWORDS = new Set(['void', 'int', 'byte', 'bool', 'boolean', 'char', 'short', 'word', 'unsigned', 'signed', 'const', 'static', 'volatile', 'uint8_t', 'uint16_t', 'int8_t', 'int16_t', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'return', 'sizeof']);
const BUILTINS = new Set(['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'delay', 'delayMicroseconds', 'map', 'min', 'max', 'abs', 'constrain', 'setup', 'loop']);
const CONSTS = new Set(['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'true', 'false', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15']);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlight one line; `state.block` carries an open /* comment across lines. */
function highlightLine(line, state) {
  let out = '', i = 0;
  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i);
      if (end < 0) { out += `<i class="c">${esc(line.slice(i))}</i>`; i = line.length; } else { out += `<i class="c">${esc(line.slice(i, end + 2))}</i>`; i = end + 2; state.block = false; }
      continue;
    }
    const rest = line.slice(i); let m;
    if (rest.startsWith('//')) { out += `<i class="c">${esc(rest)}</i>`; break; }
    if (rest.startsWith('/*')) {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) { state.block = true; out += `<i class="c">${esc(rest)}</i>`; i = line.length; } else { out += `<i class="c">${esc(line.slice(i, end + 2))}</i>`; i = end + 2; }
      continue;
    }
    if (/^\s*#/.test(line) && i === line.search(/\S/)) { out += `<i class="p">${esc(rest)}</i>`; break; }
    if ((m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)/.exec(rest))) { out += `<i class="n">${m[0]}</i>`; i += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const w = m[0], cls = KEYWORDS.has(w) ? 'k' : BUILTINS.has(w) ? 'f' : CONSTS.has(w) ? 'n' : '';
      out += cls ? `<i class="${cls}">${w}</i>` : w; i += w.length; continue;
    }
    if (rest[0] === "'" && (m = /^'(\\.|[^'\\])'/.exec(rest))) { out += `<i class="n">${esc(m[0])}</i>`; i += m[0].length; continue; }
    out += esc(rest[0]); i++;
  }
  return out;
}

const BUILTINS_EXTRA = ['Serial', 'String', 'millis', 'micros', 'random', 'tone', 'noTone', 'attachInterrupt', 'pow', 'sqrt', 'sin', 'cos', 'PROGMEM'];
for (const w of BUILTINS_EXTRA) BUILTINS.add(w);
for (const w of ['long', 'float', 'double', 'unsigned', 'class', 'struct', 'public', 'private', 'switch', 'case', 'default', 'new', 'delete', 'template', 'typename', 'uint32_t', 'int32_t', 'size_t', 'char', 'enum', 'goto', 'inline', 'namespace', 'using']) KEYWORDS.add(w);


export function createTextEditor() {
  const ta = $('codeInput'), hl = $('codeHighlight'), gutter = $('codeGutter');
  const files = new Map();                 // name → content, in tab order
  let active = null, markers = [];
  const listeners = [];
  const emit = () => listeners.forEach(fn => fn(active, ta.value));

  const marksFor = name => { const m = new Map(); for (const d of markers) if (d.file === name && (d.severity === 'error' || d.severity === 'warning') && m.get(d.line) !== 'error') m.set(d.line, d.severity); return m; };
  function render() {
    const marks = marksFor(active), lines = ta.value.split('\n'), state = { block: false };
    hl.innerHTML = lines.map((ln, i) => `<div class="cl${marks.get(i + 1) === 'error' ? ' err' : ''}">${highlightLine(ln, state) || ' '}</div>`).join('');
    gutter.innerHTML = lines.map((_, i) => `<div class="gn${marks.get(i + 1) === 'error' ? ' err' : ''}">${i + 1}</div>`).join('');
    syncScroll();
  }
  function syncScroll() { hl.scrollTop = gutter.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
  function store() { if (active !== null) files.set(active, ta.value); }

  ta.addEventListener('input', () => { store(); render(); emit(); });
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const s = ta.selectionStart, before = ta.value.slice(0, s), line = before.slice(before.lastIndexOf('\n') + 1);
      let indent = /^\s*/.exec(line)[0];
      const opens = /\{\s*$/.test(line), closes = ta.value[ta.selectionEnd] === '}';
      if (opens) indent += '  ';
      let ins = '\n' + indent;
      if (opens && closes) ins += '\n' + indent.slice(2);
      ta.setRangeText(ins, s, ta.selectionEnd, 'end');
      if (opens && closes) ta.selectionStart = ta.selectionEnd = s + 1 + indent.length;
      ta.dispatchEvent(new Event('input'));
    }
  });

  const api = {
    kind: 'text',
    setFiles(list) { files.clear(); for (const f of list) files.set(f.name, f.content); active = null; api.showFile(list[0]?.name); },
    getFiles() { store(); return [...files].map(([name, content]) => ({ name, content })); },
    getActive() { return active; },
    showFile(name) {
      store();
      if (!files.has(name)) return;
      active = name; ta.value = files.get(name); ta.scrollTop = 0; render();
    },
    addFile(name, content = '') { files.set(name, content); },
    removeFile(name) { const was = active === name; files.delete(name); if (was) { active = null; api.showFile([...files.keys()][0]); } },
    renameFile(from, to) {
      store(); const entries = [...files].map(([n, c]) => (n === from ? [to, c] : [n, c]));
      files.clear(); for (const [n, c] of entries) files.set(n, c);
      if (active === from) active = to;
      markers = markers.map(m => (m.file === from ? { ...m, file: to } : m));
    },
    onChange(fn) { listeners.push(fn); },
    setMarkers(list) { markers = list.slice(); render(); },
    reveal(name, line) {
      if (name !== active) api.showFile(name);
      const lines = ta.value.split('\n'), n = Math.min(Math.max(1, line), lines.length);
      const start = lines.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0);
      ta.focus(); ta.setSelectionRange(start, start + lines[n - 1].length);
      ta.scrollTop = Math.max(0, (n - 4) * 19); syncScroll();
    },
    focus() { ta.focus(); },
    dispose() {},
    /** Text currently selected (tests / callers). */
    get selectionText() { return ta.value.slice(ta.selectionStart, ta.selectionEnd); },
    get value() { return ta.value; },
  };
  return api;
}
