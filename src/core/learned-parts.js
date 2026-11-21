// Parts the student has APPROVED in the Part Maker, remembered so the next request for the same part is instant and the AI can copy
// what already worked. Every read re-validates (a damaged or hand-edited entry is ignored); nothing here talks to a network.
import { validatePartSpec } from './custom-parts.js';
import { rankTemplates } from './part-match.js';

const KEY = 'virtual-lab:learned-parts', MAX = 80;
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
let mem = null;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const numbers = s => new Set((String(s || '').toLowerCase().match(/\d+(?:\.\d+)?/g) || []).map(Number));

function read() {
  if (mem) return mem;
  try { const v = JSON.parse(store()?.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(list) { try { store()?.setItem(KEY, JSON.stringify(list)); mem = null; } catch { mem = list; } }

/** The valid remembered parts, newest first: [{ id, request, spec, at }]. */
export function learnedParts() {
  const seen = new Set(), out = [];
  for (const e of read()) {
    if (!e || typeof e.request !== 'string' || !e.spec) continue;
    const v = validatePartSpec(e.spec); if (!v.ok) continue;
    const id = String(e.id || `learned-${slug(v.spec.name)}`); if (seen.has(id)) continue;
    seen.add(id); out.push({ id, request: e.request.slice(0, 240), spec: v.spec, at: Number(e.at) || 0 });
  }
  return out;
}

/** Remember an approved part against the words the student used to ask for it. Returns false for a part that does not validate or has no words. */
export function learnPart(request, spec, now = Date.now()) {
  const text = String(request || '').replace(/\s+/g, ' ').trim().slice(0, 240) || String(spec?.name || '');
  const v = validatePartSpec(spec); if (!v.ok || !text) return false;
  const id = `learned-${slug(v.spec.name) || slug(text)}`;
  const list = read().filter(e => e?.id !== id);
  list.unshift({ id, request: text, spec: JSON.parse(JSON.stringify(v.spec)), at: now });
  write(list.slice(0, MAX)); return true;
}
export function forgetLearnedPart(id) { const l = read(), n = l.filter(e => e?.id !== id); if (n.length === l.length) return false; write(n); return true; }

/** Templates in the shape part-match.js ranks ({id, name, label, …spec}); `aka` carries the student's own words so "bioamp pill" finds "BioAmp EXG Pill". */
export function learnedTemplates(list = learnedParts()) {
  return list.map(e => ({ ...e.spec, id: e.id, group: 'Learned', aka: e.request, learned: true }));
}

/**
 * The remembered part this request clearly asks for again, or null. Stricter than a built-in template: a request that states a number the
 * remembered one never mentioned ("gain 1000" against a part made at gain 100) is a different part, so the AI makes it.
 */
export function matchLearned(description, templates) {
  const r = rankTemplates(description, templates), best = r[0], next = r[1];
  if (!best || best.score < 0.7) return null;
  if (next && next.score > best.score - 0.08 && best.score < 0.9) return null;
  const t = best.template, known = numbers(`${t.aka} ${t.name} ${t.label} ${JSON.stringify(t.behaviour || {})} ${t.description || ''}`);
  for (const n of numbers(description)) if (!known.has(n)) return null;
  return t;
}

/** Up to n remembered parts that resemble this request, trimmed to what the AI should copy (pins, behaviour, naming) and never the drawing. */
export function examplesFor(description, templates, n = 2) {
  return rankTemplates(description, templates).filter(r => r.score >= 0.3).slice(0, n).map(({ template: t }) => ({
    request: String(t.aka || t.name).slice(0, 200),
    spec: { name: t.name, label: t.label, description: String(t.description || '').slice(0, 200), pins: (t.pins || []).map(p => ({ id: p.id, label: p.label })), behaviour: t.behaviour, ...(t.sizeMm ? { sizeMm: t.sizeMm } : {}) },
  }));
}
