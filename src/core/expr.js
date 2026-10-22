// A tiny arithmetic expression language — the only thing a student-made or AI-made part is allowed to "run".
//
// This is deliberately NOT JavaScript and never touches eval/Function: an expression is parsed into a plain
// tree of numbers, named values and arithmetic, and the evaluator can only do arithmetic on numbers it is
// handed. There are no strings, no variables it can assign to, no property access, no loops, no way to name a
// function that isn't in FUNCTIONS below — so the worst a malicious expression can do is return a wrong number.
// Size and depth are capped too, so it can't hang the page.
//
// Grammar (lowest precedence first):
//   ?:  ||  &&  |  ^  &  == !=  < <= > >=  << >>  + -  * / %   unary ! - ~   call  ( )  number  name

const MAX_NODES = 400, MAX_DEPTH = 40;

/** name → how many arguments. A "pin function" takes one bare pin name, not a value. */
export const FUNCTIONS = {
  min: { args: [2, 8] }, max: { args: [2, 8] }, abs: { args: [1, 1] }, floor: { args: [1, 1] }, ceil: { args: [1, 1] },
  round: { args: [1, 1] }, clamp: { args: [3, 3] }, select: { args: [3, 3] },
  v: { args: [1, 1], pin: true }, rising: { args: [1, 1], pin: true }, falling: { args: [1, 1], pin: true }, changed: { args: [1, 1], pin: true },
};

const BINARY = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<=', '>=', '<', '>'], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
const PUNCT = ['||', '&&', '==', '!=', '<=', '>=', '<<', '>>', '|', '^', '&', '<', '>', '+', '-', '*', '/', '%', '!', '~', '(', ')', ',', '?', ':'];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?)/.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at position ${i}`);
      const text = m[0];
      out.push({ t: 'num', v: /^0[bB]/.test(text) ? parseInt(text.slice(2), 2) : Number(text) });
      i += text.length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      // Names are letters, digits and _ only. Pin ids may also contain + - . (like "V+"), but those are
      // arithmetic here, so such a pin can't be named in an expression — never a silent misreading of "A-B".
      const text = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))[0];
      out.push({ t: 'name', v: text });
      i += text.length; continue;
    }
    const p = PUNCT.find(op => src.startsWith(op, i));
    if (!p) throw new Error(`“${c}” can't be used here`);
    out.push({ t: p }); i += p.length;
  }
  return out;
}

/**
 * Parse an expression into a tree. Throws an Error with a readable message if it isn't valid.
 * @returns {{node: object, names: Set<string>, pins: Set<string>}}
 */
export function parseExpr(src) {
  const text = String(src ?? '').trim();
  if (!text) throw new Error('Empty expression');
  if (text.length > 400) throw new Error('Expression is too long (400 characters max)');
  const tk = tokenize(text);
  const names = new Set(), pins = new Set();
  let at = 0, nodes = 0;
  const peek = () => tk[at];
  const eat = t => (tk[at] && tk[at].t === t ? (at++, true) : false);
  const count = () => { if (++nodes > MAX_NODES) throw new Error('Expression is too complicated'); };

  function parseTernary(depth) {
    if (depth > MAX_DEPTH) throw new Error('Expression is nested too deeply');
    const cond = parseBinary(0, depth);
    if (!eat('?')) return cond;
    const yes = parseTernary(depth + 1);
    if (!eat(':')) throw new Error('A “?” needs a matching “:”');
    count();
    return { k: '?', cond, yes, no: parseTernary(depth + 1) };
  }
  function parseBinary(level, depth) {
    if (level >= BINARY.length) return parseUnary(depth);
    let left = parseBinary(level + 1, depth);
    for (;;) {
      const op = BINARY[level].find(o => peek()?.t === o);
      if (!op) return left;
      at++; count();
      left = { k: 'bin', op, a: left, b: parseBinary(level + 1, depth) };
    }
  }
  function parseUnary(depth) {
    for (const op of ['!', '-', '~']) if (eat(op)) { count(); return { k: 'un', op, a: parseUnary(depth + 1) }; }
    return parseAtom(depth);
  }
  function parseAtom(depth) {
    if (depth > MAX_DEPTH) throw new Error('Expression is nested too deeply');
    const t = peek();
    if (!t) throw new Error('The expression stops too early');
    if (t.t === 'num') { at++; count(); return { k: 'num', v: t.v }; }
    if (t.t === '(') {
      at++;
      const inner = parseTernary(depth + 1);
      if (!eat(')')) throw new Error('A “(” is missing its “)”');
      return inner;
    }
    if (t.t === 'name') {
      at++;
      if (eat('(')) {
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new Error(`There is no function called “${t.v}” (you can use ${Object.keys(FUNCTIONS).join(', ')})`);
        const args = [];
        if (!eat(')')) {
          do {
            if (fn.pin) {
              const p = peek();
              if (p?.t !== 'name') throw new Error(`${t.v}() takes a pin name, like ${t.v}(CLK)`);
              at++; pins.add(p.v); args.push({ k: 'pinref', v: p.v });
            } else args.push(parseTernary(depth + 1));
          } while (eat(','));
          if (!eat(')')) throw new Error(`${t.v}( is missing its )`);
        }
        if (args.length < fn.args[0] || args.length > fn.args[1]) throw new Error(`${t.v}() takes ${fn.args[0] === fn.args[1] ? fn.args[0] : `${fn.args[0]}–${fn.args[1]}`} values, not ${args.length}`);
        count();
        return { k: 'call', fn: t.v, args };
      }
      if (FUNCTIONS[t.v]) throw new Error(`“${t.v}” is a function — write ${t.v}(...)`);
      names.add(t.v); count();
      return { k: 'name', v: t.v };
    }
    throw new Error(`“${t.t}” can't start a value`);
  }

  const node = parseTernary(0);
  if (at < tk.length) throw new Error('There is something left over at the end of the expression');
  return { node, names, pins };
}

