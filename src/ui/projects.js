// "My projects": several saved projects instead of one autosaved workspace. The editor and code dock
// keep their own working copy (so a reload restores exactly where you were); this module ties that working
// copy to a named project, autosaves it into the store, and switches between projects.
// The store is swappable (src/core/projects.js): local now, cloud when signed in.
import { WORKSPACES, DEFAULT_WORKSPACE, newProject, uniqueName, cleanName, createLocalStore } from '../core/projects.js';
import { DEFAULT_SKETCH } from '../sim/examples.js';
import { fromProjectFile } from '../core/project.js';

// Which project is open is per *tab* (sessionStorage), so two tabs can work on different projects without
// trading places; localStorage only remembers the last one opened, for the next new tab.
const LAST_KEY = 'circuitbench:current-project';
const TAB_KEY = 'circuitbench:tab-project';
const SAVE_DELAY = 600;

const ago = (t, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString();
};

export function initProjects({ editor, code, sim = null, store = createLocalStore() }) {
  const $ = id => document.getElementById(id);
  const modal = $('projectsModal'), listEl = $('projList'), nameInput = $('projNewName'), wsSelect = $('projNewWorkspace');
  let current = null;          // the open project's record (without trusting its .data — the working copy is the truth)
  let timer = 0, suspended = false, confirmDelete = null, renaming = null;
  const getCurrentId = () => { try { return sessionStorage.getItem(TAB_KEY) || localStorage.getItem(LAST_KEY); } catch { return null; } };
  const setCurrentId = id => { try { sessionStorage.setItem(TAB_KEY, id); localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ } };
  const switchListeners = [];
  const announce = () => switchListeners.forEach(fn => fn(current));
  const workingData = () => ({ ...editor.exportProject(), ...code.exportState() });

  wsSelect.replaceChildren(...Object.entries(WORKSPACES).map(([id, w]) => {
    const o = document.createElement('option'); o.value = id; o.disabled = !w.available;
    o.textContent = w.available ? w.name : `${w.name} — coming soon`; return o;
  }));
  wsSelect.value = DEFAULT_WORKSPACE;

  function paintName() { $('projectName').textContent = current?.name || 'Untitled project'; document.title = current ? `${current.name} — CircuitBench` : 'CircuitBench'; }

  /* ── saving ──────────────────────────── */
  async function saveNow() {
    clearTimeout(timer); timer = 0;
    if (!current || suspended) return;
    try { current = await store.save({ ...current, data: workingData(), updatedAt: Date.now() }); }
    catch { editor.status('Could not save the project — this browser\'s storage is full or blocked. Download it from Export to keep a copy.'); }
    if (!modal.hidden) renderList();
  }
  const scheduleSave = () => { if (!current || suspended) return; clearTimeout(timer); timer = setTimeout(saveNow, SAVE_DELAY); };
  editor.on('workspace', scheduleSave);
  code.onChange(scheduleSave);
  window.addEventListener('pagehide', () => { if (timer) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) saveNow(); });

  /* ── switching ───────────────────────── */
  async function open(id) {
    if (current?.id === id) return close();
    await saveNow();
    const p = await store.load(id);
    if (!p) { editor.status('That project could not be opened.'); return renderList(); }
    show(p); close();
    editor.status(`Opened “${p.name}”`);
  }
  /** Put a stored project on screen. The store is the truth — never the shared working copy, which another tab may have written. */
  function show(p) {
    suspended = true;
    try {
      sim?.stop?.();
      editor.openProject(p.data);
      if (!code.importState(p.data || {})) code.importState({ sketch: DEFAULT_SKETCH });
    } finally { suspended = false; }
    current = p; setCurrentId(p.id); paintName(); announce();
  }

  // Another tab saved the project this tab has open. If we have nothing unsaved, follow it (both tabs then
  // show the same thing); if we do, keep ours and say so, rather than silently overwriting either side.
  window.addEventListener('storage', async e => {
    if (!current || e.key !== `circuitbench:project:${current.id}` || !e.newValue) return;
    let theirs; try { theirs = JSON.parse(e.newValue); } catch { return; }
    if ((theirs.updatedAt || 0) <= (current.updatedAt || 0)) return;
    if (timer) { editor.status(`“${current.name}” was also changed in another tab — your edits here will replace those when they save.`); return; }
    show(theirs); editor.status(`“${theirs.name}” was updated in another tab — showing the latest.`);
  });

  async function create({ name, workspace = DEFAULT_WORKSPACE, data = null } = {}) {
    await saveNow();
    const taken = (await store.list()).map(m => m.name);
    const p = newProject({ name: uniqueName(cleanName(name), taken), workspace, data });
    if (!data) p.data = null;
    await store.save(p);
    current = null;                  // open() should not re-save the project we're leaving twice
    await open(p.id);
    if (!data) await saveNow();      // persist the fresh default circuit + sketch
    return current;
  }

  async function duplicate(id) {
    if (id === current?.id) await saveNow();
    const src = await store.load(id); if (!src) return;
    const taken = (await store.list()).map(m => m.name);
    await store.save(newProject({ name: uniqueName(`${src.name} copy`, taken), workspace: src.workspace, data: src.data }));
    renderList();
  }

  async function remove(id) {
    await store.remove(id);
    if (id === current?.id) {
      current = null;
      const rest = await store.list();
      if (rest.length) await open(rest[0].id); else await create({ name: 'My first project' });
      openModal();
    } else renderList();
  }

  async function rename(id, name) {
    const p = id === current?.id ? { ...current, data: workingData() } : await store.load(id);
    if (!p) return;
    const saved = await store.save({ ...p, name: cleanName(name, p.name), updatedAt: Date.now() });
    if (id === current?.id) { current = saved; paintName(); }
    renderList();
  }

  /* ── the dialog ──────────────────────── */
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  async function renderList() {
    const items = await store.list();
    listEl.replaceChildren(...items.map(m => {
      const li = el('li', `proj-row${m.id === current?.id ? ' current' : ''}`); li.dataset.id = m.id;
      const main = el('div', 'proj-main');
      if (renaming === m.id) {
        const input = el('input', 'proj-rename'); input.value = m.name; input.maxLength = 80; input.setAttribute('aria-label', 'Project name');
        const done = ok => { renaming = null; if (ok && input.value.trim() && input.value.trim() !== m.name) rename(m.id, input.value); else renderList(); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
        input.addEventListener('blur', () => { if (renaming === m.id) done(true); });
        main.append(input); queueMicrotask(() => { input.focus(); input.select(); });
      } else {
        const openBtn = el('button', 'proj-open', m.name); openBtn.type = 'button'; openBtn.dataset.act = 'open';
        main.append(openBtn);
      }
      main.append(el('span', 'proj-meta', `${WORKSPACES[m.workspace]?.name || m.workspace} · edited ${ago(m.updatedAt)}${m.id === current?.id ? ' · open now' : ''}`));
      const acts = el('div', 'proj-acts');
      const b = (act, label, title) => { const x = el('button', `proj-act ${act}`, label); x.type = 'button'; x.dataset.act = act; x.title = title; return x; };
      acts.append(b('rename', 'Rename', 'Rename this project'), b('duplicate', 'Duplicate', 'Make a copy'),
        confirmDelete === m.id ? b('delete-yes', 'Delete for good?', 'This cannot be undone') : b('delete', 'Delete', 'Delete this project'));
      li.append(main, acts);
      return li;
    }));
  }
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.closest('.proj-row')?.dataset.id, act = btn.dataset.act;
    if (act !== 'delete-yes') confirmDelete = null;
    if (act === 'open') open(id);
    else if (act === 'rename') { renaming = id; renderList(); }
    else if (act === 'duplicate') duplicate(id);
    else if (act === 'delete') { confirmDelete = id; renderList(); }
    else if (act === 'delete-yes') { confirmDelete = null; remove(id); }
  });

  function openModal({ focusNew = false } = {}) {
    modal.hidden = false; confirmDelete = null; renaming = null; renderList();
    (focusNew ? nameInput : $('projectsClose')).focus();
  }
  function close() { modal.hidden = true; }
  $('projectBtn').addEventListener('click', () => openModal());
  $('projectsClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  $('projNewForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = nameInput.value; nameInput.value = '';
    await create({ name: name.trim() || 'Untitled project', workspace: wsSelect.value });
  });

  /* ── start: attach the working copy to a project ── */
  const ready = (async () => {
    const list = await store.list();
    const id = getCurrentId();
    if (!list.length) {
      current = newProject({ name: 'My first project', data: workingData() });   // first run, or an older single-workspace save
      await store.save(current).catch(() => {});
      setCurrentId(current.id); paintName(); announce();
      return current;
    }
    const p = (id && list.some(m => m.id === id) && await store.load(id)) || await store.load(list[0].id);
    if (p) show(p);
    return current;
  })();

  return {
    ready, open, create, duplicate, remove, rename, saveNow, openModal, close,
    get current() { return current; },
    /** Called with the project whenever a different one is on screen (also once at start). */
    onSwitch(fn) { switchListeners.push(fn); if (current) fn(current); },
    /** Bring in a project file as a new project (rather than overwriting the open one). */
    importFile: async (data, name) => { fromProjectFile(data); return create({ name: name || 'Imported project', data }); },   // validate first: a bad file must not leave an empty project behind
  };
}
