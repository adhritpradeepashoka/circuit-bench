// The Feedback button: a short note to the team. Admins read the notes in Settings.
import { authed, getMe } from '../sim/session.mjs';
import { activeWorkspace } from '../core/workspaces.js';

export function initFeedback({ status = () => {} } = {}) {
  const $ = id => document.getElementById(id), modal = $('feedbackModal'); if (!modal) return;
  const HINT = $('feedbackNote').innerHTML;
  const close = () => { modal.hidden = true; };
  const open = () => { modal.hidden = false; $('feedbackNote').innerHTML = HINT; $('feedbackText').focus(); };
  $('feedbackBtn').addEventListener('click', open); $('feedbackClose').addEventListener('click', close);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  $('feedbackForm').addEventListener('submit', async e => {
    e.preventDefault(); const text = $('feedbackText').value.trim(); if (text.length < 3) return;
    const kind = modal.querySelector('input[name=fbKind]:checked')?.value || 'other', btn = $('feedbackSend'); btn.disabled = true;
    try {
      const r = await authed('/api/feedback', { method: 'POST', body: { kind, text, page: activeWorkspace().id } }), j = await r.json().catch(() => null);
      if (j?.ok) { $('feedbackText').value = ''; close(); status('Thank you. Your feedback was sent.'); }
      else $('feedbackNote').textContent = j?.error || 'Could not send it. Check your connection and try again.';
    } catch { $('feedbackNote').textContent = 'Could not send it. Check your connection and try again.'; }
    btn.disabled = false;
  });

  /* admins: the notes, newest first */
  const list = $('fbList'), el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  async function load() {
    if (!getMe()?.entitlements?.admin || !list) return;
    try {
      const j = await (await authed('/api/feedback')).json(); if (!j?.ok) { list.replaceChildren(el('p', 'proj-note', j?.error || 'Could not load feedback.')); return; }
      list.replaceChildren(...(j.feedback.length ? j.feedback.map(f => {
        const row = el('div', 'proj-row fb-row'), main = el('div', 'proj-main'), del = el('button', 'proj-act', 'Done'); del.type = 'button'; del.title = 'Remove this note';
        main.append(el('b', '', f.text), el('span', 'proj-meta', `${f.kind} · ${new Date(f.createdAt).toLocaleString()}${f.email ? ` · ${f.email}` : ' · not signed in'}${f.page ? ` · ${f.page}` : ''}`));
        del.addEventListener('click', async () => { await authed(`/api/feedback?id=${f.id}`, { method: 'DELETE' }).catch(() => {}); load(); });
        row.append(main, del); return row;
      }) : [el('p', 'proj-note', 'No feedback yet.')]));
    } catch { /* offline */ }
  }
  $('fbRefresh')?.addEventListener('click', load); $('settingsBtn')?.addEventListener('click', () => setTimeout(load, 300));
}
