// KiCad board import: reads a `.kicad_pcb` file (plain text, S-expressions) and turns it into a CircuitBench part you can wire up.
//
// A board file says where every pad and copper track is. It does NOT always say which pads are connected: a board drawn
// without a schematic (an electrode array, say) has an empty net on every track. So connectivity is worked out the way
// a continuity tester would: pads and track ends that touch share copper, and copper that touches is one node. When the
// file does carry net names those are used for the pin names instead.
//
// Pure data in, pure data out (no DOM), so it runs in the browser and in tests. Output is a part spec of package 'board',
// validated by validatePartSpec like every other part.

/* ── S-expression reader ─────────────────────────────────────── */
export function parseSexp(text) {
  let i = 0;
  const n = text.length;
  const atom = () => {
    if (text[i] === '"') {
      let s = ''; i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\' && i + 1 < n) i++; s += text[i++]; }
      i++;
      return { str: s };
    }
    const st = i;
    while (i < n && !/[\s()]/.test(text[i])) i++;
    return text.slice(st, i);
  };
  const list = () => {
    const out = []; i++;                                  // past "("
    while (i < n) {
      const c = text[i];
      if (c === ')') { i++; return out; }
      if (c === '(') out.push(list());
      else if (/\s/.test(c)) i++;
      else out.push(atom());
    }
    return out;
  };
  while (i < n && text[i] !== '(') i++;
  if (i >= n) throw new Error('This does not look like a KiCad file (no “(kicad_pcb” found).');
  return list();
}

const val = a => (a && typeof a === 'object' && !Array.isArray(a) ? a.str : a);
const head = l => (Array.isArray(l) ? val(l[0]) : undefined);
const kids = (l, name) => l.filter(x => Array.isArray(x) && head(x) === name);
const kid = (l, name) => kids(l, name)[0];
const num = x => { const v = parseFloat(val(x)); return Number.isFinite(v) ? v : 0; };
const rot = (x, y, deg) => {                              // KiCad: y points down, positive angles turn counter-clockwise on screen
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + y * s, -x * s + y * c];
};

/* ── arcs ─────────────────────────────────────────────────────── */
/** Points along the arc through three points (KiCad 6+ writes start, mid, end). */
function arcPoints(a, m, e, n = 12) {
  const [ax, ay] = a, [bx, by] = m, [cx, cy] = e, d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [a, m, e];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy), a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  const TAU = Math.PI * 2, wrap = v => ((v % TAU) + TAU) % TAU;
  let sweep = wrap(a1 - a0);
  if (wrap(am - a0) > sweep) sweep -= TAU;                           // the middle point is on the other way round: go that way
  return Array.from({ length: n + 1 }, (_, i) => [ux + r * Math.cos(a0 + sweep * i / n), uy + r * Math.sin(a0 + sweep * i / n)]);
}
/** KiCad 5 arcs: start is the centre, end is where it begins, then the sweep in degrees. */
function legacyArc(cx, cy, ex, ey, deg, n = 12) {
  const dx = ex - cx, dy = ey - cy;
  return Array.from({ length: n + 1 }, (_, i) => { const k = (deg * i / n) * Math.PI / 180; return [cx + dx * Math.cos(k) - dy * Math.sin(k), cy + dx * Math.sin(k) + dy * Math.cos(k)]; });
}

