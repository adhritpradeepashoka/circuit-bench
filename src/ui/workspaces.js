// The Workspaces dialog: built-in workspaces, your own (saved from a project) and imported ones. Starting a project
// in a workspace gives it that workspace's starting board; the parts menu then leads with its sections.
import { BUILTIN_WORKSPACES, activeWorkspace, setActiveWorkspace, listWorkspaces, saveWorkspace, removeWorkspace, parseWorkspaceFile, workspaceFromProject, workspaceFile } from '../core/workspaces.js';
import { specsUsed } from '../core/custom-parts.js';
import { PACKS, packTypes, isInstalled, installPack, removePack, onPacksChange } from '../core/packs.js';
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
  const modal = $('workspacesModal'), list = $('wsList');
  const isBrandNew = p => !!p.createdAt && Date.now() - p.createdAt < 10 * 60_000;       // made in the last few minutes
  projects.onSwitch(p => { setActiveWorkspace(p.workspace); showHint(); editor.setHintAllowed(isBrandNew(p)); editor.emit('catalog'); });      // the parts menu leads with the open project's workspace

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, fn, title) => { const b = el('button', 'proj-act', label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; };

  function render() {
    const all = listWorkspaces(), groups = [['Built in', all.filter(w => w.builtin)], ['Mine & imported', all.filter(w => !w.builtin)]];
    list.replaceChildren(...groups.flatMap(([title, items]) => {
      const head = el('h3', 'ws-group', title);
      if (!items.length) return [head, el('p', 'proj-note', 'None yet — save a project as a workspace below, or import a workspace file.')];
      return [head, ...items.map(w => {
        const row = el('div', 'proj-row ws-row'), main = el('div', 'proj-main');
        main.append(el('b', '', w.name), el('span', 'proj-meta', `${w.blurb || 'No description'}${w.author && !w.builtin ? ` · by ${w.author}` : ''}${w.parts.length ? ` · ${w.parts.length} own part${w.parts.length > 1 ? 's' : ''}` : ''}`));
        const acts = el('div', 'proj-acts');
        acts.append(btn('New project', async () => { close(); await projects.create({ name: `${w.name} project`, workspace: w.id }); editor.status(`New ${w.name} project`); }, `Start a project in the ${w.name} workspace`));
        if (!w.builtin) {
          acts.append(btn('Export', () => download(w), 'Download this workspace as a file to share'), btn('Delete', () => { removeWorkspace(w.id); render(); editor.emit('catalog'); }, 'Remove this workspace (projects made in it keep working)'));
        }
        row.append(main, acts);
        return row;
      })];
    }));
  }
  function download(w) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([workspaceFile(w)], { type: 'application/json' }));
    a.download = `${w.id}.circuitbench-workspace.json`; a.click(); URL.revokeObjectURL(a.href);
    editor.status(`Workspace “${w.name}” downloaded`);
  }
  const note = msg => { $('wsNote').textContent = msg; };

  $('wsSaveForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('wsSaveName').value.trim();
    if (!name) return note('Give the workspace a name first.');
    const data = { ...editor.exportProject(), ...code.exportState() };
    const r = saveWorkspace(workspaceFromProject({ name, blurb: `Saved from “${projects.current?.name || 'a project'}”` }, data, specsUsed(editor.state.parts)));
    if (!r.ok) return note(r.errors.join(' '));
    $('wsSaveName').value = ''; render(); editor.emit('catalog'); note(`Saved “${r.workspace.name}”. Start a new project in it from the list.`);
  });
  $('wsImport').addEventListener('click', () => $('wsImportFile').click());
  $('wsImportFile').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const parsed = parseWorkspaceFile(await file.text());
    if (!parsed.ok) return note(`Could not import that file: ${parsed.errors.slice(0, 3).join(' ')}`);
    const r = saveWorkspace(parsed.workspace);
    if (!r.ok) return note(r.errors.join(' '));
    render(); editor.emit('catalog'); note(`Imported “${r.workspace.name}” — ${r.workspace.parts.length} part${r.workspace.parts.length === 1 ? '' : 's'}. Nothing in it can run code; parts are checked like any you make yourself.`);
  });

  /* ── resource packs (the second tab) ── */
  const packList = $('packList');
  function renderPacks() {
    packList.replaceChildren(...PACKS.filter(p => packTypes(p).length).map(pack => {
      const on = isInstalled(pack.id), row = el('div', `proj-row ws-row pack-card${on ? ' on' : ''}`), main = el('div', 'proj-main');
      main.append(el('b', '', pack.name), el('span', 'proj-meta', pack.blurb), el('span', 'proj-meta pack-parts', `Adds: ${packTypes(pack).map(t => PART_DEFS[t].name).join(', ')}`));
      const acts = el('div', 'proj-acts'), b = btn(on ? 'Remove' : 'Add pack', () => {
        if (on) {
          if (editor.state.parts.some(p => packTypes(pack).includes(p.type))) { editor.status(`${pack.name} is used on this bench — take those parts off first.`); packNote(`${pack.name} is used on this bench — take those parts off first.`); return; }
          removePack(pack.id);
        } else installPack(pack.id);
      }, on ? `Remove ${pack.name} from your parts menu` : `Add ${pack.name} to your parts menu`);
      b.classList.add('pack-btn'); b.dataset.pack = pack.id; b.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} the ${pack.name} pack`);
      acts.append(b); row.append(main, acts); return row;
    }), el('p', 'proj-note', 'Projects that already use a pack’s parts switch it on by themselves, so nothing is ever missing.'), el('p', 'proj-note', ''));
    packList.lastChild.id = 'packNote';
  }
  const packNote = msg => { const n = $('packNote'); if (n) n.textContent = msg; };
  onPacksChange(() => { renderPacks(); editor.emit('catalog'); });
  function showTab(name) {
    for (const t of modal.querySelectorAll('.ws-tabs [role="tab"]')) { const on = t.dataset.tab === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
    $('wsPaneWorkspaces').hidden = name !== 'workspaces'; $('wsPanePacks').hidden = name !== 'packs';
    if (name === 'packs') renderPacks(); else render();
  }
  for (const t of modal.querySelectorAll('.ws-tabs [role="tab"]')) {
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const o = [...modal.querySelectorAll('.ws-tabs [role="tab"]')].find(x => x !== t); o.focus(); showTab(o.dataset.tab); } });
  }
  editor.on('open-packs', () => open('packs'));

  function open(tab = 'workspaces') { modal.hidden = false; showTab(tab); (modal.querySelector('.ws-tabs [aria-selected="true"]') || $('workspacesClose')).focus(); }
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
  const syncDronePrompt = () => { dronePrompt.hidden = activeWorkspace().id !== 'robotics' || editor.state.parts.some(p => /^custom-(drone-(aio|esc|fc|motor)|bmotor-|esp32-c3)/.test(p.type)); };
  editor.on('workspace', syncDronePrompt); projects.onSwitch(() => setTimeout(syncDronePrompt, 0)); syncDronePrompt();

  $('workspacesClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  return { open, close, render };
}
