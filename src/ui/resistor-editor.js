import { parseResistance, formatOhms, compactOhms, bandColors, bandNames, PRESETS } from '../core/resistance.js';

const $ = id => document.getElementById(id);

/** Right-click a resistor → small popover: type a value (4.7k, 220, 1M…) or pick a preset; the colour bands follow live. */
export function initResistorEditor(editor) {
  const box = $('resEditor'), input = $('resInput'), msg = $('resMsg'), bands = $('resBands'), presets = $('resPresets');
  let partId = null, original = null;

  presets.innerHTML = PRESETS.map(v => `<button type="button" data-ohms="${v}">${compactOhms(v)}</button>`).join('');

  const isOpen = () => !box.hidden;
  const say = (text, bad = false) => { msg.textContent = text; msg.classList.toggle('bad', bad); };
  const paintBands = ohms => { bands.innerHTML = bandColors(ohms).map(c => `<i style="background:${c}"></i>`).join(''); bands.title = bandNames(ohms).join(' · '); };
  const markPreset = ohms => presets.querySelectorAll('button').forEach(b => b.classList.toggle('cur', Number(b.dataset.ohms) === ohms));

  function preview() {
    const r = parseResistance(input.value);
    if (!r.ok) { say(r.error, true); editor.setResistance(partId, original, { commit: false }); paintBands(original); markPreset(-1); return null; }
    say(`${formatOhms(r.ohms)}${r.rounded ? ' — rounded: colour bands carry two digits' : ''} · ${bandNames(r.ohms).slice(0, 3).join(' ')}`);
    editor.setResistance(partId, r.ohms, { commit: false }); paintBands(r.ohms); markPreset(r.ohms);
    return r;
  }
  function close() { box.hidden = true; partId = null; }
  function cancel() {
    if (!isOpen()) return;
    editor.setResistance(partId, original, { commit: false });
    close();
  }
  function apply() {
    if (!isOpen()) return;
    const r = parseResistance(input.value);
    if (!r.ok) { say(r.error, true); input.focus(); return; }
    editor.setResistance(partId, original, { commit: false });          // so history records original → new
    editor.setResistance(partId, r.ohms, { commit: true });
    editor.status(r.ohms === original ? 'Resistor unchanged' : `Resistor set to ${formatOhms(r.ohms)} (${bandNames(r.ohms).slice(0, 3).join(', ')})`);
    close();
  }

  function open({ part, clientX, clientY }) {
    if (part.type !== 'resistor') return;
    if (isOpen()) cancel();
    partId = part.id; original = part.ohms;
    box.hidden = false;
    input.value = compactOhms(original);
    paintBands(original); markPreset(original); say(`${formatOhms(original)} · ${bandNames(original).slice(0, 3).join(' ')}`);
    const r = editor.canvas.getBoundingClientRect();
    const left = Math.max(8, Math.min(clientX - r.left + 10, r.width - box.offsetWidth - 8));
    const top = Math.max(8, Math.min(clientY - r.top + 10, r.height - box.offsetHeight - 8));
    box.style.left = `${left}px`; box.style.top = `${top}px`;
    input.focus(); input.select();
  }

  editor.on('part-context', open);
  input.addEventListener('input', preview);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  presets.addEventListener('click', e => {
    const b = e.target.closest('button[data-ohms]');
    if (!b) return;
    input.value = compactOhms(Number(b.dataset.ohms)); apply();
  });
  $('resApply').addEventListener('click', apply);
  $('resCancel').addEventListener('click', cancel);
  document.addEventListener('pointerdown', e => { if (isOpen() && !e.target.closest('.part-editor')) cancel(); }, true);
  // if the selected resistor disappears (undo/delete) while the editor is open, just close it
  editor.on('workspace', () => { if (isOpen() && !editor.partById(partId)) close(); });
  return { isOpen };
}
