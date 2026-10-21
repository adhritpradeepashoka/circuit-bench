// Turns a batch of AI-proposed circuit edits into a new project (the same shape toProjectFile/
// fromProjectFile use), so the result can go straight through editor.importProject() — which already
// validates part types, carries the edit onto the undo stack, and re-renders everything.
//
// Deliberately pure and DOM-free: this runs both in the browser (to preview/apply) and on the server
// (to validate before ever showing a result to the user), from the same PART_DEFS catalogue.
import { PART_DEFS } from './parts.js';
import { CONTROLS } from './controls.js';

const uid = prefix => `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

/** A short, token-cheap description of what the AI is allowed to place and wire — goes straight into the prompt. */
export function describeCatalog() {
  const lines = Object.values(PART_DEFS).map(def => {
    if (def.type === 'breadboard') return `- breadboard: holes A1..J40 (A-E and F-J are separate strips per column, like a real breadboard), rails TP1-25/TN1-25 (top +/-), BP1-25/BN1-25 (bottom +/-)`;
    const pins = def.pins.map(p => p.id).join(', ');
    const props = def.props ? ` props: ${Object.keys(def.props).join(', ')}` : '';
    // Carries the same electrical note shown on the part's own right-click control (e.g. "OUT falls as
    // it gets hotter") into the prompt — without it the model assumes a sensor's analog reading rises
    // with the quantity it measures, which is backwards for the NTC and LDR modules and silently
    // inverts any firmware comparison it writes (regression: "LED on above 50°C" came out on below
    // 25°C and off above it, because nothing told the model OUT falls as temperature rises).
    const note = [CONTROLS[def.type]?.note, def.aiNote].filter(Boolean).map(n => ` — ${n}`).join('');
    return `- ${def.type}: pins ${pins}${props}${note}`;
  });
  return lines.join('\n');
}

function dedupeId(wanted, used) {
  if (!used.has(wanted)) return wanted;
  let n = 2;
  while (used.has(`${wanted}-${n}`)) n++;
  return `${wanted}-${n}`;
}

const ALLOWED_PROP = (type, key) => !!PART_DEFS[type]?.props && key in PART_DEFS[type].props;
const pinExists = (type, pin) => !!PART_DEFS[type]?.pinById?.has(String(pin));

/**
 * @param {{parts:Array, wires:Array}} project current circuit (same shape as editor.exportProject())
 * @param {Array} actions proposed edits, each { op, ...}
 * @returns {{parts:Array, wires:Array, warnings:string[]}}
 */
export function applyCircuitActions(project, actions) {
  const parts = (project?.parts || []).map(p => ({ ...p }));
  const wires = (project?.wires || []).map(w => ({ ...w, from: { ...w.from }, to: { ...w.to } }));
  const warnings = [];
  const usedPartIds = new Set(parts.map(p => p.id));
  const usedWireIds = new Set(wires.map(w => w.id));
  const idMap = new Map(); // id the AI asked for → id it actually got (this batch only)
  const resolve = id => idMap.get(id) ?? id;
  const partByFinalId = id => parts.find(p => p.id === id);

  if (!Array.isArray(actions)) return { parts, wires, warnings: ['No actions to apply.'] };

  let cascade = 0;
  const bbox = parts.reduce((b, p) => {
    const def = PART_DEFS[p.type]; if (!def) return b;
    return { maxX: Math.max(b.maxX, p.x + def.w), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y + def.h) };
  }, { maxX: 0, minY: 0, maxY: 0 });

  for (const a of actions) {
    if (!a || typeof a !== 'object' || typeof a.op !== 'string') { warnings.push(`Skipped a malformed action: ${JSON.stringify(a)}`); continue; }
    try {
      switch (a.op) {
        case 'add_part': {
          const def = PART_DEFS[a.type];
          if (!def) { warnings.push(`Unknown part type "${a.type}" — skipped.`); break; }
          const wantedId = String(a.id || `${a.type.slice(0, 3)}-ai`);
          const finalId = dedupeId(wantedId, usedPartIds);
          usedPartIds.add(finalId); if (a.id) idMap.set(a.id, finalId);
          const props = {};
          for (const [k, v] of Object.entries(a.props || {})) {
            if (ALLOWED_PROP(a.type, k)) props[k] = v; else warnings.push(`${a.type} has no "${k}" property — ignored.`);
          }
          const hasXY = Number.isFinite(a.x) && Number.isFinite(a.y);
          const x = hasXY ? a.x : bbox.maxX + 40;
          const y = hasXY ? a.y : bbox.minY + cascade * 70;
          if (!hasXY) cascade++;
          parts.push({ id: finalId, type: a.type, x, y, rotate: ((+a.rotate || 0) % 360 + 360) % 360, ...(def.props || {}), ...props });
          break;
        }
        case 'move_part': {
          const p = partByFinalId(resolve(a.id));
          if (!p) { warnings.push(`move_part: no part "${a.id}".`); break; }
          if (Number.isFinite(a.x)) p.x = a.x;
          if (Number.isFinite(a.y)) p.y = a.y;
          break;
        }
        case 'rotate_part': {
          const p = partByFinalId(resolve(a.id));
          if (!p) { warnings.push(`rotate_part: no part "${a.id}".`); break; }
          p.rotate = ((+a.rotate || 0) % 360 + 360) % 360;
          break;
        }
        case 'set_prop': {
          const p = partByFinalId(resolve(a.id));
          if (!p) { warnings.push(`set_prop: no part "${a.id}".`); break; }
          if (!ALLOWED_PROP(p.type, a.key)) { warnings.push(`${p.type} has no "${a.key}" property — ignored.`); break; }
          p[a.key] = a.value;
          break;
        }
        case 'remove_part': {
          const id = resolve(a.id);
          const before = parts.length;
          const keep = parts.filter(p => p.id !== id);
          if (keep.length === before) { warnings.push(`remove_part: no part "${a.id}".`); break; }
          parts.length = 0; parts.push(...keep);
          for (let i = wires.length - 1; i >= 0; i--) if (wires[i].from.part === id || wires[i].to.part === id) wires.splice(i, 1);
          break;
        }
        case 'add_wire': {
          const fromPart = partByFinalId(resolve(a.from?.part)), toPart = partByFinalId(resolve(a.to?.part));
          if (!fromPart || !toPart) { warnings.push(`add_wire: unknown part in ${JSON.stringify(a)}.`); break; }
          if (!pinExists(fromPart.type, a.from.pin)) { warnings.push(`add_wire: ${fromPart.type} has no pin "${a.from.pin}".`); break; }
          if (!pinExists(toPart.type, a.to.pin)) { warnings.push(`add_wire: ${toPart.type} has no pin "${a.to.pin}".`); break; }
          const id = dedupeId(String(a.id || uid('w')), usedWireIds); usedWireIds.add(id);
          wires.push({ id, from: { part: fromPart.id, pin: String(a.from.pin) }, to: { part: toPart.id, pin: String(a.to.pin) }, style: a.style || 'straight', color: a.color || '#454d53', width: +a.width || 3, bend: 0.5, sag: null });
          break;
        }
        case 'remove_wire': {
          const before = wires.length;
          const keep = wires.filter(w => w.id !== a.id);
          if (keep.length === before) { warnings.push(`remove_wire: no wire "${a.id}".`); break; }
          wires.length = 0; wires.push(...keep);
          break;
        }
        default:
          warnings.push(`Unknown action "${a.op}" — skipped.`);
      }
    } catch (err) {
      warnings.push(`"${a.op}" failed: ${err.message}`);
    }
  }
  return { parts, wires, warnings };
}