/* ── board reading ───────────────────────────────────────────── */
export function readBoard(text) {
  const root = parseSexp(text);
  if (head(root) !== 'kicad_pcb') throw new Error('This is not a KiCad PCB file (.kicad_pcb).');
  const pads = [], tracks = [], edge = [], vias = [], parts = [], silk = [], texts = [], zoneList = []; let zones = 0;
  for (const el of root) {
    if (!Array.isArray(el)) continue;
    const t = head(el);
    if (t === 'footprint' || t === 'module') {                       // KiCad 6+ writes (footprint …); KiCad 5 writes (module …)
      const at = kid(el, 'at'), fx = num(at?.[1]), fy = num(at?.[2]), fr = num(at?.[3]);
      const props = Object.fromEntries(kids(el, 'property').map(p => [val(p[1]), val(p[2])]));
      for (const ft of kids(el, 'fp_text')) { const k = val(ft[1]); if (k === 'reference' && !props.Reference) props.Reference = val(ft[2]); else if (k === 'value' && !props.Value) props.Value = val(ft[2]); }      // KiCad 5, 6 and 7 keep them here, 8+ as properties
      const ref = props.Reference || '', value = props.Value || '', name = val(el[1]) || '';
      const fpLayer = val(kid(el, 'layer')?.[1]) || 'F.Cu';
      parts.push({ ref, value, name });
      const front = !String(fpLayer).startsWith('B.');
      const at2 = (x, y) => { const [dx, dy] = rot(x, y, fr); return [fx + dx, fy + dy]; };      // a footprint's own drawing is in its local frame: turn it, then move it
      const sideOf = l => (String(l).startsWith('B.') ? 1 : 0);
      for (const g of el) {
        if (!Array.isArray(g)) continue;
        const gt = head(g);
        if (!/^fp_(line|rect|circle|arc|poly)$/.test(gt)) continue;
        const gl = val(kid(g, 'layer')?.[1]) || '';
        if (!/silk/i.test(gl)) continue;
        const sd = sideOf(gl), pt = k => { const q = kid(g, k); return q ? at2(num(q[1]), num(q[2])) : null; };
        const seg = (a, b) => a && b && silk.push([a[0], a[1], b[0], b[1], sd]);
        if (gt === 'fp_line') seg(pt('start'), pt('end'));
        else if (gt === 'fp_rect') { const a = kid(g, 'start'), b = kid(g, 'end'); if (a && b) { const c = [[num(a[1]), num(a[2])], [num(b[1]), num(a[2])], [num(b[1]), num(b[2])], [num(a[1]), num(b[2])]].map(q => at2(q[0], q[1])); for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]); } }
        else if (gt === 'fp_circle') { const c = kid(g, 'center'), e = kid(g, 'end'); if (c && e) { const cx = num(c[1]), cy = num(c[2]), r = Math.hypot(num(e[1]) - cx, num(e[2]) - cy); let prev = null; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, q = at2(cx + r * Math.cos(a), cy + r * Math.sin(a)); if (prev) seg(prev, q); prev = q; } } }
        else if (gt === 'fp_poly') { const q = kids(kid(g, 'pts') || [], 'xy').map(c => at2(num(c[1]), num(c[2]))); for (let i = 0; i < q.length; i++) seg(q[i], q[(i + 1) % q.length]); }
        else if (gt === 'fp_arc') {
          const s0 = kid(g, 'start'), m0 = kid(g, 'mid'), e0 = kid(g, 'end');
          const pts = m0 ? arcPoints([num(s0[1]), num(s0[2])], [num(m0[1]), num(m0[2])], [num(e0[1]), num(e0[2])]) : legacyArc(num(s0?.[1]), num(s0?.[2]), num(e0?.[1]), num(e0?.[2]), num(kid(g, 'angle')?.[1]));
          for (let i = 1; i < pts.length; i++) seg(at2(pts[i - 1][0], pts[i - 1][1]), at2(pts[i][0], pts[i][1]));
        }
      }
      if (ref && ref !== 'REF**') {
        const rt = kids(el, 'fp_text').find(x => val(x[1]) === 'reference'), pr = kids(el, 'property').find(x => val(x[1]) === 'Reference');
        const src = rt || pr, ra = src && kid(src, 'at'), lay = val(kid(src || [], 'layer')?.[1]) || fpLayer, hidden = !!src && src.some(x => x === 'hide' || (Array.isArray(x) && head(x) === 'hide' && val(x[1]) !== 'no'));
        if (src && ra && /silk/i.test(lay) && !hidden) { const [tx, ty] = at2(num(ra[1]), num(ra[2])); texts.push([ref, tx, ty, sideOf(lay)]); }
      }
      for (const pd of kids(el, 'pad')) {
        const pa = kid(pd, 'at'), [dx, dy] = rot(num(pa?.[1]), num(pa?.[2]), fr);
        const size = kid(pd, 'size'), w = num(size?.[1]), h = num(size?.[2]) || w;
        // a pad's angle in a board file is already absolute (it includes the footprint's own turn), so a footprint turned 90° with a 2.4 × 1.6 pad has it standing 1.6 wide and 2.4 tall
        const pad_rot = num(pa?.[3]), ca = Math.abs(Math.cos(pad_rot * Math.PI / 180)), sa = Math.abs(Math.sin(pad_rot * Math.PI / 180)), ew = +(w * ca + h * sa).toFixed(3), eh = +(w * sa + h * ca).toFixed(3);
        const layers = (kid(pd, 'layers') || []).slice(1).map(val);
        const net = kid(pd, 'net');
        pads.push({
          num: String(val(pd[1])), type: val(pd[2]), shape: val(pd[3]),
          x: fx + dx, y: fy + dy, w: ew, h: eh, ow: w, oh: h, rot: pad_rot, drill: num(kid(pd, 'drill')?.[1]),
          layers, side: layers.some(l => l.startsWith('B.')) && !layers.some(l => l.startsWith('F.') || l === '*.Cu') ? 'B' : 'F',
          net: net ? String(val(net[net.length - 1]) || '') : '', ref: ref && ref !== 'REF**' ? ref : '', fp: name, fpLayer,
        });
      }
    } else if (t === 'segment') {
      const s = kid(el, 'start'), e = kid(el, 'end'), net = kid(el, 'net');
      tracks.push({ x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]), w: num(kid(el, 'width')?.[1]) || 0.25, layer: val(kid(el, 'layer')?.[1]) || 'F.Cu', net: net ? String(val(net[net.length - 1]) || '') : '' });
    } else if (t === 'arc') {                                        // a curved track (KiCad 6+): two straight pieces through its middle point keep it connected and drawn
      const a = kid(el, 'start'), m = kid(el, 'mid'), e = kid(el, 'end'), net = kid(el, 'net'), w = num(kid(el, 'width')?.[1]) || 0.25, layer = val(kid(el, 'layer')?.[1]) || 'F.Cu', nn = net ? String(val(net[net.length - 1]) || '') : '';
      if (a && m && e) { tracks.push({ x1: num(a[1]), y1: num(a[2]), x2: num(m[1]), y2: num(m[2]), w, layer, net: nn }, { x1: num(m[1]), y1: num(m[2]), x2: num(e[1]), y2: num(e[2]), w, layer, net: nn }); }
    } else if (t === 'zone') {
      zones++;
      const zl = (kid(el, 'layers') ? kid(el, 'layers').slice(1).map(val) : [val(kid(el, 'layer')?.[1]) || 'F.Cu']);
      const filled = kids(el, 'filled_polygon');
      const polys = filled.length ? filled : kids(el, 'polygon');
      for (const fp of polys) {
        const pts = kid(fp, 'pts'); if (!pts) continue;
        const l = val(kid(fp, 'layer')?.[1]) || zl[0] || 'F.Cu';
        zoneList.push({ layer: l, filled: filled.length > 0, pts: kids(pts, 'xy').map(c => [num(c[1]), num(c[2])]) });
      }
    } else if (t === 'via') {
      const a = kid(el, 'at');
      vias.push({ x: num(a?.[1]), y: num(a?.[2]), size: num(kid(el, 'size')?.[1]) || 0.6, drill: num(kid(el, 'drill')?.[1]) || 0 });
    } else if (t === 'gr_circle' || t === 'gr_rect' || t === 'gr_line' || t === 'gr_arc' || t === 'gr_poly') {
      if (val(kid(el, 'layer')?.[1]) !== 'Edge.Cuts') continue;
      if (t === 'gr_circle') { const c = kid(el, 'center'), e = kid(el, 'end'); edge.push({ type: 'circle', x: num(c?.[1]), y: num(c?.[2]), r: Math.hypot(num(e?.[1]) - num(c?.[1]), num(e?.[2]) - num(c?.[2])) }); }
      else if (t === 'gr_rect') { const s = kid(el, 'start'), e = kid(el, 'end'); edge.push({ type: 'rect', x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]) }); }
      else if (t === 'gr_line') { const s = kid(el, 'start'), e = kid(el, 'end'); edge.push({ type: 'line', x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]) }); }
      else if (t === 'gr_arc') {
        const s = kid(el, 'start'), m = kid(el, 'mid'), e = kid(el, 'end');
        if (m) edge.push({ type: 'arc', pts: [s, m, e].map(p => [num(p?.[1]), num(p?.[2])]) });
        else {                                                                          // KiCad 5: start = the centre, end = where the arc begins, then its sweep in degrees (tenths in very old files)
          const cx = num(s?.[1]), cy = num(s?.[2]), ex = num(e?.[1]), ey = num(e?.[2]), ang = num(kid(el, 'angle')?.[1]), a = (ang / 2) * Math.PI / 180, dx = ex - cx, dy = ey - cy;
          const at = k => [cx + dx * Math.cos(k) - dy * Math.sin(k), cy + dx * Math.sin(k) + dy * Math.cos(k)];
          edge.push({ type: 'arc', pts: [[ex, ey], at(a), at(2 * a)] });
        }
      } else if (t === 'gr_poly') { const pts = kid(el, 'pts'); if (pts) edge.push({ type: 'arc', pts: kids(pts, 'xy').map(p => [num(p[1]), num(p[2])]) }); }
    }
  }
  return { pads, tracks, vias, edge, parts, zones, zoneList, silk, texts };
}

