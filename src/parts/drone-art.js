// Pictures of the drone electronics, drawn the way the real parts look from above (like the BioAmp pill): an AIO board with its solder pads,
// a brushless motor with three wires, a LiPo with its connector and a micro FPV camera with its pigtail. Each pin sits on the pad or wire tip a person would solder to.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GOLD = '#d9b44a', GOLD_D = '#8a6d1d', SILVER = '#c9ccd1', SILVER_D = '#8b9096';
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const tin = p => `<rect x="${(p.x - 4).toFixed(1)}" y="${(p.y - 2).toFixed(1)}" width="8" height="4" rx="1.2" fill="#cfd3d8" stroke="#8b9096" stroke-width=".6"><title>${esc(p.label || p.id)}</title></rect>`;

/** The pad for one pin: a gold ring with the hole dark in the middle, and its name in white silkscreen beside it. */
function pad(p, { r = 5.4, label = p.id, dx = 0, dy = -8, anchor = 'middle', size = 5.4 } = {}) {
  return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${GOLD}" stroke="${GOLD_D}" stroke-width=".7"><title>${esc(p.label || p.id)}</title></circle><circle cx="${p.x}" cy="${p.y}" r="${(r * 0.42).toFixed(1)}" fill="#10161a"/>`
    + `<text x="${p.x + dx}" y="${p.y + dy}" text-anchor="${anchor}" font-size="${size}" font-family="sans-serif" font-weight="700" fill="#f2f2f2">${esc(label)}</text>`;
}

function aio(spec, w, h, pins) {
  const by = Object.fromEntries(pins.map(p => [p.id, p])), name = esc(spec.label || 'AIO');
  const motorLabel = { 1: 'M1', 2: 'M2', 3: 'M3', 4: 'M4' };
  const groups = [1, 2, 3, 4].map(k => {
    const ps = ['A', 'B', 'C'].map(l => by[`M${k}${l}`]).filter(Boolean); if (ps.length < 3) return '';
    const x0 = Math.min(...ps.map(p => p.x)), x1 = Math.max(...ps.map(p => p.x)), cy = ps[0].y;
    return `<rect x="${x0 - 9}" y="${cy - 11}" width="${x1 - x0 + 18}" height="22" rx="3" fill="none" stroke="#f2f2f2" stroke-width=".8" opacity=".55"/>` + ps.map((p, i) => pad(p, { r: 4.6, label: 'ABC'[i], dy: 12.5, size: 5 })).join('')
      + `<text x="${(x0 + x1) / 2}" y="${cy - 14}" text-anchor="middle" font-size="7.5" font-family="sans-serif" font-weight="800" fill="#ffffff">${motorLabel[k]}</text>`;
  }).join('');
  const bat = ['BAT+', 'BAT-'].map(id => by[id] && pad(by[id], { r: 8, label: id === 'BAT+' ? '+' : '−', dy: 3.4, size: 11 })).join('');
  const cam = ['5V', 'G', 'CAM'].map(id => by[id] && pad(by[id], { r: 4.8, label: id === 'G' ? 'GND' : id, dx: 9, dy: 2, anchor: 'start', size: 5.6 })).join('');
  const holes = [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.2" fill="${GOLD}" opacity=".9"/><circle cx="${x}" cy="${y}" r="3" fill="#0d1215"/>`).join('');
  const cx = w / 2, cy = h / 2;
  const mcu = `<rect x="${cx - 17}" y="${cy - 19}" width="34" height="34" rx="2" fill="#1c1c20" stroke="#000"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${cx - 15 + i * 4}" y="${cy - 22}" width="2" height="4" fill="${SILVER}"/><rect x="${cx - 15 + i * 4}" y="${cy + 14}" width="2" height="4" fill="${SILVER}"/><rect x="${cx - 20}" y="${cy - 17 + i * 4}" width="4" height="2" fill="${SILVER}"/><rect x="${cx + 16}" y="${cy - 17 + i * 4}" width="4" height="2" fill="${SILVER}"/>`).join('')}<circle cx="${cx - 11}" cy="${cy - 13}" r="1.8" fill="#6b6b73"/><text x="${cx}" y="${cy + 1}" text-anchor="middle" font-size="5" font-family="monospace" fill="#8d8d99">STM32</text><text x="${cx}" y="${cy + 7}" text-anchor="middle" font-size="4.2" font-family="monospace" fill="#6b6b75">F411</text>`;
  const gyro = `<rect x="${cx + 26}" y="${cy - 36}" width="14" height="14" rx="1.5" fill="#26262b" stroke="#000" stroke-width=".6"/><text x="${cx + 33}" y="${cy - 27}" text-anchor="middle" font-size="3.6" font-family="monospace" fill="#8d8d99">IMU</text>`;
  const caps = [[cx - 44, cy + 26], [cx - 34, cy + 26], [cx + 24, cy + 28], [cx + 36, cy + 28], [cx - 44, cy - 30]].map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="4" rx=".8" fill="#b98f4e" stroke="#6f5226" stroke-width=".5"/>`).join('');
  const big = `<rect x="${cx - 32}" y="${h - 50}" width="22" height="18" rx="3" fill="#1b1b1f" stroke="#000"/><rect x="${cx - 32}" y="${h - 50}" width="22" height="5" fill="#c9ccd1"/><text x="${cx - 21}" y="${h - 36}" text-anchor="middle" font-size="5" font-family="monospace" fill="#c9ccd1">470µ</text>`;
  const coil = `<rect x="${cx + 10}" y="${h - 50}" width="22" height="18" rx="2" fill="#4a4d55" stroke="#222"/><circle cx="${cx + 21}" cy="${h - 41}" r="5" fill="#2d2f34"/>`;
  const usb = `<rect x="${cx - 12}" y="${h - 8}" width="24" height="9" rx="2.4" fill="${SILVER}" stroke="${SILVER_D}"/><rect x="${cx - 8}" y="${h - 6}" width="16" height="4" rx="1.6" fill="#2a2d33"/>`;
  const led = `<circle cx="${cx + 52}" cy="${cy - 8}" r="2.2" fill="#3dd16a"/><circle cx="${cx + 52}" cy="${cy + 2}" r="2.2" fill="#ff9d2e"/>`;
  return svg(w, h, `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="9" fill="${spec.color}" stroke="#05080c" stroke-width="1.4"/><rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="7" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
    ${holes}<path d="M${cx} 22 l-6 10 h12 z" fill="#f2f2f2" opacity=".9"/><text x="${cx}" y="42" text-anchor="middle" font-size="5.2" font-family="sans-serif" font-weight="700" fill="#f2f2f2">FRONT</text>
    ${mcu}${gyro}${caps}${big}${coil}${led}${usb}${groups}${bat}${cam}
    <text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="6.4" font-family="sans-serif" font-weight="800" fill="#f2f2f2">${name}</text>
    <text x="${cx}" y="${cy + 41}" text-anchor="middle" font-size="4.4" font-family="sans-serif" fill="#cfd8e3">${esc(spec.sprite.note || 'FC + 4-in-1 ESC')}</text>`);
}

