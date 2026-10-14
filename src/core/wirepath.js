// Pure geometry for the generic line-drawer wires (no DOM).
//   straight    – a → b
//   orthogonal  – 90° routing; `bend` (0..1) slides the middle segment
//   curve       – cubic Bézier that sags like a real jumper; `sag` (px) is editable
const f = n => +n.toFixed(2);

export function wireGeometry(a, b, wire) {
  const style = wire.style || 'straight';
  if (style === 'orthogonal') {
    const bend = wire.bend ?? 0.5;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const mx = a.x + dx * bend;
      return { d: `M${f(a.x)} ${f(a.y)}L${f(mx)} ${f(a.y)}L${f(mx)} ${f(b.y)}L${f(b.x)} ${f(b.y)}`, mid: { x: mx, y: (a.y + b.y) / 2 }, axis: 'x' };
    }
    const my = a.y + dy * bend;
    return { d: `M${f(a.x)} ${f(a.y)}L${f(a.x)} ${f(my)}L${f(b.x)} ${f(my)}L${f(b.x)} ${f(b.y)}`, mid: { x: (a.x + b.x) / 2, y: my }, axis: 'y' };
  }
  if (style === 'curve') {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    let n = { x: -dy / L, y: dx / L };
    if (n.y < 0 || (n.y === 0 && n.x < 0)) n = { x: -n.x, y: -n.y };   // "down" side by default
    const s = wire.sag ?? Math.min(60, L * 0.28);
    const c1 = { x: a.x + n.x * s, y: a.y + n.y * s }, c2 = { x: b.x + n.x * s, y: b.y + n.y * s };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return {
      d: `M${f(a.x)} ${f(a.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`,
      mid: { x: m.x + n.x * s * 0.75, y: m.y + n.y * s * 0.75 }, axis: 'n', normal: n, chordMid: m,
    };
  }
  return { d: `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, axis: null };
}

/** Turn a dragged handle position into the wire parameter it controls. */
export function paramFromHandle(a, b, wire, p) {
  const g = wireGeometry(a, b, wire);
  if (g.axis === 'x') return { bend: clamp((p.x - a.x) / ((b.x - a.x) || 1), 0.05, 0.95) };
  if (g.axis === 'y') return { bend: clamp((p.y - a.y) / ((b.y - a.y) || 1), 0.05, 0.95) };
  if (g.axis === 'n') return { sag: ((p.x - g.chordMid.x) * g.normal.x + (p.y - g.chordMid.y) * g.normal.y) / 0.75 };
  return {};
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
