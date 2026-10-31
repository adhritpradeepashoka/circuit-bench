// Finds the real photo of a part on the web so the AI can draw it from the picture instead of from memory. Every fetch goes through
// safeFetch(): https only, never a private / loopback address (the host name is resolved and checked, and so is every redirect), a size cap,
// a time cap, and the content type must be what we asked for. A page is only read for its <meta og:image>, never run or followed further.
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_IMAGE = 4_000_000, MAX_PAGE = 400_000, HOPS = 4;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Is this address one a public web page can never legitimately point us at (loopback, private, link-local, metadata…)? */
export function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (!v) return true;
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::' || s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('ff')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

async function checkUrl(raw, resolve) {
  let u; try { u = new URL(String(raw)); } catch { throw new Error('bad url'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new Error('only plain https addresses');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('private host');
  if (net.isIP(host)) { if (isPrivateAddress(host)) throw new Error('private address'); return u; }
  const addrs = await resolve(host);
  if (!addrs.length || addrs.some(a => isPrivateAddress(a))) throw new Error('private address');
  return u;
}

/**
 * GET a public https URL. → { type, bytes (Uint8Array), url } or throws. `types` limits the content type (prefix match).
 * @param {{fetchImpl?:Function, resolve?:(h:string)=>Promise<string[]>, max?:number, types?:string[], timeoutMs?:number}} o
 */
export async function safeFetch(rawUrl, { fetchImpl = globalThis.fetch, resolve = async h => (await lookup(h, { all: true })).map(a => a.address), max = MAX_IMAGE, types = IMAGE_TYPES, timeoutMs = 9000 } = {}) {
  let url = rawUrl;
  for (let hop = 0; hop <= HOPS; hop++) {
    const u = await checkUrl(url, resolve);
    const res = await fetchImpl(u.href, { redirect: 'manual', headers: { 'user-agent': 'CircuitBench-part-maker/1.0 (+https://circuitbench.run.place)', accept: types.join(',') }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).href; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!types.some(t => type === t || (t.endsWith('/') && type.startsWith(t)))) throw new Error(`unexpected type ${type || 'unknown'}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > max) throw new Error('too big');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error('too big');
    return { type, bytes: buf, url: u.href };
  }
  throw new Error('too many redirects');
}

/** The picture a web page advertises for itself (<meta property="og:image">), as an absolute URL, or null. */
export function ogImage(html, base) {
  const h = String(html).slice(0, MAX_PAGE);
  for (const re of [/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i]) {
    const m = re.exec(h);
    if (m) { try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { /* next */ } }
  }
  return null;
}

/** The first usable photo among direct image URLs, then the pictures of the pages the search used. → { type, b64, url, from } or null. */
export async function findPhoto({ imageUrls = [], pageUrls = [], safe = safeFetch, maxTries = 7 }) {
  let tries = 0;
  const grab = async (u, from) => { if (tries++ >= maxTries) return null; try { const r = await safe(u); if (r.bytes.length < 3000) return null; return { type: r.type, b64: Buffer.from(r.bytes).toString('base64'), url: r.url, from }; } catch { return null; } };
  for (const u of imageUrls.slice(0, 4)) { const hit = await grab(u, u); if (hit) return hit; }
  for (const p of pageUrls.slice(0, 4)) {
    if (tries >= maxTries) break;
    try {
      tries++;
      const page = await safe(p, { types: ['text/html', 'application/xhtml+xml'], max: MAX_PAGE });
      const og = ogImage(Buffer.from(page.bytes).toString('utf8'), page.url);
      if (og) { const hit = await grab(og, page.url); if (hit) return hit; }
    } catch { /* next page */ }
  }
  return null;
}
