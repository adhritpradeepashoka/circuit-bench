// The Part Maker's own on-device model: a small transformer trained only to turn "INA128 with gain 500" into a part (pins in datasheet
// order, kind, numbers). Plain JavaScript on the CPU, about 4 MB, no GPU and no key. Anything it is not sure of, or does not know,
// comes back null and the Part Maker asks a bigger AI instead.
import { loadTiny } from './tiny-model.mjs';
import { specFromPartLanguage, parsePartLanguage } from '../core/part-model-decode.js';
import { validatePartSpec } from '../core/custom-parts.js';
import { checkPart } from '../core/part-agent.js';

const asc = s => String(s).replace(/Ω/g, 'ohm').replace(/[µμ]/g, 'u').replace(/[^\x20-\x7e]/g, '').toLowerCase().trim();
const sq = s => asc(s).replace(/[^a-z0-9]/g, '');
/** The answer must be about something the student actually wrote: a word (or the whole request) shows up in the part's name or label. A bare "12v" never gets a gas sensor. */
const mentions = (text, spec) => { const hay = sq(`${spec.name} ${spec.label}`), whole = sq(text); return (whole.length >= 3 && hay.includes(whole)) || text.split(/[^a-z0-9.+]+/).some(w => w.length >= 3 && /[a-z]{3}/.test(w) && hay.includes(sq(w))); };

/* Plain values ("22k resistor", "100nF capacitor", "10 mH inductor", "5.1v zener") are read by rule, exactly, before any model: arithmetic is not what a small network is for. */
const NUM = '(\\d+(?:\\.\\d+)?)';
const g = n => `${Number(n.toPrecision(8))}`;
const ohmLabel = v => (v >= 1e6 ? `${g(v / 1e6)}M` : v >= 1e3 ? `${g(v / 1e3)}k` : g(v));
export function valuePart(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/ω/g, 'ohm').replace(/[µμ]/g, 'u').replace(/\s+/g, ' ').trim()} `;
  let m;
  if (/\b(pot|potentiometer|trimmer|trim pot|knob)\b/.test(t) && (m = t.match(new RegExp(`${NUM} ?(k|m|meg)? ?(?:ohms?|kohm)?\\b`)))) { /* a pot is not a plain resistor: leave it to the model */ return null; }
  if (/\b(resistor|resistance)\b/.test(t) && (m = t.match(new RegExp(`${NUM} ?(k|m|meg)?(?: ?ohms?| ?kohm| ?mohm)?(?= |$)`)))) {
    const mult = { k: 1e3, m: 1e6, meg: 1e6 }[m[2]] || 1, v = Number(m[1]) * mult;
    if (v >= 0.1 && v <= 1e8) return `Resistor ${ohmLabel(v)}|${ohmLabel(v)}|resistor|1 2|ohms=${g(v)}`;
  }
  if (/\b(capacitor|cap)\b/.test(t) && (m = t.match(new RegExp(`${NUM} ?(pf|nf|uf|mf)\\b`)))) {
    const uf = Number(m[1]) * { pf: 1e-6, nf: 1e-3, uf: 1, mf: 1e3 }[m[2]];
    if (uf > 0 && uf <= 1e6) { const lab = uf < 0.001 ? `${g(uf * 1e6)}pF` : uf < 1 ? `${g(uf * 1e3)}nF` : `${g(uf)}uF`; return `${uf >= 1 ? 'Electrolytic' : 'Ceramic'} capacitor ${lab}|${lab}|capacitor|${uf >= 1 ? '+ -' : '1 2'}|uF=${g(uf)}`; }
  }
  if (/\b(inductor|coil|choke)\b/.test(t) && (m = t.match(new RegExp(`${NUM} ?(uh|mh|h)\\b`)))) {
    const mh = Number(m[1]) * { uh: 1e-3, mh: 1, h: 1e3 }[m[2]];
    if (mh >= 0.001 && mh <= 1e5) { const lab = mh < 1 ? `${g(mh * 1000)}uH` : `${g(mh)}mH`; return `Inductor ${lab}|${lab}|inductor|1 2|mH=${g(mh)} rs=${g(Number((2 + Math.sqrt(mh)).toFixed(1)))}`; }
  }
  if (/\bzener\b/.test(t) && (m = t.match(new RegExp(`${NUM} ?v\\b`)))) { const v = Number(m[1]); if (v >= 1 && v <= 100) return `Zener diode ${g(v)} V|ZENER ${g(v)}V|diode|A K|vf=0.7 vz=${g(v)} imax=500`; }
  return null;
}

let loading = null;
export function loadPartModel(opts = {}) {
  return (loading ||= loadTiny({ ...opts, manifestUrl: '/part-model.json', binUrl: '/part-model.bin', share: false }).catch(e => { loading = null; throw e; }));
}

/**
 * @returns {{ok:true, spec, source:'on-device', note, confidence}|null}
 * Sure enough (every token ≥ minConfidence), a kind the simulator can model, a spec that validates, and every number the student typed
 * accounted for (checkPart); a built-in template with the same name supplies its own accurate drawing.
 */
export function partFromModel(model, description, { templates = [], minConfidence = 0.85 } = {}) {
  const text = String(description || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text || text.length > 120) return null;
  const byRule = valuePart(text), out = byRule ? { text: byRule, minProb: 1 } : model.translate(text);
  if (out.minProb < minConfidence) return null;
  const parsed = parsePartLanguage(out.text); if (!parsed) return null;
  let spec = specFromPartLanguage(out.text); if (!spec) return null;
  const tpl = templates.find(t => asc(t.name) === asc(parsed.name));
  if (tpl) {
    const { id, group, aka, learned, ...raw } = tpl, behaviour = { ...raw.behaviour };
    for (const [k, v] of Object.entries(parsed.params)) if (k in behaviour && typeof behaviour[k] === 'number' && behaviour[k] !== v) behaviour[k] = v;
    const v = validatePartSpec({ ...raw, behaviour });
    if (v.ok) spec = v.spec;
  }
  if (!mentions(text, spec) || checkPart(spec, { description: text }).length) return null;
  return { ok: true, spec, source: 'on-device', confidence: out.minProb, note: tpl ? `Recognised "${spec.name}" by the model on this device: its own drawing and pins, no AI needed.` : `Made by the Part Maker model on this device (no AI). It is a plain board with the real pin names, so check them against the datasheet.`, meta: { provider: 'On this device', model: 'part model', ms: 0 } };
}
