// The AI chat pane (top of the right-hand sidebar). A normal rolling conversation: your message goes in
// as a bubble and the input clears; the reply comes back as a bubble with its own Apply / Discard when it
// proposes a change (a circuit edit, a new sketch, or both). Earlier turns are sent along so follow-ups
// like "now make it faster" work, and every request also carries live diagnostics (last compile, the
// running sim, Serial Monitor output) — see gatherContext below and describeContext in
// server/ai-service.mjs. Bring-your-own-key for now: src/sim/ai-client.mjs. Proposed circuit edits are
// validated against the real part/pin catalogue by src/core/ai-actions.js before anything renders.
import { generateCode, getStoredKey, setStoredKey, getStoredProvider, setStoredProvider } from '../sim/ai-client.mjs';
import { applyCircuitActions } from '../core/ai-actions.js';
import { FORMAT, VERSION } from '../core/project.js';
import { sidePanes } from './side-panes.js';

const PROVIDER_HINTS = {
  gemini: '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free Gemini key</a> at Google AI Studio. If that page says "project creation failed" (a known Google-side bug on some accounts), switch to the Groq tab above instead.',
  groq: '<a href="https://console.groq.com/keys" target="_blank" rel="noopener">Get a free Groq key</a> at console.groq.com — no Google account step involved.',
};
const CHAT_STORE = 'virtual-lab:ai-chat';
const MAX_SAVED = 40, MAX_HISTORY = 8, MAX_SAVED_CODE = 8000;
const SUGGESTIONS = ['Make the LED blink twice as fast', 'Add a pushbutton on pin 2 that turns the LED on', 'Why isn\'t my circuit working?'];

// applyCircuitActions already works in — and returns — the project-file shape (parts use "rotate",
// wires use from/to), the same shape editor.exportProject()/fromProjectFile() use, so no remapping.
const toProjectFileShape = (parts, wires) => ({ format: FORMAT, version: VERSION, parts, wires });

const CAP = { output: 4000, serial: 2000, file: 6000, files: 12000 };

/** Everything the AI needs to diagnose instead of guess: the compiler's verdict, the live sim, the serial log, other project files. */
export function gatherContext(code, sim) {
  const b = code.lastBuild;
  const compile = b ? {
    ok: !!b.ok, stale: !!b.stale, unreachable: !!b.unreachable,
    errors: (b.diagnostics || []).filter(d => d.severity === 'error').slice(0, 10).map(d => ({ file: d.file, line: d.line, message: d.message })),
    output: String(b.output || b.error || '').slice(-CAP.output),
  } : null;
  const st = code.exportState?.() || { files: [], sketch: code.source };
  let budget = CAP.files;
  const otherFiles = [];
  for (const f of st.files || []) {
    if (f.name.endsWith('.ino') && f.content === st.sketch) continue;          // the main sketch is sent separately
    const content = f.content.slice(0, Math.min(CAP.file, budget)); budget -= content.length;
    otherFiles.push({ name: f.name, content });
    if (budget <= 0) break;
  }
  const serial = String(code.serial?.text || '').slice(-CAP.serial);
  return { compile, sim: sim?.snapshot?.() ?? null, serial, otherFiles };
}

const STATE_NOTE = { applied: 'applied', discarded: 'not applied — the student discarded it', superseded: 'not applied', expired: 'not applied', pending: 'not applied yet' };

/** The earlier turns, as the model should see them: what was asked, what it answered, and whether that edit is actually in the project now. */
export function chatHistory(messages, max = MAX_HISTORY) {
  return messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-max).map(m => (m.role === 'user'
    ? { role: 'user', text: m.text }
    : { role: 'assistant', text: `${m.text || ''}${m.hasEdit ? ` [proposed edit: ${STATE_NOTE[m.state] || 'not applied'}]` : ''}` }));
}

