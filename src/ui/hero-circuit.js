// A small live circuit built from the real Wokwi parts (the same components the editor uses): an Arduino Uno blinking an LED through a resistor.
// Used on the landing page and on the sign-in screen. Wires are laid out from the parts' own pin positions, so they always land on the pins.
import '@wokwi/elements';

const W = 600, H = 410;
export function mountHeroCircuit(host, { interval = 750 } = {}) {
  host.classList.add('hc'); host.replaceChildren();
  const stage = document.createElement('div'); stage.className = 'hc-stage'; stage.style.cssText = `position:relative;width:${W}px;height:${H}px;transform-origin:0 0`;
  const mk = (tag, x, y, props = {}, k = 1) => { const e = document.createElement(tag); e.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform-origin:0 0;transform:scale(${k})`; Object.assign(e, props); for (const [k, v] of Object.entries(props)) if (typeof v === 'string') e.setAttribute(k, v); return e; };
  const U = [280, 176], L = [70, 14], R = [150, 150], KL = 2.6, KR = 2.3;
  const uno = mk('wokwi-arduino-uno', ...U), led = mk('wokwi-led', ...L, { color: 'red' }, KL), res = mk('wokwi-resistor', ...R, { value: '220' }, KR);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';
  stage.append(uno, res, led, svg); host.append(stage);
  const fit = () => { const k = Math.min(1, host.clientWidth / W) || 1; stage.style.transform = `scale(${k})`; host.style.height = `${H * k}px`; };
  fit(); if ('ResizeObserver' in window) new ResizeObserver(fit).observe(host);

  const wires = [];
  const pin = (el, [x0, y0], name, k = 1) => { const p = (el.pinInfo || []).find(q => q.name === name); return p ? [Math.round(x0 + p.x * k), Math.round(y0 + p.y * k)] : null; };
  const wire = (pts, color, flows) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M' + pts.map(q => q.join(' ')).join(' L')); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', 3.2); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); svg.append(p); if (flows) wires.push(p); return p; };
  let timer = 0, on = false;
  const set = v => { on = v; led.value = v; uno.led13 = v; for (const w of wires) w.classList.toggle('hc-flow', v); };
  Promise.all(['wokwi-arduino-uno', 'wokwi-led', 'wokwi-resistor'].map(t => customElements.whenDefined(t))).then(async () => {
    await Promise.all([uno, led, res].map(e => e.updateComplete)); await new Promise(r => requestAnimationFrame(r));
    const p13 = pin(uno, U, '13'), gnd = pin(uno, U, 'GND.1') || pin(uno, U, 'GND');
    const a = pin(led, L, 'A', KL), c = pin(led, L, 'C', KL), r1 = pin(res, R, '1', KR), r2 = pin(res, R, '2', KR);
    if (!p13 || !gnd || !a || !c || !r1 || !r2) return;
    const lowY = Math.max(a[1], c[1]) + 22, rowY = r1[1];
    wire([a, [a[0], lowY], [p13[0], lowY], p13], '#ffb84a', true);                           // LED anode ← pin 13
    wire([c, [c[0], rowY], r1], '#8fa0a8', false);                                          // LED cathode → resistor
    wire([r2, [gnd[0], r2[1]], gnd], '#8fa0a8', false);                                       // resistor → GND
    for (const q of [p13, gnd, a, c, r1, r2]) { const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); d.setAttribute('cx', q[0]); d.setAttribute('cy', q[1]); d.setAttribute('r', 3.6); d.setAttribute('fill', '#fff'); svg.append(d); }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    set(true); if (!reduce) timer = setInterval(() => { if (!host.isConnected) return clearInterval(timer); set(!on); }, interval);
  });
  return () => clearInterval(timer);
}
