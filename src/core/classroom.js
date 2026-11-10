// Classroom rules, shared by the server (which enforces them) and the page (which only reflects them). Pure.
import { DEFAULT_CURRICULUM } from './curriculum.js';

export const KINDS = ['single', 'teacher', 'student'];

/** Everything a teacher can switch. Anything not listed (the bench, wiring, Run, a student's own projects, assignments) is always on. */
export const FEATURES = [
  { id: 'ai', label: 'AI helper', note: 'Chat that builds circuits and writes code.' },
  { id: 'community', label: 'Community and blog', note: 'Reading and posting public messages.' },
  { id: 'code', label: 'Typing code', note: 'Off = blocks only; the Code tab is hidden.' },
  { id: 'examples', label: 'Example sketches', note: 'Ready-made programs students could copy.' },
  { id: 'customParts', label: 'Making new parts', note: 'The part maker.' },
  { id: 'importFiles', label: 'Importing files', note: 'Bringing in files from outside, such as PCB files.' },
  { id: 'themes', label: 'Changing the look', note: 'Off = students keep the class look for class work.' },
  { id: 'share', label: 'Sharing and exporting', note: 'Downloading or copying projects out of the class.' },
  { id: 'wiring', label: 'Wiring in robotics', note: 'Off = the robot workspace is only the 3D build and the physics test, with no circuit and no wiring switch.' },
  { id: 'personal', label: 'Personal profile', note: 'Students can switch to their own profile, with everything on, for projects of their own. Hand-ins stay in the class profile.' },
];
export const FEATURE_IDS = FEATURES.map(f => f.id);
const set = on => Object.fromEntries(FEATURE_IDS.map(id => [id, on.includes(id)]));
export const PRESETS = {
  focused: { label: 'Focused', note: 'The bench, blocks and code, the look, and the assignments.', features: set(['code', 'themes', 'personal']) },
  standard: { label: 'Standard', note: 'Adds examples and the part maker.', features: set(['code', 'themes', 'personal', 'examples', 'customParts', 'wiring']) },
  everything: { label: 'Everything', note: 'Every feature on.', features: set(FEATURE_IDS) },
};
export const DEFAULT_PRESET = 'focused';

/** Who the class is for. The teacher says this when making the class; it picks the starting look and the starting assignments, and can be changed later. */
export const GRADES = [
  { id: 'g3-5', label: 'Grades 3–5', theme: 'kids' }, { id: 'g6-8', label: 'Grades 6–8', theme: 'kids' }, { id: 'g9-10', label: 'Grades 9–10', theme: 'classic' },
  { id: 'g11-12', label: 'Grades 11–12', theme: 'classic' }, { id: 'college', label: 'College or adult', theme: 'classic' },
];
export const LEVELS = [
  { id: 'new', label: 'New to electronics', note: 'Starts at the very first project.' },
  { id: 'some', label: 'Has tried a little', note: 'Skips the first few projects.' },
  { id: 'confident', label: 'Comfortable', note: 'Starts with the harder projects.' },
];
/** The looks a teacher may give a class (the team-only themes are never offered). */
export const CLASS_THEMES = ['kids', 'classic', 'contrast', 'hacker', 'techno'];
export const gradeOf = id => GRADES.find(g => g.id === id) || null;
/** The look a class gets: the teacher's pick, else the one that suits the grade, else Kids. */
export const classTheme = s => (CLASS_THEMES.includes(s?.theme) ? s.theme : gradeOf(s?.grade)?.theme || 'kids');
export const defaultSettings = () => ({ preset: DEFAULT_PRESET, features: { ...PRESETS[DEFAULT_PRESET].features }, unlock: 'linear', grade: null, level: null, theme: null });

/** Accepts anything from the network; returns a clean settings object (or the old one for the parts that are junk). */
export function cleanSettings(input, base = defaultSettings()) {
  const out = { preset: base.preset, features: { ...base.features }, unlock: base.unlock, grade: base.grade ?? null, level: base.level ?? null, theme: base.theme ?? null };
  if (input && typeof input === 'object') {
    if (PRESETS[input.preset]) { out.preset = input.preset; out.features = { ...PRESETS[input.preset].features }; }
    if (input.features && typeof input.features === 'object') {
      for (const id of FEATURE_IDS) if (typeof input.features[id] === 'boolean') out.features[id] = input.features[id];
      out.preset = Object.entries(PRESETS).find(([, p]) => FEATURE_IDS.every(id => p.features[id] === out.features[id]))?.[0] || 'custom';
    }
    if (input.unlock === 'linear' || input.unlock === 'open') out.unlock = input.unlock;
    if ('grade' in input) out.grade = gradeOf(input.grade) ? input.grade : null;
    if ('level' in input) out.level = LEVELS.some(l => l.id === input.level) ? input.level : null;
    if ('theme' in input) out.theme = CLASS_THEMES.includes(input.theme) ? input.theme : null;
  }
  return out;
}

/** A student in several classes gets the STRICTER setting: a feature is on only if every class allows it. */
export function mergeFeatures(list) {
  const out = {}; for (const id of FEATURE_IDS) out[id] = list.length ? list.every(s => s?.features?.[id]) : true;
  return out;
}
/** What a person may use: everyone who is not a student gets everything; a student with no class gets the Focused set. */
export const allOn = () => Object.fromEntries(FEATURE_IDS.map(id => [id, true]));

/* ── curriculum ── */
/** How many of the first projects a class at this level skips (they are hidden, and the teacher can unhide any). */
export const SKIP_FOR_LEVEL = { new: 0, some: 5, confident: 12 };
export const newCurriculum = (level = null) => DEFAULT_CURRICULUM.map((p, i) => ({ ...p, hidden: i < (SKIP_FOR_LEVEL[level] || 0) }));
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function cleanCurriculum(list, base = newCurriculum()) {
  if (!Array.isArray(list) || list.length > 100) return base;
  const seen = new Set(), out = [];
  for (const p of list) {
    const id = /^[a-z0-9_-]{1,24}$/i.test(p?.id) ? p.id : null; if (!id || seen.has(id)) continue; seen.add(id);
    const title = clip(p.title, 80), goal = clip(p.goal, 400); if (!title) continue;
    out.push({ id, title, goal, uses: Array.isArray(p.uses) ? p.uses.slice(0, 10).map(u => clip(u, 40)).filter(Boolean) : [], kind: clip(p.kind || 'free', 16), hidden: !!p.hidden });
  }
  return out.length ? out : base;
}

/** Which projects can a student open? `progress` = { projectId: status }; 'submitted' and 'done' both count as finished. */
export function openProjects(curriculum, progress, unlock) {
  const visible = curriculum.filter(p => !p.hidden), done = id => progress?.[id] === 'submitted' || progress?.[id] === 'done';
  let prev = true;
  return visible.map(p => { const open = unlock === 'open' || prev; prev = done(p.id); return { ...p, open, status: progress?.[p.id] || (open ? 'todo' : 'locked') }; });
}

export const randomCode = (rand = Math.random) => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(rand() * A.length)]; return s; };
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
