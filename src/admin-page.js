// The admin console (/admin): everyone who has signed in or been invited, and for each person what they may do. Every change is saved the moment it is made,
// and the server tells that person's open page straight away, so a lock takes effect while they are using it. The server re-checks who is asking on every call;
// this page only shows the controls.
import './admin.css';
import './core/workspaces.js';
import { WORKSPACES } from './core/projects.js';
import { authed, getToken, setSession } from './sim/session.mjs';
import { PERMISSION_FEATURES, PERMISSION_PRESETS, cleanPerms, hasLimits } from './core/permissions.js';

const $app = document.getElementById('app');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const call = (path, opts) => authed(path, opts).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const wsName = id => WORKSPACES[id]?.name || id;
const initial = u => (u.name || u.email || '?').trim()[0]?.toUpperCase() || '?';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let me = null, users = [], selected = '', filter = 'all', query = '', say = { text: '', bad: false }, listEl, detailEl, countEl;

const permsOf = u => cleanPerms(u?.perms);
const canEdit = u => !!u && u.role !== 'owner' && u.email !== me.email && (u.role !== 'admin' || !!me.entitlements?.owner);
const why = u => u.role === 'owner' ? 'The owner can never be limited.' : u.email === me.email ? 'You cannot limit your own account, so you cannot lock yourself out.' : 'Only the owner can limit an admin.';

function gate(title, text, link) {
  $app.replaceChildren(Object.assign(el('div', 'gate'), {}));
  const g = $app.firstChild; g.append(el('h1', '', title), el('p', '', text)); if (link) { const a = el('a', 'btn', link[0]); a.href = link[1]; g.append(a); }
}

async function start() {
  if (!getToken()) return gate('Sign in first', 'Open the lab and sign in with Google, then come back to this page.', ['Open the lab', '/app']);
  const r = await call('/api/me');
  if (r.status === 401) { setSession('', null); return gate('Please sign in again', 'Your sign-in has expired.', ['Open the lab', '/app']); }
  me = r.body?.me; if (!me) return gate('Admin is not available', 'The server did not answer. Try again in a moment.');
  document.getElementById('who').textContent = `${me.name || me.email} · ${me.role}`;
  if (!me.entitlements?.admin) return gate('Admins only', 'This page is for the owner and admins.', ['Open the lab', '/app']);
  build(); await load(true);
  setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(false); });
}

function build() {
  const people = el('div', 'people'), head = el('div', 'people-head');
  const search = Object.assign(el('input'), { type: 'search', placeholder: 'Search people', ariaLabel: 'Search people', id: 'adminSearch' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); paintList(); });
  const filters = el('div', 'filters', ''); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Show');
  for (const [id, label] of [['all', 'Everyone'], ['online', 'Online now'], ['limited', 'Limited'], ['blocked', 'Blocked']]) {
    const b = Object.assign(el('button', `chip${id === filter ? ' on' : ''}`, label), { type: 'button' }); b.dataset.filter = id;
    b.addEventListener('click', () => { filter = id; for (const c of filters.children) c.classList.toggle('on', c.dataset.filter === id); paintList(); });
    filters.append(b);
  }
  countEl = el('small', 'count'); head.append(search, filters, countEl);
  listEl = el('ul', 'list'); listEl.setAttribute('aria-label', 'People');
  const add = el('form', 'add'), em = Object.assign(el('input'), { type: 'email', placeholder: 'Add someone by email', ariaLabel: 'Email address to add', id: 'adminAddEmail', required: true });
  add.append(em, Object.assign(el('button', '', 'Add'), { type: 'submit' }));
  add.addEventListener('submit', async e => {
    e.preventDefault(); const email = em.value.trim(); if (!email) return;
    const { body } = await call('/api/admin/permissions', { method: 'POST', body: { email, perms: {} } });
    if (!body?.ok) { flash(body?.error || 'That did not work.', true); return; }
    em.value = ''; selected = email.toLowerCase(); await load(true);
  });
  people.append(head, listEl, add);
  detailEl = el('div', 'detail'); detailEl.id = 'adminDetail';
  $app.replaceChildren(people, detailEl);
}

async function load(force) {
  const { status, body } = await call('/api/admin/users');
  if (status !== 200 || !body?.users) { if (force) flash(body?.error || 'Could not load people.', true); return; }
  const before = users; users = body.users.sort((a, b) => (b.online - a.online) || (a.name || a.email).localeCompare(b.name || b.email));
  paintList();
  const u = users.find(x => x.email === selected), was = before.find(x => x.email === selected);
  if (force || !detailEl.contains(document.activeElement) && (!same(u && [u.role, u.perms, u.online], was && [was.role, was.perms, was.online]))) paintDetail();
}

