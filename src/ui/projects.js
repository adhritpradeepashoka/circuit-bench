// "My projects": several saved projects instead of one autosaved workspace. The editor and code dock
// keep their own working copy (so a reload restores exactly where you were); this module ties that working
// copy to a named project, autosaves it into the store, and switches between projects.
// The store is swappable (src/core/projects.js): local now, cloud when signed in.
import { WORKSPACES, DEFAULT_WORKSPACE, newProject, uniqueName, cleanName, createLocalStore } from '../core/projects.js';
import { DEFAULT_SKETCH } from '../sim/examples.js';
import { fromProjectFile } from '../core/project.js';
import { PACKS, packTypes, isInstalled, onPacksChange } from '../core/packs.js';
import { PART_DEFS } from '../core/parts.js';
import { isMcuBoard } from '../core/boards.js';
import { setRobotType } from '../core/robot-context.js';
import { cleanRobotType } from '../core/robot-types.js';
import { getWorkspace } from '../core/workspaces.js';
import { EXAMPLES } from '../sim/examples.js';
import { getToken, authed } from '../sim/session.mjs';
import { initGallery } from './gallery.js';
import { benchThumb } from './thumb.js';

// Which project is open is per *tab* (sessionStorage), so two tabs can work on different projects without
// trading places; localStorage only remembers the last one opened, for the next new tab.
const LAST_KEY = 'circuitbench:current-project';
const TAB_KEY = 'circuitbench:tab-project';
const SAVE_DELAY = 600;
const THUMB = 'circuitbench:thumb:';

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

  const fillWorkspaces = () => {
    const keep = wsSelect.value;
    wsSelect.replaceChildren(...Object.entries(WORKSPACES).map(([id, w]) => {
      const o = document.createElement('option'); o.value = id; o.disabled = !w.available;
      o.textContent = w.available ? w.name : `${w.name} — coming soon`; return o;
    }));
    wsSelect.value = WORKSPACES[keep]?.available ? keep : DEFAULT_WORKSPACE;
    paintTiles();
  };
  // A small line icon for each kind of workspace (fixed markup, drawn here, no pictures to load)
  const WS_PATH = {
    'arduino-uno': '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
    robotics: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9 16.5h6"/>',
    bioelectronics: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    biosignal: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    pcb: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h4v4M11 13h5M16 9v.01M7 16h.01"/>',
    cad: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  };
  const wsIcon = id => { const i = document.createElement('i'); i.className = 'ws-ico'; i.setAttribute('aria-hidden', 'true'); i.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${WS_PATH[id] || '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>'}</svg>`; return i; };
  function paintTiles() {
    const host = $('projTiles'); if (!host) return;
    host.replaceChildren(...Object.entries(WORKSPACES).filter(([, w]) => w.available).map(([id, w]) => {
      const t = document.createElement('button'); t.type = 'button'; t.className = `proj-tile${wsSelect.value === id ? ' on' : ''}`; t.dataset.ws = id; t.setAttribute('role', 'radio'); t.setAttribute('aria-checked', String(wsSelect.value === id));
      const b = document.createElement('b'); b.textContent = w.name; const s = document.createElement('span'); s.textContent = w.blurb;
      t.append(wsIcon(id), b, s); t.addEventListener('click', () => { wsSelect.value = id; paintTiles(); $('projNewBoard').hidden = id === 'robotics'; nameInput.focus(); }); return t;
    }));
    $('projNewBoard').hidden = wsSelect.value === 'robotics';
  }
  let projQuery = '';
  $('projSearch').addEventListener('input', e => { projQuery = e.target.value.trim().toLowerCase(); renderList(); });
  fillWorkspaces();

  function paintName() { $('projectName').textContent = current?.name || 'Untitled project'; document.title = current ? `${current.name} — CircuitBench` : 'CircuitBench'; }

  /* ── saving ──────────────────────────── */
  async function saveNow() {
    clearTimeout(timer); timer = 0;
    if (!current || suspended) return;
    try { current = await store.save({ ...current, data: workingData(), updatedAt: Date.now() }); }
    catch { editor.status('Could not save the project — this browser\'s storage is full or blocked. Download it from the File menu to keep a copy.'); }
    if (!modal.hidden) renderList();
    saveThumb(current);
  }
  // a small picture of the bench for the home screen's project cards (kept beside, not inside, the project)
  let thumbAt = 0, thumbTimer = 0;
  async function saveThumb(p) {
    if (!p) return;
    if (Date.now() - thumbAt < 4000) { clearTimeout(thumbTimer); thumbTimer = setTimeout(() => saveThumb(current), 4200); return; }
    thumbAt = Date.now();
    const img = await benchThumb(editor);
    try { if (img) localStorage.setItem(THUMB + p.id, img); else if (!editor.state.parts.length) localStorage.removeItem(THUMB + p.id); } catch { /* storage full: the card just shows a plain tile */ }
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
      editor.openProject(p.data, { board: p.board });
      if (!code.importState(p.data || {})) code.importState({ sketch: DEFAULT_SKETCH });
    } finally { suspended = false; }
    current = p; setRobotType(cleanRobotType(p.robotType)); setCurrentId(p.id); paintName(); announce();
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

  async function create({ name, workspace = DEFAULT_WORKSPACE, data = null, board } = {}) {
    await saveNow();
    const taken = (await store.list()).map(m => m.name);
    const ws = getWorkspace(workspace), fresh = !data;
    if (!data && ws.starter?.project) data = JSON.parse(JSON.stringify(ws.starter.project));      // a workspace saved from a whole project starts as that project
    const p = newProject({ name: uniqueName(cleanName(name), taken), workspace, data });
    if (!data) { p.data = null; if (board) p.board = board; }
    await store.save(p);
    current = null;                  // open() should not re-save the project we're leaving twice
    await open(p.id);
    if (!data) {
      if (ws.starter?.extra?.length) editor.addStarter(ws.starter.extra);                                  // the workspace's own starting parts
      const ex = EXAMPLES[ws.starter?.sketch]; if (ex) code.importState({ sketch: ex.code });
      await saveNow();      // persist the fresh default circuit + sketch
    }
    if (ws.robotics && fresh) editor.emit?.('robotics-created');      // a new robot starts by asking what it is
    return current;
  }

  /** A project someone shared: make it a new project of mine (the original is never touched) and open it. */
  async function copyPublic({ name, workspace, data, scene }) {
    try { fromProjectFile(data); } catch { editor.status('That shared project is damaged, so it could not be copied.'); return null; }          // a bad file must not leave an empty project behind
    await saveNow();
    const taken = (await store.list()).map(m => m.name), ws = WORKSPACES[workspace] ? workspace : DEFAULT_WORKSPACE;
    const p = newProject({ name: uniqueName(cleanName(name), taken), workspace: ws, data });
    await store.save(p);
    try { if (scene) localStorage.setItem(`circuitbench:robot-scene:${p.id}`, JSON.stringify(scene)); } catch { /* the scene is a bonus */ }
    current = null; await open(p.id); return current;
  }
  /** Which of my projects are public (the server knows). */
  let shared = new Map(), handle = '';
  async function loadShared() {
    if (!getToken()) { shared = new Map(); return; }
    try { const r = await (await authed('/api/projects')).json(); if (r?.ok) shared = new Map(r.projects.filter(m => m.public).map(m => [m.id, true])); } catch { /* offline */ }
  }
  async function setShared(id, on) {
    if (!getToken()) { editor.status('Sign in to share a project. Public projects need an account so people know who made them.'); return; }
    await saveNow(); await (store.flush?.() ?? null);
    try {
      const r = await (await authed(`/api/projects/${encodeURIComponent(id)}/public`, { method: 'PUT', body: JSON.stringify({ public: on }) })).json();
      if (!r?.ok) { editor.status(r?.error || 'Could not change sharing.'); return; }
      if (on) shared.set(id, true); else shared.delete(id); handle = r.handle || handle;
      editor.status(on ? 'This project is public now: anyone can view it and copy it. Your own copy stays yours.' : 'This project is private again.');
    } catch { editor.status('Could not reach the server.'); }
    renderList();
  }

  async function duplicate(id) {
    if (id === current?.id) await saveNow();
    const src = await store.load(id); if (!src) return;
    const taken = (await store.list()).map(m => m.name);
    await store.save(newProject({ name: uniqueName(`${src.name} copy`, taken), workspace: src.workspace, data: src.data }));
    renderList();
  }

  async function remove(id, { quiet = false } = {}) {
    await store.remove(id); try { localStorage.removeItem(THUMB + id); } catch { /* ignore */ }
    if (id === current?.id) {
      current = null;
      const rest = await store.list();
      if (rest.length) await open(rest[0].id); else await create({ name: 'My first project' });
      if (!quiet) openModal();
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
    const all = await store.list(), items = projQuery ? all.filter(m => `${m.name} ${WORKSPACES[m.workspace]?.name || m.workspace}`.toLowerCase().includes(projQuery)) : all;
    $('projCount').textContent = all.length ? `(${all.length})` : '';
    const empty = $('projEmpty'); empty.hidden = !!items.length; empty.textContent = all.length ? `Nothing matches “${projQuery}”.` : 'No projects yet. Pick a kind above to start your first one.';
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
      main.append(el('span', 'proj-meta', `Edited ${ago(m.updatedAt)}`));
      const chip = el('span', 'proj-chip'); chip.append(wsIcon(m.workspace), document.createTextNode(WORKSPACES[m.workspace]?.name || m.workspace)); if (m.id === current?.id) chip.append(el('em', '', 'open now'));
      li.append(chip);
      const acts = el('div', 'proj-acts');
      const b = (act, label, title) => { const x = el('button', `proj-act ${act}`, label); x.type = 'button'; x.dataset.act = act; x.title = title; return x; };
      acts.append(b('share', shared.get(m.id) ? 'Public' : 'Share', shared.get(m.id) ? 'Anyone can view and copy this. Press to make it private again.' : 'Let anyone view and copy this project'),
        b('rename', 'Rename', 'Rename this project'), b('duplicate', 'Duplicate', 'Make a copy'),
        confirmDelete === m.id ? b('delete-yes', 'Delete for good?', 'This cannot be undone') : b('delete', 'Delete', 'Delete this project'));
      li.append(main, acts);
      li.style.setProperty('--tint', `hsl(${[...(m.workspace || '')].reduce((a, c) => a + c.charCodeAt(0) * 7, 40) % 360} 55% 50%)`);
      return li;
    }));
  }
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.closest('.proj-row')?.dataset.id, act = btn.dataset.act;
    if (act !== 'delete-yes') confirmDelete = null;
    if (act === 'open') open(id);
    else if (act === 'share') setShared(id, !shared.get(id));
    else if (act === 'rename') { renaming = id; renderList(); }
    else if (act === 'duplicate') duplicate(id);
    else if (act === 'delete') { confirmDelete = id; renderList(); }
    else if (act === 'delete-yes') { confirmDelete = null; remove(id); }
  });

  // The board picker offers the two built-in boards plus whatever the installed resource packs add.
  const boardSel = $('projNewBoard'), baseBoards = [...boardSel.options].map(o => o.value);
  const fillBoards = () => {
    const keep = boardSel.value;
    for (const o of [...boardSel.options]) if (!baseBoards.includes(o.value)) o.remove();
    for (const pack of PACKS) if (isInstalled(pack.id)) for (const t of packTypes(pack).filter(isMcuBoard)) { const o = document.createElement('option'); o.value = t; o.textContent = PART_DEFS[t].name; boardSel.append(o); }
    boardSel.value = [...boardSel.options].some(o => o.value === keep) ? keep : baseBoards[0];
  };
  fillBoards(); onPacksChange(fillBoards);

  function openModal({ focusNew = false } = {}) {
    fillWorkspaces(); modal.hidden = false; confirmDelete = null; renaming = null; projQuery = ''; $('projSearch').value = ''; renderList(); loadShared().then(renderList);
    (focusNew ? nameInput : $('projSearch')).focus();
  }
  function close() { modal.hidden = true; }
  // The quick switcher: a list under the project button, one click to change project (the full dialog stays for rename, copy and delete)
  const pop = el('div', 'proj-switch'); pop.hidden = true; pop.setAttribute('role', 'menu'); document.body.append(pop);
  const pbtn = $('projectBtn');
  let swConfirm = null;
  async function renderSwitch() {
    const items = await store.list(), ul = el('ul');
    for (const m of items) {
      const li = el('li', m.id === current?.id ? 'current' : ''), b = el('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.append(el('b', '', m.name), el('span', '', `${WORKSPACES[m.workspace]?.name || m.workspace} · edited ${ago(m.updatedAt)}${m.id === current?.id ? ' · open now' : ''}`));
      b.addEventListener('click', () => { closeSwitch(); open(m.id); }); li.append(b);
      // hover (or keyboard focus) shows a bin; the first click asks "Delete?", the second deletes for good
      const ask = swConfirm === m.id, del = el('button', `ps-del${ask ? ' ask' : ''}`); del.type = 'button';
      del.title = ask ? 'Click again to delete this project for good' : `Delete ${m.name}`; del.setAttribute('aria-label', del.title);
      if (ask) del.textContent = 'Delete?'; else del.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.4 4.5l.6 8.5h6l.6-8.5M6.8 7v4M9.2 7v4"/></svg>';
      del.addEventListener('click', async e => { e.stopPropagation(); if (swConfirm !== m.id) { swConfirm = m.id; await renderSwitch(); return; } swConfirm = null; await remove(m.id, { quiet: true }); await renderSwitch(); });
      del.addEventListener('mouseleave', () => { if (swConfirm === m.id) { swConfirm = null; renderSwitch(); } });
      li.append(del); ul.append(li);
    }
    const foot = el('div', 'ps-foot'), nw = el('button', 'ps-new', '+ New project'), all = el('button', '', 'Manage…');
    nw.type = all.type = 'button'; nw.addEventListener('click', () => { closeSwitch(); openModal({ focusNew: true }); }); all.addEventListener('click', () => { closeSwitch(); openModal(); });
    foot.append(nw, all); pop.replaceChildren(ul, foot);
    ul.querySelector('.current button')?.scrollIntoView?.({ block: 'nearest' });
  }
  function closeSwitch() { swConfirm = null; pop.hidden = true; pbtn.setAttribute('aria-expanded', 'false'); }
  async function openSwitch() {
    await saveNow(); await renderSwitch(); const r = pbtn.getBoundingClientRect();
    pop.hidden = false; pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`; pop.style.top = `${r.bottom + 6}px`;
    pbtn.setAttribute('aria-expanded', 'true'); (pop.querySelector('.current button') || pop.querySelector('button'))?.focus();
  }
  pbtn.addEventListener('click', () => (pop.hidden ? openSwitch() : closeSwitch()));
  document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && !pbtn.contains(e.target)) closeSwitch(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { closeSwitch(); pbtn.focus(); } });
  $('projectsClose').addEventListener('click', close);
  $('projGallery').addEventListener('click', () => gallery.open());
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  $('projNewForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = nameInput.value; nameInput.value = '';
    await create({ name: name.trim() || 'Untitled project', workspace: wsSelect.value, board: $('projNewBoard').value });
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

  const gallery = initGallery({ projects: { copyPublic }, status: t => editor.status(t) });
  return {
    /** Which kind of robot the open project is (arm, rover …), or null. Saved with the project. */
    async setRobotType(id) { if (!current) return; current = { ...current, robotType: cleanRobotType(id) }; setRobotType(current.robotType); await saveNow(); },
    ready, open, create, duplicate, remove, rename, saveNow, openModal, close, copyPublic, openGallery: () => gallery.open(),
    get current() { return current; },
    /** Called with the project whenever a different one is on screen (also once at start). */
    onSwitch(fn) { switchListeners.push(fn); if (current) fn(current); },
    /** Bring in a project file as a new project (rather than overwriting the open one). */
    importFile: async (data, name) => { fromProjectFile(data); return create({ name: name || 'Imported project', data }); },   // validate first: a bad file must not leave an empty project behind
  };
}
