// Monaco (the VS Code editor) as a CodeEditor implementation. Loaded lazily the first time the code dock is opened.
// Only the core API, the editor features and the C++ language are pulled in (not every language Monaco knows).
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import EditorWorker from 'vlab-monaco-worker';
import { ARDUINO_COMPLETIONS } from './arduino-completions.js';

/**
 * Can this page start a Web Worker at all? Strict CSPs, some sandboxes/previews and a few browsers refuse (the constructor throws).
 * Checked once, up front, so a refusal is handled quietly instead of Monaco logging "Could not create web worker(s)".
 */
export function workersAvailable() {
  if (typeof Worker === 'undefined') return false;
  try { const w = new EditorWorker(); w.terminate(); return true; } catch { return false; }
}
const WORKERS = workersAvailable();
if (!WORKERS) {
  // The browser refused to start Web Workers (strict CSP, sandboxed preview, file:// in some browsers). Monaco then runs its helper
  // code on the main thread — fine for sketch-sized files. Replace its generic warning with one plain explanation.
  const warn = console.warn.bind(console); let told = false;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Could not create web worker(s)')) {
      if (!told) { told = true; console.info('[virtual-lab] Web Workers are blocked on this page, so the code editor runs its helpers on the main thread. It works normally; only very large files could feel slower.'); }
      return;
    }
    warn(...args);
  };
}
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const $ = id => document.getElementById(id);
let themed = false, completionsRegistered = false;

function setupOnce() {
  if (!themed) {
    monaco.editor.defineTheme('vlab-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: '6f8a7b' }, { token: 'keyword', foreground: 'f0a35c' }, { token: 'number', foreground: 'd6b6ff' },
        { token: 'string', foreground: '9fd88f' }, { token: 'type', foreground: '7cc4ff' }, { token: 'identifier', foreground: 'dce6e1' },
        { token: 'delimiter', foreground: 'a9b8b1' }, { token: 'predefined', foreground: '7cc4ff' },
      ],
      colors: {
        'editor.background': '#161c20', 'editor.foreground': '#dce6e1', 'editorLineNumber.foreground': '#566670', 'editorLineNumber.activeForeground': '#b9c8c1',
        'editorGutter.background': '#12181b', 'editor.lineHighlightBackground': '#1d252a', 'editor.selectionBackground': '#2f5fb555', 'editorCursor.foreground': '#f3f7f5',
        'editorWidget.background': '#1d252a', 'editorSuggestWidget.background': '#1d252a', 'editorSuggestWidget.selectedBackground': '#2c3a41',
        'scrollbarSlider.background': '#36424a88', 'editorError.foreground': '#ff6b60', 'editorWarning.foreground': '#f2c94c',
      },
    });
    themed = true;
  }
  if (!completionsRegistered) {
    monaco.languages.registerCompletionItemProvider('cpp', {
      triggerCharacters: ['.'],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const prefix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: word.startColumn });
        const afterSerial = /Serial\.$/.test(prefix);
        const K = monaco.languages.CompletionItemKind;
        return {
          suggestions: ARDUINO_COMPLETIONS.filter(c => (c.member ? afterSerial : !afterSerial)).map(c => ({
            label: c.label, kind: c.kind === 'const' ? K.Constant : c.kind === 'snippet' ? K.Snippet : c.member ? K.Method : K.Function,
            insertText: c.insert || c.label, insertTextRules: c.insert ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            documentation: c.doc, detail: c.detail, range,
          })),
        };
      },
    });
    completionsRegistered = true;
  }
}

/**
 * @param {{ onRun?: () => void }} [opts]  Ctrl/Cmd+Enter calls onRun (the app's Run shortcut) instead of inserting a line
 */
