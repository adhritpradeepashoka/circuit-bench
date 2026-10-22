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

/* ── board reading ───────────────────────────────────────────── */
export function readBoard(text) {
  const root = parseSexp(text);
  if (head(root) !== 'kicad_pcb') throw new Error('This is not a KiCad PCB file (.kicad_pcb).');
  const pads = [], tracks = [], edge = [], vias = [], parts = [];
  for (const el of root) {
    if (!Array.isArray(el)) continue;
    const t = head(el);
    if (t === 'footprint') {
      const at = kid(el, 'at'), fx = num(at?.[1]), fy = num(at?.[2]), fr = num(at?.[3]);
      const props = Object.fromEntries(kids(el, 'property').map(p => [val(p[1]), val(p[2])]));
      const ref = props.Reference || '', value = props.Value || '', name = val(el[1]) || '';
      const fpLayer = val(kid(el, 'layer')?.[1]) || 'F.Cu';
      parts.push({ ref, value, name });
      for (const pd of kids(el, 'pad')) {
        const pa = kid(pd, 'at'), [dx, dy] = rot(num(pa?.[1]), num(pa?.[2]), fr);
        const size = kid(pd, 'size'), w = num(size?.[1]), h = num(size?.[2]) || w;
        const layers = (kid(pd, 'layers') || []).slice(1).map(val);
        const net = kid(pd, 'net');
        pads.push({
          num: String(val(pd[1])), type: val(pd[2]), shape: val(pd[3]),
          x: fx + dx, y: fy + dy, w, h, rot: fr + num(pa?.[3]), drill: num(kid(pd, 'drill')?.[1]),
          layers, side: layers.some(l => l.startsWith('B.')) && !layers.some(l => l.startsWith('F.') || l === '*.Cu') ? 'B' : 'F',
          net: net ? String(val(net[net.length - 1]) || '') : '', ref: ref && ref !== 'REF**' ? ref : '', fp: name, fpLayer,
        });
      }
    } else if (t === 'segment') {
      const s = kid(el, 'start'), e = kid(el, 'end'), net = kid(el, 'net');
      tracks.push({ x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]), w: num(kid(el, 'width')?.[1]) || 0.25, layer: val(kid(el, 'layer')?.[1]) || 'F.Cu', net: net ? String(val(net[net.length - 1]) || '') : '' });
    } else if (t === 'via') {
      const a = kid(el, 'at');
      vias.push({ x: num(a?.[1]), y: num(a?.[2]), size: num(kid(el, 'size')?.[1]) || 0.6 });
    } else if (t === 'gr_circle' || t === 'gr_rect' || t === 'gr_line' || t === 'gr_arc' || t === 'gr_poly') {
      if (val(kid(el, 'layer')?.[1]) !== 'Edge.Cuts') continue;
      if (t === 'gr_circle') { const c = kid(el, 'center'), e = kid(el, 'end'); edge.push({ type: 'circle', x: num(c?.[1]), y: num(c?.[2]), r: Math.hypot(num(e?.[1]) - num(c?.[1]), num(e?.[2]) - num(c?.[2])) }); }
      else if (t === 'gr_rect') { const s = kid(el, 'start'), e = kid(el, 'end'); edge.push({ type: 'rect', x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]) }); }
      else if (t === 'gr_line') { const s = kid(el, 'start'), e = kid(el, 'end'); edge.push({ type: 'line', x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]) }); }
      else if (t === 'gr_arc') { const s = kid(el, 'start'), m = kid(el, 'mid'), e = kid(el, 'end'); edge.push({ type: 'arc', pts: [s, m, e].map(p => [num(p?.[1]), num(p?.[2])]) }); }
    }
  }
  return { pads, tracks, vias, edge, parts };
}

