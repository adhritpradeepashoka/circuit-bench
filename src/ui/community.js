// Community: team updates and user discussions. Everything a person writes is shown as plain text (textContent), never as markup.
import { getMe, authed } from '../sim/session.mjs';

export function initCommunity({ fetchImpl = (...a) => globalThis.fetch(...a), status = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  const modal = $('communityModal'), body = $('communityBody');
  let tab = 'update';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const call = (path, opts) => authed(path, { fetchImpl, ...opts }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const when = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const staff = () => !!getMe()?.entitlements?.admin;

  /** Plain text with line breaks and clickable http(s) links, built with DOM nodes so nothing can inject markup. */
  function text(str, cls = 'cm-text') {
    const box = el('div', cls);
    for (const line of String(str).split('\n')) {
      const p = el('p'); let last = 0;
      for (const m of line.matchAll(/https?:\/\/[^\s<>"]+/g)) {
        p.append(line.slice(last, m.index));
        const a = el('a', '', m[0]); a.href = m[0]; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; p.append(a); last = m.index + m[0].length;
      }
      p.append(line.slice(last)); box.append(p);
    }
    return box;
  }
  const open = async () => { modal.hidden = false; await showList(); $('communityClose').focus(); };
  const close = () => { modal.hidden = true; };
  const signedIn = () => !!getMe();
  const note = () => el('p', 'proj-note', 'Sign in with Google (top bar) to post or comment.');

  async function showList() {
    body.replaceChildren(el('p', 'proj-note', 'Loading…'));
    const { body: r } = await call(`/api/community/posts?kind=${tab}`);
    const head = el('div', 'cm-tabs');
    for (const [id, label] of [['update', 'Updates'], ['topic', 'Discussions']]) {
      const b = el('button', 'cm-tab', label); b.type = 'button'; b.setAttribute('aria-pressed', String(tab === id));
      b.addEventListener('click', () => { tab = id; showList(); }); head.append(b);
    }
    const list = el('div', 'cm-list');
    if (!r?.ok) list.append(el('p', 'proj-note', r?.error || 'Could not load posts — the community needs the CircuitBench server.'));
    else if (!r.posts.length) list.append(el('p', 'proj-note', tab === 'update' ? 'No updates yet.' : 'No discussions yet — start one!'));
    else for (const p of r.posts) {
      const row = el('button', 'cm-row'); row.type = 'button';
      row.append(el('b', '', `${p.pinned ? '📌 ' : ''}${p.title}`), el('span', 'proj-meta', `${p.author} · ${when(p.createdAt)} · ${p.comments} comment${p.comments === 1 ? '' : 's'}`));
      row.addEventListener('click', () => showPost(p.id)); list.append(row);
    }
    body.replaceChildren(head, list, composer());
  }

  function composer() {
    if (!signedIn()) return note();
    if (tab === 'update' && !staff()) return el('span');
    const f = el('form', 'cm-form'); f.id = 'cmNewForm';
    const t = el('input'); t.placeholder = tab === 'update' ? 'Update title' : 'Start a discussion — title'; t.maxLength = 120; t.setAttribute('aria-label', 'Title');
    const b = el('textarea'); b.rows = 3; b.placeholder = tab === 'update' ? 'What is new?' : 'What would you like to talk about?'; b.maxLength = 8000; b.setAttribute('aria-label', 'Text');
    const go = el('button', '', tab === 'update' ? 'Post update' : 'Post'); go.type = 'submit'; const msg = el('p', 'proj-note'); msg.setAttribute('role', 'status');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const { body: r } = await call('/api/community/posts', { method: 'POST', body: { kind: tab, title: t.value, body: b.value } });
      if (r?.ok) showPost(r.post.id); else msg.textContent = r?.error || 'That did not work.';
    });
    f.append(t, b, go, msg); return f;
  }

  async function showPost(id) {
    const { body: r } = await call(`/api/community/posts/${id}`);
    if (!r?.ok) { await showList(); return; }
    const back = el('button', 'proj-act', '← Back'); back.type = 'button'; back.addEventListener('click', showList);
    const p = r.post, card = el('article', 'cm-post');
    card.append(el('h3', '', `${p.pinned ? '📌 ' : ''}${p.title}`), el('span', 'proj-meta', `${p.author} · ${when(p.createdAt)}`), text(p.body));
    const acts = el('div', 'proj-acts');
    if (p.canPin) { const b = el('button', 'proj-act', p.pinned ? 'Unpin' : 'Pin'); b.type = 'button'; b.addEventListener('click', async () => { await call(`/api/community/posts/${id}`, { method: 'PATCH', body: { pinned: !p.pinned } }); showPost(id); }); acts.append(b); }
    if (p.mine) { const b = el('button', 'proj-act', 'Delete post'); b.type = 'button'; b.addEventListener('click', async () => { await call(`/api/community/posts/${id}`, { method: 'DELETE' }); showList(); }); acts.append(b); }
    const comments = el('div', 'cm-comments');
    for (const c of r.comments) {
      const item = el('div', 'cm-comment'); item.append(el('b', '', c.author), el('span', 'proj-meta', ` · ${when(c.createdAt)}`), text(c.body));
      if (c.mine) { const d = el('button', 'ai-link', 'delete'); d.type = 'button'; d.addEventListener('click', async () => { await call(`/api/community/comments/${c.id}`, { method: 'DELETE' }); showPost(id); }); item.append(d); }
      comments.append(item);
    }
    if (!r.comments.length) comments.append(el('p', 'proj-note', 'No comments yet.'));
    let form = note();
    if (signedIn()) {
      form = el('form', 'cm-form'); const b = el('textarea'); b.rows = 2; b.placeholder = 'Write a comment…'; b.maxLength = 1500; b.setAttribute('aria-label', 'Comment');
      const go = el('button', '', 'Comment'); go.type = 'submit'; const msg = el('p', 'proj-note'); msg.setAttribute('role', 'status');
      form.addEventListener('submit', async e => { e.preventDefault(); const { body: x } = await call(`/api/community/posts/${id}/comments`, { method: 'POST', body: { body: b.value } }); if (x?.ok) showPost(id); else msg.textContent = x?.error || 'That did not work.'; });
      form.append(b, go, msg);
    }
    body.replaceChildren(back, card, acts, el('h4', '', 'Comments'), comments, form);
  }

  $('communityBtn').addEventListener('click', open);
  $('communityClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  return { open, close, get isOpen() { return !modal.hidden; } };
}