function motor(spec, w, h, pins) {
  const cx = 44, cy = h / 2, R = 36, col = spec.color, wires = [['#2b6cb0', 'A'], ['#d4a017', 'B'], ['#d9d9d9', 'C']];
  const ordered = ['A', 'B', 'C'].map(id => pins.find(p => p.id === id)).filter(Boolean);
  const lines = ordered.map((p, i) => `<path d="M${cx + R - 6} ${cy - 6 + i * 6} C ${cx + R + 30} ${cy - 6 + i * 6}, ${p.x - 40} ${p.y}, ${p.x - 5} ${p.y}" fill="none" stroke="${wires[i][0]}" stroke-width="3.6" stroke-linecap="round"/><path d="M${cx + R - 6} ${cy - 6 + i * 6} C ${cx + R + 30} ${cy - 6 + i * 6}, ${p.x - 40} ${p.y}, ${p.x - 5} ${p.y}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1"/>${tin(p)}<text x="${p.x - 14}" y="${p.y - 5}" text-anchor="end" font-size="6" font-family="sans-serif" font-weight="800" fill="#f2f2f2" stroke="#222" stroke-width="1.6" paint-order="stroke">${p.id}</text>`).join('');
  const mags = Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6; return `<rect x="${(cx + Math.cos(a) * (R - 6) - 2.6).toFixed(1)}" y="${(cy + Math.sin(a) * (R - 6) - 2.6).toFixed(1)}" width="5.2" height="5.2" rx="1" transform="rotate(${i * 30} ${(cx + Math.cos(a) * (R - 6)).toFixed(1)} ${(cy + Math.sin(a) * (R - 6)).toFixed(1)})" fill="${i % 2 ? '#8e949c' : '#5b6068'}"/>`; }).join('');
  return svg(w, h, `${lines}<circle cx="${cx}" cy="${cy}" r="${R}" fill="#23272d" stroke="#0a0c0f" stroke-width="1.4"/><circle cx="${cx}" cy="${cy}" r="${R - 3}" fill="none" stroke="${col}" stroke-width="3"/>${mags}
    <circle cx="${cx}" cy="${cy}" r="${R - 14}" fill="#2f343b" stroke="#111"/><circle cx="${cx}" cy="${cy}" r="9" fill="#9aa1a9" stroke="#444"/><circle cx="${cx}" cy="${cy}" r="3.2" fill="#2a2d33"/>
    <rect x="${cx - 14}" y="${cy + 15}" width="28" height="11" rx="2.5" fill="${col}"/><text x="${cx}" y="${cy + 23.4}" text-anchor="middle" font-size="7.4" font-family="sans-serif" font-weight="800" fill="${spec.textColor}">${esc(spec.label.replace('MOTOR ', ''))}</text>
    <text x="${cx}" y="${cy - 19}" text-anchor="middle" font-size="5.2" font-family="sans-serif" fill="#c8ced6">brushless</text>`);
}