export function initAiPanel(editor, code, sim = null) {
  const $ = id => document.getElementById(id);
  const panes = sidePanes(editor);
  const log = $('aiLog'), promptEl = $('aiPrompt'), sendBtn = $('aiGenerate'), status = $('aiStatus');
  const keyRow = $('aiKeyRow'), keyInput = $('aiKeyInput');
  const providerTabs = keyRow.querySelectorAll('[data-provider]'), providerHint = $('aiProviderHint');

  let messages = loadChat();     // { id, role: 'user'|'assistant'|'error', text, summary?, warnings?, fatal?, code?, codeLines?, hasEdit?, state? }
  const proposals = new Map();   // message id → { code, circuitEdit } (in memory only — never persisted)
  let busy = false, seq = Date.now();

  /* ── persistence (per-viewer convenience; can come back empty) ── */
  function loadChat() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_STORE) || '[]');
      if (!Array.isArray(saved)) return [];
      // A proposal can't survive a reload (its edit lived in memory), so a pending one becomes "expired".
      return saved.filter(m => m && typeof m.text === 'string' && ['user', 'assistant', 'error'].includes(m.role)).map(m => (m.state === 'pending' ? { ...m, state: 'expired' } : m));
    } catch { return []; }
  }
  function saveChat() {
    try { localStorage.setItem(CHAT_STORE, JSON.stringify(messages.slice(-MAX_SAVED).map(m => (m.code && m.code.length > MAX_SAVED_CODE ? { ...m, code: undefined } : m)))); } catch { /* full or blocked */ }
  }

  /* ── rendering ───────────────────────── */
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const STATE_LABEL = { applied: 'Applied ✓', discarded: 'Discarded', superseded: 'Not applied — a newer reply replaced it', expired: 'Not applied (page was reloaded)' };

  function renderMessage(m) {
    const row = el('div', `msg ${m.role === 'user' ? 'me' : 'ai'}${m.role === 'error' ? ' err' : ''}`);
    row.dataset.id = m.id;
    const bubble = el('div', 'bubble');
    if (m.role === 'user') { bubble.textContent = m.text; row.append(bubble); return row; }
    bubble.append(el('p', 'msg-text', m.text || (m.role === 'error' ? 'Something went wrong.' : 'Done.')));
    if (m.summary) bubble.append(el('p', 'ai-summary', m.summary));
    if (m.warnings?.length) {
      const ul = el('ul', `ai-warnings${m.fatal ? ' fatal' : ''}`);
      for (const w of m.warnings) ul.append(el('li', null, w));
      bubble.append(ul);
    }
    if (m.code) {
      const d = el('details', 'ai-code');
      d.append(el('summary', null, `sketch.ino · ${m.codeLines} line${m.codeLines === 1 ? '' : 's'}`), el('pre', null, m.code));
      bubble.append(d);
    }
    if (m.hasEdit) {
      const actions = el('div', 'msg-actions');
      if (m.state === 'pending' && proposals.has(m.id)) {
        const apply = el('button', 'msg-apply', 'Apply'); apply.type = 'button'; apply.dataset.act = 'apply';
        const discard = el('button', 'msg-discard', 'Discard'); discard.type = 'button'; discard.dataset.act = 'discard';
        actions.append(discard, apply);
      } else actions.append(el('span', `msg-state ${m.state}`, STATE_LABEL[m.state] || 'Not applied'));
      bubble.append(actions);
    }
    row.append(bubble);
    return row;
  }

  function renderEmpty() {
    const box = el('div', 'ai-empty');
    box.append(el('b', null, 'Ask about your circuit'), el('p', null, 'It sees your wiring and code, compile errors, and — while the simulation runs — the live pin readings. It can rewire the board and rewrite the sketch for you.'));
    const chips = el('div', 'ai-chips');
    for (const s of SUGGESTIONS) { const c = el('button', 'ai-chip', s); c.type = 'button'; c.addEventListener('click', () => { promptEl.value = s; send(); }); chips.append(c); }
    box.append(chips);
    return box;
  }

  function render() {
    log.replaceChildren(...(messages.length ? messages.map(renderMessage) : [renderEmpty()]));
    if (busy) {
      const row = el('div', 'msg ai thinking'), bubble = el('div', 'bubble');
      bubble.append(el('span', 'dots'), el('span', 'thinking-label', sim?.running ? 'Thinking — reading the live simulation…' : 'Thinking…'));
      row.append(bubble); log.append(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  log.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.closest('.msg')?.dataset.id, m = messages.find(x => String(x.id) === id);
    if (!m || m.state !== 'pending') return;
    if (btn.dataset.act === 'apply') applyProposal(m); else { m.state = 'discarded'; proposals.delete(m.id); saveChat(); render(); }
  });

  function applyProposal(m) {
    const p = proposals.get(m.id); if (!p) return;
    if (p.circuitEdit) editor.importProject(toProjectFileShape(p.circuitEdit.parts, p.circuitEdit.wires));
    if (p.code) { code.source = p.code; code.open(); }
    editor.status(p.circuitEdit && p.code ? 'AI edit applied — circuit and sketch.ino both updated' : p.circuitEdit ? 'AI edit applied to the circuit' : 'AI edit applied to sketch.ino — Verify or Run to compile it');
    m.state = 'applied'; proposals.delete(m.id); saveChat(); render();
  }

  /* ── key setup ───────────────────────── */
  const setStatus = msg => { status.textContent = msg || ''; };
  const hasKey = () => !!getStoredKey();
  function refreshKeyUi() { keyRow.hidden = hasKey(); }
  function paintProvider() {
    const p = getStoredProvider();
    providerTabs.forEach(b => b.classList.toggle('on', b.dataset.provider === p));
    providerHint.innerHTML = PROVIDER_HINTS[p] || '';
  }
  providerTabs.forEach(b => b.addEventListener('click', () => { setStoredProvider(b.dataset.provider); paintProvider(); }));
  $('aiKeySave').addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (!v) return setStatus('Paste a key first.');
    setStoredKey(v); keyInput.value = ''; refreshKeyUi();
    setStatus(`${getStoredProvider() === 'groq' ? 'Groq' : 'Gemini'} key saved — only in this browser.`);
    if (promptEl.value.trim()) send(); else promptEl.focus();
  });
  $('aiForgetKey').addEventListener('click', () => { setStoredKey(''); refreshKeyUi(); setStatus(''); paintProvider(); keyInput.focus(); });

  /* ── composer ────────────────────────── */
  const autosize = () => { promptEl.style.height = 'auto'; promptEl.style.height = `${Math.min(promptEl.scrollHeight || 0, 150)}px`; };
  promptEl.addEventListener('input', autosize);
  promptEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('aiComposer').addEventListener('submit', e => { e.preventDefault(); send(); });
  $('aiNewChat').addEventListener('click', () => { if (busy) return; messages = []; proposals.clear(); saveChat(); setStatus(''); render(); promptEl.focus(); });

  /** A circuit edit that applied with no net change and no warnings asked to touch the board and nothing moved — say so instead of a quiet no-op. */
  function outcome(circuit, res) {
    let circuitEdit = null, warnings = [], changed = null;
    if (res.actions?.length) {
      const applied = applyCircuitActions(circuit, res.actions);
      circuitEdit = { parts: applied.parts, wires: applied.wires };
      warnings = applied.warnings;
      changed = JSON.stringify(circuitEdit.parts) !== JSON.stringify(circuit.parts) || JSON.stringify(circuitEdit.wires) !== JSON.stringify(circuit.wires);
    }
    if (circuitEdit && changed === false && warnings.length === 0) warnings = [...warnings, 'None of the requested circuit changes actually took effect — the AI may be describing an edit it did not really make.'];
    return { circuitEdit: changed ? circuitEdit : null, attempted: !!circuitEdit, changed, warnings };
  }

  async function send() {
    const text = promptEl.value.trim();
    if (!text) return;
    if (busy) return setStatus('Wait for the current reply first.');
    if (!hasKey()) { refreshKeyUi(); keyInput.focus(); return setStatus('Add a free API key above to start chatting.'); }
    setStatus('');
    const history = chatHistory(messages);
    for (const m of messages) if (m.state === 'pending') { m.state = 'superseded'; proposals.delete(m.id); }   // an older edit no longer matches the board once you've moved on
    messages.push({ id: ++seq, role: 'user', text });
    promptEl.value = ''; autosize();
    busy = true; sendBtn.disabled = true; saveChat(); render();
    try {
      const circuit = editor.exportProject();
      const res = await generateCode({ instruction: text, circuit, code: code.source, context: gatherContext(code, sim), history });
      if (!res.ok) {
        if (res.needsKey) { setStoredKey(''); refreshKeyUi(); }
        messages.push({ id: ++seq, role: 'error', text: res.error || 'Something went wrong.' });
        return;
      }
      const o = outcome(circuit, res);
      const hasEdit = !!(res.code || o.circuitEdit);
      const summary = [];
      if (o.attempted) summary.push(o.changed ? `${res.actions.length} circuit change${res.actions.length === 1 ? '' : 's'}` : 'no circuit change actually applied');
      if (res.code) summary.push('a new sketch');
      const m = {
        id: ++seq, role: 'assistant', text: res.explanation || (hasEdit ? 'Here is the change.' : 'Done.'),
        summary: summary.length ? `Proposes: ${summary.join(' + ')}.` : '', warnings: o.warnings, fatal: o.attempted && !o.changed,
        code: res.code || undefined, codeLines: res.code ? res.code.split('\n').length : 0, hasEdit, state: hasEdit ? 'pending' : undefined,
      };
      if (hasEdit) proposals.set(m.id, { code: res.code || null, circuitEdit: o.circuitEdit });
      messages.push(m);
    } catch (err) {
      messages.push({ id: ++seq, role: 'error', text: err?.message || 'Something went wrong.' });
    } finally {
      busy = false; sendBtn.disabled = false; saveChat(); render();
      if (panes.isOpen('ai')) promptEl.focus();
    }
  }

  /* ── opening / closing ───────────────── */
  function focusInput() { refreshKeyUi(); (hasKey() ? promptEl : keyInput).focus(); }
  $('aiBtn').addEventListener('click', () => { panes.toggle('ai'); if (panes.isOpen('ai')) focusInput(); });
  $('aiClose').addEventListener('click', () => panes.close('ai'));
  panes.onChange((name, open) => { if (name === 'ai' && open) { refreshKeyUi(); render(); } });

  /** Open the chat with a message ready — and send it straight away when the intent is unambiguous (e.g. "fix this compile error"). */
  function askAi(instruction, { send: now = false } = {}) {
    panes.open('ai');
    promptEl.value = instruction; autosize();
    if (now && hasKey()) send();
    else { focusInput(); promptEl.setSelectionRange?.(instruction.length, instruction.length); }
  }
  code.onAiFix?.(() => askAi('Fix the compile error(s) shown in the compiler output.', { send: true }));

  paintProvider(); refreshKeyUi(); render();
  return { askAi, send, get messages() { return messages; } };
}