export function createMonacoEditor({ onRun } = {}) {
  setupOnce();
  const host = $('codeMonaco'), body = $('codeBody');
  // Monaco measures its container and the font when it is created — so the container must already be visible (not `hidden`).
  body.classList.add('monaco'); host.hidden = false;
  const models = new Map();                       // name → ITextModel, in tab order
  const listeners = [];
  let active = null, silent = false;

  let editor;
  try { editor = monaco.editor.create(host, {
    theme: 'vlab-dark', language: 'cpp', model: null, automaticLayout: true,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 13, lineHeight: 19,
    minimap: { enabled: false, showMarkSectionHeaders: false, showRegionSectionHeaders: false }, scrollBeyondLastLine: false, tabSize: 2, insertSpaces: true, detectIndentation: false,
    lineNumbersMinChars: 3, glyphMargin: false, folding: true, renderLineHighlight: 'line', padding: { top: 8, bottom: 8 },
    smoothScrolling: true, cursorSmoothCaretAnimation: 'off', bracketPairColorization: { enabled: true }, quickSuggestions: { other: true, comments: false, strings: false },
    accessibilitySupport: 'auto', ariaLabel: 'Arduino sketch',
    colorDecorators: false,          // colour swatches for #rrggbb — not useful in C++, and computed in the worker
    // Only link detection and word-based suggestions still need the editor worker. Without workers, switch them off (Arduino API
    // completions come from our own provider on the main thread) rather than let Monaco fall back to running the worker inline.
    ...(WORKERS ? {} : { links: false, wordBasedSuggestions: 'off' }),
  }); } catch (err) { body.classList.remove('monaco'); host.hidden = true; throw err; }
  if (onRun) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun);
  requestAnimationFrame(() => { monaco.editor.remeasureFonts?.(); editor.layout(); });

  const uri = name => monaco.Uri.parse(`inmemory://vlab/${encodeURIComponent(name)}`);
  const lang = name => (/\.(c)$/.test(name) ? 'c' : 'cpp');
  function makeModel(name, content) {
    const m = monaco.editor.createModel(content, lang(name), uri(name));
    m.updateOptions({ tabSize: 2, insertSpaces: true });
    m.onDidChangeContent(() => { if (!silent) listeners.forEach(fn => fn(name, m.getValue())); });
    models.set(name, m); return m;
  }
  const dropAll = () => { for (const m of models.values()) m.dispose(); models.clear(); };

  const api = {
    kind: 'monaco',
    setFiles(list) { editor.setModel(null); dropAll(); for (const f of list) makeModel(f.name, f.content); active = null; api.showFile(list[0]?.name); },
    getFiles() { return [...models].map(([name, m]) => ({ name, content: m.getValue() })); },
    getActive() { return active; },
    showFile(name) { const m = models.get(name); if (!m) return; active = name; editor.setModel(m); },
    addFile(name, content = '') { makeModel(name, content); },
    removeFile(name) { const m = models.get(name); if (!m) return; const was = active === name; if (was) editor.setModel(null); m.dispose(); models.delete(name); if (was) { active = null; api.showFile([...models.keys()][0]); } },
    renameFile(from, to) {
      const m = models.get(from); if (!m) return;
      const content = m.getValue(), pos = active === from ? editor.getPosition() : null, wasActive = active === from;
      const order = [...models.keys()].map(n => (n === from ? to : n));
      silent = true;
      if (wasActive) editor.setModel(null);
      m.dispose(); models.delete(from);
      const rebuilt = new Map(); makeModel(to, content);
      for (const n of order) rebuilt.set(n, models.get(n));
      models.clear(); for (const [n, mm] of rebuilt) models.set(n, mm);
      silent = false;
      if (wasActive) { active = to; editor.setModel(models.get(to)); if (pos) editor.setPosition(pos); }
    },
    onChange(fn) { listeners.push(fn); },
    setMarkers(list) {
      for (const [name, m] of models) {
        const marks = list.filter(d => d.file === name && (d.severity === 'error' || d.severity === 'warning')).map(d => {
          const line = Math.min(Math.max(1, d.line), m.getLineCount()), max = m.getLineMaxColumn(line);
          const first = m.getLineFirstNonWhitespaceColumn(line) || 1;
          return { severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: d.message, source: 'arduino-cli',
            startLineNumber: line, endLineNumber: line, startColumn: Math.min(Math.max(1, d.col || first), max), endColumn: max };
        });
        monaco.editor.setModelMarkers(m, 'arduino', marks);
      }
    },
    reveal(name, line) {
      if (name !== active) api.showFile(name);
      const m = models.get(name); if (!m) return;
      const n = Math.min(Math.max(1, line), m.getLineCount());
      editor.setSelection({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: m.getLineMaxColumn(n) });
      editor.revealLineInCenter(n); editor.focus();
    },
    focus() { editor.focus(); },
    layout() { editor.layout(); },
    dispose() { editor.setModel(null); dropAll(); editor.dispose(); host.hidden = true; body.classList.remove('monaco'); },
    get selectionText() { const s = editor.getSelection(), m = editor.getModel(); return s && m ? m.getValueInRange(s) : ''; },
    get value() { return editor.getModel()?.getValue() ?? ''; },
    /** Escape hatch for tests / power use. */
    raw: { editor, monaco },
    /** false when the browser refused to start workers and the worker-dependent extras are off. */
    workers: WORKERS,
  };
  return api;
}
