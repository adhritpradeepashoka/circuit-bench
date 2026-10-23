// The picture and the movement of a part, as data. An AI (or a student) can draw a part as SVG and say which pieces
// move; nothing here ever runs what it is given. The markup is re-built from scratch out of an allow-list of
// shapes and attributes — scripts, event handlers, styles, links, images and anything unknown are dropped — and
// motion is a handful of fixed kinds (spin / rotate / glow / slide) that only take numbers.
//
// Pure (no DOM): validatePartSpec() calls cleanArt(); elements.js calls renderArt().

export const ART_MAX = { chars: 24000, elements: 500, size: 400 };

const TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title']);
const CANON = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath' };
const TEXT_TAGS = new Set(['text', 'tspan', 'title']);
// attribute → how its value is checked
const NUM = /^-?\d*\.?\d+(?:e-?\d+)?(?:px|%)?$/i;
const NUMLIST = /^[-\d\s.,e+%]+$/i;
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,eE+-]+$/;
const TRANSFORM = /^(?:\s*(?:translate|scale|rotate|skewX|skewY|matrix)\(\s*[-\d.\s,e+]*\)\s*)+$/;
const COLOR = /^(?:none|currentColor|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[-\d.\s,%]+\))$/i;
const NAMED = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'gray', 'grey', 'silver', 'gold', 'brown', 'pink', 'cyan', 'magenta', 'transparent', 'navy', 'teal', 'maroon', 'olive', 'lime']);
const LOCAL_REF = /^url\(#[A-Za-z][\w-]{0,30}\)$/;
const ID = /^[A-Za-z][\w-]{0,30}$/;
const paint = v => COLOR.test(v) || NAMED.has(v.toLowerCase()) || LOCAL_REF.test(v);
const CHECK = {
  id: v => ID.test(v),
  d: v => v.length <= 4000 && PATH_D.test(v),
  points: v => v.length <= 2000 && NUMLIST.test(v),
  transform: v => v.length <= 200 && TRANSFORM.test(v),
  gradientTransform: v => v.length <= 200 && TRANSFORM.test(v),
  fill: paint, stroke: paint, 'stop-color': paint, 'flood-color': paint,
  'clip-path': v => LOCAL_REF.test(v),
  opacity: v => NUM.test(v), 'fill-opacity': v => NUM.test(v), 'stroke-opacity': v => NUM.test(v), 'stop-opacity': v => NUM.test(v),
  'stroke-width': v => NUM.test(v), 'stroke-dasharray': v => NUMLIST.test(v), 'stroke-dashoffset': v => NUM.test(v),
  'stroke-linecap': v => ['butt', 'round', 'square'].includes(v), 'stroke-linejoin': v => ['miter', 'round', 'bevel'].includes(v),
  'fill-rule': v => ['nonzero', 'evenodd'].includes(v), 'clip-rule': v => ['nonzero', 'evenodd'].includes(v),
  'font-size': v => NUM.test(v), 'font-weight': v => /^(normal|bold|[1-9]00)$/.test(v), 'font-family': v => /^(sans-serif|serif|monospace)$/.test(v),
  'text-anchor': v => ['start', 'middle', 'end'].includes(v), 'dominant-baseline': v => ['middle', 'central', 'hanging', 'auto'].includes(v),
  gradientUnits: v => ['userSpaceOnUse', 'objectBoundingBox'].includes(v), clipPathUnits: v => ['userSpaceOnUse', 'objectBoundingBox'].includes(v),
  offset: v => NUM.test(v),
};
for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'dx', 'dy']) CHECK[k] = v => NUM.test(v);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/**
 * Re-build SVG markup (the inside of an <svg>) from an allow-list.
 * @returns {{ok: true, svg: string, ids: Set<string>, groups: Set<string>} | {ok: false, error: string}}
 */
export function sanitizeSvg(markup) {
  let src = String(markup ?? '').trim();
  if (!src) return { ok: false, error: 'The picture is empty.' };
  if (src.length > ART_MAX.chars) return { ok: false, error: `The picture is too big (more than ${ART_MAX.chars} characters) — simplify it.` };
  src = src.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>/gi, '');
  // an outer <svg …> … </svg> wrapper is fine: only what is inside it is kept
  const wrap = /^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i.exec(src);
  if (wrap) src = wrap[1];
  const out = [], stack = [], ids = new Set(), groups = new Set();
  let n = 0, i = 0;
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m.index !== i) return { ok: false, error: 'The picture has markup that could not be read.' };
    i = re.lastIndex;
    if (m[5] !== undefined) {                               // text: only meaningful inside <text>
      const top = stack.at(-1);
      if (top && TEXT_TAGS.has(top.lc)) out.push(esc(unesc(m[5]).slice(0, 80)));
      continue;
    }
    const closing = m[1] === '/', lc = m[2].toLowerCase(), self = m[4] === '/';
    if (closing) {
      const top = stack.pop();
      if (!top || top.lc !== lc) return { ok: false, error: 'The picture has mismatched tags.' };
      if (top.keep) out.push(`</${top.name}>`);
      continue;
    }
    const keep = TAGS.has(lc) && !stack.some(s => !s.keep);
    const name = CANON[lc] || lc;
    let attrs = '';
    if (keep) {
      if (++n > ART_MAX.elements) return { ok: false, error: `The picture has more than ${ART_MAX.elements} shapes — simplify it.` };
      const are = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
      let a;
      while ((a = are.exec(m[3] || ''))) {
        const key = a[1], val = unesc(a[2] ?? a[3] ?? '').trim();
        const k = Object.keys(CHECK).find(c => c.toLowerCase() === key.toLowerCase());
        if (k && val && CHECK[k](val)) {
          attrs += ` ${k}="${esc(val)}"`;
          if (k === 'id') { ids.add(val); if (lc === 'g') groups.add(val); }
        }
      }
    }
    if (self) { if (keep) out.push(`<${name}${attrs}/>`); }
    else { stack.push({ lc, name, keep }); if (keep) out.push(`<${name}${attrs}>`); }
  }
  if (i !== src.length) return { ok: false, error: 'The picture has markup that could not be read.' };
  if (stack.length) return { ok: false, error: 'The picture has tags that are never closed.' };
  if (!n) return { ok: false, error: 'The picture has no shapes in it.' };
  return { ok: true, svg: out.join(''), ids, groups };
}

