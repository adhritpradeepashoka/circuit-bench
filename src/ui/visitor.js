// Someone using the lab without signing in is a "visitor": this browser made itself a random id (see sim/session.mjs)
// and checks in with it, so an admin can see who is here and block one. Signed-in people are judged by their account.
// The page only reflects the answer (the blocked screen); the server refuses AI, community, projects and compiling too.
import { getVisitorId, getToken } from '../sim/session.mjs';
import { holdLine } from './live-line.js';

let block = { blocked: false, note: '' };
/** Is this visitor blocked right now? (Ignored for anyone who is signed in.) */
export const visitorBlock = () => (getToken() ? { blocked: false, note: '' } : block);

export function initVisitor({ fetchImpl = (...a) => globalThis.fetch(...a), heartbeatMs = 30_000, page = () => '' } = {}) {
  let off = false;                                                                  // the server does not track visitors: stop asking
  const set = next => {
    if (next.blocked === block.blocked && next.note === block.note) return;
    block = next; try { globalThis.dispatchEvent?.(new Event('cb-visitor')); } catch { /* ignore */ }
  };
  async function beat() {
    if (off) return;
    try {
      const token = getToken();
      const r = await fetchImpl('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ id: getVisitorId(), page: page() }) });
      if (r.status === 404) { off = true; line.stop(); return; }
      const b = await r.json().catch(() => null); if (b?.ok) set({ blocked: !!b.blocked, note: b.note || '' });
    } catch { /* offline: keep what we knew */ }
  }
  const line = holdLine({ fetchImpl, url: () => `/api/live?v=${getVisitorId()}`, onRefresh: () => beat(), keep: () => !off && !getToken(), retryMs: 10_000 });
  const sync = () => { beat(); if (getToken()) line.stop(); else line.start(); };
  globalThis.addEventListener?.('cb-session', sync);
  if (heartbeatMs) {
    setInterval(beat, heartbeatMs);
    globalThis.document?.addEventListener?.('visibilitychange', () => { if (!document.hidden) beat(); });
    beat().then(() => { if (!getToken()) line.start(); });
  }
  return { beat, line };
}
