// HTTP front for the compile service (and, when ./dist exists, the built web app).
//   POST /api/compile   { sketch | files:[{name,content}], fqbn? }  →  { ok, hex, output, diagnostics, size, cached, ms }
//   GET  /api/health    →  { ok, arduinoCli, boards }
//   GET  /api/config    →  { googleClientId }   (public settings; GOOGLE_CLIENT_ID env)
// Env: PORT (8787), HOST (127.0.0.1), VLAB_CORS_ORIGIN (e.g. * — only needed when the page is served from somewhere else),
//      ARDUINO_CLI, AVR_GCC_DIR, ARDUINO_CTAGS_DIR, VLAB_BUILD_CACHE (see compile-service.mjs)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompiler, RequestError, BOARDS } from './compile-service.mjs';
import { createAiService } from './ai-service.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createServer({ compiler = createCompiler(), ai = createAiService(), staticDir = null, log = () => {}, corsOrigin = null, publicConfig = {} } = {}) {
  const buckets = new Map();   // ip → recent request timestamps (small in-memory rate limit)
  const limited = ip => {
    const now = Date.now(), list = (buckets.get(ip) || []).filter(t => now - t < 60_000);
    list.push(now); buckets.set(ip, list);
    return list.length > 40;
  };
  const cors = corsOrigin ? { 'access-control-allow-origin': corsOrigin, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'origin' } : {};
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) { res.writeHead(corsOrigin ? 204 : 403, cors); return res.end(); }
      // Public, non-secret settings the page needs at run time (e.g. the Google OAuth *client* ID, which is
      // meant to be visible). Lets them change on the host without a rebuild.
      if (url.pathname === '/api/config') return send(res, 200, { googleClientId: publicConfig.googleClientId || null });
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
        const result = await ai.generateCode(body);
        log(`ai generate-code ok`);
        return send(res, 200, result);
      }
      if (url.pathname === '/api/ai/create-part') {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' }, { allow: 'POST' });
        if (limited(req.socket.remoteAddress || 'local')) return send(res, 429, { ok: false, error: 'Too many AI requests — wait a moment.' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) { req.destroy(); return; } }
        let body; try { body = JSON.parse(raw); } catch { throw new RequestError('Body must be valid JSON.'); }
        const result = await ai.createPart(body);
        log(`ai create-part ok`);
        return send(res, 200, result);
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { ok: false, error: 'Unknown endpoint.' });

      if (staticDir) {                                                     // serve the built app
        let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
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
  const server = createServer({ compiler, staticDir, corsOrigin: process.env.VLAB_CORS_ORIGIN || null, publicConfig: { googleClientId: process.env.GOOGLE_CLIENT_ID || '137986291175-5s42d2u26q1029oo1v5dhged48dg79fb.apps.googleusercontent.com' }, log: m => console.log(`[vlab] ${m}`) });
  server.listen(port, host, async () => {
    const v = await compiler.version();
    console.log(`[vlab] http://${host}:${port}  ${staticDir ? '(serving dist/ + ' : '('}/api/compile)`);
    console.log(v ? `[vlab] Arduino CLI ${v}` : `[vlab] WARNING: could not run “${compiler.config.cli}” — install Arduino CLI (see README) or set ARDUINO_CLI`);
  });
}
