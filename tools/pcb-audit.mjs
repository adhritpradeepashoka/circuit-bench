// Run the KiCad importer over real .kicad_pcb files and compare with simple ground truth counted straight from the text.
// Usage: node tools/pcb-audit.mjs file.kicad_pcb [...]
import { readFileSync } from 'node:fs';
import { boardToSpec, readBoard, groupPads } from '../src/core/kicad-import.js';
import { validatePartSpec } from '../src/core/custom-parts.js';
for (const f of process.argv.slice(2)) {
  const text = readFileSync(f, 'utf8'), t0 = Date.now();
  const truth = { pads: (text.match(/\(pad\s/g) || []).length, segments: (text.match(/\(segment\s/g) || []).length, arcs: (text.match(/\n\s*\(arc\s/g) || []).length, vias: (text.match(/\(via\s/g) || []).length, zones: (text.match(/\(zone\s/g) || []).length, footprints: (text.match(/\((footprint|module)\s/g) || []).length };
  try {
    const b = readBoard(text), groups = groupPads(b), r = boardToSpec(text), v = validatePartSpec(r.spec);
    const refs = b.parts.filter(p => p.ref && p.ref !== 'REF**').length;
    console.log(`${f.split('/').pop()}  ${Date.now() - t0}ms\n  truth   ${JSON.stringify(truth)}\n  read    pads ${b.pads.length} tracks ${b.tracks.length} vias ${b.vias.length} footprints ${b.parts.length} withRef ${refs} edge ${b.edge.length}\n  nodes ${groups.length} pins ${r.report.pins} size ${r.report.widthMm}x${r.report.heightMm} valid ${v.ok}${v.ok ? '' : ' ' + v.errors.join(' ')}\n  notes ${r.report.notes.join(' | ').slice(0, 300)}`);
  } catch (e) { console.log(`${f.split('/').pop()}  THREW ${e.message}\n  truth ${JSON.stringify(truth)}`); }
}
