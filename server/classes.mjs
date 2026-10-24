// Classes: a teacher makes a class and shares its join code; students join with the code. Teachers see their students' progress and
// handed-in work (read-only); each class has its own copy of the course and its own feature switches.
// Rules that matter, all enforced HERE (the page only reflects them):
//   · a student in several classes gets the STRICTER feature set (a feature is on only if every class allows it)
//   · a student's projects belong to the student; only what they hand in to a class is visible to that class's teacher
//   · only the teacher of a class (or the owner) can change it, read its roster or open handed-in work
import { FEATURE_IDS, defaultSettings, cleanSettings, cleanCurriculum, newCurriculum, openProjects, mergeFeatures, allOn, randomCode, normCode, PRESETS } from '../src/core/classroom.js';
import { normEmail } from './accounts.mjs';

const MAX_CLASSES_TEACHER = 20, MAX_CLASSES_STUDENT = 8, MAX_STUDENTS = 200, MAX_WORK = 400_000;
const fail = (status, error) => ({ ok: false, status, error });
const clipName = (s, d = 'My class') => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || d;

/* ───────── stores ───────── */
export function createMemoryClassStore() {
  let seq = 0; const classes = new Map(), members = new Map(), progress = new Map();   // members: id → Map(email → joinedAt); progress: `${id}|${email}|${pid}` → row
  return {
    kind: 'memory',
    async createClass({ code, teacher, name, data, now }) { const c = { id: ++seq, code, teacher, name, data, createdAt: now }; classes.set(c.id, c); members.set(c.id, new Map()); return { ...c }; },
    async getClass(id) { const c = classes.get(id); return c ? { ...c } : null; },
    async classByCode(code) { const c = [...classes.values()].find(x => x.code === code); return c ? { ...c } : null; },
    async classesOfTeacher(email) { return [...classes.values()].filter(c => c.teacher === email).map(c => ({ ...c })); },
    async setClass(id, { name, data }) { const c = classes.get(id); if (!c) return null; if (name !== undefined) c.name = name; if (data !== undefined) c.data = data; return { ...c }; },
    async setCode(id, code) { const c = classes.get(id); if (c) c.code = code; },
    async deleteClass(id) { classes.delete(id); members.delete(id); for (const k of [...progress.keys()]) if (k.startsWith(`${id}|`)) progress.delete(k); },
    async addMember(id, email, now) { const m = members.get(id); if (!m.has(email)) m.set(email, now); },
    async removeMember(id, email) { members.get(id)?.delete(email); for (const k of [...progress.keys()]) if (k.startsWith(`${id}|${email}|`)) progress.delete(k); },
    async members(id) { return [...(members.get(id) || [])].map(([email, joinedAt]) => ({ email, joinedAt })); },
    async classesOfStudent(email) { return [...classes.values()].filter(c => members.get(c.id)?.has(email)).map(c => ({ ...c })); },
    async progress(id) { return [...progress.entries()].filter(([k]) => k.startsWith(`${id}|`)).map(([, r]) => ({ email: r.email, projectId: r.projectId, status: r.status, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, comment: r.comment, hasWork: !!r.submission })); },
    async putProgress(id, email, projectId, patch) { const k = `${id}|${email}|${projectId}`; const cur = progress.get(k) || { email, projectId, status: 'todo', comment: '', submission: '' }; progress.set(k, { ...cur, ...patch }); },
    async submission(id, email, projectId) { return progress.get(`${id}|${email}|${projectId}`)?.submission || null; },
    async codeTaken(code) { return [...classes.values()].some(c => c.code === code); },
  };
}
export function createPgClassStore(pool) {
  const toClass = r => (r ? { id: Number(r.id), code: r.code, teacher: r.teacher, name: r.name, data: r.data, createdAt: Number(r.created_at) } : null);
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`create table if not exists cb_classes (id bigserial primary key, code text unique not null, teacher text not null, name text not null, data text not null default '{}', created_at bigint not null)`);
      await pool.query(`create table if not exists cb_class_members (class_id bigint not null references cb_classes(id) on delete cascade, email text not null, joined_at bigint not null, primary key (class_id, email))`);
      await pool.query(`create table if not exists cb_class_progress (class_id bigint not null references cb_classes(id) on delete cascade, email text not null, project_id text not null, status text not null default 'todo',
        submitted_at bigint, reviewed_at bigint, comment text not null default '', submission text not null default '', primary key (class_id, email, project_id))`);
      for (const t of ['cb_classes', 'cb_class_members', 'cb_class_progress']) { try { await pool.query(`alter table ${t} enable row level security`); } catch { /* not Postgres-proper (tests) */ } }
    },
    async createClass({ code, teacher, name, data, now }) { return toClass((await pool.query('insert into cb_classes (code, teacher, name, data, created_at) values ($1,$2,$3,$4,$5) returning *', [code, teacher, name, data, now])).rows[0]); },
    async getClass(id) { return toClass((await pool.query('select * from cb_classes where id = $1', [id])).rows[0]); },
    async classByCode(code) { return toClass((await pool.query('select * from cb_classes where code = $1', [code])).rows[0]); },
    async classesOfTeacher(email) { return (await pool.query('select * from cb_classes where teacher = $1 order by id', [email])).rows.map(toClass); },
    async setClass(id, { name, data }) { return toClass((await pool.query('update cb_classes set name = coalesce($2, name), data = coalesce($3, data) where id = $1 returning *', [id, name ?? null, data ?? null])).rows[0]); },
    async setCode(id, code) { await pool.query('update cb_classes set code = $2 where id = $1', [id, code]); },
    async deleteClass(id) { await pool.query('delete from cb_classes where id = $1', [id]); },
    async addMember(id, email, now) { await pool.query('insert into cb_class_members (class_id, email, joined_at) values ($1,$2,$3) on conflict do nothing', [id, email, now]); },
    async removeMember(id, email) { await pool.query('delete from cb_class_members where class_id = $1 and email = $2', [id, email]); await pool.query('delete from cb_class_progress where class_id = $1 and email = $2', [id, email]); },
    async members(id) { return (await pool.query('select email, joined_at from cb_class_members where class_id = $1 order by joined_at', [id])).rows.map(r => ({ email: r.email, joinedAt: Number(r.joined_at) })); },
    async classesOfStudent(email) { return (await pool.query('select c.* from cb_classes c join cb_class_members m on m.class_id = c.id where m.email = $1 order by c.id', [email])).rows.map(toClass); },
    async progress(id) { return (await pool.query("select email, project_id, status, submitted_at, reviewed_at, comment, submission <> '' as has_work from cb_class_progress where class_id = $1", [id])).rows.map(r => ({ email: r.email, projectId: r.project_id, status: r.status, submittedAt: r.submitted_at == null ? null : Number(r.submitted_at), reviewedAt: r.reviewed_at == null ? null : Number(r.reviewed_at), comment: r.comment, hasWork: r.has_work })); },
    async putProgress(id, email, projectId, p) {
      await pool.query(`insert into cb_class_progress (class_id, email, project_id, status, submitted_at, reviewed_at, comment, submission) values ($1,$2,$3,coalesce($4,'todo'),$5,$6,coalesce($7,''),coalesce($8,''))
        on conflict (class_id, email, project_id) do update set status = coalesce($4, cb_class_progress.status), submitted_at = coalesce($5, cb_class_progress.submitted_at), reviewed_at = coalesce($6, cb_class_progress.reviewed_at),
          comment = coalesce($7, cb_class_progress.comment), submission = coalesce($8, cb_class_progress.submission)`, [id, email, projectId, p.status ?? null, p.submittedAt ?? null, p.reviewedAt ?? null, p.comment ?? null, p.submission ?? null]);
    },
    async submission(id, email, projectId) { const r = (await pool.query('select submission from cb_class_progress where class_id = $1 and email = $2 and project_id = $3', [id, email, projectId])).rows[0]; return r?.submission || null; },
    async codeTaken(code) { return (await pool.query('select 1 from cb_classes where code = $1', [code])).rowCount > 0; },
  };
}