/* ── continuity: which copper is one node ───────────────────── */
export function groupPads(board, { useNets = true } = {}) {
  const par = new Map();
  const find = a => { if (!par.has(a)) par.set(a, a); while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
  const join = (a, b) => par.set(find(a), find(b));
  const { pads, tracks, vias } = board;
  const ends = [];
  tracks.forEach((t, i) => {
    join(`t${i}a`, `t${i}b`);
    ends.push([`t${i}a`, t.x1, t.y1, t.layer], [`t${i}b`, t.x2, t.y2, t.layer]);
  });
  // a grid of 1 mm cells, so each query looks only at the track ends near it (a big board has 15 000 of them: comparing every pair took 12 s)
  const CELL = 1, grid = new Map(), key = (cx, cy) => `${cx},${cy}`;
  for (const e of ends) { const k = key(Math.floor(e[1] / CELL), Math.floor(e[2] / CELL)); (grid.get(k) || grid.set(k, []).get(k)).push(e); }
  const near = (x, y, r, fn) => {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) for (const e of grid.get(key(cx, cy)) || []) fn(e);
  };
  vias.forEach((v, i) => near(v.x, v.y, v.size / 2 + 0.05, e => { if (Math.hypot(e[1] - v.x, e[2] - v.y) <= v.size / 2 + 0.05) join(`v${i}`, e[0]); }));
  for (const e of ends) near(e[1], e[2], 0.15, o => { if (o !== e && o[3] === e[3] && Math.hypot(e[1] - o[1], e[2] - o[2]) < 0.15) join(e[0], o[0]); });
  pads.forEach((p, k) => {
    find(`p${k}`);
    const reach = Math.max(Math.min(p.w, p.h) / 2, 0.25) + 0.05;
    near(p.x, p.y, reach, e => {
      const onLayer = p.layers.includes(e[3]) || p.layers.includes('*.Cu');
      if (onLayer && Math.hypot(e[1] - p.x, e[2] - p.y) <= reach) join(`p${k}`, e[0]);
    });
  });
  // pads the file itself says share a net are one node too (a board that has real net names)
  const byNet = new Map();
  if (useNets) pads.forEach((p, k) => { if (p.net) { if (byNet.has(p.net)) join(`p${k}`, byNet.get(p.net)); else byNet.set(p.net, `p${k}`); } });
  const groups = new Map();
  pads.forEach((_, k) => { const g = find(`p${k}`); (groups.get(g) || groups.set(g, []).get(g)).push(k); });
  return [...groups.values()];
}

