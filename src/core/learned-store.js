// The learned recipes this browser knows (see learned.js). Every read re-validates, so a damaged or hand-edited entry is simply ignored.
import { validateRecipe } from './learned.js';

const KEY = 'virtual-lab:learned-recipes', PREF = 'virtual-lab:learn-from-ai', MAX = 60;
let mem = null;
const listeners = new Set();

function rawRead() {
  if (mem) return mem;
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function rawWrite(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); mem = null; } catch { mem = list; }
  for (const f of listeners) { try { f(list); } catch { /* one listener must not break the others */ } }
}
/** The valid recipes (own + shared ones the server handed over). */
export function learnedRecipes() {
  const seen = new Set(), out = [];
  for (const r of [...rawRead(), ...shared]) { const v = validateRecipe(r); if (v.ok && !seen.has(v.recipe.id)) { seen.add(v.recipe.id); out.push(v.recipe); } }
  return out;
}
let shared = [];
export const setSharedRecipes = list => { shared = Array.isArray(list) ? list : []; };
export const onLearnedChange = f => { listeners.add(f); return () => listeners.delete(f); };

export function addLearned(recipe) {
  const v = validateRecipe(recipe); if (!v.ok) return false;
  const list = rawRead().filter(r => r?.id !== v.recipe.id);
  list.unshift(v.recipe); rawWrite(list.slice(0, MAX)); return true;
}
export function removeLearned(id) { const list = rawRead(); const next = list.filter(r => r?.id !== id); if (next.length === list.length) return false; rawWrite(next); return true; }

/** Learning from the AI's answers is on unless the student turned it off (it costs one extra AI call per new kind of request). */
export function learningOn() { try { return localStorage.getItem(PREF) !== '0'; } catch { return true; } }
export function setLearning(on) { try { localStorage.setItem(PREF, on ? '1' : '0'); } catch { /* ignore */ } }
