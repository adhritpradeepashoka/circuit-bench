// Pictures of real components for the ready-made parts (a "look"): a diode with its stripe, a TO-92 transistor, a TO-220 regulator, a ceramic and an electrolytic capacitor,
// a relay, a fan, a servo… Each is drawn above the part's pins (which always sit along the bottom edge, 0.1" apart) with a lead running down to every pin, and each pin's
// name written on its lead. Pure strings, no DOM: customPartSVG (parts/elements.js) wraps the result. Add a look here, list it in LOOKS, and name it in a template.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = v => +Number(v).toFixed(2);
const lum = hex => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0.2; const v = parseInt(m[1], 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };
const METAL = '#b8bec4', METAL_D = '#7d858c', GOLD = '#d9b44a';

/** A context for the drawers: the pin points, where the body may sit (above y = bt) and small helpers. */
function ctx(spec, w, h, pins) {
  const xs = pins.map(p => p.x), y = pins.length ? pins[0].y : h - 3, bt = y - 14, cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : w / 2;
  const c = spec.color, light = lum(c) > 0.6, ink = light ? '#222' : '#f2f2f2';
  const lead = (x, y1, y2, col = METAL, sw = 2) => `<line x1="${n2(x)}" y1="${n2(y1)}" x2="${n2(x)}" y2="${n2(y2)}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
  const leads = (from = bt, cols = null) => pins.map((p, i) => lead(p.x, from, p.y, cols?.[i] || METAL)).join('');
  const text = (t, x, yy, size = 6.5, fill = ink, extra = '') => `<text x="${n2(x)}" y="${n2(yy)}" text-anchor="middle" font-size="${size}" font-weight="700" font-family="sans-serif" fill="${fill}"${extra}>${esc(t)}</text>`;
  const fit = (t, maxW, size = 7) => Math.max(3.6, Math.min(size, maxW / (String(t).length * 0.62)));
  return { w, h, pins, xs, y, bt, cx, c, light, ink, lead, leads, text, fit, label: spec.label || spec.name };
}
const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient>`;

const DRAW = {
  // a diode standing on end: the stripe end is the cathode and sits over the K pin; the anode lead comes over the top
  diode(k) {
    const { pins, bt, c, light, lead } = k, a = pins[0], kk = pins[1] || pins[0], top = bt - 40, stripe = light ? '#1b1b1b' : '#dfe3e6';
    return `<defs>${grad('dg', c, light ? '#fff6dd' : '#6a6a70')}</defs>
      <path d="M${n2(a.x)} ${n2(a.y)} V${n2(top - 8)} H${n2(kk.x)} V${n2(top)}" fill="none" stroke="${METAL}" stroke-width="2" stroke-linejoin="round"/>${lead(kk.x, bt - 4, kk.y)}
      <rect x="${n2(kk.x - 7)}" y="${top}" width="14" height="${bt - 4 - top}" rx="3.5" fill="url(#dg)" stroke="#0008" stroke-width=".7"/>
      <rect x="${n2(kk.x - 7)}" y="${bt - 14}" width="14" height="6.5" fill="${stripe}"/>${k.text(k.label, kk.x, top + 13, k.fit(k.label, 12, 5), k.light ? '#222' : '#eee', ` transform="rotate(-90 ${n2(kk.x)} ${top + 13})"`)}`;
  },
  // TO-92: the half-round plastic transistor (also Hall sensors). Flat face towards you, three straight legs.
  to92(k) {
    const { xs, bt, cx, c } = k, hw = Math.max(12, (Math.max(...xs) - Math.min(...xs)) / 2 + 5);
    return `${k.leads(bt - 2)}<defs>${grad('tg', c, '#5b5b62')}</defs>
      <path d="M${n2(cx - hw)} ${bt} V${bt - 20} A${n2(hw)} ${n2(hw + 2)} 0 0 1 ${n2(cx + hw)} ${bt - 20} V${bt} Z" fill="url(#tg)" stroke="#000a" stroke-width=".8"/>
      ${k.text(k.label, cx, bt - 8, k.fit(k.label, hw * 2 - 4, 6.5), '#f2f2f2')}`;
  },
  // TO-220: black body with a metal tab and a mounting hole. Regulators, power MOSFETs.
  to220(k) {
    const { bt, cx, c } = k, bw = 18;
    return `${k.leads(bt - 2)}
      <rect x="${n2(cx - bw)}" y="${bt - 44}" width="${bw * 2}" height="18" rx="2" fill="${METAL}" stroke="#555" stroke-width=".7"/><circle cx="${n2(cx)}" cy="${bt - 36}" r="4.2" fill="#fff" stroke="#555" stroke-width=".8"/>
      <rect x="${n2(cx - bw)}" y="${bt - 26}" width="${bw * 2}" height="24" rx="2" fill="${lum(c) > 0.45 ? '#2a2a2e' : c}" stroke="#000" stroke-width=".7"/>
      ${k.text(k.label, cx, bt - 11, k.fit(k.label, bw * 2 - 4, 7), '#f2f2f2')}`;
  },
  // a surface-mount regulator (SOT-223): a small black body with a wide tab
  sot223(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 14)}" y="${bt - 36}" width="28" height="9" rx="1" fill="${METAL}" stroke="#555" stroke-width=".6"/>
      <rect x="${n2(cx - 14)}" y="${bt - 28}" width="28" height="22" rx="2" fill="#26262a" stroke="#000" stroke-width=".7"/>${k.text(k.label, cx, bt - 14, k.fit(k.label, 24, 6.5), '#eee')}`;
  },
  capDisc(k) {
    const { bt, cx, c } = k, r = 15, cy = bt - r - 6;
    return `<defs><radialGradient id="cd" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe0a0"/><stop offset="1" stop-color="${c}"/></radialGradient></defs>${k.leads(cy + r - 2)}
      <circle cx="${n2(cx)}" cy="${cy}" r="${r}" fill="url(#cd)" stroke="#6b4a10" stroke-width=".8"/>${k.text(k.label.replace(/[^0-9a-z]/gi, '').slice(0, 4) || '104', cx, cy + 2.5, 8, '#4a3200')}`;
  },
  capElectro(k) {
    const { bt, cx, c, pins } = k, bw = 15, top = bt - 40, plus = pins[0];
    return `<defs><linearGradient id="eg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff" stop-opacity=".32"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>${k.leads(bt - 2, null)}
      <rect x="${n2(cx - bw)}" y="${top}" width="${bw * 2}" height="${bt - 2 - top}" rx="4" fill="${c}" stroke="#000a" stroke-width=".8"/><rect x="${n2(cx - bw)}" y="${top}" width="${bw * 2}" height="${bt - 2 - top}" rx="4" fill="url(#eg)"/>
      <rect x="${n2(cx - bw)}" y="${top}" width="9" height="${bt - 2 - top}" rx="3" fill="#e9ecef" opacity=".9"/>${[0, 1, 2].map(i => k.text('−', cx - bw + 4.5, top + 11 + i * 9, 8, '#111')).join('')}
      ${k.text(k.label.replace(/^.*?(\d)/, '$1'), cx + 5, top + 21, k.fit(k.label, 16, 6), '#fff', ' stroke="#0006" stroke-width=".4"')}${k.text('+', plus.x - 4, bt - 6, 7, '#222')}`;
  },
  inductor(k) {
    const { bt, cx, pins } = k, r = 17, cy = bt - r - 6;
    return `<circle cx="${n2(cx)}" cy="${cy}" r="${r}" fill="#5a3d2b" stroke="#2c1c10" stroke-width="1"/><circle cx="${n2(cx)}" cy="${cy}" r="6" fill="#f4f1ea" stroke="#2c1c10" stroke-width=".8"/>
      ${Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2; return `<line x1="${n2(cx + Math.cos(a) * 7.5)}" y1="${n2(cy + Math.sin(a) * 7.5)}" x2="${n2(cx + Math.cos(a) * 16)}" y2="${n2(cy + Math.sin(a) * 16)}" stroke="#c98a45" stroke-width="2.2"/>`; }).join('')}
      <path d="M${n2(pins[0].x)} ${pins[0].y} V${cy + r - 2}" stroke="${METAL}" stroke-width="2" fill="none"/><path d="M${n2((pins[1] || pins[0]).x)} ${pins[0].y} V${cy + r - 2}" stroke="${METAL}" stroke-width="2" fill="none"/>${k.text(k.label, cx, cy + r + 3, 5.5, '#222')}`;
  },
  // an 8–14 pin chip seen from above: notch, pin-1 dot and the name, legs to the pins this model uses
  chip(k) {
    const { xs, bt, cx, c } = k, x0 = Math.min(...xs) - 12, x1 = Math.max(...xs) + 12, body = lum(c) > 0.5 ? '#2a2a2e' : c;
    return `${k.leads(bt - 3)}<rect x="${n2(x0)}" y="${bt - 30}" width="${n2(x1 - x0)}" height="28" rx="2.5" fill="${body}" stroke="#000" stroke-width=".8"/>
      <path d="M${n2(x0)} ${bt - 20} a4 4 0 0 1 0 -8" fill="#0008"/><circle cx="${n2(x0 + 8)}" cy="${bt - 7}" r="1.8" fill="#fff8"/>${k.text(k.label, (x0 + x1) / 2 + 2, bt - 13, k.fit(k.label, x1 - x0 - 14, 8), '#f2f2f2')}
      ${Array.from({ length: Math.max(2, Math.round((x1 - x0) / 9.6)) }, (_, i) => `<rect x="${n2(x0 + 3 + i * 9.6)}" y="${bt - 2}" width="2.4" height="2.5" fill="${METAL_D}"/>`).join('')}`;
  },
  relay(k) {
    const { bt, cx, xs } = k, x0 = Math.min(...xs) - 12, x1 = Math.max(...xs) + 12;
    return `${k.leads(bt - 2)}<rect x="${n2(x0)}" y="${bt - 40}" width="${n2(x1 - x0)}" height="38" rx="3" fill="#2f5aa8" stroke="#16315f" stroke-width="1"/>
      <rect x="${n2(x0 + 4)}" y="${bt - 36}" width="${n2(x1 - x0 - 8)}" height="14" rx="1.5" fill="#e9eef7"/>${k.text(/12/.test(k.label + k.c) ? 'SRD-12VDC' : 'SRD-05VDC', (x0 + x1) / 2, bt - 26, 6, '#16315f')}
      <path d="M${n2(x0 + 8)} ${bt - 10} h6 l2 -5 l3 10 l3 -10 l3 10 l2 -5 h6" fill="none" stroke="#e9eef7" stroke-width="1.2"/>${k.text('COIL', x1 - 12, bt - 8, 5, '#e9eef7')}`;
  },
  buzzer(k) {
    const { bt, cx } = k, r = 19, cy = bt - r - 3, passive = /passive|piezo/i.test(k.label);
    return `${k.leads(cy + r - 3, ['#c33', '#222'])}${passive
      ? `<circle cx="${n2(cx)}" cy="${cy}" r="${r}" fill="#c9a227" stroke="#7a5f10"/><circle cx="${n2(cx)}" cy="${cy}" r="${r - 6}" fill="#f1efe6" stroke="#bbb"/><circle cx="${n2(cx)}" cy="${cy}" r="3" fill="#c9a227"/>`
      : `<circle cx="${n2(cx)}" cy="${cy}" r="${r}" fill="#1d1d20" stroke="#000"/><circle cx="${n2(cx)}" cy="${cy}" r="${r - 5}" fill="none" stroke="#3a3a40" stroke-width="1"/><circle cx="${n2(cx)}" cy="${cy}" r="3" fill="#000"/>${k.text('+', cx - r + 6, cy - r + 9, 8, '#ddd')}`}`;
  },
  speaker(k) {
    const { bt, cx } = k, r = 20, cy = bt - r - 2;
    return `${k.leads(cy + r - 3, ['#c33', '#222'])}<circle cx="${n2(cx)}" cy="${cy}" r="${r}" fill="#26262a" stroke="#000"/><circle cx="${n2(cx)}" cy="${cy}" r="${r - 4}" fill="#3a3a40"/><circle cx="${n2(cx)}" cy="${cy}" r="${r - 10}" fill="#4a4a52" stroke="#222" stroke-width=".8"/><circle cx="${n2(cx)}" cy="${cy}" r="4.5" fill="#1a1a1e"/>
      ${[45, 135, 225, 315].map(a => `<circle cx="${n2(cx + Math.cos(a * Math.PI / 180) * (r - 2))}" cy="${n2(cy + Math.sin(a * Math.PI / 180) * (r - 2))}" r="1.4" fill="#888"/>`).join('')}`;
  },
  fan(k) {
    const { bt, cx } = k, s = 36, cy = bt - s / 2 - 4;
    const blades = Array.from({ length: 7 }, (_, i) => `<path d="M0 0 C6 -4 14 -6 16 -12 C10 -14 3 -9 0 0Z" transform="rotate(${i * 360 / 7})" fill="#aab2ba" stroke="#555" stroke-width=".5"/>`).join('');
    return `${k.leads(cy + s / 2, ['#c33', '#222'])}<rect x="${n2(cx - s / 2)}" y="${n2(cy - s / 2)}" width="${s}" height="${s}" rx="4" fill="#2b2f36" stroke="#000"/>
      ${[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => `<circle cx="${n2(cx + a * 14)}" cy="${n2(cy + b * 14)}" r="1.8" fill="#0b0d10"/>`).join('')}<circle cx="${n2(cx)}" cy="${n2(cy)}" r="15.5" fill="#0d1014"/>
      <g transform="translate(${n2(cx)} ${n2(cy)})">${blades}<circle r="4.6" fill="#454b52" stroke="#111"/></g>`;
  },
  vibe(k) {
    const { bt, cx } = k, r = 15, cy = bt - r - 4;
    return `${k.leads(cy + r - 3, ['#c33', '#2b6cb0'])}<circle cx="${n2(cx)}" cy="${cy}" r="${r}" fill="#a9b1b8" stroke="#555"/><path d="M${n2(cx - r)} ${cy} A${r} ${r} 0 0 1 ${n2(cx + r)} ${cy} Z" fill="#26262a" opacity=".85"/><circle cx="${n2(cx)}" cy="${cy}" r="3" fill="#555"/>`;
  },
  pump(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 3, ['#c33', '#222'])}<rect x="${n2(cx - 20)}" y="${bt - 38}" width="40" height="34" rx="6" fill="#ecf1f5" stroke="#5b6670"/><rect x="${n2(cx - 20)}" y="${bt - 38}" width="40" height="13" rx="6" fill="#2b8fd6"/>
      <rect x="${n2(cx - 28)}" y="${bt - 34}" width="10" height="6" fill="#2b8fd6" stroke="#145a8a" stroke-width=".7"/><rect x="${n2(cx + 18)}" y="${bt - 22}" width="10" height="6" fill="#2b8fd6" stroke="#145a8a" stroke-width=".7"/><circle cx="${n2(cx)}" cy="${bt - 15}" r="7" fill="#c8d1d8" stroke="#5b6670"/>`;
  },
  solenoid(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 3, ['#c33', '#222'])}<rect x="${n2(cx - 5)}" y="${bt - 56}" width="10" height="26" fill="${METAL}" stroke="#555" stroke-width=".7"/><rect x="${n2(cx - 18)}" y="${bt - 34}" width="36" height="30" rx="3" fill="#1d1d20" stroke="#000"/>
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${n2(cx - 16)}" y="${bt - 31 + i * 4.5}" width="32" height="2.4" fill="#b87333"/>`).join('')}`;
  },
  toggle(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 5)}<rect x="${n2(cx - 16)}" y="${bt - 14}" width="32" height="11" rx="2" fill="#555d66" stroke="#222"/><polygon points="${n2(cx - 9)},${bt - 14} ${n2(cx + 9)},${bt - 14} ${n2(cx + 13)},${bt - 20} ${n2(cx - 13)},${bt - 20}" fill="#9aa3ab" stroke="#444" stroke-width=".7"/>
      <path d="M${n2(cx)} ${bt - 20} L${n2(cx + 11)} ${bt - 44}" stroke="${METAL}" stroke-width="6" stroke-linecap="round"/><circle cx="${n2(cx + 11)}" cy="${bt - 44}" r="4" fill="#dfe3e6" stroke="#555" stroke-width=".6"/>`;
  },
  slide(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 3)}<rect x="${n2(cx - 22)}" y="${bt - 26}" width="44" height="22" rx="2" fill="#33383f" stroke="#111"/><rect x="${n2(cx - 14)}" y="${bt - 20}" width="28" height="6" rx="3" fill="#0c0d0f"/><rect x="${n2(cx - 12)}" y="${bt - 36}" width="12" height="18" rx="2" fill="#f1f3f5" stroke="#555" stroke-width=".7"/>`;
  },
  reed(k) {
    const { bt, cx, pins } = k, y = bt - 18;
    return `${pins.map((p, i) => `<path d="M${n2(p.x)} ${p.y} V${bt} L${n2(cx + (i ? 1 : -1) * 26)} ${y}" fill="none" stroke="${METAL}" stroke-width="2" stroke-linejoin="round"/>`).join('')}
      <rect x="${n2(cx - 26)}" y="${y - 6}" width="52" height="12" rx="6" fill="#bfe3ef" fill-opacity=".6" stroke="#6b8a96"/><line x1="${n2(cx - 22)}" y1="${y}" x2="${n2(cx - 2)}" y2="${y - 2}" stroke="#555" stroke-width="1.6"/><line x1="${n2(cx + 22)}" y1="${y}" x2="${n2(cx + 2)}" y2="${y + 2}" stroke="#555" stroke-width="1.6"/>`;
  },
  trimmer(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 18)}" y="${bt - 38}" width="36" height="36" rx="2" fill="#2b6cb0" stroke="#173f6e"/><circle cx="${n2(cx)}" cy="${bt - 20}" r="12" fill="#d9b44a" stroke="#7a5f10"/><rect x="${n2(cx - 9)}" y="${bt - 21.5}" width="18" height="3" fill="#6b5410"/>`;
  },
  fsr(k) {
    const { bt, cx } = k, cy = 20;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 6)}" y="${cy}" width="12" height="${bt - cy}" fill="#2b2f36" stroke="#000" stroke-width=".7"/><circle cx="${n2(cx)}" cy="${cy}" r="14" fill="#2b2f36" stroke="#000"/><circle cx="${n2(cx)}" cy="${cy}" r="9.5" fill="#d9a441" stroke="#7a5f10"/>`;
  },
  flex(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 6)}" y="4" width="12" height="${bt - 2}" rx="2" fill="#222831" stroke="#000" stroke-width=".7"/>${Array.from({ length: 7 }, (_, i) => `<line x1="${n2(cx - 4)}" y1="${10 + i * 6}" x2="${n2(cx + 4)}" y2="${10 + i * 6}" stroke="#6b7480" stroke-width="1"/>`).join('')}`;
  },
  soil(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 17)}" y="4" width="10" height="26" fill="#2f855a" stroke="#14452a"/><rect x="${n2(cx + 7)}" y="4" width="10" height="26" fill="#2f855a" stroke="#14452a"/><rect x="${n2(cx - 17)}" y="28" width="34" height="${bt - 30}" rx="2" fill="#2f855a" stroke="#14452a"/>
      <path d="M${n2(cx - 12)} 8 V30 M${n2(cx + 12)} 8 V30" stroke="#c9a227" stroke-width="2"/>${k.text('SOIL', cx, bt - 8, 6, '#eaf7ee')}`;
  },
  servo(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 6, ['#7a4a21', '#d33', '#f08c00'])}<rect x="${n2(cx - 26)}" y="${bt - 34}" width="52" height="28" rx="2" fill="#2b6cb0" stroke="#173f6e"/><rect x="${n2(cx - 32)}" y="${bt - 24}" width="64" height="5" fill="#2b6cb0" stroke="#173f6e" stroke-width=".7"/><circle cx="${n2(cx - 32 + 2)}" cy="${bt - 21.5}" r="1.5" fill="#fff"/><circle cx="${n2(cx + 30)}" cy="${bt - 21.5}" r="1.5" fill="#fff"/>
      <circle cx="${n2(cx + 12)}" cy="${bt - 34}" r="7" fill="#f1f3f5" stroke="#777"/><rect x="${n2(cx + 8)}" y="${bt - 56}" width="8" height="24" rx="3" fill="#f1f3f5" stroke="#777" stroke-width=".8"/>${k.text('SG90', cx - 10, bt - 17, 7, '#e8f1ff')}`;
  },
  hcsr04(k) {
    const { bt, cx, w } = k, x0 = 4, x1 = w - 4;
    return `${k.leads(bt - 3)}<rect x="${x0}" y="6" width="${x1 - x0}" height="${bt - 8}" rx="2" fill="#2563a8" stroke="#123a66"/>${[x0 + 18, x1 - 18].map(x => `<circle cx="${x}" cy="${n2((6 + bt - 2) / 2 - 2)}" r="12" fill="#c9ced3" stroke="#555"/><circle cx="${x}" cy="${n2((6 + bt - 2) / 2 - 2)}" r="8" fill="#3a3f46"/><circle cx="${x}" cy="${n2((6 + bt - 2) / 2 - 2)}" r="3" fill="#8b929a"/>`).join('')}${k.text('HC-SR04', cx, 12, 5.5, '#dbe8f7')}`;
  },
  encoder(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 3)}<rect x="${n2(cx - 28)}" y="8" width="56" height="${bt - 10}" rx="2" fill="#1d2025" stroke="#000"/><circle cx="${n2(cx)}" cy="${n2((8 + bt) / 2)}" r="14" fill="#c9ced3" stroke="#555"/><circle cx="${n2(cx)}" cy="${n2((8 + bt) / 2)}" r="9" fill="#9aa3ab" stroke="#444" stroke-width=".8"/><rect x="${n2(cx - 1.5)}" y="${n2((8 + bt) / 2 - 12)}" width="3" height="8" fill="#222"/>${k.text('KY-040', cx, bt - 4, 5, '#cfd5db')}`;
  },
  irdist(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 26)}" y="${bt - 34}" width="52" height="32" rx="3" fill="#25272b" stroke="#000"/><rect x="${n2(cx - 22)}" y="${bt - 28}" width="14" height="14" rx="2" fill="#0a0b0d" stroke="#555"/><rect x="${n2(cx + 8)}" y="${bt - 28}" width="14" height="14" rx="2" fill="#0a0b0d" stroke="#555"/>${k.text('IR DIST', cx, bt - 6, 6, '#ddd')}`;
  },
  mic(k) {
    const { bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="${n2(cx - 28)}" y="${bt - 38}" width="56" height="36" rx="2" fill="#2563a8" stroke="#123a66"/><circle cx="${n2(cx - 10)}" cy="${bt - 20}" r="11" fill="#2a2d33" stroke="#9aa3ab" stroke-width="2"/><circle cx="${n2(cx - 10)}" cy="${bt - 20}" r="3" fill="#000"/><rect x="${n2(cx + 8)}" y="${bt - 32}" width="16" height="12" fill="#c9ced3" stroke="#555"/><circle cx="${n2(cx + 16)}" cy="${bt - 26}" r="3" fill="#1e3a5f"/>`;
  },
  ledbar(k) {
    const { w, bt } = k, cols = ['#2ecc40', '#2ecc40', '#2ecc40', '#2ecc40', '#ffdc00', '#ffdc00', '#ff851b', '#ff851b', '#ff4136', '#ff4136'], x0 = 6, bw = w - 12;
    return `${k.leads(bt - 3)}<rect x="${x0}" y="10" width="${bw}" height="${bt - 12}" rx="3" fill="#1c1d20" stroke="#000"/>${cols.map((c, i) => `<rect x="${n2(x0 + 6 + i * ((bw - 12) / 10))}" y="18" width="${n2((bw - 12) / 10 - 3)}" height="${bt - 28}" rx="1.5" fill="${c}" opacity=".85" stroke="#0006" stroke-width=".6"/>`).join('')}`;
  },
  stepper(k) {
    const { w, bt, cx } = k;
    return `${k.leads(bt - 2)}<rect x="6" y="${bt - 22}" width="${w - 12}" height="22" rx="2" fill="#2f855a" stroke="#14452a"/><rect x="${n2(cx - 13)}" y="${bt - 19}" width="26" height="9" rx="1" fill="#1b1b1d"/>${[0, 1, 2, 3].map(i => `<rect x="${12 + i * 7}" y="${bt - 15}" width="4" height="4" rx=".8" fill="${['#ff3b30', '#ff9f0a', '#ffd60a', '#34c759'][i]}"/>`).join('')}
      <circle cx="${n2(cx)}" cy="${bt - 38}" r="16" fill="#b8bec4" stroke="#555"/><circle cx="${n2(cx)}" cy="${bt - 38}" r="7" fill="#9aa3ab" stroke="#666"/><rect x="${n2(cx - 3)}" y="${bt - 54}" width="6" height="8" fill="#d9b44a"/>${k.text('28BYJ-48', cx, bt - 17, 4.4, '#e8f5ec')}`;
  },
  buck(k) {
    const { bt, cx, w } = k;
    return `${k.leads(bt - 2)}<rect x="6" y="6" width="${w - 12}" height="${bt - 6}" rx="2" fill="#2563a8" stroke="#123a66"/><rect x="12" y="12" width="26" height="24" rx="2" fill="#1c1d20" stroke="#555"/>${Array.from({ length: 4 }, (_, i) => `<line x1="14" y1="${17 + i * 5}" x2="36" y2="${17 + i * 5}" stroke="#b87333" stroke-width="2"/>`).join('')}
      <circle cx="${w - 22}" cy="22" r="9" fill="#2a2d33" stroke="#9aa3ab"/><rect x="${w - 32}" y="${bt - 22}" width="18" height="14" fill="#2b6cb0" stroke="#fff6"/><circle cx="${w - 23}" cy="${bt - 15}" r="4" fill="#d9b44a"/>${k.text('BUCK', 26, bt - 8, 6, '#dbe8f7')}`;
  },
  person(k) {
    const { bt, cx, w } = k;
    return `${k.leads(bt - 2)}<rect x="6" y="6" width="${w - 12}" height="${bt - 6}" rx="4" fill="${k.c}" stroke="#0006"/><circle cx="${n2(cx)}" cy="22" r="8" fill="#f1d3b8" stroke="#5a3d2b"/><path d="M${n2(cx - 16)} ${bt - 4} Q${n2(cx - 16)} 34 ${n2(cx)} 34 Q${n2(cx + 16)} 34 ${n2(cx + 16)} ${bt - 4}Z" fill="#f1d3b8" stroke="#5a3d2b"/><path d="M8 ${bt - 12} h10 l3 -8 l4 14 l3 -10 h${w - 30}" fill="none" stroke="#fff" stroke-width="1.2" opacity=".8"/>`;
  },
};
DRAW.reg220 = DRAW.to220;

export const LOOKS = Object.freeze(Object.fromEntries(Object.keys(DRAW).map(k => [k, true])));
export const LOOK_IDS = new Set(Object.keys(DRAW));

/** The inside of the part's SVG (the caller adds the <svg> and the pin dots), or '' when there is no such look. */
export function lookSVG(look, spec, w, h, pins) {
  const f = DRAW[look]; if (!f || !pins.length || pins.some(p => p.side !== 'bottom' || Math.abs(p.y - pins[0].y) > 0.5)) return '';       // looks are drawn for pins along the bottom edge
  const k = ctx(spec, w, h, pins);
  const names = pins.map(p => `<text x="${n2(p.x + 1.7)}" y="${n2(p.y - 3.2)}" font-size="4.6" font-family="monospace" fill="#222" stroke="#fff" stroke-width="1.5" paint-order="stroke" transform="rotate(-90 ${n2(p.x + 1.7)} ${n2(p.y - 3.2)})">${esc(p.id)}</text>`).join('');
  return `${f(k)}${names}`;
}
