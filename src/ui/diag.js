// Alignment check, opened with ?diag=1 on the page address. It draws a magenta dot at every pin where the app
// *thinks* the pin is (computed from the model and the view, with no CSS transform involved), so a screenshot
// shows whether the drawn parts line up, and it measures real page elements against the model and reports
// the numbers (with the display settings) so a layout bug on one particular device can be pinned down.
import { allPinsWorld, partBounds } from '../core/geometry.js';

export function startDiag(editor) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;width:min(360px,calc(100vw - 16px));max-height:60dvh;overflow:auto;background:#fff;color:#111;border:2px solid #c0158a;border-radius:10px;padding:10px;font:12px/1.4 ui-monospace,monospace;box-shadow:0 6px 24px rgba(0,0,0,.3)';
  box.innerHTML = '<b>Alignment check</b> <button id="dgRun">Measure</button> <button id="dgDots">Dots on/off</button> <button id="dgCopy">Copy</button> <button id="dgX">✕</button><pre id="dgOut" style="white-space:pre-wrap;margin:6px 0 0"></pre>';
  document.body.appendChild(box);
  const out = box.querySelector('#dgOut');
  const cv = editor.canvas;
  const dots = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dots.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:9998';
  document.body.appendChild(dots);
  let on = true;
  const f = n => (Math.round(n * 100) / 100);

  function draw() {
    dots.innerHTML = '';
    if (!on) return;
    const r = cv.getBoundingClientRect(), { x, y, z } = editor.view;
    let n = 0, html = '';
    for (const part of editor.state.parts) for (const p of allPinsWorld(part)) {
      if (n++ > 1500) break;
      html += `<circle cx="${r.left + p.x * z + x}" cy="${r.top + p.y * z + y}" r="1.6" fill="#e0149a"/>`;
    }
    dots.innerHTML = html;
  }
  function measure() {
    const r = cv.getBoundingClientRect(), { x, y, z } = editor.view, L = [];
    const vv = window.visualViewport;
    L.push(`UA ${navigator.userAgent.replace(/^Mozilla\/5.0 /, '')}`);
    L.push(`dpr ${window.devicePixelRatio}  inner ${innerWidth}x${innerHeight}  visual ${vv ? `${f(vv.width)}x${f(vv.height)} scale ${vv.scale} offset ${f(vv.offsetLeft)},${f(vv.offsetTop)}` : 'n/a'}`);
    L.push(`screen ${screen.width}x${screen.height}  touch ${navigator.maxTouchPoints}  pointer:coarse ${matchMedia('(pointer:coarse)').matches}  rootFont ${getComputedStyle(document.documentElement).fontSize}`);
    L.push(`canvas rect ${f(r.left)},${f(r.top)} ${f(r.width)}x${f(r.height)}  client ${cv.clientWidth}x${cv.clientHeight}  scroll ${cv.scrollLeft},${cv.scrollTop}`);
    L.push(`view x=${f(x)} y=${f(y)} z=${f(z)}   world transform: ${getComputedStyle(editor.world).transform}`);
    // a probe element at world (100,100) sized 100x100: where does the browser really put it?
    const pr = document.createElement('div'); pr.style.cssText = 'position:absolute;left:100px;top:100px;width:100px;height:100px;visibility:hidden';
    editor.world.appendChild(pr); const b = pr.getBoundingClientRect(); pr.remove();
    L.push(`probe expected ${f(r.left + 100 * z + x)},${f(r.top + 100 * z + y)} ${f(100 * z)}px   actual ${f(b.left)},${f(b.top)} ${f(b.width)}px   off ${f(b.left - (r.left + 100 * z + x))},${f(b.top - (r.top + 100 * z + y))}`);
    for (const part of editor.state.parts) {
      const el = editor.els.get(part.id); if (!el) continue;
      const bb = partBounds(part), er = el.getBoundingClientRect(), m = el.querySelector('.model, svg, img')?.getBoundingClientRect();
      const ex = r.left + bb.x0 * z + x, ey = r.top + bb.y0 * z + y, ew = (bb.x1 - bb.x0) * z, eh = (bb.y1 - bb.y0) * z;
      L.push(`${part.type}: model ${f(ex)},${f(ey)} ${f(ew)}x${f(eh)} | element ${f(er.left)},${f(er.top)} ${f(er.width)}x${f(er.height)} | off ${f(er.left - ex)},${f(er.top - ey)} size ${f(er.width - ew)},${f(er.height - eh)}${m ? ` | art ${f(m.left)},${f(m.top)} ${f(m.width)}x${f(m.height)}` : ''}`);
    }
    out.textContent = L.join('\n');
    draw();
    return L.join('\n');
  }
  box.querySelector('#dgRun').onclick = measure;
  box.querySelector('#dgDots').onclick = () => { on = !on; draw(); };
  box.querySelector('#dgCopy').onclick = () => { const t = measure(); navigator.clipboard?.writeText(t).catch(() => {}); };
  box.querySelector('#dgX').onclick = () => { clearInterval(tick); box.remove(); dots.remove(); };
  const tick = setInterval(draw, 400);
  setTimeout(measure, 800);
}
