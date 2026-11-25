// A line held open to the server. When an admin changes someone's access the server writes "data: refresh" to it,
// and the page re-reads at once instead of waiting for its next check-in. Used for signed-in accounts and for visitors.
export function holdLine({ fetchImpl, url, headers = () => ({}), onRefresh, keep = () => true, retryMs = 3000 }) {
  let ctl = null, timer = null, stopped = false;
  async function run() {
    if (stopped || ctl || !keep() || !globalThis.ReadableStream) return;
    const c = ctl = new AbortController();
    try {
      const r = await fetchImpl(url(), { headers: headers(), signal: c.signal });
      if (!r.ok || !r.body) throw new Error('no live line');
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.includes('data: refresh')) onRefresh(); }
      }
    } catch { /* offline, signed out, or the server restarted: try again below */ }
    ctl = null;
    if (!stopped && keep()) { timer = setTimeout(run, retryMs + Math.random() * 2000); timer.unref?.(); }
  }
  return { start() { stopped = false; return run(); }, stop() { stopped = true; clearTimeout(timer); ctl?.abort(); ctl = null; } };
}