export const MOTION_KINDS = {
  spin: { label: 'Spins around a point', drivers: ['rpm'] },
  rotate: { label: 'Turns to an angle', drivers: ['angle', 'level'] },
  glow: { label: 'Fades in as it lights up', drivers: ['lit', 'level'] },
  slide: { label: 'Slides along a line', drivers: ['level', 'angle', 'lit'] },
};
const clamp = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, +x.toFixed(2))) : d; };

/** What each moving piece does. `groups` are the ids of <g> elements in the picture. */
export function cleanMotion(list, groups, size = ART_MAX.size) {
  const errors = [], out = [];
  for (const m of Array.isArray(list) ? list.slice(0, 12) : []) {
    const target = String(m?.target ?? '');
    const kind = String(m?.kind ?? '');
    if (!MOTION_KINDS[kind]) { errors.push(`Motion "${kind}": use one of ${Object.keys(MOTION_KINDS).join(', ')}.`); continue; }
    if (!groups.has(target)) { errors.push(`Motion target "${target}" must be the id of a <g> in the picture.`); continue; }
    const driver = MOTION_KINDS[kind].drivers.includes(m.driver) ? m.driver : MOTION_KINDS[kind].drivers[0];
    const e = { target, kind, driver };
    if (kind === 'spin' || kind === 'rotate') e.pivot = [clamp(m.pivot?.[0], 0, size, 0), clamp(m.pivot?.[1], 0, size, 0)];
    if (kind === 'rotate') { e.from = clamp(m.from, -720, 720, 0); e.to = clamp(m.to, -720, 720, 90); }
    if (kind === 'glow') { e.min = clamp(m.min, 0, 1, 0.15); }
    if (kind === 'slide') { e.dx = clamp(m.dx, -size, size, 10); e.dy = clamp(m.dy, -size, size, 0); }
    out.push(e);
  }
  return { motion: out, errors };
}

/**
 * The art block of a spec: { w, h, svg, motion }. Returns the cleaned block or the reasons it was refused.
 */
export function cleanArt(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['A drawn part needs an "art" block with w, h and svg.'] };
  const w = clamp(raw.w, 20, ART_MAX.size, 0), h = clamp(raw.h, 20, ART_MAX.size, 0);
  const errors = [];
  if (!w || !h) errors.push('The picture needs a width and height (20–400).');
  const s = sanitizeSvg(raw.svg);
  if (!s.ok) return { ok: false, errors: [...errors, s.error] };
  const mo = cleanMotion(raw.motion, s.groups);
  errors.push(...mo.errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, art: { w, h, svg: s.svg, motion: mo.motion } };
}

/**
 * The picture at this moment. `st` = { lit: 0–1, aux: rpm or degrees, level: 0–1 }.
 * Motion is applied by styling the targeted <g> — the markup itself is already safe.
 */
export function renderArt(art, st = {}) {
  const lit = Number(st.lit) || 0, aux = Number(st.aux) || 0, level = Number.isFinite(st.level) ? st.level : lit;
  let svg = art.svg;
  for (const m of art.motion || []) {
    const value = m.driver === 'rpm' ? aux : m.driver === 'angle' ? aux : m.driver === 'lit' ? lit : level;
    let style = '';
    if (m.kind === 'spin') {
      if (value) style = `transform-origin:${m.pivot[0]}px ${m.pivot[1]}px;animation:cp-spin ${Math.max(0.08, Math.min(4, 60 / Math.abs(value))).toFixed(2)}s linear infinite${value < 0 ? ' reverse' : ''}`;
    } else if (m.kind === 'rotate') {
      const t = m.driver === 'angle' ? value : m.from + (m.to - m.from) * Math.max(0, Math.min(1, value));
      style = `transform-origin:${m.pivot[0]}px ${m.pivot[1]}px;transform:rotate(${(+t).toFixed(1)}deg)`;
    } else if (m.kind === 'glow') {
      style = `opacity:${(m.min + (1 - m.min) * Math.max(0, Math.min(1, value))).toFixed(2)}`;
    } else if (m.kind === 'slide') {
      const f = Math.max(0, Math.min(1, m.driver === 'angle' ? value / 180 : value));
      style = `transform:translate(${(m.dx * f).toFixed(1)}px,${(m.dy * f).toFixed(1)}px)`;
    }
    if (style) svg = svg.replace(`<g id="${m.target}"`, `<g id="${m.target}" style="${style}"`);
  }
  return svg;
}
