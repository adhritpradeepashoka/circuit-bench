// The Resource packs dialog (a card list of add-on board packs), plus the active workspace's hint and the drone quick-start.
import { getRobotType, onRobotType } from '../core/robot-context.js';
import { BUILTIN_WORKSPACES, activeWorkspace, setActiveWorkspace } from '../core/workspaces.js';
import { PACKS, packTypes, isInstalled, installPack, removePack, dependentsOf, onPacksChange } from '../core/packs.js';
import { PART_DEFS } from '../core/parts.js';
import { quickDrone } from '../core/quick-drone.js';
import { applyCircuitActions } from '../core/ai-actions.js';
import { FORMAT, VERSION } from '../core/project.js';

function showHint() {
  const h = activeWorkspace().hint || BUILTIN_WORKSPACES[0].hint, card = document.getElementById('hintCard');
  if (!card || !h) return;
  card.replaceChildren(Object.assign(document.createElement('b'), { textContent: h.title }), Object.assign(document.createElement('span'), { textContent: h.text }));
}

export function initWorkspaces({ editor, code, projects }) {
  const $ = id => document.getElementById(id);
  const modal = $('workspacesModal');
  const isBrandNew = p => !!p.createdAt && Date.now() - p.createdAt < 10 * 60_000;       // made in the last few minutes
  projects.onSwitch(p => { setActiveWorkspace(p.workspace); showHint(); editor.setHintAllowed(isBrandNew(p)); editor.emit('catalog'); });      // the parts menu leads with the open project's workspace

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /* ── resource packs ── */
  const packList = $('packList');
  const openGroups = new Set(), seenGroups = new Set();                      // dropdowns the student opened or closed; a group with something installed starts open
  const ICON = '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><rect x="9" y="12" width="30" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="17" y="19" width="14" height="10" rx="2" fill="currentColor" opacity=".85"/><path d="M14 8v4M22 8v4M30 8v4M38 8v4M14 36v4M22 36v4M30 36v4M38 36v4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" transform="translate(-4 0)"/></svg>';
  function packRow(pack) {
    const on = isInstalled(pack.id), types = packTypes(pack), card = el('div', `pack-card${on ? ' on' : ''}`);
    card.dataset.pack = pack.id; card.dataset.group = pack.group || 'More';
    const tile = el('div', 'pack-tile'); tile.innerHTML = ICON; tile.append(el('span', 'pack-count', String(types.length)));
    const info = el('div', 'pack-info'), chips = el('div', 'pack-chips');
    for (const t of types.slice(0, 4)) chips.append(el('span', 'pack-chip', PART_DEFS[t].name));
    if (types.length > 4) chips.append(el('span', 'pack-chip more', `+${types.length - 4} more`));
    info.append(el('b', 'pack-name', pack.name), el('span', 'pack-blurb', pack.blurb), chips);
    const b = el('button', `pack-btn${on ? ' on' : ''}`, on ? '✓ Added' : '+ Add'); b.type = 'button'; b.dataset.pack = pack.id;
    b.title = on ? `Remove ${pack.name} from your parts menu` : `Add ${pack.name} to your parts menu`;
    b.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} the ${pack.name} pack`);
    b.addEventListener('click', () => {
      if (on) {
        if (editor.state.parts.some(p => types.includes(p.type))) { const m = `${pack.name} is used on this bench — take those parts off first.`; editor.status(m); packNote(m); return; }
        if (!removePack(pack.id)) { const m = `${pack.name} is needed by ${dependentsOf(pack.id).map(d => d.name).join(', ')} — remove that first.`; editor.status(m); packNote(m); }
      } else installPack(pack.id);
    });
    card.append(tile, info, b); return card;
  }
  function renderPacks() {
    const packs = PACKS.filter(p => packTypes(p).length), groups = [...new Set(packs.map(p => p.group || 'More'))];
    packList.replaceChildren(...groups.map(g => {
      const list = packs.filter(p => (p.group || 'More') === g), have = list.filter(p => isInstalled(p.id)).length;
      if (!seenGroups.has(g)) { seenGroups.add(g); openGroups.add(g); }
      const d = el('details', 'pack-group'); d.dataset.group = g; d.open = openGroups.has(g);
      d.addEventListener('toggle', () => { if (d.open) openGroups.add(g); else openGroups.delete(g); });
      const grid = el('div', 'pack-grid'); grid.append(...list.map(packRow));
      d.append(el('summary', 'pack-group-head', `${g} · ${list.length} pack${list.length === 1 ? '' : 's'}${have ? ` · ${have} added` : ''}`), grid);
      return d;
    }), el('p', 'proj-note', 'Projects that already use a pack’s parts switch it on by themselves, so nothing is ever missing.'), el('p', 'proj-note', ''));
    packList.lastChild.id = 'packNote';
  }
  const packNote = msg => { const n = $('packNote'); if (n) n.textContent = msg; };
  onPacksChange(() => { renderPacks(); editor.emit('catalog'); });
  editor.on('open-packs', () => open());

  function open() { modal.hidden = false; renderPacks(); $('workspacesClose').focus(); }
  function close() { modal.hidden = true; }
  $('workspacesBtn').addEventListener('click', () => open());
  // Robotics, no drone on the bench yet: one tap builds and wires a whole drone circuit (the same builder the chat uses, no AI needed)
  const dronePrompt = el('div', 'drone-start'); dronePrompt.hidden = true;
  dronePrompt.append(el('b', '', 'Building a drone?'), el('span', '', 'Place and wire the parts for me:'));
  for (const [label, ask] of [['Small drone (AIO)', 'build a drone circuit'], ['5-inch drone (stack)', 'build a 5 inch drone'], ['Coreless brushed (ESP32-C3)', 'build a coreless brushed drone with an esp32']]) {
    const b = el('button', '', label); b.type = 'button';
    b.addEventListener('click', () => {
      const q = quickDrone(ask, editor.exportProject()); if (!q?.actions.length) return;
      const r = applyCircuitActions(editor.exportProject(), q.actions);
      editor.importProject({ format: FORMAT, version: VERSION, parts: r.parts, wires: r.wires });
      editor.status('Drone parts placed and wired. Next: build the frame in the Assembly tab.');
    });
    dronePrompt.append(b);
  }
  $('canvas')?.append(dronePrompt);
  const syncDronePrompt = () => { dronePrompt.hidden = activeWorkspace().id !== 'robotics' || (!!getRobotType() && getRobotType() !== 'drone') || editor.state.parts.some(p => /^custom-(drone-(aio|esc|fc|motor)|bmotor-|esp32-c3)/.test(p.type)); };
  onRobotType(() => syncDronePrompt()); editor.on('workspace', syncDronePrompt); projects.onSwitch(() => setTimeout(syncDronePrompt, 0)); syncDronePrompt();

  $('workspacesClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  return { open, close };
}
