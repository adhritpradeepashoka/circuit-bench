// Presses the app buttons the CircuitBench model asked for (names from core/app-ops.js). Only buttons that already exist can be pressed.
import { APP_OPS } from '../core/app-ops.js';

/** → { done:[names], missing:[names] } */
export function runAppOps(names, { doc = globalThis.document, editor = null } = {}) {
  const done = [], missing = [];
  for (const n of names || []) {
    const def = APP_OPS[n];
    if (def?.click) { const el = doc?.getElementById(def.click); if (el && !el.disabled) { el.click(); done.push(n); } else missing.push(n); }
    else if (def?.emit && editor?.emit) { editor.emit(def.emit); done.push(n); }
    else missing.push(n);
  }
  return { done, missing };
}
