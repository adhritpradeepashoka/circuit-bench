// The Settings dialog (⚙ in the top bar, beside the account): AI keys and models, appearance, and the housekeeping
// switches that don't belong on the bench. The AI key form itself is owned by ai-panel.js and lives in this dialog.
import { themesFor, FONTS, getTheme, setTheme, getCustom, setCustom } from './theme.js';
import { initAdmin } from './admin.js';
import { cachedModels, deleteLocalModels } from '../sim/webllm.mjs';
import { PROVIDER_IDS, setStoredKey } from '../sim/ai-client.mjs';

export function initSettings({ tour, ai, status = () => {} }) {
  const $ = id => document.getElementById(id);
  const modal = $('settingsModal');
  const admin = initAdmin();
  async function paintModel() {
    const have = await cachedModels();
    $('setModelInfo').textContent = have.length ? `Downloaded on this device: ${have.map(i => i.replace(/-q\d.*$/, '')).join(', ')}. You can delete it any time.` : 'Nothing is downloaded. The on-device model (about 1.6 GB, once) only downloads if you choose “On this device” above.';
    $('setDeleteModel').disabled = !have.length;
  }
  $('setDeleteModel').addEventListener('click', async () => { $('setDeleteModel').disabled = true; const n = await deleteLocalModels(); status(n ? `Deleted ${n} downloaded model${n > 1 ? 's' : ''}` : 'No downloaded models found'); ai.refresh(); paintModel(); });
  const open = () => { admin.load(); paintModel(); paintThemes(); modal.hidden = false; $('settingsClose').focus(); };
  const close = () => { modal.hidden = true; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function paintThemes() {
    const cur = getTheme();
    $('themeList').replaceChildren(...themesFor().map(t => {
      const b = el('button', 'theme-opt'); b.type = 'button'; b.dataset.theme = t.id; b.setAttribute('aria-pressed', String(t.id === cur));
      b.append(el('span', `theme-swatch sw-${t.id}`), el('b', '', t.label), el('span', 'proj-meta', t.note));
      return b;
    }));
    const cu = $('themeCustom'), c = getCustom();
    cu.hidden = cur !== 'custom';
    for (const k of ['bar', 'bg', 'text', 'accent']) $(`cu-${k}`).value = c[k];
    $('cu-font').value = c.font;
  }
  for (const k of ['bar', 'bg', 'text', 'accent']) $(`cu-${k}`).addEventListener('input', e => setCustom({ [k]: e.target.value }));
  $('cu-font').replaceChildren(...Object.entries(FONTS).map(([id, f]) => { const o = el('option', '', f.label); o.value = id; return o; }));
  $('cu-font').addEventListener('change', e => setCustom({ font: e.target.value }));
  $('themeList').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (!b) return; setTheme(b.dataset.theme); paintThemes(); });
  window.addEventListener('cb-session', () => { if (!modal.hidden) paintThemes(); });
  $('settingsBtn').addEventListener('click', open);
  $('settingsClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  $('setTour').addEventListener('click', () => { close(); tour.start(); });
  $('setGuide').addEventListener('click', () => { close(); tour.startGuide(); });
  $('setHint').addEventListener('click', () => { const c = $('hintCard'); if (c) c.hidden = false; close(); });
  $('setClearChat').addEventListener('click', () => { ai.clearChat(); status('AI chat history cleared'); });
  $('setForgetKeys').addEventListener('click', () => { for (const p of PROVIDER_IDS) setStoredKey('', p); ai.refresh(); status('All saved API keys removed from this browser'); });
  return { open, close, get isOpen() { return !modal.hidden; } };
}
