// The public CircuitBench blog: anyone can read; signing in with Google (the same account as the lab) lets you post and comment.
// Every flair is a Reddit-style post flair (src/core/community-flairs.js). Everything people write is shown as plain text (textContent), never as markup.
import './styles.css';
import './blog.css';
import { applyTheme } from './ui/theme.js';
import { initAccount } from './ui/account.js';
import { getMe, authed } from './sim/session.mjs';
import { FLAIRS, FLAIR_BY_ID, CHANGELOG_FLAIRS } from './core/community-flairs.js';

applyTheme();
const $ = id => document.getElementById(id);
const main = $('blogMain'), side = $('blogSide');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const call = (path, opts) => authed(path, opts).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const when = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const signedIn = () => !!getMe();
const staff = () => !!getMe()?.entitlements?.admin;

/** Plain text with line breaks and clickable http(s) links, built from DOM nodes so nothing can inject markup. */
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
const chip = id => { const f = FLAIR_BY_ID.get(id) || FLAIR_BY_ID.get('discussion'); const c = el('span', 'flair', f.label); c.style.setProperty('--flair', f.color); return c; };
const signInNote = what => el('p', 'proj-note blog-note', `Sign in with Google (top right) to ${what}. You can read everything without an account.`);

/* ── routing: /blog, /blog?flair=bug, /blog?view=changelog, /blog/12 ── */
const route = () => {
  const m = /^\/blog\/(\d+)\/?$/.exec(location.pathname), q = new URLSearchParams(location.search);
  return m ? { post: Number(m[1]) } : { flair: FLAIR_BY_ID.has(q.get('flair')) ? q.get('flair') : '', view: q.get('view') === 'changelog' ? 'changelog' : '', sort: q.get('sort') === 'top' ? 'top' : '' };
};
const go = (url, replace) => { history[replace ? 'replaceState' : 'pushState'](null, '', url); render(); window.scrollTo(0, 0); };
window.addEventListener('popstate', render);
document.addEventListener('click', e => {                         // in-page links without a reload
  const a = e.target.closest?.('a[data-nav]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault(); go(a.getAttribute('href'));
});
const link = (href, cls, label) => { const a = el('a', cls, label); a.href = href; a.dataset.nav = '1'; return a; };

/* ── the sidebar ── */
function paintSide(r) {
  const box = el('div', 'side-card');
  box.append(el('h3', '', 'Browse'));
  const nav = el('nav', 'side-nav');
  const item = (href, label, on, swatch) => { const a = link(href, `side-item${on ? ' on' : ''}`, label); if (swatch) { const s = el('i', 'swatch'); s.style.background = swatch; a.prepend(s); } return a; };
  nav.append(item('/blog', 'All posts', !r.flair && !r.view && !r.post));
  nav.append(item('/blog?view=changelog', 'Changelog — updates & fixes', r.view === 'changelog'));
  box.append(nav, el('h3', '', 'Flairs'));
  const fl = el('nav', 'side-nav');
  for (const f of FLAIRS) fl.append(item(`/blog?flair=${f.id}`, f.label, r.flair === f.id, f.color));
  box.append(fl);
  const post = el('button', 'blog-new', '＋ New post'); post.type = 'button';
  post.addEventListener('click', () => { if (r.post || r.flair || r.view) go('/blog'); showComposer(true); });
  side.replaceChildren(post, box);
}

/* ── the list ── */
async function showList(r) {
  main.replaceChildren(el('p', 'proj-note', 'Loading…'));
  const { body } = await call(`/api/community/posts${r.flair ? `?flair=${r.flair}` : ''}`);
  const head = el('div', 'blog-head');
  head.append(el('h1', '', r.view === 'changelog' ? 'Changelog' : r.flair ? FLAIR_BY_ID.get(r.flair).label : 'CircuitBench Blog'));
  head.append(el('p', 'blog-lead', r.view === 'changelog' ? 'Everything the team has shipped and fixed, newest first.' : r.flair ? FLAIR_BY_ID.get(r.flair).hint : 'Updates and fixes from the team, plus questions, error reports, workspaces and parts from the community.'));
  const sort = el('div', 'blog-sort');
  for (const [id, label] of [['', 'New'], ['top', 'Most discussed']]) {
    const q = new URLSearchParams(location.search); if (id) q.set('sort', id); else q.delete('sort');
    const a = link(`/blog${q.toString() ? `?${q}` : ''}`, `blog-pill${r.sort === id ? ' on' : ''}`, label); sort.append(a);
  }
  const list = el('div', 'blog-list');
  if (!body?.ok) list.append(el('p', 'proj-note', body?.error || 'Could not load posts.'));
  else {
    let posts = body.posts.filter(p => !r.view || CHANGELOG_FLAIRS.includes(p.flair));
    if (r.sort === 'top') posts = [...posts].sort((a, b) => (b.pinned - a.pinned) || b.comments - a.comments || b.createdAt - a.createdAt);
    if (!posts.length) list.append(el('p', 'proj-note', 'Nothing here yet.'));
    for (const p of posts) {
      const card = el('article', 'blog-card');
      const meta = el('div', 'blog-meta'); meta.append(chip(p.flair), el('span', '', `${p.author} · ${when(p.createdAt)}`));
      const title = link(`/blog/${p.id}`, 'blog-title', `${p.pinned ? '📌 ' : ''}${p.title}`);
      card.append(meta, title, el('p', 'blog-snippet', p.body.replace(/\s+/g, ' ').slice(0, 220) + (p.body.length > 220 ? '…' : '')), el('div', 'blog-foot', `💬 ${p.comments} comment${p.comments === 1 ? '' : 's'}`));
      list.append(card);
    }
  }
  main.replaceChildren(head, sort, list);
}

/* ── composing ── */
function showComposer(focus) {
  document.getElementById('blogComposer')?.remove();
  const box = el('section', 'blog-composer'); box.id = 'blogComposer';
  box.append(el('h2', '', 'New post'));
  if (!signedIn()) { box.append(signInNote('post')); main.prepend(box); return; }
  const f = el('form', 'cm-form');
  const sel = el('select'); sel.setAttribute('aria-label', 'Flair');
  for (const fl of FLAIRS.filter(x => !x.staff || staff())) { const o = el('option', '', fl.label); o.value = fl.id; sel.append(o); }
  sel.value = staff() ? 'update' : 'discussion';
  const hint = el('p', 'proj-note', FLAIR_BY_ID.get(sel.value).hint); sel.addEventListener('change', () => { hint.textContent = FLAIR_BY_ID.get(sel.value).hint; });
  const t = el('input'); t.placeholder = 'Title'; t.maxLength = 120; t.setAttribute('aria-label', 'Title');
  const b = el('textarea'); b.rows = 6; b.placeholder = 'Write your post. Links are made clickable.'; b.maxLength = 8000; b.setAttribute('aria-label', 'Text');
  const post = el('button', '', 'Post'); post.type = 'submit'; const msg = el('p', 'proj-note'); msg.setAttribute('role', 'status');
  f.addEventListener('submit', async e => {
    e.preventDefault(); post.disabled = true;
    const { body: r } = await call('/api/community/posts', { method: 'POST', body: { flair: sel.value, title: t.value, body: b.value } });
    post.disabled = false;
    if (r?.ok) go(`/blog/${r.post.id}`); else msg.textContent = r?.error || 'That did not work.';
  });
  f.append(sel, hint, t, b, post, msg); box.append(f); main.prepend(box);
  if (focus) t.focus();
}

/* ── one post ── */
async function showPost(id) {
  main.replaceChildren(el('p', 'proj-note', 'Loading…'));
  const { body: r } = await call(`/api/community/posts/${id}`);
  if (!r?.ok) { main.replaceChildren(el('p', 'proj-note', 'That post is not here (it may have been deleted).'), link('/blog', 'blog-pill', '← All posts')); document.title = 'CircuitBench Blog'; return; }
  const p = r.post;
  document.title = `${p.title} — CircuitBench Blog`;
  const card = el('article', 'blog-post');
  const meta = el('div', 'blog-meta'); meta.append(chip(p.flair), el('span', '', `${p.author} · ${when(p.createdAt)}`));
  card.append(link('/blog', 'blog-back', '← All posts'), meta, el('h1', '', `${p.pinned ? '📌 ' : ''}${p.title}`), text(p.body, 'cm-text blog-body'));
  const acts = el('div', 'proj-acts');
  const act = (label, fn) => { const b = el('button', 'proj-act', label); b.type = 'button'; b.addEventListener('click', fn); acts.append(b); };
  if (p.canPin) act(p.pinned ? 'Unpin' : 'Pin', async () => { await call(`/api/community/posts/${id}`, { method: 'PATCH', body: { pinned: !p.pinned } }); showPost(id); });
  if (p.mine) act('Delete post', async () => { await call(`/api/community/posts/${id}`, { method: 'DELETE' }); go('/blog'); });
  const comments = el('div', 'cm-comments');
  for (const c of r.comments) {
    const item = el('div', 'cm-comment'); item.append(el('b', '', c.author), el('span', 'proj-meta', ` · ${when(c.createdAt)}`), text(c.body));
    if (c.mine) { const d = el('button', 'ai-link', 'delete'); d.type = 'button'; d.addEventListener('click', async () => { await call(`/api/community/comments/${c.id}`, { method: 'DELETE' }); showPost(id); }); item.append(d); }
    comments.append(item);
  }
  if (!r.comments.length) comments.append(el('p', 'proj-note', 'No comments yet.'));
  let form = signInNote('comment');
  if (signedIn()) {
    form = el('form', 'cm-form'); const b = el('textarea'); b.rows = 3; b.placeholder = 'Write a comment…'; b.maxLength = 1500; b.setAttribute('aria-label', 'Comment');
    const post = el('button', '', 'Comment'); post.type = 'submit'; const msg = el('p', 'proj-note'); msg.setAttribute('role', 'status');
    form.addEventListener('submit', async e => { e.preventDefault(); const { body: x } = await call(`/api/community/posts/${id}/comments`, { method: 'POST', body: { body: b.value } }); if (x?.ok) showPost(id); else msg.textContent = x?.error || 'That did not work.'; });
    form.append(b, post, msg);
  }
  main.replaceChildren(card, acts, el('h2', 'blog-h2', `${r.comments.length} comment${r.comments.length === 1 ? '' : 's'}`), comments, form);
}

function render() {
  const r = route(); paintSide(r);
  if (r.post) showPost(r.post); else { document.title = 'CircuitBench Blog'; showList(r); }
}
window.addEventListener('cb-session', () => { if (!document.getElementById('blogComposer')) render(); else showComposer(false); });
render();
initAccount({ status: () => {} });