/* ───────── the rules ───────── */
export function createClasses({ store = createMemoryClassStore(), accounts, now = () => Date.now(), rand = Math.random } = {}) {
  const parse = c => { let d = {}; try { d = JSON.parse(c.data || '{}'); } catch { /* corrupt → defaults */ } return { ...c, settings: cleanSettings(d.settings), curriculum: cleanCurriculum(d.curriculum) }; };
  const pack = (settings, curriculum) => JSON.stringify({ settings, curriculum });
  const who = async token => { const a = await accounts.auth(token); return a ? { ...a, kind: a.row?.kind || '' } : null; };
  const nameOf = async email => { const r = await accounts.store.get(email); return { email, name: r?.name || email.split('@')[0], picture: r?.picture || '' }; };
  const mayTeach = (a, c) => a.role === 'owner' || (a.kind === 'teacher' && c.teacher === a.email);
  const own = async (token, id) => {
    const a = await who(token); if (!a) return { err: fail(401, 'Please sign in again.') };
    const c = await store.getClass(Number(id)); if (!c || !mayTeach(a, c)) return { err: fail(404, 'No such class.') };
    return { a, c: parse(c) };
  };
  const classLine = c => ({ id: c.id, name: c.name, code: c.code });

  /** What the page needs to know about this person's classes (part of /api/me). */
  async function forUser(email, kind) {
    if (kind === 'teacher') return { kind, classes: (await store.classesOfTeacher(email)).map(classLine), features: allOn() };
    if (kind === 'student') {
      const cs = (await store.classesOfStudent(email)).map(parse);
      return { kind, classes: cs.map(c => ({ id: c.id, name: c.name })), features: mergeFeatures(cs.length ? cs.map(c => c.settings) : [{ features: PRESETS.focused.features }]) };
    }
    return { kind, classes: [], features: allOn() };
  }
  /** For the gate on features that cost money or reach other people: false only for a student whose class(es) turned it off. */
  async function allowed(token, feature) {
    const a = await who(token); if (!a || a.kind !== 'student' || a.role === 'owner') return true;
    return !!(await forUser(a.email, 'student')).features[feature];
  }

  async function create(token, { name } = {}) {
    const a = await who(token); if (!a) return fail(401, 'Please sign in again.');
    if (a.kind !== 'teacher' && a.role !== 'owner') return fail(403, 'Only teacher accounts can make classes.');
    if ((await store.classesOfTeacher(a.email)).length >= MAX_CLASSES_TEACHER) return fail(400, `You can have up to ${MAX_CLASSES_TEACHER} classes.`);
    let code = ''; for (let i = 0; i < 20; i++) { const t = randomCode(rand); if (!(await store.codeTaken(t))) { code = t; break; } }
    if (!code) return fail(503, 'Could not make a join code — try again.');
    const c = await store.createClass({ code, teacher: a.email, name: clipName(name), data: pack(defaultSettings(), newCurriculum()), now: now() });
    return { ok: true, class: classLine(c) };
  }
  async function list(token) {
    const a = await who(token); if (!a) return fail(401, 'Please sign in again.');
    if (a.kind === 'teacher' || a.role === 'owner') {
      const cs = await store.classesOfTeacher(a.email);
      return { ok: true, kind: 'teacher', classes: await Promise.all(cs.map(async c => ({ ...classLine(c), students: (await store.members(c.id)).length }))) };
    }
    const cs = (await store.classesOfStudent(a.email)).map(parse);
    return { ok: true, kind: a.kind, classes: await Promise.all(cs.map(async c => {
      const prog = Object.fromEntries((await store.progress(c.id)).filter(r => r.email === a.email).map(r => [r.projectId, r.status]));
      const proj = openProjects(c.curriculum, prog, c.settings.unlock);
      return { id: c.id, name: c.name, done: proj.filter(p => p.status === 'submitted' || p.status === 'done').length, total: proj.length };
    })) };
  }
  async function view(token, id) {
    const a = await who(token); if (!a) return fail(401, 'Please sign in again.');
    const c0 = await store.getClass(Number(id)); if (!c0) return fail(404, 'No such class.');
    const c = parse(c0);
    if (mayTeach(a, c0)) {
      const ms = await store.members(c.id), prog = await store.progress(c.id);
      const roster = await Promise.all(ms.map(async m => ({ ...(await nameOf(m.email)), joinedAt: m.joinedAt, progress: Object.fromEntries(prog.filter(r => r.email === m.email).map(r => [r.projectId, { status: r.status, hasWork: r.hasWork, comment: r.comment, submittedAt: r.submittedAt }])) })));
      return { ok: true, role: 'teacher', class: { ...classLine(c), unlock: c.settings.unlock, settings: c.settings }, curriculum: c.curriculum, roster };
    }
    if (!(await store.members(c.id)).some(m => m.email === a.email)) return fail(404, 'No such class.');
    const rows = (await store.progress(c.id)).filter(r => r.email === a.email);
    const prog = Object.fromEntries(rows.map(r => [r.projectId, r.status])), notes = Object.fromEntries(rows.filter(r => r.comment).map(r => [r.projectId, r.comment]));
    return { ok: true, role: 'student', class: { id: c.id, name: c.name, teacher: (await nameOf(c.teacher)).name }, projects: openProjects(c.curriculum, prog, c.settings.unlock).map(p => ({ ...p, comment: notes[p.id] || '' })) };
  }
  async function patch(token, id, body = {}) {
    const { a, c, err } = await own(token, id); if (err) return err;
    const settings = body.settings !== undefined || body.unlock ? cleanSettings({ ...(body.settings || {}), unlock: body.unlock ?? body.settings?.unlock }, c.settings) : c.settings;
    const curriculum = body.curriculum !== undefined ? cleanCurriculum(body.curriculum, c.curriculum) : c.curriculum;
    const u = await store.setClass(c.id, { name: body.name !== undefined ? clipName(body.name, c.name) : undefined, data: pack(settings, curriculum) });
    return { ok: true, class: { ...classLine(u), settings }, curriculum };
  }
  async function remove(token, id) { const { c, err } = await own(token, id); if (err) return err; await store.deleteClass(c.id); return { ok: true }; }
  async function newCode(token, id) {
    const { c, err } = await own(token, id); if (err) return err;
    let code = ''; for (let i = 0; i < 20; i++) { const t = randomCode(rand); if (!(await store.codeTaken(t))) { code = t; break; } }
    if (!code) return fail(503, 'Could not make a join code — try again.');
    await store.setCode(c.id, code);
    return { ok: true, code };
  }

  async function join(token, rawCode) {
    const a = await who(token); if (!a) return fail(401, 'Please sign in again.');
    if (a.kind === 'teacher') return fail(403, 'This is a teacher account. Students join with their own account.');
    if (a.kind === 'single') return fail(403, 'Single-user accounts cannot join a class. Ask an admin to change your account type.');
    const code = normCode(rawCode); if (code.length !== 6) return fail(400, 'A class code has 6 letters and numbers.');
    const c = await store.classByCode(code); if (!c) return fail(404, 'No class has that code.');
    if (!a.kind) await accounts.store.setKind(a.email, 'student');
    const mine = await store.classesOfStudent(a.email);
    if (mine.some(x => x.id === c.id)) return { ok: true, class: { id: c.id, name: c.name }, already: true };
    if (mine.length >= MAX_CLASSES_STUDENT) return fail(400, `You can be in up to ${MAX_CLASSES_STUDENT} classes.`);
    if ((await store.members(c.id)).length >= MAX_STUDENTS) return fail(400, 'That class is full.');
    await store.addMember(c.id, a.email, now());
    return { ok: true, class: { id: c.id, name: c.name } };
  }
  async function leave(token, id) { const a = await who(token); if (!a) return fail(401, 'Please sign in again.'); await store.removeMember(Number(id), a.email); return { ok: true }; }
  async function removeStudent(token, id, email) { const { c, err } = await own(token, id); if (err) return err; await store.removeMember(c.id, normEmail(email)); return { ok: true }; }

  async function submit(token, id, { projectId, data, note } = {}) {
    const a = await who(token); if (!a) return fail(401, 'Please sign in again.');
    const c0 = await store.getClass(Number(id)); if (!c0 || !(await store.members(c0.id)).some(m => m.email === a.email)) return fail(404, 'No such class.');
    const c = parse(c0), prog = Object.fromEntries((await store.progress(c.id)).filter(r => r.email === a.email).map(r => [r.projectId, r.status]));
    const p = openProjects(c.curriculum, prog, c.settings.unlock).find(x => x.id === projectId);
    if (!p) return fail(404, 'No such project.'); if (!p.open) return fail(403, 'Finish the project before this one first.');
    const work = JSON.stringify({ data: data ?? null, note: String(note ?? '').slice(0, 500) });
    if (work.length > MAX_WORK) return fail(413, 'That project is too big to hand in.');
    await store.putProgress(c.id, a.email, projectId, { status: 'submitted', submittedAt: now(), submission: work, comment: '' });
    return { ok: true, status: 'submitted' };
  }
  async function review(token, id, { email, projectId, status, comment } = {}) {
    const { c, err } = await own(token, id); if (err) return err;
    if (!['done', 'returned', 'submitted'].includes(status)) return fail(400, 'Mark it done or send it back.');
    const e = normEmail(email); if (!(await store.members(c.id)).some(m => m.email === e)) return fail(404, 'No such student.');
    if (!c.curriculum.some(p => p.id === projectId)) return fail(404, 'No such project.');
    await store.putProgress(c.id, e, projectId, { status, reviewedAt: now(), comment: String(comment ?? '').slice(0, 500) });
    return { ok: true };
  }
  async function work(token, id, email, projectId) {
    const { c, err } = await own(token, id); if (err) return err;
    const raw = await store.submission(c.id, normEmail(email), String(projectId)); if (!raw) return fail(404, 'Nothing handed in yet.');
    try { return { ok: true, ...JSON.parse(raw) }; } catch { return fail(500, 'That work could not be read.'); }
  }

  /** Owner only: a class with pretend students, so the teacher view can be shown without real kids. */
  async function demo(token) {
    const a = await who(token); if (!a || a.role !== 'owner') return fail(403, 'Only the owner can make a demo class.');
    const made = await create(token, { name: 'Demo class' }); if (!made.ok) return made;
    const id = made.class.id, c = parse(await store.getClass(id)), names = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sara'];
    const vis = c.curriculum.filter(p => !p.hidden);
    for (let i = 0; i < names.length; i++) {
      const email = `demo-${names[i].toLowerCase()}@demo.invalid`; await accounts.store.login({ email, sub: `demo-${i}`, name: names[i], picture: '' }, now());
      await accounts.store.setKind(email, 'student'); await store.addMember(id, email, now());
      for (const p of vis.slice(0, [3, 7, 12, 5, 9, 1][i])) await store.putProgress(id, email, p.id, { status: 'submitted', submittedAt: now(), submission: JSON.stringify({ data: null, note: 'Demo work' }) });
    }
    return { ok: true, class: made.class };
  }

  accounts.setClassroom(forUser);
  return { create, list, view, patch, remove, newCode, join, leave, removeStudent, submit, review, work, demo, allowed, forUser, store };
}
