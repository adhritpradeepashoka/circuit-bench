// Wires the "✨ Ask AI" popover in the code dock: shows the key prompt (beta, bring-your-own-key) when
// needed, sends the instruction + circuit + current sketch to the server, and lets the user apply or
// discard the result. See src/sim/ai-client.mjs for the BYOK rationale and request shape.
import { generateCode, getStoredKey, setStoredKey } from '../sim/ai-client.mjs';

export function initAiPanel(editor, code) {
  const $ = id => document.getElementById(id);
  const btn = $('aiBtn'), panel = $('aiPanel'), keyRow = $('aiKeyRow'), askRow = $('aiAskRow'), resultRow = $('aiResult');
  const keyInput = $('aiKeyInput'), status = $('aiStatus'), promptEl = $('aiPrompt'), explainEl = $('aiExplain');
  let lastCode = null, pending = null;

  const setStatus = (msg, busy = false) => { status.textContent = msg || ''; status.classList.toggle('busy', busy); };
  const hasKey = () => !!getStoredKey();
  function refreshKeyUi() { keyRow.hidden = hasKey(); }

  function open() { panel.hidden = false; refreshKeyUi(); setStatus(''); if (!hasKey()) keyInput.focus(); else promptEl.focus(); }
  function close() { panel.hidden = true; }

  btn.addEventListener('click', e => { e.stopPropagation(); panel.hidden ? open() : close(); });
  document.addEventListener('click', e => { if (!panel.hidden && !e.target.closest('.ai-menu')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

  $('aiKeySave').addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (!v) return setStatus('Paste a key first.');
    setStoredKey(v); keyInput.value = ''; refreshKeyUi(); setStatus('Key saved — only in this browser.'); promptEl.focus();
  });
  $('aiForgetKey').addEventListener('click', () => { setStoredKey(''); refreshKeyUi(); setStatus(''); keyInput.focus(); });

  $('aiGenerate').addEventListener('click', async () => {
    const instruction = promptEl.value.trim();
    if (!instruction) return setStatus('Describe what you want first.');
    if (!hasKey()) return refreshKeyUi();
    const genBtn = $('aiGenerate');
    genBtn.disabled = true; setStatus('Asking the AI…', true); resultRow.hidden = true;
    try {
      lastCode = code.source;
      const circuit = editor.exportProject();
      const res = await generateCode({ instruction, circuit, code: lastCode });
      if (!res.ok) {
        if (res.needsKey) { setStoredKey(''); refreshKeyUi(); }
        setStatus(res.error || 'Something went wrong.');
        return;
      }
      pending = res.code;
      explainEl.textContent = res.explanation || 'Ready to apply.';
      resultRow.hidden = false; setStatus('');
    } catch (err) {
      setStatus(err?.message || 'Something went wrong.');
    } finally {
      genBtn.disabled = false;
    }
  });

  $('aiApply').addEventListener('click', () => {
    if (pending == null) return;
    code.source = pending; code.open();
    editor.status('AI edit applied to sketch.ino — Verify to compile it');
    resultRow.hidden = true; promptEl.value = ''; pending = null; close();
  });
  $('aiDiscard').addEventListener('click', () => { resultRow.hidden = true; pending = null; });
}