const num = v => (Number.isFinite(v) ? v : 0);
const bool = v => (num(v) !== 0 ? 1 : 0);

/**
 * Evaluate a parsed tree. `ctx.get(name)` supplies values; `ctx.pin(fn, pinName)` answers v()/rising()/falling()/changed().
 * Pure arithmetic — it cannot reach anything the caller doesn't hand it.
 */
export function evalExpr(node, ctx) {
  switch (node.k) {
    case 'num': return node.v;
    case 'name': return num(ctx.get(node.v));
    case 'pinref': return 0;
    case 'un': {
      const a = evalExpr(node.a, ctx);
      return node.op === '!' ? (bool(a) ? 0 : 1) : node.op === '-' ? -num(a) : ~Math.trunc(num(a));
    }
    case '?': return bool(evalExpr(node.cond, ctx)) ? evalExpr(node.yes, ctx) : evalExpr(node.no, ctx);
    case 'bin': {
      const op = node.op;
      if (op === '&&') return bool(evalExpr(node.a, ctx)) ? bool(evalExpr(node.b, ctx)) : 0;
      if (op === '||') return bool(evalExpr(node.a, ctx)) ? 1 : bool(evalExpr(node.b, ctx));
      const a = num(evalExpr(node.a, ctx)), b = num(evalExpr(node.b, ctx));
      switch (op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '%': return b === 0 ? 0 : a % b;
        case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
        case '&': return Math.trunc(a) & Math.trunc(b);
        case '|': return Math.trunc(a) | Math.trunc(b);
        case '^': return Math.trunc(a) ^ Math.trunc(b);
        case '<<': return Math.trunc(a) << (Math.trunc(b) & 31);
        case '>>': return Math.trunc(a) >> (Math.trunc(b) & 31);
        default: return 0;
      }
    }
    case 'call': {
      const f = node.fn;
      if (FUNCTIONS[f].pin) return num(ctx.pin(f, node.args[0].v));
      const a = node.args.map(x => num(evalExpr(x, ctx)));
      switch (f) {
        case 'min': return Math.min(...a); case 'max': return Math.max(...a);
        case 'abs': return Math.abs(a[0]); case 'floor': return Math.floor(a[0]);
        case 'ceil': return Math.ceil(a[0]); case 'round': return Math.round(a[0]);
        case 'clamp': return Math.min(Math.max(a[0], a[1]), a[2]);
        case 'select': return bool(a[0]) ? a[1] : a[2];
        default: return 0;
      }
    }
    default: return 0;
  }
}

/** Convenience: parse + evaluate in one go (used by tests and one-off checks). */
export const runExpr = (src, ctx) => evalExpr(parseExpr(src).node, ctx);
