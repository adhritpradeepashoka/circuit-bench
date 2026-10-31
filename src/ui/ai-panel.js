// The AI chat pane (top of the right-hand sidebar). A normal rolling conversation: your message goes in
// as a bubble and the input clears; the reply comes back as a bubble with its own Apply / Discard when it
// proposes a change (a circuit edit, a new sketch, or both). Earlier turns are sent along so follow-ups
// like "now make it faster" work, and every request also carries live diagnostics (last compile, the
// running sim, Serial Monitor output) — see gatherContext below and describeContext in
// server/ai-service.mjs. Bring-your-own-key for now: src/sim/ai-client.mjs. Proposed circuit edits are
// validated against the real part/pin catalogue by src/core/ai-actions.js before anything renders.
import { loadTiny, understand } from '../sim/tiny-model.mjs';
import { quickEdit } from '../core/quick-edits.js';
import { quickAssembly } from '../core/quick-assembly.js';
import { quickDrone } from '../core/quick-drone.js';
import { recipeEdit } from '../core/recipes.js';
import { eligibleForLearning, prepareLearning, templatizeInstruction } from '../core/learned.js';
import { learnedRecipes, addLearned, learningOn, setLearning } from '../core/learned-store.js';
import { DEFAULT_SKETCH } from '../sim/examples.js';
const isCustomSketch = src => { const t = String(src || '').replace(/\s+/g, ' ').trim(); return !!t && t !== DEFAULT_SKETCH.replace(/\s+/g, ' ').trim(); };
import { hasHostedAi } from '../sim/session.mjs';
import { probeWebGPU, generateLocal, LOCAL_PROVIDER, LOCAL_MODELS, DEFAULT_LOCAL_MODEL, getLocalModel, setLocalModel, webgpuAvailable } from '../sim/webllm.mjs';
import { generateCode, createPart, hasAnyKey, getStoredKey, setStoredKey, getStoredProvider, setStoredProvider, getStoredModel, setStoredModel, PROVIDER_INFO, PROVIDER_IDS, providersWithKeys } from '../sim/ai-client.mjs';
import { applyCircuitActions, guardRoboticsBoards } from '../core/ai-actions.js';
import { BOARD_SPECS } from '../core/boards.js';
import { activeWorkspace } from '../core/workspaces.js';
import { droneWiring } from '../core/drone-wiring.js';
import { FORMAT, VERSION } from '../core/project.js';
import { sidePanes } from './side-panes.js';

const CHAT_STORE = 'virtual-lab:ai-chat';
const MAX_SAVED = 40, MAX_HISTORY = 8, MAX_SAVED_CODE = 8000;
const SUGGESTIONS = ['Make the LED blink twice as fast', 'Add a pushbutton on pin 2 that turns the LED on', 'Why isn\'t my circuit working?'];

// applyCircuitActions already works in — and returns — the project-file shape (parts use "rotate",
// wires use from/to), the same shape editor.exportProject()/fromProjectFile() use, so no remapping.
const toProjectFileShape = (parts, wires, customParts = []) => ({ format: FORMAT, version: VERSION, parts, wires, ...(customParts.length ? { customParts } : {}) });

const CAP = { output: 4000, serial: 2000, file: 6000, files: 12000 };