function matches(u) {
  const p = permsOf(u);
  if (filter === 'online' && !u.online) return false;
  if (filter === 'limited' && !(hasLimits(p) && !p.blocked)) return false;
  if (filter === 'blocked' && !p.blocked) return false;
  return !query || `${u.name || ''} ${u.email}`.toLowerCase().includes(query);
}
function tagsFor(u) {
  const p = permsOf(u), t = [];
  if (p.blocked) t.push(['Blocked', 'bad']);
  else { if (p.workspace) t.push([`${wsName(p.workspace)} only`, 'warn']); if (p.off.length) t.push([`${p.off.length} off`, 'warn']); }
  if (u.role !== 'user') t.push([u.role, '']);
  if (!u.sub && !u.lastSeen && u.role !== 'owner') t.push(['invited', '']);
  return t;
}
function paintList() {
  const shown = users.filter(matches);
  countEl.textContent = `${shown.length} of ${users.length}${users.some(u => u.online) ? ` · ${users.filter(u => u.online).length} online` : ''}`;
  listEl.replaceChildren(...shown.map(u => {
    const li = el('li'), b = Object.assign(el('button', 'person'), { type: 'button' }); b.dataset.email = u.email; b.setAttribute('aria-current', String(u.email === selected));
    const av = el('span', `avatar${u.online ? ' on' : ''}`, initial(u)), main = el('span'); main.append(el('b', '', u.name || u.email), el('small', '', u.name ? u.email : u.lastSeen ? `seen ${new Date(u.lastSeen).toLocaleDateString()}` : 'not signed in yet'));
    const tags = el('span', 'tags'); for (const [text, kind] of tagsFor(u)) tags.append(el('span', `tag ${kind}`, text));
    b.append(av, main, tags); b.addEventListener('click', () => { selected = u.email; say = { text: '', bad: false }; paintList(); paintDetail(); });
    li.append(b); return li;
  }));
  if (!shown.length) listEl.replaceChildren(el('li', 'empty', users.length ? 'Nobody matches.' : 'Nobody yet. Add someone by email below.'));
}

const flash = (text, bad = false) => { say = { text, bad }; const s = document.getElementById('adminSaved'); if (s) { s.textContent = text; s.classList.toggle('bad', bad); } };

async function save(u, mutate) {
  const next = permsOf(u); mutate(next);
  const prev = u.perms; u.perms = next; paintList(); paintDetail(); flash('Saving…');
  const { body } = await call('/api/admin/permissions', { method: 'POST', body: { email: u.email, perms: next } });
  if (body?.ok) { u.perms = body.user?.perms ?? null; flash(u.online ? 'Saved. They have it now.' : 'Saved. It applies the next time they open the lab.'); }
  else { u.perms = prev; flash(body?.error || 'That did not work.', true); }
  paintList(); paintDetail(); flash(say.text, say.bad);
}
async function setRole(u, role) {
  const { body } = await call('/api/admin/users', { method: 'POST', body: { email: u.email, role } });
  if (body?.ok) { await load(true); flash(`${u.name || u.email} is now ${role === 'user' ? 'a free user' : role}.`); } else flash(body?.error || 'That did not work.', true);
}

function toggle(label, note, on, onChange, { danger = false, disabled = false } = {}) {
  const row = el('div', 'row'), text = el('div'), sw = el('label', `switch${danger ? ' danger' : ''}`), inp = Object.assign(el('input'), { type: 'checkbox', checked: on, disabled });
  text.append(el('b', '', label), el('small', '', note)); inp.setAttribute('aria-label', label); inp.addEventListener('change', () => onChange(inp.checked));
  sw.append(inp, el('span')); row.append(text, sw); return row;
}

