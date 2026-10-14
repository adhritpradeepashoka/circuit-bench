import { LED_COLORS } from '../core/led-colors.js';

const $ = id => document.getElementById(id);

/** Right-click an LED → pick its colour (which also sets its forward voltage in the simulation). */
export function initLedEditor(editor) {
  const box = $('ledEditor'), grid = $('ledSwatches'), vf = $('ledVf');
  let partId = null;
  grid.innerHTML = Object.entries(LED_COLORS).map(([k, c]) => `<button type="button" data-color="${k}"><i style="background:${c.hex}"></i>${c.name}</button>`).join('');

  const isOpen = () => !box.hidden;
  const close = () => { box.hidden = true; partId = null; };
  function open({ part, clientX, clientY }) {
    if (part.type !== 'led') return;
    partId = part.id; box.hidden = false;
    mark(part.color); vf.textContent = `Vf ≈ ${LED_COLORS[part.color].vf} V`;
    const r = editor.canvas.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(clientX - r.left + 10, r.width - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(clientY - r.top + 10, r.height - box.offsetHeight - 8))}px`;
    grid.querySelector('.cur')?.focus();
  }
  const mark = color => grid.querySelectorAll('button').forEach(b => b.classList.toggle('cur', b.dataset.color === color));

  editor.on('part-context', open);
  grid.addEventListener('click', e => {
    const b = e.target.closest('button[data-color]');
    if (!b || !isOpen()) return;
    const c = LED_COLORS[b.dataset.color];
    editor.setPartProp(partId, 'color', b.dataset.color);
    editor.status(`LED colour set to ${c.name} — forward voltage ≈ ${c.vf} V`);
    close();
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', e => { if (isOpen() && !e.target.closest('.part-editor')) close(); }, true);
  editor.on('workspace', () => { if (isOpen() && !editor.partById(partId)) close(); });
  return { isOpen };
}
