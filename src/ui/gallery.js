// The public gallery: projects other people chose to share. Anyone can look; "Copy to my projects" makes it yours to change (the original never changes).
// A shared project is found by an opaque handle, never by its owner's email; the author shows as a first name and an initial.
import { WORKSPACES } from '../core/projects.js';
import { getToken, authed } from '../sim/session.mjs';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const api = async path => { try { const r = await (getToken() ? authed(path) : fetch(path)); return await r.json(); } catch { return { ok: false, error: 'Could not reach the server.' }; } };

export function summarize(data) {
  const parts = Array.isArray(data?.parts) ? data.parts : [], counts = new Map();
  for (const p of parts) if (p?.type) counts.set(p.type, (counts.get(p.type) || 0) + 1);
  const code = typeof data?.sketch === 'string' ? data.sketch : (Array.isArray(data?.files) && data.files[0]?.content) || '';
  return { parts: parts.length, wires: Array.isArray(data?.wires) ? data.wires.length : 0, kinds: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12), code: String(code).split('\n').slice(0, 24).join('\n') };
}

export function initGallery({ projects, status = () => {} }) {
  const modal = el('div', 'modal'); modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Public projects');
  const card = el('div', 'modal-card proj-card'), head = el('div', 'modal-head'), title = el('h2', '', 'Public projects');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Search public projects'; search.setAttribute('aria-label', 'Search public projects'); search.className = 'gal-search';
  const x = el('button', 'pane-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
  head.append(title, search, x);
  const body = el('div', 'proj-scroll gal-body'); card.append(head, body); modal.append(card); document.body.append(modal);
  let timer = null, view = null;
  const close = () => { modal.hidden = true; };
  x.addEventListener('click', close); modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); view ? list() : close(); } });

  async function copy(handle, id, btn) {
    btn && (btn.disabled = true);
    const r = await api(`/api/gallery/${handle}/${encodeURIComponent(id)}`);
    if (!r.ok) { status(r.error || 'Could not copy that project.'); btn && (btn.disabled = false); return; }
    const p = r.project; close(); document.getElementById('projectsModal')?.setAttribute('hidden', '');
    await projects.copyPublic({ name: `${p.name} (copy)`, workspace: p.workspace, data: p.data, scene: p.scene });
    status(`Copied “${p.name}” by ${p.author} to your projects. Your changes stay yours; the original is not touched.`);
  }
  const chip = ws => { const c = el('span', 'proj-chip', WORKSPACES[ws]?.name || ws || ''); return c; };

  async function show(handle, id) {
    view = { handle, id }; body.replaceChildren(el('p', 'proj-empty', 'Loading…'));
    const r = await api(`/api/gallery/${handle}/${encodeURIComponent(id)}`);
    if (!r.ok) { body.replaceChildren(el('p', 'proj-empty', r.error || 'That project is not available.')); body.append(back()); return; }
    const p = r.project, s = summarize(p.data);
    const top = el('div', 'gal-top'), h = el('div', 'gal-name', p.name); top.append(h, chip(p.workspace), el('span', 'proj-meta', `by ${p.author} · edited ${ago(p.updatedAt)}`));
    const facts = el('p', 'gal-facts', `${s.parts} part${s.parts === 1 ? '' : 's'}, ${s.wires} wire${s.wires === 1 ? '' : 's'}${s.kinds.length ? ': ' : ''}${s.kinds.map(([t, n]) => `${n} × ${t}`).join(', ')}`);
    const act = el('div', 'gal-acts'), c = el('button', 'proj-act gal-copy', 'Copy to my projects'); c.type = 'button'; c.addEventListener('click', () => copy(handle, id, c));
    const link = el('button', 'proj-act', 'Copy link'); link.type = 'button'; link.addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/app#view=${handle}/${id}`); status('Link copied.'); } catch { status('Could not copy the link.'); } });
    act.append(c, link, back());
    const kids = [top, facts];
    if (s.code.trim()) { const pre = el('pre', 'gal-code', s.code); kids.push(el('h4', '', 'Sketch (first lines)'), pre); }
    kids.push(act); body.replaceChildren(...kids);
  }
  function back() { const b = el('button', 'proj-act', 'Back to the list'); b.type = 'button'; b.addEventListener('click', () => list()); return b; }

  async function list() {
    view = null; const q = search.value.trim(); body.replaceChildren(el('p', 'proj-empty', 'Loading…'));
    const r = await api(`/api/gallery${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (!r.ok) { body.replaceChildren(el('p', 'proj-empty', r.error || 'Could not load the gallery.')); return; }
    if (!r.projects.length) { body.replaceChildren(el('p', 'proj-empty', q ? `Nothing public matches “${q}”.` : 'Nothing has been shared yet. Open My projects and press “Share” on one of yours to be the first.')); return; }
    const ul = el('ul', 'proj-list');
    for (const p of r.projects) {
      const li = el('li', 'proj-row'), main = el('div', 'proj-main'), open = el('button', 'proj-open', p.name); open.type = 'button'; open.addEventListener('click', () => show(p.handle, p.id));
      main.append(open, el('span', 'proj-meta', `by ${p.author} · ${ago(p.updatedAt)}`));
      const acts = el('div', 'proj-acts'), v = el('button', 'proj-act', 'View'), c = el('button', 'proj-act gal-copy', 'Copy'); v.type = c.type = 'button';
      v.addEventListener('click', () => show(p.handle, p.id)); c.addEventListener('click', () => copy(p.handle, p.id, c)); acts.append(v, c);
      li.append(chip(p.workspace), main, acts); ul.append(li);
    }
    body.replaceChildren(ul);
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(list, 250); });
  function open(link = null) { modal.hidden = false; if (link) show(link.handle, link.id); else { search.focus(); list(); } }
  // a shared link: /app#view=<handle>/<project id>
  const fromHash = () => { const m = /^#view=([0-9a-f]{16})\/(p-[a-z0-9-]+)$/.exec(location.hash); if (m) { history.replaceState(null, '', location.pathname + location.search); open({ handle: m[1], id: m[2] }); } };
  addEventListener('hashchange', fromHash); setTimeout(fromHash, 1200);
  return { open, close };
}
