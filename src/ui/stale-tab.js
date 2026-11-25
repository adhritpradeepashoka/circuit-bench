// A tab left open across a deploy still points at the old file names, so the next lazily loaded piece (the 3D view, Blockly, the editor …) fails with
// "Failed to fetch dynamically imported module". Vite reports it as 'vite:preloadError'; we say what happened and offer a reload instead of leaving a raw error.
export function watchStaleTab({ win = globalThis.window, doc = globalThis.document } = {}) {
  if (!win?.addEventListener || !doc) return () => {};
  let shown = false;
  const show = () => {
    if (shown) return; shown = true;
    const bar = doc.createElement('div'); bar.id = 'staleTab'; bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;background:#1b2b3a;color:#fff;padding:10px 14px;border-radius:10px;font:14px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center';
    const msg = doc.createElement('span'); msg.textContent = 'CircuitBench was updated while this tab was open. Reload to get the new version.';
    const btn = doc.createElement('button'); btn.type = 'button'; btn.textContent = 'Reload'; btn.style.cssText = 'background:#2f6fed;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit';
    btn.addEventListener('click', () => win.location.reload());
    bar.append(msg, btn); doc.body.append(bar);
  };
  win.addEventListener('vite:preloadError', show);
  return () => win.removeEventListener?.('vite:preloadError', show);
}
