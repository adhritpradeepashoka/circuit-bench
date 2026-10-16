// Wires the "✨ Ask AI" popover in the code dock: shows the key prompt (beta, bring-your-own-key) when
// needed, sends the instruction + circuit + current sketch to the server, and lets the user apply or
// discard the result — which can now be a circuit edit (parts/wires), a firmware edit, or both.
// See src/sim/ai-client.mjs for the BYOK rationale and request shape, and src/core/ai-actions.js for
// how proposed circuit edits are validated against the real part/pin catalogue before anything renders.
import { generateCode, getStoredKey, setStoredKey, getStoredProvider, setStoredProvider } from '../sim/ai-client.mjs';
import { applyCircuitActions } from '../core/ai-actions.js';
import { FORMAT, VERSION } from '../core/project.js';

const PROVIDER_HINTS = {
  gemini: '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free Gemini key</a> at Google AI Studio. If that page says "project creation failed" (a known Google-side bug on some accounts), switch to the Groq tab above instead.',
  groq: '<a href="https://console.groq.com/keys" target="_blank" rel="noopener">Get a free Groq key</a> at console.groq.com — no Google account step involved.',
};

// applyCircuitActions already works in — and returns — the project-file shape (parts use "rotate",
// wires use from/to), the same shape editor.exportProject()/fromProjectFile() use, so no field remapping
// is needed here. (A previous version of this remapped "rot" <-> "rotate" and, for any part the AI's
// actions didn't touch, silently reset its rotation to 0 on every circuit edit — fixed by making
// ai-actions.js use the project-file field name throughout instead of patching it up here.)
function toProjectFileShape(parts, wires) {
  return { format: FORMAT, version: VERSION, parts, wires };
}

