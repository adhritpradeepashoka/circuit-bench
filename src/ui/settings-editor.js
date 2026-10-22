// Right-click a part with several settings (DHT sensor: model, temperature, humidity · battery: voltage) → a small
// panel with one row per field, built from SETTINGS in src/core/controls.js. Applies live, even while running.
import { SETTINGS } from '../core/controls.js';

export function initSettingsEditor(editor) {
  const box = document.createElement('div');
  box.className = 'part-editor settings-editor'; box.id = 'setEditor'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Part settings');
  (document.getElementById('valEditor')?.parentElement || editor.canvas).append(box);
  let partId = null;

  const isOpen = () => !box.hidden;
  const close = () => { box.hidden = true; partId = null; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function build(part) {
    const spec = SETTINGS[part.type];
    box.replaceChildren();
    const head = el('div', 'pe-head'); head.append(el('span', 'pe-title', spec.title)); box.append(head);
    for (const f of spec.fields) {
      const row = el('label', 'pe-field set-field');
      const name = el('span', null, f.label), val = el('b', 'set-val');
      name.append(' ', val); row.append(name);
      const cur = part[f.key];
      let input;
      if (f.kind === 'select') {
        input = el('select'); input.id = `set-${f.key}`;
        for (const [v, label] of f.options) { const o = el('option', null, label); o.value = v; input.append(o); }
        input.value = cur;
        input.addEventListener('change', () => { editor.setPartProp(partId, f.key, input.value); editor.status(`${spec.title}: ${f.label} → ${input.value}`); });
      } else {
        input = el('input'); input.type = 'range'; input.id = `set-${f.key}`;
        Object.assign(input, { min: f.min, max: f.max, step: f.step }); input.value = String(cur);
        val.textContent = f.fmt(cur);
        input.addEventListener('input', () => { editor.setPartProp(partId, f.key, Number(input.value), { commit: false }); val.textContent = f.fmt(input.value); });
        input.addEventListener('change', () => { editor.setPartProp(partId, f.key, Number(input.value)); editor.status(`${spec.title}: ${f.label} ${f.fmt(input.value)}`); });
      }
      row.append(input); box.append(row);
      if (f.presets) {
        const pre = el('div', 'pe-presets ve-presets');
        for (const [label, v] of f.presets) {
          const b = el('button', null, label); b.type = 'button';
          b.addEventListener('click', () => { input.value = String(v); editor.setPartProp(partId, f.key, v); val.textContent = f.fmt(v); });
          pre.append(b);
        }
        box.append(pre);
      }
    }
    box.append(el('div', 'pe-msg', spec.note));
  }

  editor.on('part-context', ({ part, clientX, clientY }) => {
    if (!SETTINGS[part.type]) return;
    partId = part.id; build(part); box.hidden = false;
    const r = editor.canvas.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(clientX - r.left + 10, r.width - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(clientY - r.top + 10, r.height - box.offsetHeight - 8))}px`;
    box.querySelector('input, select')?.focus();
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', e => { if (isOpen() && !e.target.closest('.part-editor')) close(); }, true);
  editor.on('workspace', () => { if (isOpen() && !editor.partById(partId)) close(); });
  return { isOpen, close };
}
