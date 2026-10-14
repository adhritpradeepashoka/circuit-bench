// Our own breadboard model. @wokwi/elements has no breadboard, so this is *not* pretending
// to be a library component: it is a real 0.1" (9.6 px) pitch board with an explicit
// electrical topology that the netlist builder consumes.
//
//   top rail   +  o o o o o   o o o o o  ...   (25 contacts, one continuous conductor)
//   top rail   −  o o o o o   o o o o o  ...
//
//   A  ┐
//   B  │ contacts A–E of one column are one conductor   ("c7-top")
//   C  │
//   D  │
//   E  ┘
//      ═══════ centre trench (no connection) ═══════
//   F  ┐
//   G  │ contacts F–J of one column are another conductor ("c7-bot")
//   ...
//   bottom rails − / +
export const PITCH = 9.6;          // 0.1 inch in CSS px (same unit as @wokwi/elements)
export const BB_COLS = 30;
export const BB_LETTERS_TOP = ['A', 'B', 'C', 'D', 'E'];
export const BB_LETTERS_BOTTOM = ['F', 'G', 'H', 'I', 'J'];
const RAIL_HOLES = 25;

export function buildBreadboard() {
  const mx = 17;                                         // left/right margin
  const width = mx * 2 + (BB_COLS - 1) * PITCH;          // 312.4
  const railY = { TP: 15, TN: 24.6, BN: 181.4, BP: 191 };
  const rowA = 50;
  const yRows = {};
  BB_LETTERS_TOP.forEach((l, i) => (yRows[l] = rowA + i * PITCH));
  const rowF = yRows.E + 3 * PITCH;                      // 0.3" centre trench
  BB_LETTERS_BOTTOM.forEach((l, i) => (yRows[l] = rowF + i * PITCH));
  const height = 206;

  const pins = [];
  const groups = [];
  for (let c = 1; c <= BB_COLS; c++) {
    const x = mx + (c - 1) * PITCH;
    for (const [letters, tag] of [[BB_LETTERS_TOP, 'top'], [BB_LETTERS_BOTTOM, 'bot']]) {
      const ids = [];
      for (const l of letters) {
        const id = `${l}${c}`;
        pins.push({ id, label: id, x, y: yRows[l], kind: 'hole', group: `c${c}-${tag}` });
        ids.push(id);
      }
      groups.push({ id: `c${c}-${tag}`, pins: ids });
    }
  }
  // Rails: 5-hole clusters with a half-pitch gap, centred on the board.
  const railSpan = (RAIL_HOLES - 1) * PITCH + Math.floor((RAIL_HOLES - 1) / 5) * (PITCH / 2);
  const railX0 = (width - railSpan) / 2;
  const railNames = { TP: 'Top + rail', TN: 'Top − rail', BP: 'Bottom + rail', BN: 'Bottom − rail' };
  const railHoles = [];
  for (const [r, y] of Object.entries(railY)) {
    const ids = [];
    for (let i = 0; i < RAIL_HOLES; i++) {
      const x = railX0 + i * PITCH + Math.floor(i / 5) * (PITCH / 2);
      const id = `${r}${i + 1}`;
      pins.push({ id, label: `${railNames[r]} #${i + 1}`, x, y, kind: 'rail', group: `rail-${r}` });
      railHoles.push({ x, y, r });
      ids.push(id);
    }
    groups.push({ id: `rail-${r}`, pins: ids });
  }
  return { width, height, pins, groups, yRows, railY, railX0, railSpan, mx, rowF, railHoles };
}

/** SVG markup for the board. Pure string, so it can be used for the canvas and the catalogue thumbnail. */
export function breadboardSVG(bb) {
  const { width: W, height: H, yRows, railY, mx } = bb;
  const holes = bb.pins.map(p => `M${(p.x - 2).toFixed(2)} ${(p.y - 2).toFixed(2)}h4v4h-4z`).join('');
  const trenchY = (yRows.E + yRows.F) / 2;
  const railLine = (y, color, dy) => `<line x1="${bb.railX0 - 4}" x2="${bb.railX0 + bb.railSpan + 4}" y1="${y + dy}" y2="${y + dy}" stroke="${color}" stroke-width="1.1" stroke-linecap="round" opacity=".9"/>`;
  const sign = (x, y, s, c) => `<text x="${x}" y="${y + 2.2}" text-anchor="middle" font-size="7" font-weight="700" fill="${c}">${s}</text>`;
  const RED = '#d3372f', BLUE = '#2b62c7';
  let labels = '';
  for (const l of [...BB_LETTERS_TOP, ...BB_LETTERS_BOTTOM]) {
    labels += `<text x="${mx - 11}" y="${yRows[l] + 2}" text-anchor="middle">${l}</text><text x="${W - mx + 11}" y="${yRows[l] + 2}" text-anchor="middle">${l}</text>`;
  }
  for (let c = 1; c <= BB_COLS; c++) {
    if (c === 1 || c % 5 === 0) {
      const x = mx + (c - 1) * PITCH;
      labels += `<text x="${x}" y="${yRows.A - 9}" text-anchor="middle">${c}</text><text x="${x}" y="${yRows.J + 14}" text-anchor="middle">${c}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bbBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f5f1"/><stop offset="1" stop-color="#e3e1da"/></linearGradient>
    <linearGradient id="bbTrench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bdbab1"/><stop offset=".45" stop-color="#d9d6ce"/><stop offset="1" stop-color="#eeece6"/></linearGradient>
  </defs>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="5" fill="url(#bbBody)" stroke="#aeaaa0" stroke-width="1"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="3.5" fill="none" stroke="#fff" stroke-opacity=".8"/>
  <rect x="9" y="${trenchY - 5.2}" width="${W - 18}" height="10.4" rx="2" fill="url(#bbTrench)" stroke="#a9a69d" stroke-width=".6"/>
  ${railLine(railY.TP, RED, -5.6)}${railLine(railY.TN, BLUE, 5.6)}${railLine(railY.BN, BLUE, -5.6)}${railLine(railY.BP, RED, 5.6)}
  ${sign(mx - 11, railY.TP, '+', RED)}${sign(mx - 11, railY.TN, '−', BLUE)}${sign(mx - 11, railY.BN, '−', BLUE)}${sign(mx - 11, railY.BP, '+', RED)}
  ${sign(W - mx + 11, railY.TP, '+', RED)}${sign(W - mx + 11, railY.TN, '−', BLUE)}${sign(W - mx + 11, railY.BN, '−', BLUE)}${sign(W - mx + 11, railY.BP, '+', RED)}
  <path d="${holes}" fill="#2a2e31" stroke="#8f8c83" stroke-width=".7" stroke-linejoin="round"/>
  <g font-family="ui-sans-serif,system-ui,sans-serif" font-size="5.6" fill="#7b786f">${labels}</g>
</svg>`;
}
