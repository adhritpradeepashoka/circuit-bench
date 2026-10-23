// Community: update posts from the team (admins/owner) and discussion topics from anyone signed in, each with comments.
// Plain text only — the page renders it with textContent, so nothing a user writes can run as markup.
import { isPrivileged } from './accounts.mjs';

export const LIMITS = { title: 120, post: 8000, comment: 1500, perMinute: 6 };
const clean = (s, n) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const fail = (status, error) => ({ ok: false, status, error });

export function createMemoryCommunity() {
  const posts = [], comments = []; let pid = 0, cid = 0;
  return {
    async init() {},
    async listPosts(kind) { return posts.filter(p => !kind || p.kind === kind).map(p => ({ ...p, comments: comments.filter(c => c.postId === p.id && !c.hidden).length })).sort((a, b) => b.pinned - a.pinned || b.createdAt - a.createdAt); },
    async getPost(id) { return posts.find(p => p.id === id) || null; },
    async addPost(p) { const row = { id: ++pid, pinned: 0, ...p }; posts.push(row); return row; },
    async updatePost(id, patch) { const p = posts.find(x => x.id === id); if (!p) return null; Object.assign(p, patch); return p; },
    async deletePost(id) { const i = posts.findIndex(p => p.id === id); if (i < 0) return false; posts.splice(i, 1); for (let j = comments.length - 1; j >= 0; j--) if (comments[j].postId === id) comments.splice(j, 1); return true; },
    async listComments(postId) { return comments.filter(c => c.postId === postId && !c.hidden); },
    async addComment(c) { const row = { id: ++cid, hidden: 0, ...c }; comments.push(row); return row; },
    async getComment(id) { return comments.find(c => c.id === id) || null; },
    async deleteComment(id) { const i = comments.findIndex(c => c.id === id); if (i < 0) return false; comments.splice(i, 1); return true; },
  };
}
const P = r => r && ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body, authorEmail: r.author_email, authorName: r.author_name, createdAt: Number(r.created_at), pinned: Number(r.pinned), comments: r.comments == null ? undefined : Number(r.comments) });
const C = r => r && ({ id: Number(r.id), postId: Number(r.post_id), authorEmail: r.author_email, authorName: r.author_name, authorPicture: r.author_picture, body: r.body, createdAt: Number(r.created_at), hidden: Number(r.hidden) });
export function createPgCommunity(pool) {
  const q = (sql, args) => pool.query(sql, args);
  return {
    async init() {
      await q(`create table if not exists cb_posts (id bigserial primary key, kind text not null, title text not null, body text not null, author_email text not null, author_name text not null default '', created_at bigint not null, pinned int not null default 0)`);
      await q(`create table if not exists cb_comments (id bigserial primary key, post_id bigint not null references cb_posts(id) on delete cascade, author_email text not null, author_name text not null default '', author_picture text not null default '', body text not null, created_at bigint not null, hidden int not null default 0)`);
    },
    async listPosts(kind) {
      const r = await q(`select * from cb_posts ${kind ? 'where kind = $1' : ''} order by pinned desc, created_at desc limit 200`, kind ? [kind] : []);
      const n = new Map((await q('select post_id, count(*) as n from cb_comments where hidden = 0 group by post_id')).rows.map(x => [Number(x.post_id), Number(x.n)]));
      return r.rows.map(row => ({ ...P(row), comments: n.get(Number(row.id)) || 0 }));
    },
    async getPost(id) { return P((await q('select * from cb_posts where id = $1', [id])).rows[0]); },
    async addPost(p) { return P((await q('insert into cb_posts (kind, title, body, author_email, author_name, created_at) values ($1,$2,$3,$4,$5,$6) returning *', [p.kind, p.title, p.body, p.authorEmail, p.authorName, p.createdAt])).rows[0]); },
    async updatePost(id, patch) {
      const cur = await this.getPost(id); if (!cur) return null; const n = { ...cur, ...patch };
      return P((await q('update cb_posts set title = $2, body = $3, pinned = $4 where id = $1 returning *', [id, n.title, n.body, n.pinned])).rows[0]);
    },
    async deletePost(id) { return (await q('delete from cb_posts where id = $1', [id])).rowCount > 0; },
    async listComments(postId) { return (await q('select * from cb_comments where post_id = $1 and hidden = 0 order by created_at', [postId])).rows.map(C); },
    async addComment(c) { return C((await q('insert into cb_comments (post_id, author_email, author_name, author_picture, body, created_at) values ($1,$2,$3,$4,$5,$6) returning *', [c.postId, c.authorEmail, c.authorName, c.authorPicture || '', c.body, c.createdAt])).rows[0]); },
    async getComment(id) { return C((await q('select * from cb_comments where id = $1', [id])).rows[0]); },
    async deleteComment(id) { return (await q('delete from cb_comments where id = $1', [id])).rowCount > 0; },
  };
}

