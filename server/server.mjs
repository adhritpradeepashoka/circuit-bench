// HTTP front for the compile service (and, when ./dist exists, the built web app).
//   POST /api/compile   { sketch | files:[{name,content}], fqbn? }  →  { ok, hex, output, diagnostics, size, cached, ms }
//   GET  /api/health    →  { ok, arduinoCli, boards }
//   GET  /api/config    →  { googleClientId, accounts }   (public settings; GOOGLE_CLIENT_ID env)
//   POST /api/auth/google {credential} → { token, me }   ·   GET /api/me · POST /api/presence (Bearer token)
//   GET/POST/DELETE /api/admin/users   (admins; the owner also manages admins)
//   Env for accounts: OWNER_EMAIL, DATABASE_URL, SESSION_SECRET, MAX_FREE_CONCURRENT, FREE_HOSTED_AI=1, HOSTED_AI_KEY/_PROVIDER/_MODEL
// Env: PORT (8787), HOST (127.0.0.1), VLAB_CORS_ORIGIN (e.g. * — only needed when the page is served from somewhere else),
//      ARDUINO_CLI, AVR_GCC_DIR, ARDUINO_CTAGS_DIR, VLAB_BUILD_CACHE (see compile-service.mjs)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompiler, RequestError, BOARDS } from './compile-service.mjs';
import { createAiService } from './ai-service.mjs';
import { createCommunity, createMemoryCommunity, createPgCommunity } from './community.mjs';
import { createAccounts, createMemoryStore, createPgStore, createSessions, createGoogleVerifier, createPresence } from './accounts.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createServer({ compiler = createCompiler(), ai = createAiService(), staticDir = null, log = () => {}, corsOrigin = null, publicConfig = {}, accounts = null, hostedAi = null, community = null } = {}) {
  // hostedAi = { provider, key, model? }: the owner's own AI key, used only for signed-in users whose role entitles them to it.
  const bearer = req => /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1] || '';
  async function readJson(req, max) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > max) { req.destroy(); throw new RequestError('Request too large.', 413); } }
    try { return JSON.parse(raw || '{}'); } catch { throw new RequestError('Body must be valid JSON.'); }
  }
  /** Swap in the server's own AI key when the student asked for the included AI and their role allows it. */
  async function applyHosted(req, body) {
    if (!body?.hosted) return body;
    const me = accounts && await accounts.me(bearer(req));
    if (!me) throw new RequestError('Sign in to use the included AI.', 401);
    if (!me.entitlements.hostedAi) throw new RequestError('The included AI is for beta members. Use the on-device model or add your own free key.', 403);
    if (!hostedAi?.key) throw new RequestError('The included AI is not set up on this server yet.', 503);
    const { hosted, userKey, provider, model, ...rest } = body;
    return { ...rest, userKey: hostedAi.key, provider: hostedAi.provider || 'groq', model: hostedAi.model || '' };
  }
  const buckets = new Map();   // ip → recent request timestamps (small in-memory rate limit)
  const limited = ip => {
    const now = Date.now(), list = (buckets.get(ip) || []).filter(t => now - t < 60_000);
    list.push(now); buckets.set(ip, list);
    return list.length > 40;
  };
  const cors = corsOrigin ? { 'access-control-allow-origin': corsOrigin, 'access-control-allow-methods': 'POST, GET, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600', vary: 'origin' } : {};
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) { res.writeHead(corsOrigin ? 204 : 403, cors); return res.end(); }
      // Public, non-secret settings the page needs at run time (e.g. the Google OAuth *client* ID, which is
      // meant to be visible). Lets them change on the host without a rebuild.
      if (url.pathname === '/api/config') return send(res, 200, { googleClientId: publicConfig.googleClientId || null, accounts: !!accounts });
      if (url.pathname === '/api/auth/google') {
        if (!accounts) return send(res, 404, { ok: false, error: 'Accounts are not enabled on this server.' });
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' }, { allow: 'POST' });
        if (limited(req.socket.remoteAddress || 'local')) return send(res, 429, { ok: false, error: 'Too many requests — wait a moment.' });
        const out = await accounts.signIn((await readJson(req, 20_000)).credential);
        return out ? send(res, 200, { ok: true, ...out }) : send(res, 401, { ok: false, error: 'Google sign-in could not be verified.' });
      }
      if (url.pathname === '/api/me' || url.pathname === '/api/presence') {
        if (!accounts) return send(res, 404, { ok: false, error: 'Accounts are not enabled on this server.' });
        const me = await accounts.me(bearer(req), { beat: url.pathname === '/api/presence' });
        return me ? send(res, 200, { ok: true, me: { ...me, hostedAiReady: !!hostedAi?.key } }) : send(res, 401, { ok: false, error: 'Please sign in again.' });
      }
      if (url.pathname.startsWith('/api/community')) {
        if (!community) return send(res, 404, { ok: false, error: 'The community is not enabled on this server.' });
        const parts = url.pathname.split('/').slice(3), tok = bearer(req), id = Number(parts[1]);
        const out = r => send(res, r.ok ? 200 : r.status, r.ok ? r : { ok: false, error: r.error });
        if (req.method !== 'GET' && limited(req.socket.remoteAddress || 'local')) return send(res, 429, { ok: false, error: 'Too many requests — wait a moment.' });
        if (parts[0] === 'posts' && !parts[1]) {
          if (req.method === 'GET') return out(await community.list(url.searchParams.get('kind'), url.searchParams.get('flair')));
          if (req.method === 'POST') return out(await community.create(tok, await readJson(req, 30_000)));
        }
        if (parts[0] === 'posts' && Number.isInteger(id) && id > 0) {
          if (!parts[2]) {
            if (req.method === 'GET') return out(await community.read(id, tok));
            if (req.method === 'PATCH') return out(await community.edit(tok, id, await readJson(req, 30_000)));
            if (req.method === 'DELETE') return out(await community.remove(tok, id));
          }
          if (parts[2] === 'comments' && req.method === 'POST') return out(await community.comment(tok, id, (await readJson(req, 8_000)).body));
        }
        if (parts[0] === 'comments' && Number.isInteger(id) && id > 0 && req.method === 'DELETE') return out(await community.removeComment(tok, id));
        return send(res, 404, { ok: false, error: 'Unknown endpoint.' });
      }
      if (url.pathname === '/api/admin/users') {
        if (!accounts) return send(res, 404, { ok: false, error: 'Accounts are not enabled on this server.' });
        if (req.method === 'GET') {
          const out = await accounts.listUsers(bearer(req));
          return out ? send(res, 200, { ok: true, ...out }) : send(res, 403, { ok: false, error: 'Admins only.' });
        }
        if (req.method === 'POST' || req.method === 'DELETE') {
          const b = req.method === 'POST' ? await readJson(req, 4_000) : { email: url.searchParams.get('email'), role: 'user' };
          const out = Array.isArray(b.themes) && req.method === 'POST' ? await accounts.setThemes(bearer(req), b.email, b.themes) : await accounts.setRole(bearer(req), b.email, b.role);
          return send(res, out.ok ? 200 : out.status, out.ok ? { ok: true, user: out.user } : { ok: false, error: out.error });
        }
        return send(res, 405, { ok: false, error: 'Use GET, POST or DELETE.' });
      }
      if (url.pathname === '/api/health') {
        const v = await compiler.version();
        return send(res, 200, { ok: !!v, arduinoCli: v, boards: Object.fromEntries(Object.entries(BOARDS).map(([k, b]) => [k, b.name])) });
      }
      if (url.pathname === '/api/compile') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' }, { allow: 'POST' });
        if (limited(req.socket.remoteAddress || 'local')) return send(res, 429, { ok: false, error: 'Too many compile requests — wait a moment.' });
        let raw = '', seen = 0, tooBig = false;
        for await (const chunk of req) {                      // drain the whole body so the client can read our 413 (bounded)
          seen += chunk.length;
          if (seen > 8_000_000) { req.destroy(); return; }
          if (!tooBig) { raw += chunk; if (raw.length > 400_000) { tooBig = true; raw = ''; } }
        }
        if (tooBig) throw new RequestError('Request too large.', 413);
        let body; try { body = JSON.parse(raw); } catch { throw new RequestError('Body must be valid JSON.'); }
        const result = await compiler.compile(body);
        log(`compile ${result.ok ? 'ok' : 'failed'} ${result.cached ? '(cached)' : `${result.ms} ms`}`);
        return send(res, 200, result);
      }
      if (url.pathname === '/api/ai/generate-code') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' }, { allow: 'POST' });
        if (limited(req.socket.remoteAddress || 'local')) return send(res, 429, { ok: false, error: 'Too many AI requests — wait a moment.' });
        let raw = '', seen = 0, tooBig = false;
        for await (const chunk of req) {
          seen += chunk.length;
          if (seen > 400_000) { req.destroy(); return; }
          if (!tooBig) { raw += chunk; if (raw.length > 120_000) { tooBig = true; raw = ''; } }
        }
        if (tooBig) throw new RequestError('Request too large.', 413);
        let body; try { body = JSON.parse(raw); } catch { throw new RequestError('Body must be valid JSON.'); }
        const result = await ai.generateCode(await applyHosted(req, body));
        log(`ai generate-code ok`);
        return send(res, 200, result);
      }
      if (url.pathname === '/api/ai/create-part') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' }, { allow: 'POST' });
        if (limited(req.socket.remoteAddress || 'local')) return send(res, 429, { ok: false, error: 'Too many AI requests — wait a moment.' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) { req.destroy(); return; } }
        let body; try { body = JSON.parse(raw); } catch { throw new RequestError('Body must be valid JSON.'); }
        const result = await ai.createPart(await applyHosted(req, body));
        log(`ai create-part ok`);
        return send(res, 200, result);
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { ok: false, error: 'Unknown endpoint.' });

      if (staticDir) {                                                     // serve the built app
        const blogPage = url.pathname === '/blog' || /^\/blog\/\d+\/?$/.test(url.pathname);        // the public blog: one page for the list and for every post
        let rel = blogPage ? 'blog.html' : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
        if (rel.split(sep).includes('..')) return send(res, 400, { ok: false, error: 'Bad path.' });
        let file = join(staticDir, rel || 'index.html');
        try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(staticDir, 'index.html'); }
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        return res.end(data);
      }
      send(res, 404, { ok: false, error: 'Not found.' });
    } catch (err) {
      if (err instanceof RequestError) return send(res, err.status, { ok: false, error: err.message });
      log(`error: ${err.stack || err}`);
      send(res, 500, { ok: false, error: 'Internal error.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787, host = process.env.HOST || '127.0.0.1';
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const staticDir = await stat(dist).then(() => dist, () => null);
  const compiler = createCompiler();
  const clientId = process.env.GOOGLE_CLIENT_ID || '137986291175-5s42d2u26q1029oo1v5dhged48dg79fb.apps.googleusercontent.com';
  // Accounts: DATABASE_URL (Supabase/Neon Postgres) keeps roles across deploys; without it they live in memory and reset on restart.
  let store = createMemoryStore(), communityStore = createMemoryCommunity();
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }, max: 4 });
    try {
      const pgStore = createPgStore(pool), pgCommunity = createPgCommunity(pool);
      await pgStore.init(); await pgCommunity.init();
      store = pgStore; communityStore = pgCommunity;
    } catch (e) {
      // Keep the site up on a bad DATABASE_URL (wrong password, unreachable host): fall back to memory and say why.
      console.log(`[vlab] ERROR: database unavailable (${e.code || ''} ${e.message}) — using in-memory accounts until DATABASE_URL is fixed`);
      pool.end().catch(() => {});
    }
  } else console.log('[vlab] WARNING: no DATABASE_URL — roles are kept in memory and reset on every restart');
  const ownerEmails = String(process.env.OWNER_EMAIL || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!ownerEmails.length) console.log('[vlab] WARNING: OWNER_EMAIL is not set — nobody can administer accounts');
  if (!process.env.SESSION_SECRET) console.log('[vlab] WARNING: no SESSION_SECRET — everyone is signed out on every restart');
  const accounts = createAccounts({
    store, ownerEmails, verifyGoogle: createGoogleVerifier({ clientId }),
    sessions: createSessions({ secret: process.env.SESSION_SECRET || undefined }),
    presence: createPresence({ cap: Number(process.env.MAX_FREE_CONCURRENT) || 0 }),
    freeHostedAi: process.env.FREE_HOSTED_AI === '1',
  });
  const hostedAi = process.env.HOSTED_AI_KEY ? { key: process.env.HOSTED_AI_KEY, provider: process.env.HOSTED_AI_PROVIDER || 'groq', model: process.env.HOSTED_AI_MODEL || '' } : null;
  const community = createCommunity({ accounts, store: communityStore });
  const server = createServer({ compiler, staticDir, accounts, hostedAi, community, corsOrigin: process.env.VLAB_CORS_ORIGIN || null, publicConfig: { googleClientId: clientId }, log: m => console.log(`[vlab] ${m}`) });
  server.listen(port, host, async () => {
    const v = await compiler.version();
    console.log(`[vlab] http://${host}:${port}  ${staticDir ? '(serving dist/ + ' : '('}/api/compile)`);
    console.log(v ? `[vlab] Arduino CLI ${v}` : `[vlab] WARNING: could not run “${compiler.config.cli}” — install Arduino CLI (see README) or set ARDUINO_CLI`);
  });
}
