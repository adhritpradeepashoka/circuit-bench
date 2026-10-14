import { CONTROLS, toValue, toSlider } from '../core/controls.js';

const $ = id => document.getElementById(id);

/** Right-click a potentiometer / photoresistor / NTC sensor → slider for its one value. Applies live, even while running. */
export function initValueEditor(editor) {
  const box = $('valEditor'), slider = $('valSlider'), readout = $('valReadout'), presets = $('valPresets');
  let partId = null, ctl = null;

  const isOpen = () => !box.hidden;
  const close = () => { box.hidden = true; partId = null; ctl = null; };
  const show = v => { readout.textContent = ctl.fmt(v); readout.classList.add('big'); };
  const mark = v => presets.querySelectorAll('button').forEach(b => b.classList.toggle('cur', Math.abs(Number(b.dataset.v) - v) < 1e-9));

  function open({ part, clientX, clientY }) {
    ctl = CONTROLS[part.type];
    if (!ctl) return;
    partId = part.id; box.hidden = false;
    $('valTitle').textContent = ctl.title; $('valLabel').textContent = ctl.label; $('valNote').textContent = ctl.note;
    presets.innerHTML = ctl.presets.map(p => `<button type="button" data-v="${p.v}">${p.label}</button>`).join('');
    const v = part[ctl.key];
    slider.value = String(toSlider(ctl, v)); show(v); mark(v);
    const r = editor.canvas.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(clientX - r.left + 10, r.width - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(clientY - r.top + 10, r.height - box.offsetHeight - 8))}px`;
    slider.focus();
  }
  const snap = v => (ctl.step ? Math.round(v / ctl.step) * ctl.step : Number(v.toPrecision(3)));
  const apply = (v, commit) => { v = snap(Math.min(ctl.max, Math.max(ctl.min, v))); editor.setPartProp(partId, ctl.key, v, { commit }); show(v); mark(v); return v; };

  editor.on('part-context', open);
  slider.addEventListener('input', () => { if (isOpen()) apply(toValue(ctl, Number(slider.value)), false); });
  slider.addEventListener('change', () => { if (isOpen()) { apply(toValue(ctl, Number(slider.value)), true); editor.status(`${ctl.title}: ${$('valReadout').textContent}`); } });
  presets.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b || !isOpen()) return;
    const v = apply(Number(b.dataset.v), true); slider.value = String(toSlider(ctl, v));
    editor.status(`${ctl.title}: ${ctl.fmt(v)}`);
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', e => { if (isOpen() && !e.target.closest('.part-editor')) close(); }, true);
  editor.on('workspace', () => { if (isOpen() && !editor.partById(partId)) close(); });
  return { isOpen };
}