export function initAiPanel(editor, code) {
  const $ = id => document.getElementById(id);
  const btn = $('aiBtn'), panel = $('aiPanel'), keyRow = $('aiKeyRow'), askRow = $('aiAskRow'), resultRow = $('aiResult');
  const keyInput = $('aiKeyInput'), status = $('aiStatus'), promptEl = $('aiPrompt'), explainEl = $('aiExplain');
  const summaryEl = $('aiSummary'), warningsEl = $('aiWarnings'), applyBtn = $('aiApply');
  const providerTabs = $('aiKeyRow').querySelectorAll('[data-provider]'), providerHint = $('aiProviderHint');
  let pending = null; // { code, circuitEdit: {parts, wires} | null }

  /** applyCircuitActions never throws away a change silently — but every op it can't do pushes a warning. A model that narrates a change it didn't actually request (no matching action, or every matching action warned) is the "it says it rewired but didn't" case — catch it structurally instead of trusting the explanation text. */
  function describeOutcome(circuit, actionCount, circuitEdit, warnings) {
    if (!actionCount) return { changed: null, warnings };
    const changed = JSON.stringify(circuitEdit.parts) !== JSON.stringify(circuit.parts) || JSON.stringify(circuitEdit.wires) !== JSON.stringify(circuit.wires);
    return { changed, warnings };
  }

  const setStatus = (msg, busy = false) => { status.textContent = msg || ''; status.classList.toggle('busy', busy); };
  const hasKey = () => !!getStoredKey();
  function refreshKeyUi() { keyRow.hidden = hasKey(); }
  function paintProvider() {
    const p = getStoredProvider();
    providerTabs.forEach(b => b.classList.toggle('on', b.dataset.provider === p));
    providerHint.innerHTML = PROVIDER_HINTS[p] || '';
  }
  providerTabs.forEach(b => b.addEventListener('click', () => { setStoredProvider(b.dataset.provider); paintProvider(); }));
  paintProvider();

  function open() { panel.hidden = false; refreshKeyUi(); setStatus(''); if (!hasKey()) keyInput.focus(); else promptEl.focus(); }
  function close() { panel.hidden = true; }

  btn.addEventListener('click', e => { e.stopPropagation(); panel.hidden ? open() : close(); });
  document.addEventListener('click', e => { if (!panel.hidden && !e.target.closest('.ai-menu')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

  $('aiKeySave').addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (!v) return setStatus('Paste a key first.');
    setStoredKey(v); keyInput.value = ''; refreshKeyUi(); setStatus(`${getStoredProvider() === 'groq' ? 'Groq' : 'Gemini'} key saved — only in this browser.`); promptEl.focus();
  });
  $('aiForgetKey').addEventListener('click', () => { setStoredKey(''); refreshKeyUi(); setStatus(''); paintProvider(); keyInput.focus(); });

  $('aiGenerate').addEventListener('click', async () => {
    const instruction = promptEl.value.trim();
    if (!instruction) return setStatus('Describe what you want first.');
    if (!hasKey()) return refreshKeyUi();
    const genBtn = $('aiGenerate');
    genBtn.disabled = true; setStatus('Asking the AI…', true); resultRow.hidden = true;
    try {
      const circuit = editor.exportProject();
      const res = await generateCode({ instruction, circuit, code: code.source });
      if (!res.ok) {
        if (res.needsKey) { setStoredKey(''); refreshKeyUi(); }
        setStatus(res.error || 'Something went wrong.');
        return;
      }
      let circuitEdit = null, warnings = [], changed = null;
      if (res.actions?.length) {
        const applied = applyCircuitActions(circuit, res.actions);
        circuitEdit = { parts: applied.parts, wires: applied.wires };
        ({ changed, warnings } = describeOutcome(circuit, res.actions.length, circuitEdit, applied.warnings));
      }
      // A circuit edit that applies cleanly (no net change, and nothing it tried warned) is suspicious on its own —
      // it asked to touch the board and nothing moved. Treat that as a failure to surface, not a quiet no-op.
      const silentNoop = circuitEdit && changed === false && warnings.length === 0;
      pending = { code: res.code, circuitEdit: changed ? circuitEdit : null };

      const summary = [];
      if (circuitEdit) summary.push(changed ? `${res.actions.length} circuit change${res.actions.length === 1 ? '' : 's'} applied` : 'no circuit change actually applied');
      if (res.code) summary.push('new sketch ready');
      summaryEl.textContent = summary.length ? `Will update: ${summary.join(' + ')}.` : '';
      explainEl.textContent = res.explanation || 'Ready to apply.';

      const allWarnings = silentNoop ? [...warnings, 'None of the requested circuit changes actually took effect — the AI may be describing an edit it did not really make.'] : warnings;
      warningsEl.hidden = allWarnings.length === 0;
      warningsEl.classList.toggle('fatal', circuitEdit != null && !changed);
      warningsEl.innerHTML = '';
      for (const w of allWarnings) { const li = document.createElement('li'); li.textContent = w; warningsEl.appendChild(li); }

      applyBtn.disabled = !pending.code && !pending.circuitEdit;
      applyBtn.textContent = applyBtn.disabled ? 'Nothing to apply' : 'Apply';
      resultRow.hidden = false; setStatus('');
    } catch (err) {
      setStatus(err?.message || 'Something went wrong.');
    } finally {
      genBtn.disabled = false;
    }
  });

  $('aiApply').addEventListener('click', () => {
    if (!pending) return;
    if (pending.circuitEdit) editor.importProject(toProjectFileShape(pending.circuitEdit.parts, pending.circuitEdit.wires));
    if (pending.code) { code.source = pending.code; code.open(); }
    editor.status(pending.circuitEdit && pending.code ? 'AI edit applied — circuit and sketch.ino both updated' : pending.circuitEdit ? 'AI edit applied to the circuit' : 'AI edit applied to sketch.ino — Verify to compile it');
    resultRow.hidden = true; promptEl.value = ''; pending = null; close();
  });
  $('aiDiscard').addEventListener('click', () => { resultRow.hidden = true; pending = null; warningsEl.hidden = true; });
}