/* ── continuity: which copper is one node ───────────────────── */
export function groupPads(board) {
  const par = new Map();
  const find = a => { if (!par.has(a)) par.set(a, a); while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
  const join = (a, b) => par.set(find(a), find(b));
  const { pads, tracks, vias } = board;
  const ends = [];
  tracks.forEach((t, i) => {
    join(`t${i}a`, `t${i}b`);
    ends.push([`t${i}a`, t.x1, t.y1, t.layer], [`t${i}b`, t.x2, t.y2, t.layer]);
  });
  vias.forEach((v, i) => { for (const e of ends) if (Math.hypot(e[1] - v.x, e[2] - v.y) <= v.size / 2 + 0.05) join(`v${i}`, e[0]); });
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (ends[i][3] === ends[j][3] && Math.hypot(ends[i][1] - ends[j][1], ends[i][2] - ends[j][2]) < 0.15) join(ends[i][0], ends[j][0]);
  }
  pads.forEach((p, k) => {
    find(`p${k}`);
    const reach = Math.max(Math.min(p.w, p.h) / 2, 0.25) + 0.05;
    for (const e of ends) {
      const onLayer = p.layers.includes(e[3]) || p.layers.includes('*.Cu');
      if (onLayer && Math.hypot(e[1] - p.x, e[2] - p.y) <= reach) join(`p${k}`, e[0]);
    }
  });
  // pads the file itself says share a net are one node too (a board that has real net names)
  const byNet = new Map();
  pads.forEach((p, k) => { if (p.net) { if (byNet.has(p.net)) join(`p${k}`, byNet.get(p.net)); else byNet.set(p.net, `p${k}`); } });
  const groups = new Map();
  pads.forEach((_, k) => { const g = find(`p${k}`); (groups.get(g) || groups.set(g, []).get(g)).push(k); });
  return [...groups.values()];
}

const cleanId = (s, fallback) => {
  const v = String(s || '').replace(/^\//, '').replace(/[^A-Za-z0-9+\-_.]/g, '_').slice(0, 12);
  return v || fallback;
};

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
    const named = members.find(p => p.net)?.net;
    const nums = [...new Set(members.map(p => p.num))];
    const refs = [...new Set(members.map(p => p.ref).filter(Boolean))];
    const base = named ? cleanId(named, `N${gi + 1}`) : refs.length === 1 && nums.length === 1 ? cleanId(`${refs[0]}.${nums[0]}`, `N${gi + 1}`) : nums.length === 1 ? cleanId(`P${nums[0]}`, `N${gi + 1}`) : `N${gi + 1}`;
    return { g, members, header, base, pin: null };
  });
  const wired = nodes.filter(n => n.header);
  if (!wired.length) notes.push('No through-hole pads were found, so every pad group is offered as a connection point.');
  for (const nd of (wired.length ? wired : nodes)) {
    if (pins.length >= 64) { notes.push('Only the first 64 connection points are kept.'); break; }
    let id = nd.base, k = 2;
    while (used.has(id.toLowerCase())) id = `${nd.base.slice(0, 9)}_${k++}`;
    used.add(id.toLowerCase());
    const at = nd.header || nd.members.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    nd.pin = id;
    pins.push({ id, label: nd.members.length > 1 ? `${id} (${nd.members.length} pads joined)` : id, side: 'bottom', x: X(at.x), y: Y(at.y) });
  }
  const pinOfPad = new Map();
  nodes.forEach(nd => nd.g.forEach(k => pinOfPad.set(k, nd.pin)));
  board.pads.forEach((p, k) => padOut.push({ x: X(p.x), y: Y(p.y), w: +p.w.toFixed(2), h: +p.h.toFixed(2), shape: p.shape || 'rect', hole: +(p.drill || 0).toFixed(2), pin: pinOfPad.get(k) || '', side: p.side }));
  const unconnected = nodes.filter(n => !n.pin).length;
  if (unconnected) notes.push(`${unconnected} pad group${unconnected > 1 ? 's' : ''} have no through-hole pad, so they are drawn but are not connection points.`);
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
      pads: padOut.slice(0, 400),
      tracks: board.tracks.slice(0, 1500).map(t => ({ x1: X(t.x1), y1: Y(t.y1), x2: X(t.x2), y2: Y(t.y2), w: +t.w.toFixed(2) })),
    },
  };
  return { spec, report: { pads: board.pads.length, tracks: board.tracks.length, nodes: groups.length, pins: pins.length, shape, widthMm: +W.toFixed(1), heightMm: +H.toFixed(1), notes } };
}