function battery(spec, w, h, pins) {
  const plus = pins.find(p => p.id === '+'), minus = pins.find(p => p.id === '-'), bw = w - 54, y0 = 6, bh = h - 12;
  const wires = [[plus, '#d6322b'], [minus, '#1b1b1f']].map(([p, c]) => p ? `<path d="M${bw + 2} ${p.y} L ${p.x - 18} ${p.y}" stroke="${c}" stroke-width="5" stroke-linecap="round"/><rect x="${p.x - 20}" y="${p.y - 6}" width="20" height="12" rx="2" fill="#e5b92c" stroke="#8a6d10"/>${tin(p)}` : '').join('');
  return svg(w, h, `${wires}<rect x="2" y="${y0}" width="${bw}" height="${bh}" rx="7" fill="${spec.color}" stroke="#000" stroke-width="1.4"/><rect x="2" y="${y0}" width="${bw}" height="${bh}" rx="7" fill="url(#lg)" opacity=".25"/>
    <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>
    <rect x="14" y="${y0 + 8}" width="${bw - 28}" height="${bh - 16}" rx="4" fill="#f08a1f"/><text x="${bw / 2 + 2}" y="${h / 2 - 3}" text-anchor="middle" font-size="12" font-weight="800" font-family="sans-serif" fill="#1a1206">LiPo</text><text x="${bw / 2 + 2}" y="${h / 2 + 10}" text-anchor="middle" font-size="6.4" font-family="sans-serif" font-weight="700" fill="#1a1206">${esc(spec.sprite.note || 'flight battery')}</text>
    <path d="M${bw - 24} ${y0 + 12} h10" stroke="#d6322b" stroke-width="2"/><text x="${bw - 12}" y="${y0 + 15}" font-size="9" font-weight="800" fill="#d6322b" font-family="sans-serif">+</text>`);
}

function camera(spec, w, h, pins) {
  const cx = 38, cy = h / 2, S = 30, wires = [['#d6322b', '5V'], ['#1b1b1f', 'GND'], ['#e5c52b', 'VID']];
  const lines = wires.map(([c, id], i) => { const p = pins.find(q => q.id === id); return p ? `<path d="M${cx + S - 2} ${cy - 8 + i * 8} C ${cx + S + 30} ${cy - 8 + i * 8}, ${p.x - 36} ${p.y}, ${p.x - 5} ${p.y}" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>${tin(p)}<text x="${p.x - 12}" y="${p.y - 4.5}" text-anchor="end" font-size="6" font-family="sans-serif" font-weight="800" fill="#f2f2f2" stroke="#222" stroke-width="1.6" paint-order="stroke">${id}</text>` : ''; }).join('');
  return svg(w, h, `${lines}<rect x="${cx - S}" y="${cy - S}" width="${S * 2}" height="${S * 2}" rx="5" fill="${spec.color}" stroke="#000" stroke-width="1.4"/><rect x="${cx - S + 3}" y="${cy - S + 3}" width="${S * 2 - 6}" height="${S * 2 - 6}" rx="3" fill="none" stroke="#fff" stroke-opacity=".12"/>
    <circle cx="${cx}" cy="${cy}" r="21" fill="#9aa1a9" stroke="#2c2f33" stroke-width="1.4"/><circle cx="${cx}" cy="${cy}" r="17" fill="#1a1c20"/><circle cx="${cx}" cy="${cy}" r="12" fill="#222a36"/><circle cx="${cx}" cy="${cy}" r="7" fill="#0b1018"/><ellipse cx="${cx - 3}" cy="${cy - 4}" rx="3.4" ry="2.2" fill="#6aa6ff" opacity=".7"/>
    ${[[-S + 5, -S + 5], [S - 5, -S + 5], [-S + 5, S - 5], [S - 5, S - 5]].map(([x, y]) => `<circle cx="${cx + x}" cy="${cy + y}" r="2.3" fill="#5a5f66"/>`).join('')}
    <text x="${cx}" y="${cy + S - 1.5}" text-anchor="middle" font-size="5" font-family="sans-serif" font-weight="700" fill="#c8ced6">${esc(spec.sprite.note || 'FPV')}</text>`);
}

export function droneSprite(art, spec, w, h, pins) {
  if (art === 'drone-aio') return aio(spec, w, h, pins);
  if (art === 'drone-motor') return motor(spec, w, h, pins);
  if (art === 'drone-battery') return battery(spec, w, h, pins);
  if (art === 'drone-camera') return camera(spec, w, h, pins);
  return '';
}