const cleanId = (s, fallback) => {
  const v = String(s || '').replace(/^\//, '').replace(/[^A-Za-z0-9+\-_.]/g, '_').slice(0, 12);
  return v || fallback;
};

export const MAX_BOARD_PINS = 400, MAX_BOARD_PADS = 12000, MAX_BOARD_TRACKS = 80000;
/** Which side of the board a copper layer is on: 0 front, 1 back, 2 inside. (KiCad 5 files call them top_layer / bottom_layer.) */
export const layerCode = l => { const n = String(l || ''); return /^(B\.|bottom)/i.test(n) ? 1 : /^(F\.|top)/i.test(n) || n === '*.Cu' ? 0 : 2; };
/** Copper pours, thinned so a pour of 100 000 points stays a few thousand: points closer than a tolerance are merged. */
function packZones(list, X, Y, budget = 20000) {
  const total = list.reduce((a, z) => a + z.pts.length, 0);
  let tol = 0.04;
  const run = t => list.map(z => {
    const out = []; let last = null;
    for (const q of z.pts) { if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= t) { out.push(q); last = q; } }
    return { l: layerCode(z.layer), f: z.filled ? 1 : 0, p: out.flatMap(q => [+X(q[0]).toFixed(1), +Y(q[1]).toFixed(1)]) };
  }).filter(z => z.p.length >= 6);
  let res = run(tol);
  while (res.reduce((a, z) => a + z.p.length / 2, 0) > budget && tol < 2) { tol *= 1.6; res = run(tol); }
  return total ? res : [];
}

