// Settings → Account and Members (admins only). Everything here is a request to the server, which re-checks who is asking:
// hiding the panel from non-admins is for tidiness, not security.
import { getMe, authed } from '../sim/session.mjs';
import { STAFF_THEMES } from '../core/staff-themes.js';

export function initAdmin({ fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const note = t => { $('adminNote').textContent = t || ''; };
  const call = (path, opts) => authed(path, { fetchImpl, ...opts }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

  function paintAccount() {
    const me = getMe(), info = $('setAccountInfo');
    if (!me) info.textContent = 'Sign in with Google (top bar) to keep beta access with your account.';
    else info.textContent = `${me.name || me.email} · ${me.email} · ${me.role === 'user' ? 'free account' : me.role}${me.entitlements?.hostedAi ? ' · included AI on' : ''}${me.entitlements?.seat === false ? ' · the site is busy, so free extras are paused' : ''}`;
    const admin = !!me?.entitlements?.admin;
    $('setAdmin').hidden = !admin;
    const sel = $('adminRole'); sel.replaceChildren(...(me?.entitlements?.owner ? ['beta', 'admin'] : ['beta']).map(r => Object.assign(el('option', '', r[0].toUpperCase() + r.slice(1)), { value: r })));
    return admin;
  }

  async function load() {
    if (!paintAccount()) return;
    const { status, body } = await call('/api/admin/users');
    if (status !== 200 || !body?.users) { note(body?.error || 'Could not load members.'); return; }
    const o = body.online; $('setAdminOnline').textContent = `${o.online} online${o.cap ? ` · free cap ${o.cap}` : ''}`;
    const me = getMe();
    $('adminList').replaceChildren(...body.users.map(u => {
      const row = el('div', 'proj-row'), main = el('div', 'proj-main'), acts = el('div', 'proj-acts');
      main.append(el('b', '', u.name || u.email), el('span', 'proj-meta', `${u.email} · ${u.role}${u.lastSeen ? ` · seen ${new Date(u.lastSeen).toLocaleDateString()}` : ' · invited'}`));
      const fixed = u.role === 'owner' || (u.role === 'admin' && !me.entitlements.owner);
      if (!fixed) {
        const b = el('button', 'proj-act', u.role === 'user' ? 'Make beta' : 'Remove access'); b.type = 'button';
        b.addEventListener('click', () => change(u.email, u.role === 'user' ? 'beta' : 'user'));
        acts.append(b);
      }
      if (me.entitlements.owner && u.role !== 'owner') {            // the owner can hand out team themes one by one
        for (const t of STAFF_THEMES) {
          const has = (u.themes || []).includes(t.id); if (t.tier === 'admin' && u.role === 'admin') continue;
          const b = el('button', 'proj-act', `${has ? 'Take away' : 'Give'} ${t.label} theme`); b.type = 'button';
          b.addEventListener('click', () => grant(u.email, has ? (u.themes || []).filter(x => x !== t.id) : [...(u.themes || []), t.id]));
          acts.append(b);
        }
      }
      row.append(main, acts); return row;
    }));
  }
  async function grant(email, themes) {
    note('');
    const { body } = await call('/api/admin/users', { method: 'POST', body: { email, themes } });
    note(body?.ok ? `${email} can now wear: ${themes.length ? themes.join(', ') : 'no team themes'}.` : body?.error || 'That did not work.');
    await load();
  }
  async function change(email, role) {
    note('');
    const { body } = await call('/api/admin/users', { method: 'POST', body: { email, role } });
    note(body?.ok ? `${email} is now ${role === 'user' ? 'a free user' : role}.` : body?.error || 'That did not work.');
    await load();
  }
  $('adminForm').addEventListener('submit', async e => { e.preventDefault(); const em = $('adminEmail').value.trim(); if (!em) return; await change(em, $('adminRole').value); if (!$('adminNote').textContent.includes('not')) $('adminEmail').value = ''; });
  window.addEventListener('cb-session', load);
  return { load, paintAccount };
}
