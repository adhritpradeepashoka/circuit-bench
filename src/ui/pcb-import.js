// Import a KiCad board (.kicad_pcb) as a part: parse it, check it like any other part spec, add it to My parts and place it.
import { boardToSpec } from '../core/kicad-import.js';
import { validatePartSpec, newCustomId } from '../core/custom-parts.js';
import { addToLibrary } from './part-creator.js';

export async function importPcbFile(editor, file) {
  try {
    const name = file.name.replace(/\.kicad_pcb$/i, '').replace(/[_-]+/g, ' ').trim();
    const { spec, report } = boardToSpec(await file.text(), { name });
    const v = validatePartSpec({ ...spec, id: newCustomId() });
    if (!v.ok) throw new Error(v.errors.join(' '));
    const saved = addToLibrary(v.spec);
    editor.emit('catalog');
    editor.addPart(v.spec.id);
    editor.status(`Imported “${v.spec.name}”: ${report.widthMm}×${report.heightMm} mm ${report.shape === 'circle' ? 'round ' : ''}board, ${report.pads} pads joined into ${report.nodes} nodes — ${report.pins} connection point${report.pins === 1 ? '' : 's'}.${report.notes.length ? ' ' + report.notes.join(' ') : ''}${saved === false ? ' Warning: this browser’s storage is full, so the board works now but will not be in My parts after you reload. Delete old imported boards from My parts to make room.' : ''}`);
    return v.spec;
  } catch (err) {
    editor.status(`Could not import that board: ${err.message}`);
    return null;
  }
}