/**
 * Turn a board into a part spec (package 'board'). Every node that reaches a through-hole pad (a header, a connector)
 * becomes a pin where that pad is; the rest of the copper is drawn for realism. `report` says what was found.
 */
export function boardToSpec(text, { name } = {}) {
  const board = readBoard(text), notes = [];
  if (!board.pads.length) throw new Error('This board has no pads, so there is nothing to wire to.');
  const groups = groupPads(board);
  const MM = 1;
  // bounding box: the board outline if there is one, otherwise the copper
  const xs = [], ys = [];
  let shape = 'rect', circle = null;
  for (const e of board.edge) {
    if (e.type === 'circle') { xs.push(e.x - e.r, e.x + e.r); ys.push(e.y - e.r, e.y + e.r); shape = 'circle'; circle = e; }
    else if (e.type === 'rect' || e.type === 'line') xs.push(e.x1, e.x2), ys.push(e.y1, e.y2);
    else if (e.type === 'arc') e.pts.forEach(p => { xs.push(p[0]); ys.push(p[1]); });
  }
  if (!xs.length) { notes.push('No board outline (Edge.Cuts) was found, so the outline is the copper’s bounding box.'); }
  for (const p of board.pads) { if (!xs.length || shape !== 'circle') { xs.push(p.x - p.w / 2, p.x + p.w / 2); ys.push(p.y - p.h / 2, p.y + p.h / 2); } }
  const x0 = Math.min(...xs), y0 = Math.min(...ys), W = Math.max(...xs) - x0, H = Math.max(...ys) - y0;
  const X = x => +((x - x0) * MM).toFixed(2), Y = y => +((y - y0) * MM).toFixed(2);

  const used = new Set(), pins = [], padOut = [];
  const mounting = pd => pd.type === 'np_thru_hole';
  const nodes = groups.map((g, gi) => {
    const members = g.map(k => board.pads[k]);
    const header = members.find(p => (p.type === 'thru_hole') && !mounting(p));
    const named = members.find(p => p.net && !/^\/?unconnected/i.test(p.net))?.net;
    const nums = [...new Set(members.map(p => p.num))];
    const refs = [...new Set(members.map(p => p.ref).filter(Boolean))];
    const base = named ? cleanId(named, `N${gi + 1}`) : refs.length === 1 && nums.length === 1 ? cleanId(`${refs[0]}.${nums[0]}`, `N${gi + 1}`) : nums.length === 1 ? cleanId(`P${nums[0]}`, `N${gi + 1}`) : `N${gi + 1}`;
    return { g, members, header, base, pin: null };
  });
  const wired = nodes.filter(n => n.header);
  if (!wired.length) notes.push('No through-hole pads were found, so every pad group is offered as a connection point.');
  // when a board has more than 64 connection points (a whole computer board, not a breakout), the connectors come first: J, P, CN, X, H… are what a student wires to
  const isConn = nd => nd.members.some(m => /^(J|P|JP|CN|X|H|CON|CONN|K)\d/i.test(m.ref));
  const chosen = [...(wired.length ? wired : nodes)].sort((a, b) => Number(isConn(b)) - Number(isConn(a)));
  for (const nd of chosen) {
    if (pins.length >= MAX_BOARD_PINS) { notes.push(`This board has ${chosen.length} connection points; the first ${MAX_BOARD_PINS} are wirable (connectors J, P, CN… first); the rest are still drawn.`); break; }
    let id = nd.base, k = 2;
    while (used.has(id.toLowerCase())) { const suf = `_${k++}`; id = nd.base.slice(0, 12 - suf.length) + suf; }
    used.add(id.toLowerCase());
    const at = nd.header || nd.members.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    nd.pin = id;
    pins.push({ id, label: nd.members.length > 1 ? `${id} (${nd.members.length} pads joined)` : id, side: 'bottom', x: X(at.x), y: Y(at.y) });
  }
  const pinOfPad = new Map();
  nodes.forEach(nd => nd.g.forEach(k => pinOfPad.set(k, nd.pin)));
  board.pads.forEach((p, k) => padOut.push({ x: X(p.x), y: Y(p.y), w: +(p.ow ?? p.w).toFixed(2), h: +(p.oh ?? p.h).toFixed(2), r: +(((p.rot || 0) % 180) + 180) % 180 || 0, shape: p.shape || 'rect', hole: +(p.drill || 0).toFixed(2), pin: pinOfPad.get(k) || '', side: p.side }));
  const unconnected = nodes.filter(n => !n.pin).length;
  if (unconnected) notes.push(`${unconnected} pad group${unconnected > 1 ? 's' : ''} have no through-hole pad, so they are drawn but are not connection points.`);
  const zoneOut = packZones(board.zoneList, X, Y);
  if (board.zones && zoneOut.some(z => !z.f)) notes.push('Some copper pours were not filled in the file (press B in KiCad to fill them), so only their outline is drawn.');
  const comps = board.parts.filter(p => p.ref && p.ref !== 'REF**');
  if (comps.length) notes.push(`${comps.length} component footprint${comps.length > 1 ? 's' : ''} on the board (${comps.slice(0, 6).map(c => c.ref).join(', ')}${comps.length > 6 ? '…' : ''}) are kept as part of this one board part; split-out component simulation is not done yet.`);
  const partName = String(name || board.parts.find(p => p.value && p.ref !== 'REF**')?.value || 'Imported PCB').slice(0, 40);
  const spec = {
    name: partName, label: partName.slice(0, 16), description: `Imported from a KiCad board: ${padOut.length} pads, ${board.tracks.length} tracks.`,
    color: '#1f7a4d', textColor: '#ffffff', package: 'board', breadboard: false,
    pins, behaviour: { kind: 'none', roles: {} },
    board: {
      w: +W.toFixed(2), h: +H.toFixed(2), shape,
      ...(circle ? { cx: X(circle.x), cy: Y(circle.y), r: +circle.r.toFixed(2) } : {}),
      pads: padOut.slice(0, MAX_BOARD_PADS),
      tracks: board.tracks.slice(0, MAX_BOARD_TRACKS).map(t => [X(t.x1), Y(t.y1), X(t.x2), Y(t.y2), +t.w.toFixed(2), layerCode(t.layer)]),
      vias: board.vias.slice(0, 20000).map(v => [X(v.x), Y(v.y), +v.size.toFixed(2), +(v.drill || 0).toFixed(2)]),
      zones: zoneOut,
      silk: board.silk.slice(0, 40000).map(q => [X(q[0]), Y(q[1]), X(q[2]), Y(q[3]), q[4]]),
      texts: board.texts.slice(0, 3000).map(q => [q[0], X(q[1]), Y(q[2]), q[3]]),
    },
  };
  return { spec, report: { pads: board.pads.length, tracks: board.tracks.length, nodes: groups.length, pins: pins.length, shape, widthMm: +W.toFixed(1), heightMm: +H.toFixed(1), notes } };
}