/** Rules and permissions. `accounts` resolves a session token to who is asking. */
export function createCommunity({ store = createMemoryCommunity(), accounts, now = () => Date.now() } = {}) {
  const recent = new Map();     // email → timestamps, a small per-person rate limit
  const slow = email => { const t = now(), l = (recent.get(email) || []).filter(x => t - x < 60_000); l.push(t); recent.set(email, l); return l.length > LIMITS.perMinute; };
  const who = async token => { const a = await accounts.auth(token); if (!a) return null; return { email: a.email, role: a.role, name: a.row?.name || a.email.split('@')[0], picture: a.row?.picture || '', staff: a.role === 'admin' || a.role === 'owner' }; };
  const pub = p => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, author: p.authorName || p.authorEmail.split('@')[0], authorEmail: undefined, createdAt: p.createdAt, pinned: !!p.pinned, comments: p.comments });
  const mine = (u, email) => !!u && (u.staff || u.email === email);
  return {
    async list(kind) { return { ok: true, posts: (await store.listPosts(kind === 'update' || kind === 'topic' ? kind : null)).map(pub) }; },
    async read(id, token) {
      const p = await store.getPost(id); if (!p) return fail(404, 'No such post.');
      const u = await who(token);
      const cs = (await store.listComments(id)).map(c => ({ id: c.id, author: c.authorName || c.authorEmail.split('@')[0], picture: c.authorPicture, body: c.body, createdAt: c.createdAt, mine: mine(u, c.authorEmail) }));
      return { ok: true, post: { ...pub(p), mine: mine(u, p.authorEmail), canPin: !!u?.staff }, comments: cs };
    },
    async create(token, { kind, title, body }) {
      const u = await who(token); if (!u) return fail(401, 'Sign in to post.');
      if (kind === 'update' && !u.staff) return fail(403, 'Only the team can post updates.');
      if (kind !== 'update' && kind !== 'topic') return fail(400, 'Unknown post type.');
      title = clean(title, LIMITS.title); body = clean(body, LIMITS.post);
      if (!title || !body) return fail(400, 'A post needs a title and some text.');
      if (slow(u.email)) return fail(429, 'Slow down a little — try again in a minute.');
      return { ok: true, post: pub(await store.addPost({ kind, title, body, authorEmail: u.email, authorName: u.name, createdAt: now() })) };
    },
    async edit(token, id, patch) {
      const u = await who(token), p = await store.getPost(id); if (!p) return fail(404, 'No such post.');
      if (!u || !(u.staff || u.email === p.authorEmail)) return fail(403, 'Not yours to change.');
      const next = {}; if (patch.title != null) next.title = clean(patch.title, LIMITS.title) || p.title; if (patch.body != null) next.body = clean(patch.body, LIMITS.post) || p.body;
      if (patch.pinned != null) { if (!u.staff) return fail(403, 'Only the team can pin posts.'); next.pinned = patch.pinned ? 1 : 0; }
      return { ok: true, post: pub(await store.updatePost(id, next)) };
    },
    async remove(token, id) {
      const u = await who(token), p = await store.getPost(id); if (!p) return fail(404, 'No such post.');
      if (!u || !(u.staff || u.email === p.authorEmail)) return fail(403, 'Not yours to delete.');
      await store.deletePost(id); return { ok: true };
    },
    async comment(token, id, body) {
      const u = await who(token); if (!u) return fail(401, 'Sign in to comment.');
      if (!(await store.getPost(id))) return fail(404, 'No such post.');
      body = clean(body, LIMITS.comment); if (!body) return fail(400, 'Write something first.');
      if (slow(u.email)) return fail(429, 'Slow down a little — try again in a minute.');
      const c = await store.addComment({ postId: id, authorEmail: u.email, authorName: u.name, authorPicture: u.picture, body, createdAt: now() });
      return { ok: true, comment: { id: c.id, author: c.authorName, picture: c.authorPicture, body: c.body, createdAt: c.createdAt, mine: true } };
    },
    async removeComment(token, id) {
      const u = await who(token), c = await store.getComment(id); if (!c) return fail(404, 'No such comment.');
      if (!u || !(u.staff || u.email === c.authorEmail)) return fail(403, 'Not yours to delete.');
      await store.deleteComment(id); return { ok: true };
    },
  };
}
