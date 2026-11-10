// A real picture of a project: the parts as they look on the bench and the wires between them, drawn as an SVG and
// shrunk to a small image. Used for the project cards on the home screen.
import { partSize, partBounds } from '../core/geometry.js';

const ser = new XMLSerializer();
const NS = 'http://www.w3.org/2000/svg';

/** The drawable picture inside a part's element: a breadboard's inline svg, or a web component's shadow svg. */
function partArt(root, w, h) {
  const host = [root, ...root.querySelectorAll('*')].find(e => e.shadowRoot?.querySelector('svg'));
  const svg = host ? host.shadowRoot.querySelector('svg') : root.querySelector('svg');
  if (!svg) return '';
  const c = svg.cloneNode(true);
  // custom elements keep their own css in the shadow root; carry it along, scoped by being inside this svg
  const sheets = host ? [...(host.shadowRoot.adoptedStyleSheets || [])].map(sh => { try { return [...sh.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; } }) : [];
  const styles = host ? [...sheets, ...[...host.shadowRoot.querySelectorAll('style')].map(s => s.textContent)].join('\n') : '';
  if (!c.getAttribute('viewBox')) {
    const pw = parseFloat(c.getAttribute('width')), ph = parseFloat(c.getAttribute('height'));
    if (pw > 0 && ph > 0) c.setAttribute('viewBox', `0 0 ${pw} ${ph}`);
  }
  c.setAttribute('width', w); c.setAttribute('height', h); c.setAttribute('preserveAspectRatio', 'none'); c.removeAttribute('style');
  if (styles) { const st = document.createElementNS(NS, 'style'); st.textContent = styles.replace(/:host[^{]*\{[^}]*\}/g, ''); c.prepend(st); }
  return ser.serializeToString(c);
}

/** → an SVG string showing everything on the bench, or '' when it is empty. */
export function benchSvg(editor, { w = 360, h = 220 } = {}) {
  const parts = editor.state.parts; if (!parts.length) return '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) { const b = partBounds(p); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  const pad = Math.max(24, (x1 - x0) * 0.04); x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const body = [];
  for (const p of [...parts].sort((a, b) => (a.type === 'breadboard' ? 0 : 1) - (b.type === 'breadboard' ? 0 : 1))) {
    const root = editor.els.get(p.id); if (!root) continue;
    const s = partSize(p), art = partArt(root, s.w, s.h);
    body.push(`<g transform="translate(${p.x} ${p.y}) rotate(${p.rot || 0} ${s.w / 2} ${s.h / 2})">${art || `<rect width="${s.w}" height="${s.h}" rx="6" fill="#2f7dd1" opacity=".85"/>`}</g>`);
  }
  const wires = editor.overlay.querySelectorAll('path, polyline, line');
  const wiresSvg = [...wires].filter(n => !n.closest('.ring, .hit, defs')).map(n => ser.serializeToString(n)).join('');
  return `<svg xmlns="${NS}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#f4f7f5"/>${body.join('')}<g fill="none" stroke-linecap="round">${wiresSvg}</g></svg>`;
}

/** → a small JPEG data URL of the bench, or '' when it cannot be drawn. */
export async function benchThumb(editor, { w = 360, h = 220 } = {}) {
  try {
    const svg = benchSvg(editor, { w, h }); if (!svg) return '';
    const img = new Image(); img.decoding = 'async';
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const cv = document.createElement('canvas'); cv.width = w * 1.5; cv.height = h * 1.5;
    const g = cv.getContext('2d'); g.fillStyle = '#f4f7f5'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    return cv.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}