function paintDetail() {
  const u = users.find(x => x.email === selected);
  if (!u) { detailEl.replaceChildren(el('p', 'empty', 'Pick someone from the list to see what they can do.')); return; }
  const p = permsOf(u), edit = canEdit(u);
  const head = el('div', 'who-head'), who = el('div');
  who.append(el('h1', '', u.name || u.email), el('p', '', u.name ? u.email : 'Has not signed in yet'));
  const live = el('span', `live${u.online ? ' on' : ''}`); live.append(el('i'), document.createTextNode(u.online ? 'Online now' : u.lastSeen ? `Last seen ${new Date(u.lastSeen).toLocaleString()}` : 'Never signed in'));
  head.append(el('span', `avatar${u.online ? ' on' : ''}`, initial(u)), who); head.append(Object.assign(el('span'), { style: 'flex:1' }), live);
  const saved = el('p', `saved${say.bad ? ' bad' : ''}`, say.text); saved.id = 'adminSaved'; saved.setAttribute('role', 'status');
  if (!edit) { const s = el('section'); s.append(el('p', 'locked-note', why(u))); detailEl.replaceChildren(head, saved, s); return; }

  const presets = el('section'); presets.append(el('h2', '', 'Start from a preset'), el('p', '', 'Applies right away. You can change any switch afterwards.'));
  const prow = el('div', 'presets');
  for (const pr of PERMISSION_PRESETS) {
    const c = cleanPerms(pr.perms), isOn = same([c.off.slice().sort(), c.workspace, c.blocked], [p.off.slice().sort(), p.workspace, p.blocked]);
    const b = Object.assign(el('button', `preset${isOn ? ' on' : ''}`), { type: 'button' }); b.dataset.preset = pr.id; b.append(el('b', '', pr.label), el('span', '', pr.note));
    b.addEventListener('click', () => save(u, n => { Object.assign(n, { off: c.off, workspace: c.workspace, blocked: c.blocked }); })); prow.append(b);
  }
  presets.append(prow);

  const ws = el('section'); ws.append(el('h2', '', 'Workspace'), el('p', '', 'Keep them in one workspace. New projects start there, and their other projects stay hidden.'));
  const f = el('div', 'field'), sel = Object.assign(el('select'), { id: 'adminWorkspace' }); sel.setAttribute('aria-label', 'Workspace');
  sel.append(Object.assign(el('option', '', 'Any workspace'), { value: '' }));
  for (const [id, w] of Object.entries(WORKSPACES)) if (w.available) sel.append(Object.assign(el('option', '', w.mix ? `${w.name} (mix)` : w.name), { value: id }));
  sel.value = p.workspace && WORKSPACES[p.workspace] ? p.workspace : ''; sel.addEventListener('change', () => save(u, n => { n.workspace = sel.value || null; }));
  f.append(sel); ws.append(f);

  const feat = el('section'); feat.append(el('h2', '', 'What they can use'), el('p', '', 'Switched on means allowed. The AI helper and the community are also refused by the server.'));
  for (const ft of PERMISSION_FEATURES) { const row = toggle(ft.label, ft.note, !p.off.includes(ft.id), on => save(u, n => { n.off = on ? n.off.filter(x => x !== ft.id) : [...n.off, ft.id]; })); row.querySelector('input').dataset.feature = ft.id; feat.append(row); }

  const role = el('section'); role.append(el('h2', '', 'Account'), el('p', '', 'Beta testers get the AI helper and every premium feature. Limits above still apply to them.'));
  const rf = el('div', 'field'), rs = Object.assign(el('select'), { id: 'adminRole' }); rs.setAttribute('aria-label', 'Role');
  for (const [v, l] of [['user', 'Free user'], ['beta', 'Beta tester'], ...(me.entitlements?.owner ? [['admin', 'Admin']] : [])]) rs.append(Object.assign(el('option', '', l), { value: v }));
  rs.value = u.role; rs.addEventListener('change', () => setRole(u, rs.value)); rf.append(rs); role.append(rf);

  const nt = el('section'); nt.append(el('h2', '', 'Note'), el('p', '', 'For the admins, and shown to them if you block the account.'));
  const ta = Object.assign(el('textarea', 'note'), { value: p.note, maxLength: 200, id: 'adminNote', placeholder: 'For example: testing the CoreWing FC wiring' }); ta.setAttribute('aria-label', 'Note');
  let t = 0; ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => save(u, n => { n.note = ta.value; }), 700); }); nt.append(ta);

  const dz = el('section', 'danger-zone'); dz.append(el('h2', '', 'Block'), el('p', '', 'They cannot sign in again, and an open page shows “This account is blocked” straight away. They stay blocked until you switch this off.'));
  const bk = toggle('Block this account', p.blocked ? 'Blocked now' : 'Not blocked', p.blocked, on => save(u, n => { n.blocked = on; }), { danger: true }); bk.querySelector('input').id = 'adminBlock'; dz.append(bk);
  detailEl.replaceChildren(head, saved, presets, ws, feat, nt, role, dz);
}

start();
