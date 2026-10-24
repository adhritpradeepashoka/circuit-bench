// Classes in the page: the "what kind of account?" chooser, the teacher dashboard (students, course, switches) and the student
// dashboard (projects, hand in). Everything a person types is shown with textContent, never as markup. The server decides what is
// allowed; this file only asks and shows.
import { getMe, getToken, setSession, authed } from '../sim/session.mjs';
import { FEATURES, PRESETS, normCode } from '../core/classroom.js';
import { setTheme } from './theme.js';

const ENTERED = 'circuitbench:entered', KIDS_KEY = 'circuitbench:kids-default', ASKED_KEY = 'circuitbench:kind-asked', DASH_KEY = 'circuitbench:dash-shown', CURRENT_KEY = 'circuitbench:class-project', LAST_CLASS = 'circuitbench:last-class';
const lget = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };
const sget = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } };

export function initClassroom({ editor, code, projects, account = null, status = () => {}, fetchImpl = (...a) => globalThis.fetch(...a), refreshAccount = async () => {} } = {}) {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, cls, fn) => { const b = el('button', `cls-btn ${cls || ''}`, label); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
  const call = (path, opts) => authed(path, { fetchImpl, ...opts }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const kind = () => getMe()?.kind || '';
  const sayErr = r => status(r.body?.error || 'Something went wrong — try again.');

  /* ───────── account type ───────── */
  const screen = $('startScreen'), classBody = $('startBody'), kindBody = classBody, classModal = screen, INTENT = 'circuitbench:intent';
  let enterResolve; const entered = new Promise(r => { enterResolve = r; });
  const shown = () => !screen.hidden;
  /** Everyone starts at this menu; the bench is only reachable by leaving it. */
  function setBench(inert) { for (const c of document.body.children) if (c !== screen && c.tagName !== 'SCRIPT') c.inert = inert; }
  function enter() { screen.hidden = true; setBench(false); sset(ENTERED, '1'); enterResolve(); try { editor.fit?.(); } catch { /* ignore */ } }
  function showMenu() { screen.hidden = false; setBench(true); renderMenu(); }
  const closeKind = () => {};
  async function reloadMe() { await refreshAccount(); paintMenu(); }

  async function choose(k) {
    const r = await call('/api/account/kind', { method: 'POST', body: { kind: k } });
    if (!r.body?.ok) return sayErr(r);
    lset(ASKED_KEY, '1'); lset(INTENT, null); await reloadMe(); showMenu();
    status(k === 'teacher' ? 'Teacher account ready — make your first class.' : 'Account type saved.');
  }
  async function joinCode(code, { fromChooser = false } = {}) {
    const r = await call('/api/classes/join', { method: 'POST', body: { code: normCode(code) } });
    if (!r.body?.ok) return sayErr(r) ?? false;
    lset(ASKED_KEY, '1');
    if (!lget(KIDS_KEY)) { lset(KIDS_KEY, '1'); setTheme('kids'); }          // students start with the Kids look; they can change it unless the teacher locked it
    lset(INTENT, null); await reloadMe();
    status(`You joined ${r.body.class.name}.`); lset(LAST_CLASS, String(r.body.class.id)); openDashboard();
    return true;
  }
  function openKindChooser() { showMenu(); }
  function renderChooser() {
    const me = getMe(), intent = lget(INTENT);
    const canTeach = me.teacherSignup !== false || me.entitlements?.admin;
    kindBody.replaceChildren(el('h1', 'start-h', `Welcome, ${(me.name || me.email || '').split(' ')[0]}!`), el('p', 'start-sub', 'How will you use CircuitBench?'));
    const opts = el('div', 'kind-opts');
    const opt = (title, note, fn) => { const b = el('button', 'kind-opt'); b.type = 'button'; b.append(el('b', '', title), el('span', '', note)); b.addEventListener('click', fn); return b; };
    opts.append(opt('Just me', 'Build and code on your own.', () => choose('single')));
    if (canTeach) opts.append(opt('I’m a teacher', 'Make classes, share a join code, see your students’ progress and choose what they can use.', () => choose('teacher')));
    else opts.append(el('p', 'proj-note', 'Teacher accounts are not open for sign-up yet.'));
    const code = el('input'); code.placeholder = 'CLASS CODE'; code.maxLength = 8; code.setAttribute('aria-label', 'Class code');
    const join = btn('Join', 'primary', () => joinCode(code.value, { fromChooser: true }));
    code.addEventListener('keydown', e => { if (e.key === 'Enter') join.click(); });
    const stu = el('div', 'kind-opt'); stu.append(el('b', '', 'I’m a student'), el('span', '', 'Your teacher gave you a 6-letter class code.'));
    const row = el('div', 'kind-join'); row.append(code, join); stu.append(row);
    opts.append(stu); kindBody.append(opts);
    if (intent === 'student') setTimeout(() => code.focus(), 50);
  }
  function renderSignedOut() {
    kindBody.replaceChildren(el('h1', 'start-h', 'Welcome to CircuitBench'), el('p', 'start-sub', 'An electronics lab in your browser. Build real circuits, snap together blocks or write code, and watch it run.'));
    const opts = el('div', 'kind-opts');
    const opt = (title, note, fn) => { const b = el('button', 'kind-opt'); b.type = 'button'; b.append(el('b', '', title), el('span', '', note)); b.addEventListener('click', fn); return b; };
    opts.append(opt('Build on my own', 'No account needed. Start building straight away.', enter));
    if (account?.enabled !== false) {
      const need = who => () => { lset(INTENT, who); status('Sign in with Google (top right) to continue.'); const h = $('startAccount'); h.classList.add('nudge'); setTimeout(() => h.classList.remove('nudge'), 1800); };
      opts.append(opt('I’m a teacher', 'Sign in to make classes and follow your students’ progress.', need('teacher')), opt('I’m a student', 'Sign in, then enter the class code your teacher gave you.', need('student')));
    }
    kindBody.append(opts, el('p', 'proj-note', 'Signing in with Google is how CircuitBench knows who you are. Returning? Sign in at the top right to carry on where you left off.'));
  }
  function renderSingle() {
    const me = getMe();
    kindBody.replaceChildren(el('h1', 'start-h', `Hi ${(me.name || '').split(' ')[0] || 'there'}!`), el('p', 'start-sub', 'Your projects are ready on the bench.'));
    kindBody.append(btn('Open the bench →', 'primary big', enter));
  }
  function renderAccount() {
    const box = $('startAccount'), me = getMe(); box.replaceChildren();
    if (me) {
      const u = account?.user; const who = el('span', 'start-who', me.name || u?.name || me.email);
      box.append(who, btn('Sign out', '', () => { account?.signOut(); }));
    } else { const host = el('div'); box.append(host); account?.mountButton?.(host); }
  }
  function renderMenu() {
    renderAccount();
    const me = getMe();
    if (!me) return renderSignedOut();
    if (!me.kind) return lget(INTENT) === 'teacher' && (me.teacherSignup !== false || me.entitlements?.admin) ? (choose('teacher'), kindBody.replaceChildren(el('p', 'start-sub', 'Setting up your teacher account…'))) : renderChooser();
    if (me.kind === 'single') return renderSingle();
    return openDashboard();
  }
  $('startEnter').addEventListener('click', enter);
  for (const e of document.querySelectorAll('.brand-mark, .brand-name')) { e.style.cursor = 'pointer'; e.addEventListener('click', showMenu); }

  /* ───────── account menu ───────── */
  function paintMenu() {
    const box = $('accountClassItems'); if (!box) return; box.replaceChildren();
    box.append(menuItem('Main menu', showMenu));
    const me = getMe(); if (!me) return;
    if (me.kind === 'teacher') box.append(menuItem('Teacher dashboard', openDashboard));
    else if (me.kind === 'student') box.append(menuItem('My class', openDashboard));
    else if (!me.kind) box.append(menuItem('Teacher or student?', showMenu));
    else if (me.kind === 'single') box.append(menuItem('Join a class', () => status('Single-user accounts cannot join a class. Ask an admin to change your account type.')));
  }
  const menuItem = (label, fn) => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', () => { $('accountMenu').hidden = true; fn(); }); return b; };

  /* ───────── dashboards ───────── */
  const closeDash = enter;
  let teacherTab = 'students';

  async function openDashboard(id) {
    if (screen.hidden) { screen.hidden = false; setBench(true); renderAccount(); }
    classBody.replaceChildren(el('p', 'proj-note', 'Loading…'));
    const k = kind();
    const list = await call('/api/classes');
    if (!list.body?.ok) { classBody.replaceChildren(el('p', 'proj-note', list.body?.error || 'Could not load your classes.')); return; }
    const classes = list.body.classes;
    const want = Number(id) || Number(lget(LAST_CLASS)) || 0;
    const cur = classes.find(c => c.id === want) || classes[0] || null;
    if (cur) lset(LAST_CLASS, String(cur.id));
    if (k === 'teacher' || getMe()?.entitlements?.owner) return teacherView(classes, cur);
    return studentView(classes, cur);
  }
  const classPicker = (classes, cur, onPick) => {
    const sel = el('select'); sel.setAttribute('aria-label', 'Class');
    for (const c of classes) { const o = el('option', '', c.name); o.value = c.id; o.selected = c.id === cur?.id; sel.append(o); }
    sel.addEventListener('change', () => onPick(Number(sel.value))); return sel;
  };

  /* ── teacher ── */
  async function teacherView(classes, cur) {
    const bar = el('div', 'cls-bar'), title = el('h1', 'start-h', 'Teacher dashboard');
    if (cur) bar.append(classPicker(classes, cur, openDashboard));
    const nameIn = el('input'); nameIn.placeholder = 'New class name'; nameIn.maxLength = 60; nameIn.setAttribute('aria-label', 'New class name');
    bar.append(btn('＋ New class', 'primary', async () => {
      const r = await call('/api/classes', { method: 'POST', body: { name: nameIn.value || 'My class' } });
      if (!r.body?.ok) return sayErr(r); await reloadMe(); openDashboard(r.body.class.id);
    }), nameIn);
    if (getMe()?.entitlements?.owner) bar.append(btn('Make a demo class', '', async () => { const r = await call('/api/classes/demo', { method: 'POST' }); if (!r.body?.ok) return sayErr(r); openDashboard(r.body.class.id); }));
    if (!cur) { classBody.replaceChildren(title, bar, el('div', 'cls-empty', 'Make your first class, then share its code with your students.')); return; }
    const r = await call(`/api/classes/${cur.id}`);
    if (!r.body?.ok) { classBody.replaceChildren(title, bar, el('p', 'proj-note', r.body?.error || 'Could not load the class.')); return; }
    const d = r.body;
    const code = el('span', 'cls-code', d.class.code); code.title = 'Students type this code to join';
    bar.append(code,
      btn('Copy', '', async () => { try { await navigator.clipboard.writeText(d.class.code); status('Class code copied'); } catch { status(`Class code: ${d.class.code}`); } }),
      btn('New code', '', async () => { if (!confirm('Make a new join code? The old one stops working (students already in stay in).')) return; const x = await call(`/api/classes/${cur.id}/code`, { method: 'POST' }); if (x.body?.ok) openDashboard(cur.id); else sayErr(x); }),
      btn('Delete class', 'danger', async () => { if (!confirm(`Delete “${d.class.name}” and all its progress? This cannot be undone.`)) return; const x = await call(`/api/classes/${cur.id}`, { method: 'DELETE' }); if (x.body?.ok) { await reloadMe(); openDashboard(); } else sayErr(x); }));
    const tabs = el('div', 'cls-tabs');
    for (const [id, label] of [['students', `Students (${d.roster.length})`], ['course', 'Course'], ['settings', 'What students can use']]) {
      const b = el('button', 'cm-tab', label); b.type = 'button'; b.setAttribute('aria-pressed', String(teacherTab === id)); b.addEventListener('click', () => { teacherTab = id; teacherView(classes, cur); }); tabs.append(b);
    }
    const pane = el('div');
    if (teacherTab === 'students') studentsPane(pane, d, cur);
    else if (teacherTab === 'course') coursePane(pane, d, cur);
    else settingsPane(pane, d, cur);
    classBody.replaceChildren(title, bar, tabs, pane);
  }
  const visible = d => d.curriculum.filter(p => !p.hidden);
  const done = x => x?.status === 'submitted' || x?.status === 'done';

  function studentsPane(pane, d, cur) {
    if (!d.roster.length) { pane.append(el('div', 'cls-empty', `No students yet. Give them the code ${d.class.code} — they choose “I’m a student” after signing in, or open My class in the account menu.`)); return; }
    const vis = visible(d), table = el('table', 'cls-table'), head = el('tr');
    for (const h of ['Student', 'Progress', 'Last hand-in', '']) head.append(el('th', '', h));
    table.append(head);
    for (const s of d.roster) {
      const n = vis.filter(p => done(s.progress[p.id])).length, last = Math.max(0, ...Object.values(s.progress).map(x => x.submittedAt || 0));
      const tr = el('tr', 'cls-student'); const nameCell = el('td'); nameCell.append(el('b', '', s.name), el('div', 'proj-meta', s.email));
      const pc = el('td'); const track = el('span', 'cls-bar-track'), fill = el('span', 'cls-bar-fill'); fill.style.width = `${vis.length ? Math.round(100 * n / vis.length) : 0}%`; track.append(fill); pc.append(track, document.createTextNode(`${n} / ${vis.length}`));
      const lc = el('td', '', last ? new Date(last).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
      const act = el('td'); act.append(btn('Remove', 'danger', async e => { e.stopPropagation(); if (!confirm(`Remove ${s.name} from this class?`)) return; const x = await call(`/api/classes/${cur.id}/students?email=${encodeURIComponent(s.email)}`, { method: 'DELETE' }); if (x.body?.ok) openDashboard(cur.id); else sayErr(x); }));
      tr.append(nameCell, pc, lc, act); tr.addEventListener('click', () => studentDetail(pane, d, cur, s)); table.append(tr);
    }
    pane.replaceChildren(table);
  }
  function studentDetail(pane, d, cur, s) {
    const back = btn('← All students', '', () => studentsPane(pane, d, cur)), list = el('div', 'cls-projects');
    visible(d).forEach((p, i) => {
      const pr = s.progress[p.id], row = el('div', 'cls-proj'); row.append(el('span', 'n', String(i + 1)));
      const mid = el('div'); mid.append(el('b', '', p.title), el('div', 'goal', p.goal)); row.append(mid);
      const act = el('div'); act.append(el('span', `cls-chip ${pr?.status || ''}`, pr ? pr.status : 'not started'));
      if (pr?.hasWork) {
        act.append(' ', btn('Open a copy', '', async () => {
          const w = await call(`/api/classes/${cur.id}/work?email=${encodeURIComponent(s.email)}&project=${encodeURIComponent(p.id)}`); if (!w.body?.ok) return sayErr(w);
          if (!w.body.data) return status('That hand-in has no circuit saved with it.');
          if (!confirm(`Open ${s.name}’s “${p.title}” as a new project of yours? Your own work is not changed.`)) return;
          try { await projects.importFile(w.body.data, `${s.name} – ${p.title}`); closeDash(); status('Opened a copy — you can look but the student’s own work is untouched.'); } catch (err) { status(`Could not open it: ${err.message}`); }
        }), ' ', btn('Mark done', '', () => review(cur, s, p, 'done')), ' ', btn('Send back', '', () => { const c = prompt('What should they change? (optional)') ?? null; if (c !== null) review(cur, s, p, 'returned', c); }));
      }
      row.append(act); if (pr?.comment) row.append(el('div', 'note', `Your note: ${pr.comment}`)); list.append(row);
    });
    pane.replaceChildren(back, el('h3', '', s.name), list);
    async function review(c, st, pj, status2, comment = '') { const x = await call(`/api/classes/${c.id}/review`, { method: 'POST', body: { email: st.email, projectId: pj.id, status: status2, comment } }); if (x.body?.ok) { await openDashboard(c.id); } else sayErr(x); }
  }

  function coursePane(pane, d, cur) {
    let cc = d.curriculum.map(p => ({ ...p })), unlock = d.class.unlock;
    const save = async () => { const r = await call(`/api/classes/${cur.id}`, { method: 'PATCH', body: { curriculum: cc, unlock } }); if (r.body?.ok) { cc = r.body.curriculum; status('Course saved'); draw(); } else sayErr(r); };
    const draw = () => {
      const top = el('div', 'cls-bar'); const sel = el('select'); sel.setAttribute('aria-label', 'How projects unlock');
      for (const [v, l] of [['linear', 'One at a time: finish a project to open the next'], ['open', 'Everything open from the start']]) { const o = el('option', '', l); o.value = v; o.selected = unlock === v; sel.append(o); }
      sel.addEventListener('change', () => { unlock = sel.value; save(); }); top.append(sel);
      const rows = el('div');
      cc.forEach((p, i) => {
        const row = el('div', 'cls-row'), vis = el('input'); vis.type = 'checkbox'; vis.checked = !p.hidden; vis.title = 'Show to students'; vis.setAttribute('aria-label', `Show ${p.title}`);
        vis.addEventListener('change', () => { p.hidden = !vis.checked; save(); });
        const mid = el('div'); mid.append(el('b', '', `${i + 1}. ${p.title}`), el('div', 'goal proj-meta', p.goal));
        const mv = el('div'); const up = btn('↑', '', () => { if (i) { [cc[i - 1], cc[i]] = [cc[i], cc[i - 1]]; save(); } }), dn = btn('↓', '', () => { if (i < cc.length - 1) { [cc[i + 1], cc[i]] = [cc[i], cc[i + 1]]; save(); } });
        up.disabled = !i; dn.disabled = i === cc.length - 1; mv.append(up, ' ', dn, ' ', btn('✕', 'danger', () => { if (confirm(`Remove “${p.title}” from this class’s course?`)) { cc.splice(i, 1); save(); } }));
        row.append(vis, mid, mv); rows.append(row);
      });
      const t = el('input'), g = el('input'); t.placeholder = 'Project title'; g.placeholder = 'What should the student make?'; t.maxLength = 80; g.maxLength = 400;
      const add = el('div', 'cls-add'); add.append(t, g, btn('＋ Add project', 'primary', () => { if (!t.value.trim()) return; cc.push({ id: `c${Date.now().toString(36)}`, title: t.value, goal: g.value, uses: [], kind: 'free', hidden: false }); save(); }));
      pane.replaceChildren(top, el('p', 'proj-note', 'This is your class’s own copy of the 30-project course. Untick to hide a project, reorder it, or add your own. Other classes are not affected.'), rows, add);
    };
    draw();
  }

  function settingsPane(pane, d, cur) {
    let s = JSON.parse(JSON.stringify(d.class.settings));
    const push = async patch => { const r = await call(`/api/classes/${cur.id}`, { method: 'PATCH', body: patch }); if (r.body?.ok) { s = r.body.class.settings; status('Saved'); draw(); } else sayErr(r); };
    const draw = () => {
      const presets = el('div', 'cls-presets');
      for (const [id, p] of Object.entries(PRESETS)) { const b = btn(p.label, '', () => push({ settings: { preset: id } })); b.title = p.note; b.setAttribute('aria-pressed', String(s.preset === id)); presets.append(b); }
      if (s.preset === 'custom') { const c = btn('Custom', ''); c.setAttribute('aria-pressed', 'true'); c.disabled = true; presets.append(c); }
      const list = el('div', 'cls-switches');
      for (const f of FEATURES) {
        const lab = el('label', 'cls-switch'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!s.features[f.id];
        cb.addEventListener('change', () => push({ settings: { features: { [f.id]: cb.checked } } }));
        const t = el('div'); t.append(el('b', '', f.label), el('span', '', f.note)); lab.append(cb, t); list.append(lab);
      }
      pane.replaceChildren(el('p', 'proj-note', 'The bench, wiring, Run, your students’ own projects and their assignments are always on. A student in more than one class gets the stricter choice.'), presets, list);
    };
    draw();
  }

  /* ── student ── */
  async function studentView(classes, cur) {
    const bar = el('div', 'cls-bar'), title = el('h1', 'start-h', 'My class');
    if (classes.length > 1 || cur) bar.append(classes.length ? classPicker(classes, cur, openDashboard) : '');
    const code = el('input'); code.placeholder = 'CLASS CODE'; code.maxLength = 8; code.setAttribute('aria-label', 'Class code'); code.style.cssText = 'text-transform:uppercase;letter-spacing:.12em;width:9em';
    const join = btn(classes.length ? 'Join another class' : 'Join', 'primary', () => joinCode(code.value)); code.addEventListener('keydown', e => { if (e.key === 'Enter') join.click(); });
    bar.append(code, join);
    if (!cur) { classBody.replaceChildren(title, bar, el('div', 'cls-empty', 'Type the code your teacher gave you to join your class.')); return; }
    const r = await call(`/api/classes/${cur.id}`);
    if (!r.body?.ok) { classBody.replaceChildren(title, bar, el('p', 'proj-note', r.body?.error || 'Could not load the class.')); return; }
    const d = r.body, n = d.projects.filter(p => done(p)).length;
    const head = el('div', 'cls-bar'); const track = el('span', 'cls-bar-track'), fill = el('span', 'cls-bar-fill'); fill.style.width = `${d.projects.length ? Math.round(100 * n / d.projects.length) : 0}%`; track.append(fill);
    head.append(el('b', '', `${d.class.name} · ${d.class.teacher}`), track, el('span', 'proj-meta', `${n} of ${d.projects.length} done`));
    head.append(btn('Leave class', 'danger', async () => { if (!confirm(`Leave ${d.class.name}? Your projects stay yours, but your hand-ins for this class are removed.`)) return; const x = await call(`/api/classes/${cur.id}/leave`, { method: 'POST' }); if (x.body?.ok) { clearCurrent(); await reloadMe(); openDashboard(); } else sayErr(x); }));
    const list = el('div', 'cls-projects'), current = getCurrent();
    d.projects.forEach((p, i) => {
      const row = el('div', `cls-proj ${p.status === 'locked' ? 'locked' : ''}`); row.append(el('span', 'n', String(i + 1)));
      const mid = el('div'); mid.append(el('b', '', p.title), el('div', 'goal', p.goal)); if (p.uses?.length) mid.append(el('div', 'uses', `You will need: ${p.uses.join(', ')}`)); row.append(mid);
      const act = el('div'); act.append(el('span', `cls-chip ${p.status}`, { todo: 'to do', locked: '🔒 locked', submitted: 'handed in', done: '✓ done', returned: 'try again' }[p.status] || p.status), ' ');
      if (p.open) {
        const isCur = current?.classId === cur.id && current?.projectId === p.id;
        if (!isCur && p.status !== 'done') act.append(btn(p.status === 'todo' ? 'Start' : 'Work on it', 'primary', () => startProject(cur, p)));
        if (isCur) act.append(btn('Hand in', 'primary', () => handIn()));
      }
      row.append(act); if (p.comment) row.append(el('div', 'note', `Teacher: ${p.comment}`)); list.append(row);
    });
    classBody.replaceChildren(title, bar, head, list);
  }

  /* ── working on a project ── */
  const getCurrent = () => { try { return JSON.parse(lget(CURRENT_KEY) || 'null'); } catch { return null; } };
  const pill = $('projPill');
  function clearCurrent() { lset(CURRENT_KEY, null); paintPill(); }
  function paintPill() {
    const c = getCurrent(); pill.replaceChildren();
    if (!c || kind() !== 'student') { pill.hidden = true; return; }
    pill.append(el('span', '', `Project ${c.n}: `), el('b', '', c.title), btn('Hand in', '', () => handIn()));
    pill.title = c.goal || ''; pill.hidden = false;
  }
  async function startProject(cls, p) {
    const k = { classId: cls.id, projectId: p.id, title: p.title, goal: p.goal, n: p.n || 0 };
    const all = (await call(`/api/classes/${cls.id}`)).body?.projects || []; k.n = all.findIndex(x => x.id === p.id) + 1;
    lset(CURRENT_KEY, JSON.stringify(k));
    try { await projects.create({ name: `${k.n}. ${p.title}` }); } catch { /* keep working in the current project */ }
    closeDash(); paintPill(); status(`Project ${k.n}: ${p.goal}`);
  }
  async function handIn() {
    const c = getCurrent(); if (!c) return;
    if (!confirm(`Hand in “${c.title}” to your teacher? They will see your circuit and code as it is now.`)) return;
    const data = { ...editor.exportProject(), ...code.exportState() };
    const r = await call(`/api/classes/${c.classId}/submit`, { method: 'POST', body: { projectId: c.projectId, data } });
    if (!r.body?.ok) return sayErr(r);
    clearCurrent(); status('Handed in! Your teacher can see it now.'); openDashboard(c.classId);
  }

  /* ───────── when to show what ───────── */
  function onSession() {
    paintMenu(); paintPill();
    if (shown()) renderMenu();                                // signing in or out while on the menu: the menu follows
  }
  globalThis.addEventListener?.('cb-session', onSession);
  account?.ready?.then(() => { if (shown() && !getMe()) renderMenu(); });      // once we know sign-in exists, the teacher and student cards appear
  showMenu();
  return { entered, enter, showMenu, openDashboard, openKindChooser, choose, joinCode, handIn, paintMenu };
}
