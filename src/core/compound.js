// Multi-step requests ("add a servo and connect it to pin 9", "add a resistor and an LED", "add a button, then blink the LED") are
// cut into steps that the instant rules or the on-device model each understand, and run one after another on a working copy of the
// bench (so step 2 sees what step 1 added). If any step is not understood the whole request is not answered here: a half answer
// that silently drops a step is worse than none, so the request goes on to the chosen AI untouched.

const PLAIN = { pushbutton: 'button', 'slide-switch': 'switch', potentiometer: 'potentiometer', ssd1306: 'oled', lcd1602: 'lcd', 'dc-motor': 'motor', 'rgb-led': 'rgb led', 'pir-sensor': 'pir sensor', 'ldr-module': 'light sensor', 'ntc-sensor': 'temperature sensor', l298n: 'motor driver', 'seven-segment': '7 segment' };
const plain = t => PLAIN[t] || String(t).replace(/-/g, ' ');
const VERB = '(?:add|put|place|insert|drop|get|give|connect|wire|hook|attach|plug|remove|delete|make|set|change|turn|blink|move|rotate|show|display|print|read|use|fade|dim|flash|play|run|start|stop|clear|rename)';
const STARTS_WITH_VERB = new RegExp(`^(?:please |now |also |just )?${VERB}\\b`, 'i');
const LIST_VERBS = /^(add|put|place|insert|drop|get|give|remove|delete|attach|plug|make|set|change)$/i;           // "add a resistor and an LED": the second part reuses the verb
const NOUN_START = /^(?:a|an|the|some|another|one|two|three|four|five|six|\d+)\b/i;

/** Cut a request into steps, or return null when it is a single step (or cannot be cut safely). */
export function splitSteps(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (!t || t.length > 260) return null;
  const hard = t.split(/\s*(?:;|,?\s+and then\s+|,?\s+then\s+|\.\s+(?=[A-Za-z]))\s*/i).filter(Boolean);
  const steps = [];
  for (const chunk of hard) {
    const pieces = chunk.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map(x => x.trim()).filter(Boolean);
    let verb = null;
    for (const piece of pieces) {
      const v = new RegExp(`^(?:please |now |also |just )?(${VERB})\\b`, 'i').exec(piece);
      if (v) { verb = v[1].toLowerCase(); steps.push(piece); continue; }
      if (verb && LIST_VERBS.test(verb) && NOUN_START.test(piece)) { steps.push(`${verb} ${piece}`); continue; }
      if (steps.length && !STARTS_WITH_VERB.test(piece) && !verb) return null;
      return null;                          // a piece that is neither a step nor a list item: do not guess what it means
    }
  }
  return steps.length > 1 ? steps : null;
}

/** What a step did to the bench, applied to a working copy so the next step sees it. */
export function applyToCopy(circuit, actions) {
  const parts = [...(circuit?.parts || [])], wires = [...(circuit?.wires || [])];
  for (const a of actions || []) {
    if (a.op === 'add_part') parts.push({ id: a.id, type: a.type, ...(a.props ? { props: a.props } : {}) });
    else if (a.op === 'remove_part') { const i = parts.findIndex(p => p.id === a.id); if (i >= 0) parts.splice(i, 1); for (let k = wires.length - 1; k >= 0; k--) if (wires[k].from?.part === a.id || wires[k].to?.part === a.id) wires.splice(k, 1); }
    else if (a.op === 'add_wire') wires.push({ from: a.from, to: a.to });
    else if (a.op === 'set_prop') { const p = parts.find(x => x.id === a.id); if (p) p.props = { ...(p.props || {}), [a.key]: a.value }; }
  }
  return { ...circuit, parts, wires };
}

/** "wire the button to pin 2" must use the button already on the bench, not add a second one: drop an add of a type that is already there and point its wires at the existing part. */
function reuseExisting(step, r, work) {
  if (!/^(?:please |now |also |just )?(connect|wire|hook|attach|plug)\b/i.test(step)) return r;
  const swap = new Map(), dropped = new Set();
  for (const a of r.actions || []) if (a.op === 'add_part') { const have = [...(work.parts || [])].reverse().find(p => p.type === a.type); if (have) { swap.set(a.id, have.id); dropped.add(a); } }
  if (!dropped.size) return r;
  const re = id => swap.get(id) ?? id;
  const actions = r.actions.filter(a => !dropped.has(a)).map(a => ({ ...a, ...(a.id ? { id: re(a.id) } : {}), ...(a.from ? { from: { ...a.from, part: re(a.from.part) } } : {}), ...(a.to ? { to: { ...a.to, part: re(a.to.part) } } : {}) }));
  return { ...r, actions };
}

/**
 * Run every step through `solve(stepText, circuitCopy)` (rules first, then the model; async). Returns the merged answer, or null when any step
 * was not understood or only produced a complaint.
 */
export async function solveSteps(text, circuit, solve) {
  const steps = splitSteps(text);
  if (!steps) return null;
  let work = circuit || { parts: [], wires: [] }, lastAdded = null, trail = [];
  const actions = [], notes = []; let code = null, viaModel = false;
  for (let raw of steps) {
    // "connect it to pin 9": "it" is what the step before added
    if (lastAdded && /\b(it|them|that)\b/i.test(raw)) raw = raw.replace(/\b(it|them|that)\b/i, `the ${[...new Set(lastAdded)].map(plain).join(' and the ')}`);
    let r = await solve(raw, work);
    if (!r || r.kind === 'off' || (!(r.actions || []).length && !r.code)) return null;
    r = reuseExisting(raw, r, work);
    if (r.code) { if (code && code !== r.code) return null; code = r.code; }
    for (const a of r.actions || []) actions.push(a);
    if (r.explanation) notes.push(String(r.explanation));
    if (r.viaModel) viaModel = true;
    const added = (r.actions || []).filter(a => a.op === 'add_part').map(a => a.type);
    trail = added.length ? [...trail.slice(-3), ...added] : trail;
    lastAdded = trail.length ? trail.slice(-2) : null;           // "them" is the last couple of things that were added
    work = applyToCopy(work, r.actions);
  }
  return { actions, code, explanation: notes.join(' '), steps: steps.length, ...(viaModel ? { viaModel: true } : {}) };
}
