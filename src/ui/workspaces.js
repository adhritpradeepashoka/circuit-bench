// The Workspaces dialog: built-in workspaces, your own (saved from a project) and imported ones. Starting a project
// in a workspace gives it that workspace's starting board; the parts menu then leads with its sections.
import { setActiveWorkspace, listWorkspaces, saveWorkspace, removeWorkspace, parseWorkspaceFile, workspaceFromProject, workspaceFile } from '../core/workspaces.js';
import { specsUsed } from '../core/custom-parts.js';

export function initWorkspaces({ editor, code, projects }) {
  const $ = id => document.getElementById(id);
  const modal = $('workspacesModal'), list = $('wsList');
  projects.onSwitch(p => { setActiveWorkspace(p.workspace); editor.emit('catalog'); });      // the parts menu leads with the open project's workspace

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

  function open() { modal.hidden = false; render(); $('workspacesClose').focus(); }
  function close() { modal.hidden = true; }
  $('workspacesBtn').addEventListener('click', open);
  $('workspacesClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  return { open, close, render };
}