/** Everything the AI needs to diagnose instead of guess: the compiler's verdict, the live sim, the serial log, other project files. */
export function gatherContext(code, sim) {
  const b = code.lastBuild;
  const compile = b ? {
    ok: !!b.ok, stale: !!b.stale, unreachable: !!b.unreachable,
    errors: (b.diagnostics || []).filter(d => d.severity === 'error').slice(0, 10).map(d => ({ file: d.file, line: d.line, message: d.message })),
    output: String(b.output || b.error || '').slice(-CAP.output),
    ...(b.notes?.length ? { notes: b.notes.slice(0, 5) } : {}),
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
  const tabsEl = $('aiProviderTabs'), providerHint = $('aiProviderHint'), modelInput = $('aiModelInput');

  let chatKey = CHAT_STORE;     // one conversation per project once projects say which one is open (setScope)
  let messages = loadChat();     // { id, role: 'user'|'assistant'|'error', text, summary?, warnings?, fatal?, code?, codeLines?, hasEdit?, state? }
  const proposals = new Map();   // message id → { code, circuitEdit } (in memory only — never persisted)
  let busy = false, seq = Date.now();

  /* ── persistence (per-viewer convenience; can come back empty) ── */
  function loadChat() {
    try {
      const saved = JSON.parse(localStorage.getItem(chatKey) || '[]');
      if (!Array.isArray(saved)) return [];
      // A proposal can't survive a reload (its edit lived in memory), so a pending one becomes "expired".
      return saved.filter(m => m && typeof m.text === 'string' && ['user', 'assistant', 'error'].includes(m.role)).map(m => (m.state === 'pending' ? { ...m, state: 'expired' } : m));
    } catch { return []; }
  }
  function saveChat() {
    try { localStorage.setItem(chatKey, JSON.stringify(messages.slice(-MAX_SAVED).map(m => (m.code && m.code.length > MAX_SAVED_CODE ? { ...m, code: undefined } : m)))); } catch { /* full or blocked */ }
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
    if (p.assemblyOps) {
      const api = window.__vlab?.assembly?.ai; m.state = 'applied'; proposals.delete(m.id);
      api?.run(p.assemblyOps).then(r => { editor.status(`AI edit applied to the 3D scene (${r.done} change${r.done === 1 ? '' : 's'})`); if (r.warnings.length) { messages.push({ id: ++seq, role: 'error', text: `Some 3D changes could not be made: ${r.warnings.join(' ')}` }); } saveChat(); render(); }).catch(e => { messages.push({ id: ++seq, role: 'error', text: e?.message || 'The 3D edit failed.' }); render(); });
      saveChat(); render(); return;
    }
    if (p.circuitEdit) editor.importProject(toProjectFileShape(p.circuitEdit.parts, p.circuitEdit.wires, p.circuitEdit.customParts));
    if (p.code) { code.source = p.code; code.open(); }
    editor.status(p.circuitEdit && p.code ? 'AI edit applied — circuit and sketch.ino both updated' : p.circuitEdit ? 'AI edit applied to the circuit' : 'AI edit applied to sketch.ino — Verify or Run to compile it');
    m.state = 'applied'; proposals.delete(m.id); saveChat(); render();
    if (p.learn && p.code && p.circuitEdit) learnFrom(p).catch(() => { /* learning is a bonus: it must never get in the way */ });
  }

  /* ── learning: a student who applied what the AI built teaches the instant tier to build it (core/learned.js) ── */
  let learning = false;
  async function learnFrom(p) {
    if (!learningOn() || learning) return;
    const project = toProjectFileShape(p.circuitEdit.parts, p.circuitEdit.wires, p.circuitEdit.customParts);
    const request = p.learn.request;
    if (recipeEdit(request, { parts: [], wires: [] }, { learned: learnedRecipes() })) return;         // the instant tier already knows this
    const el = eligibleForLearning({ request, project });
    if (!el.ok) return;
    learning = true;
    try {
      const res = await generate({ instruction: templatizeInstruction(el.map, p.code), circuit: project, code: p.code, context: null, history: [] });
      if (!res?.ok || !res.code) return;
      const prep = prepareLearning({ request, project, code: p.code, template: res.code });
      if (!prep.ok) return;
      for (const inst of prep.instances) {        // every instance must really build, on each board
        const v = await code.compileSource(inst.code, { fqbn: inst.fqbn });
        if (!v.ok) return;                          // (no compiler to ask counts as not verified)
      }
      if (addLearned(prep.recipe)) setStatus(`Learned "${prep.recipe.keywords.join(' ')}": next time I can build this instantly, with no AI.`);
    } finally { learning = false; }
  }

  /* ── key setup ───────────────────────── */
  const setStatus = msg => { status.textContent = msg || ''; };
  /* On-device (WebLLM) is the default when the browser has WebGPU and the student has saved no key of their own; a saved key wins unless they pick the local model on purpose. */
  const LOCAL_PREF = 'virtual-lab:ai-local';
  const getPref = () => { try { return localStorage.getItem(LOCAL_PREF); } catch { return null; } };
  const setPref = v => { try { localStorage.setItem(LOCAL_PREF, v === 'h' || v === 't' ? v : v ? '1' : '0'); } catch { /* ignore */ } };
  const TINY_PROVIDER = 'tiny';
  // "Included AI": beta members (and anyone the owner allows) use the server's own key with no setup. It leads unless they chose something else.
  const tinyOn = () => getPref() === 't';          // only CircuitBench's own 2.5 MB model: instant, offline, needs no GPU and no key
  const hostedOn = () => !tinyOn() && hasHostedAi() && (getPref() === 'h' || getPref() === null);
  // The on-device model is a 1.6 GB download, so it only ever starts when the student explicitly chooses it.
  const localOn = () => !hostedOn() && webgpuAvailable() && getPref() === '1';
  const hasKey = () => tinyOn() || hostedOn() || localOn() || !!getStoredKey();
  let picking = false;           // the provider picker was opened on purpose (even though the current provider has a key)
  const setupBar = $('aiSetup'), openSettings = () => $('settingsBtn')?.click();
  function refreshKeyUi() { setupBar.hidden = hasKey(); paintProvider(); }
  const select = $('aiProviderSelect');
  function paintSelect() {
    const cur = tinyOn() ? TINY_PROVIDER : hostedOn() ? 'hosted' : localOn() ? LOCAL_PROVIDER : getStoredProvider();
    const tinyOpt = () => { const o = document.createElement('option'); o.value = TINY_PROVIDER; o.textContent = 'CircuitBench tiny model (instant, no GPU)'; o.selected = cur === TINY_PROVIDER; return o; };
    const hostedOpt = () => { const o = document.createElement('option'); o.value = 'hosted'; o.textContent = 'Included with your account'; o.selected = cur === 'hosted'; return o; };
    const localOpt = () => { const o = document.createElement('option'); o.value = LOCAL_PROVIDER; o.textContent = 'On this device (free, no key)'; o.selected = cur === LOCAL_PROVIDER; return o; };
    select.replaceChildren(...(hasHostedAi() ? [hostedOpt()] : []), tinyOpt(), ...(webgpuAvailable() ? [localOpt()] : []), ...PROVIDER_IDS.map(id => { const o = document.createElement('option'); o.value = id; o.textContent = `${PROVIDER_INFO[id].label}${getStoredKey(id) ? ' ✓' : ' (no key)'}`; o.selected = id === cur; return o; }));
  }
  select.addEventListener('change', () => {
    if (select.value === 'hosted') { setPref('h'); keyInput.value = ''; picking = false; setStatus('Using the AI included with your account.'); refreshKeyUi(); return; }
    if (select.value === TINY_PROVIDER) { setPref('t'); keyInput.value = ''; picking = false; setStatus('Using the CircuitBench tiny model.'); refreshKeyUi(); return; }
    if (select.value === LOCAL_PROVIDER) { setPref(true); keyInput.value = ''; picking = false; setStatus('Using the model on this device.'); refreshKeyUi(); return; }
    setPref(false); setStoredProvider(select.value); keyInput.value = '';
    if (hasKey()) { picking = false; setStatus(`Using ${PROVIDER_INFO[select.value].label}.`); } else setStatus(`${PROVIDER_INFO[select.value].label} needs a key — get one below.`);
    refreshKeyUi(); paintProvider();
  });
  function paintProvider() {
    paintSelect();
    const isTiny = tinyOn(), isHosted = hostedOn(), isLocal = localOn() || isHosted || isTiny;
    $('aiKeySave').textContent = isLocal ? 'Done' : 'Save key';
    modelInput.hidden = isLocal; keyInput.hidden = isLocal; $('aiGetKey').hidden = isLocal;
    const cur = getStoredProvider(), info = PROVIDER_INFO[cur];
    $('aiGetKey').href = info.keyUrl; $('aiGetKey').textContent = `Get a ${info.label} key ↗`;
    const hostedTab = () => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.provider = 'hosted'; b.id = 'aiProvider-hosted'; b.classList.toggle('on', isHosted); b.textContent = 'Included'; b.title = 'Free with your account — no key needed'; return b; };
    const localTab = () => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.provider = LOCAL_PROVIDER; b.id = `aiProvider-${LOCAL_PROVIDER}`; b.classList.toggle('on', localOn()); b.textContent = 'On this device'; b.title = 'Runs in your browser — no key, nothing leaves your computer'; return b; };
    const tinyTab = () => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.provider = TINY_PROVIDER; b.id = `aiProvider-${TINY_PROVIDER}`; b.classList.toggle('on', isTiny); b.textContent = 'Tiny model'; b.title = 'CircuitBench’s own 2.5 MB model — instant, works offline, no graphics card or key needed'; return b; };
    tabsEl.replaceChildren(...(hasHostedAi() ? [hostedTab()] : []), tinyTab(), ...(webgpuAvailable() ? [localTab()] : []), ...PROVIDER_IDS.map(id => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.provider = id; b.id = `aiProvider-${id}`;
      b.classList.toggle('on', !isLocal && id === cur); b.classList.toggle('has-key', !!getStoredKey(id));
      b.textContent = `${PROVIDER_INFO[id].label}${getStoredKey(id) ? ' ✓' : ''}`;
      b.title = getStoredKey(id) ? `${PROVIDER_INFO[id].label} — key saved, click to use it` : `${PROVIDER_INFO[id].label} — needs a key`;
      return b;
    }));
    providerHint.replaceChildren();
    if (isTiny) { providerHint.append('CircuitBench’s own tiny model (about 2.5 MB, trained only on this bench): it runs in your browser in milliseconds with no graphics card, no key and no download. It handles plain requests — add, move, wire, change values — but not long sketches; for those, pick another AI above.'); return; }
    if (isHosted) { providerHint.append('CircuitBench’s own AI, free with your account — no key and nothing to download. Switch to another option above any time.'); return; }
    if (isLocal) {
      const m = LOCAL_MODELS.find(x => x.id === getLocalModel()) || LOCAL_MODELS.find(x => x.id === DEFAULT_LOCAL_MODEL) || LOCAL_MODELS[0];
      const sel = document.createElement('select'); sel.className = 'ai-local-model'; sel.setAttribute('aria-label', 'On-device model');
      for (const x of LOCAL_MODELS) { const o = document.createElement('option'); o.value = x.id; o.textContent = `${x.label} (~${(x.sizeMB / 1000).toFixed(1)} GB)`; o.selected = x.id === m.id; sel.append(o); }
      sel.addEventListener('change', () => { setLocalModel(sel.value); paintProvider(); });
      providerHint.append(sel, ' ');
      providerHint.append(`Runs a small open model (${m.label}) inside your browser using your graphics card — no key, nothing leaves your computer. ${m.note} On integrated graphics keep the 1.5B; hosted models with your own free key are smarter on big requests.`);
      return;
    }
    const a = document.createElement('a'); a.href = info.keyUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `Get a ${info.label} key`;
    providerHint.append(a, ` — ${info.hint}`);
    modelInput.placeholder = `Model (optional, default ${info.model})`; modelInput.value = getStoredModel(cur);
    keyInput.placeholder = getStoredKey(cur) ? 'Saved — paste a new key to replace it' : `Paste your ${info.label} API key`;
  }
  tabsEl.addEventListener('click', e => {
    const b = e.target.closest('[data-provider]'); if (!b) return;
    if (b.dataset.provider === 'hosted') { setPref('h'); picking = false; setStatus('Using the AI included with your account.'); refreshKeyUi(); return; }
    if (b.dataset.provider === TINY_PROVIDER) { setPref('t'); picking = false; setStatus('Using the CircuitBench tiny model.'); refreshKeyUi(); return; }
    if (b.dataset.provider === LOCAL_PROVIDER) { setPref(true); picking = false; setStatus('Using the model on this device.'); refreshKeyUi(); return; }
    setPref(false); setStoredProvider(b.dataset.provider); keyInput.value = '';
    if (hasKey()) { picking = false; setStatus(`Using ${PROVIDER_INFO[b.dataset.provider].label}.`); }
    refreshKeyUi(); paintProvider();
  });
  $('aiKeySave').addEventListener('click', () => {
    const v = keyInput.value.trim(), cur = getStoredProvider();
    if (localOn() && !v) { picking = false; refreshKeyUi(); return; }
    if (v) { setStoredKey(v); setPref(false); }
    else if (!getStoredKey(cur)) return setStatus('Paste a key first.');
    setStoredModel(modelInput.value.trim());
    keyInput.value = ''; picking = false; refreshKeyUi(); $('settingsClose')?.click();
    setStatus(`${PROVIDER_INFO[cur].label} ${v ? 'key saved' : 'selected'} — only in this browser.`);
    if (promptEl.value.trim()) send(); else promptEl.focus();
  });
  keyInput.addEventListener('paste', () => setTimeout(() => { if (/^[\w.-]{20,}$/.test(keyInput.value.trim())) $('aiKeySave').click(); }, 0));   // pasting a key saves it: no extra click
  const learnBtn = $('aiLearnToggle');
  const paintLearn = () => { learnBtn.textContent = `learn: ${learningOn() ? 'on' : 'off'}`; learnBtn.setAttribute('aria-pressed', String(learningOn())); };
  learnBtn.addEventListener('click', () => { setLearning(!learningOn()); paintLearn(); setStatus(learningOn() ? 'Learning on: AI-built circuits become instant recipes.' : 'Learning off.'); });
  paintLearn();
  $('aiForgetKey').addEventListener('click', () => { refreshKeyUi(); setStatus(''); openSettings(); });
  $('aiOpenSettings').addEventListener('click', openSettings);
  window.addEventListener('cb-session', () => { refreshKeyUi(); });
  probeWebGPU().then(() => refreshKeyUi());
  if (!globalThis.VLAB_NO_TINY) setTimeout(() => loadTiny().catch(() => {}), 1500);      // fetch the tiny model (2.5 MB) in the background so the first answer is instant      // no usable GPU adapter → stop defaulting to the on-device model

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
      circuitEdit = { parts: applied.parts, wires: applied.wires, customParts: applied.newSpecs };
      warnings = applied.warnings;
      changed = JSON.stringify(circuitEdit.parts) !== JSON.stringify(circuit.parts) || JSON.stringify(circuitEdit.wires) !== JSON.stringify(circuit.wires);
    }
    if (circuitEdit && changed === false && warnings.length === 0) warnings = [...warnings, 'None of the requested circuit changes actually took effect — the AI may be describing an edit it did not really make.'];
    return { circuitEdit: changed ? circuitEdit : null, attempted: !!circuitEdit, changed, warnings };
  }

  /** create_part actions: ask the part maker to draw + define each part, then point add_part at the id it really got. */
  async function resolveNewParts(res) {
    const acts = res.actions; if (!Array.isArray(acts) || !acts.some(a => a?.op === 'create_part')) return;
    const remap = new Map(); let n = 0;
    for (const a of acts) {
      if (a?.op !== 'create_part' || a.spec) continue;
      if (++n > 3) { a.error = 'at most 3 new parts at a time'; continue; }
      setStatus(`Drawing "${String(a.description || a.id).slice(0, 40)}"…`);
      const r = await createPart({ description: String(a.description || a.id || ''), hosted: hostedOn() });
      if (r.ok && r.spec) { a.spec = r.spec; if (a.id && a.id !== r.spec.id) remap.set(a.id, r.spec.id); }
      else a.error = r.error || 'the part maker did not answer';
    }
    for (const a of acts) if (a?.op === 'add_part' && remap.has(a.type)) a.type = remap.get(a.type);
    setStatus('');
  }

  /* ── check what the AI wrote before showing it ──────────────────────────────────────────────────────
   * A proposed sketch is compiled in the background. If it fails, the compiler's errors go back to the same AI (up to MAX_REPAIRS times)
   * so the student is shown code that builds — small on-device models especially get includes, calls and braces wrong on the first try. */
  const MAX_REPAIRS = 2;
  const generate = args => (hostedOn() ? generateCode({ ...args, hosted: true }) : localOn() ? generateLocal(args) : generateCode(args));
  const errorLines = v => (v.diagnostics || []).filter(d => d.severity === 'error').slice(0, 6).map(d => `line ${d.line}: ${d.message}`);
  async function selfCheck(res, args, circuit, text, history) {
    let cur = res, fixed = 0;
    for (let attempt = 0; ; attempt++) {
      setStatus(attempt ? `Checking the fixed sketch compiles (try ${attempt + 1})…` : 'Checking the sketch compiles…');
      const o = outcome(circuit, cur);
      const boardType = o.circuitEdit?.parts?.find(p => BOARD_SPECS[p.type])?.type;
      const v = await code.compileSource(cur.code, { fqbn: boardType ? BOARD_SPECS[boardType].fqbn : undefined });
      if (v.ok || v.unreachable) return { res: cur, failed: null, fixed };      // builds — or there is no compiler to ask, so show it as it is
      if (attempt >= MAX_REPAIRS) return { res: cur, failed: v, fixed };
      const errs = errorLines(v);
      setStatus(`The sketch did not compile (${errs[0] || 'see the compiler output'}) — asking the AI to fix it (${attempt + 1}/${MAX_REPAIRS})…`);
      const proposed = o.circuitEdit ? toProjectFileShape(o.circuitEdit.parts, o.circuitEdit.wires, o.circuitEdit.customParts) : circuit;
      const next = await generate({
        ...args, circuit: proposed, code: cur.code,
        instruction: `The sketch you just wrote does not compile with Arduino CLI. Fix every compile error and return the complete corrected sketch.ino — keep what it does the same, and only use libraries that are installed (Wire, Servo, Stepper, LiquidCrystal_I2C, DHT, Adafruit_GFX, Adafruit_SSD1306, Adafruit_MPU6050, Adafruit_Sensor, Adafruit_BusIO).\nErrors:\n${errs.join('\n') || String(v.output || '').slice(-600)}`,
        context: { ...(args.context || {}), compile: { ok: false, stale: false, errors: (v.diagnostics || []).filter(d => d.severity === 'error').slice(0, 10).map(d => ({ file: d.file, line: d.line, message: d.message })), output: String(v.output || '').slice(-1500) } },
        history: [...history, { role: 'user', text }, { role: 'assistant', text: cur.explanation || 'Here is the sketch.' }],
      }).catch(() => null);
      if (!next?.ok || !next.code || next.code === cur.code) return { res: cur, failed: v, fixed };      // it could not do better: show what we have, honestly
      cur = { ...cur, code: next.code }; fixed++;
    }
  }

  async function send() {
    const text = promptEl.value.trim();
    if (!text) return;
    if (busy) return setStatus('Wait for the current reply first.');
    // Tier 1: plainly worded edits are answered instantly by rules. Tier 2: the CircuitBench tiny model (2.5 MB, in-page, no GPU) understands
    // looser wording and politely declines what is outside the bench. Anything either is unsure about goes on to the chosen AI.
    const asmApi = window.__vlab?.assembly?.ai, in3d = !!asmApi?.active?.();
    let quick = in3d ? null : quickDrone(text, editor.exportProject()) || recipeEdit(text, editor.exportProject(), { sketchIsCustom: isCustomSketch(code.source), learned: learnedRecipes() }) || quickEdit(text, editor.exportProject()), tinyMs = 0;
    if (!quick && !in3d && !globalThis.VLAB_NO_TINY) {
      try {
        const t0 = Date.now(), tiny = await Promise.race([loadTiny(), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
        const u = understand(tiny, text, editor.exportProject());
        if (u) quick = u.kind === 'off' ? { actions: [], code: null, explanation: u.explanation } : u;
        tinyMs = Date.now() - t0; if (quick) quick.viaModel = true;
      } catch { /* the model is optional: no file, still loading, or an old browser — carry on */ }
    }
    if (in3d && !quick) {              // plain 3D requests ("put motors on", "props on the motors") are answered instantly by rules: no model, no key
      let q3 = null; try { q3 = quickAssembly(text, await asmApi.snapshot()); } catch { /* fall through to the AI */ }
      if (q3) {
        messages.push({ id: ++seq, role: 'user', text }); promptEl.value = ''; autosize();
        const ops = q3.actions.slice(0, 60), m3 = { id: ++seq, role: 'assistant', text: q3.explanation, summary: ops.length ? `Proposes: ${ops.length} change${ops.length === 1 ? '' : 's'} to the 3D scene.` : '', warnings: [], hasEdit: ops.length > 0, state: ops.length ? 'pending' : undefined };
        if (ops.length) proposals.set(m3.id, { assemblyOps: ops }); messages.push(m3); saveChat(); render(); return;
      }
    }
    if (!quick && tinyOn() && in3d) {
      messages.push({ id: ++seq, role: 'user', text }); promptEl.value = ''; autosize();
      messages.push({ id: ++seq, role: 'assistant', text: 'The tiny model only does circuit edits. To edit the 3D scene, switch the AI to Gemini, Groq or your own key (the menu at the bottom of this chat), or the AI that comes with your account.' });
      saveChat(); render(); return;
    }
    if (!quick && tinyOn()) {          // the tiny model is the chosen AI: nothing else to hand the request to
      messages.push({ id: ++seq, role: 'user', text }); promptEl.value = ''; autosize();
      messages.push({ id: ++seq, role: 'assistant', text: `The tiny model only does small bench edits — it can't write a sketch or build a whole project like that. To get one, switch the AI (the "Tiny model" tab or the menu at the bottom of this chat) to ${hasHostedAi() ? '"Included" (free with your account)' : webgpuAvailable() ? '"On this device" or an AI with your own free key' : 'an AI with your own free key (Settings → AI)'} and send it again. Or break it into steps the tiny model knows: "add an OLED display", "add a membrane keypad", "wire the OLED to the Uno".` });
      saveChat(); render(); return;
    }
    if (!quick && !hasKey()) { refreshKeyUi(); openSettings(); return setStatus('Add a free API key (or choose an AI) in Settings for requests like this.'); }
    setStatus('');
    const history = chatHistory(messages);
    for (const m of messages) if (m.state === 'pending') { m.state = 'superseded'; proposals.delete(m.id); }   // an older edit no longer matches the board once you've moved on
    messages.push({ id: ++seq, role: 'user', text });
    promptEl.value = ''; autosize();
    busy = true; sendBtn.disabled = true; saveChat(); render();
    try {
      const circuit = in3d ? { parts: [], wires: [] } : editor.exportProject();
      const args = { instruction: text, circuit, code: in3d ? '' : code.source, context: in3d ? null : { ...gatherContext(code, sim), ...(activeWorkspace().robotics ? { drone: droneWiring(editor.state) } : {}) }, history, workspace: activeWorkspace().id, ...(in3d ? { assembly: await asmApi.describe() } : {}) };
      let res, localErr = '';
      if (quick) res = { ok: true, ...quick, meta: quick.viaModel ? { provider: 'CircuitBench model', model: 'tiny · in your browser', ms: tinyMs } : { provider: 'Instant assistant', model: 'built in', ms: 0 } };
      else if (hostedOn()) {
        res = await generateCode({ ...args, hosted: true });
      } else if (localOn()) {
        setStatus('Starting the on-device model…');
        res = await generateLocal({ ...args, onProgress: p => setStatus(p?.progress < 1 ? `Downloading the model (first time only): ${Math.round((p.progress || 0) * 100)}%` : 'Starting the model…') });
        if (!res.ok && hasAnyKey()) { localErr = res.error; console.warn('[on-device AI]', res.error); messages.push({ id: ++seq, role: 'error', text: `On-device model failed: ${res.error}` }); render(); setStatus('On-device model failed — trying your saved key…'); const fb = getStoredKey(getStoredProvider()) ? getStoredProvider() : providersWithKeys()[0]; res = await generateCode({ ...args, provider: fb, userKey: getStoredKey(fb), model: getStoredModel(fb) }); }
      } else res = await generateCode(args);
      if (!res.ok) {
        if (res.needsKey) { setStoredKey(''); refreshKeyUi(); }
        messages.push({ id: ++seq, role: 'error', text: res.error || 'Something went wrong.' });
        return;
      }
      if (res.meta) setStatus(`${res.meta.provider} · ${res.meta.model} · ${(res.meta.ms / 1000).toFixed(1)} s${res.meta.tried ? ` (${res.meta.tried} unavailable model${res.meta.tried > 1 ? 's' : ''} skipped)` : ''}`);
      if (in3d) {                                                                // the reply is 3D edits: keep them for Apply, nothing to compile
        const ops = Array.isArray(res.actions) ? res.actions.filter(a => a && typeof a === 'object').slice(0, 60) : [];
        const m3 = { id: ++seq, role: 'assistant', text: res.explanation || (ops.length ? 'Here is the change.' : 'Done.'), summary: ops.length ? `Proposes: ${ops.length} change${ops.length === 1 ? '' : 's'} to the 3D scene.` : '', warnings: [], hasEdit: ops.length > 0, state: ops.length ? 'pending' : undefined };
        if (ops.length) proposals.set(m3.id, { assemblyOps: ops }); messages.push(m3); return;
      }
      if (activeWorkspace().robotics) res = guardRoboticsBoards(res, text, circuit);
      await resolveNewParts(res);
      let check = { failed: null, fixed: 0 };
      if (res.code && !quick) { check = await selfCheck(res, args, circuit, text, history); res = check.res; }
      const o = outcome(circuit, res);
      if (check.failed) o.warnings = [...o.warnings, `This sketch does not compile yet (${errorLines(check.failed)[0] || 'see the compiler output'}). Apply it and press Fix with AI, or edit it.`];
      const hasEdit = !!(res.code || o.circuitEdit);
      const summary = [];
      if (o.attempted) summary.push(o.changed ? `${res.actions.length} circuit change${res.actions.length === 1 ? '' : 's'}` : 'no circuit change actually applied');
      if (res.code) summary.push('a new sketch');
      const m = {
        id: ++seq, role: 'assistant', text: `${res.explanation || (hasEdit ? 'Here is the change.' : 'Done.')}${check.fixed ? ` (The first version had ${check.fixed === 1 ? 'a compile error' : 'compile errors'}; I checked it with the compiler and fixed ${check.fixed === 1 ? 'it' : 'them'} before showing you.)` : ''}`,
        summary: summary.length ? `Proposes: ${summary.join(' + ')}.` : '', warnings: o.warnings, fatal: o.attempted && !o.changed,
        code: res.code || undefined, codeLines: res.code ? res.code.split('\n').length : 0, hasEdit, state: hasEdit ? 'pending' : undefined,
      };
      const benchWasEmpty = !(circuit.parts || []).some(p => !BOARD_SPECS[p.type] && p.type !== 'breadboard');
      if (hasEdit) proposals.set(m.id, { code: res.code || null, circuitEdit: o.circuitEdit, learn: !quick && benchWasEmpty && !check.failed ? { request: text } : null });
      messages.push(m);
    } catch (err) {
      messages.push({ id: ++seq, role: 'error', text: err?.message || 'Something went wrong.' });
    } finally {
      busy = false; sendBtn.disabled = false; saveChat(); render();
      if (panes.isOpen('ai')) promptEl.focus();
    }
  }

  /* ── opening / closing ───────────────── */
  function focusInput() { refreshKeyUi(); promptEl.focus(); }
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

  /** Switch to the conversation that belongs to this project (the old single chat is adopted by the first project that asks). */
  function setScope(projectId) {
    const key = `${CHAT_STORE}:${projectId}`;
    if (key === chatKey || busy) return;
    try {
      if (localStorage.getItem(key) === null && localStorage.getItem(CHAT_STORE) !== null) { localStorage.setItem(key, localStorage.getItem(CHAT_STORE)); localStorage.removeItem(CHAT_STORE); }
    } catch { /* ignore */ }
    chatKey = key; proposals.clear(); messages = loadChat(); render();
  }

  paintProvider(); refreshKeyUi(); render();
  const clearChat = () => { messages = []; proposals.clear(); saveChat(); render(); };
  return { askAi, send, setScope, clearChat, refresh: () => { refreshKeyUi(); paintProvider(); }, get messages() { return messages; } };
}
