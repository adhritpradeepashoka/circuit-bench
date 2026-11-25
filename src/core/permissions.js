// What an admin lets one account do. Pure, and shared by the server (which enforces what it can: AI, community) and the page (which hides the rest).
// A person with no limits has full access. Limits only ever take things away; they never grant what a role does not already give.
import { FEATURES } from './classroom.js';

/** The switches an admin can turn off for one person: the classroom list, minus "personal profile" (that one only means something in a class). */
export const PERMISSION_FEATURES = FEATURES.filter(f => f.id !== 'personal');
export const PERMISSION_IDS = PERMISSION_FEATURES.map(f => f.id);
const WS_ID = /^[a-z0-9-]{1,60}$/;

/** { off: [feature ids that are turned off], workspace: the one workspace they are kept in (or null), blocked: access paused completely, note: why, for the admins }. Accepts anything; returns a clean object. */
export function cleanPerms(input) {
  const i = input && typeof input === 'object' ? input : {};
  return {
    off: [...new Set(Array.isArray(i.off) ? i.off.filter(id => PERMISSION_IDS.includes(id)) : [])],
    workspace: typeof i.workspace === 'string' && WS_ID.test(i.workspace) ? i.workspace : null,
    blocked: i.blocked === true,
    note: typeof i.note === 'string' ? i.note.trim().slice(0, 200) : '',
  };
}
export const hasLimits = p => { const c = cleanPerms(p); return c.off.length > 0 || !!c.workspace || c.blocked; };
/** The one workspace this account is kept in, or null. `me` is the /api/me object. */
export const lockedWorkspace = me => cleanPerms(me?.permissions).workspace;
export const isBlocked = me => cleanPerms(me?.permissions).blocked;
export const offByAdmin = me => cleanPerms(me?.permissions).off;

/** Ready-made sets for the console. */
export const PERMISSION_PRESETS = [
  { id: 'full', label: 'Full access', note: 'Everything their role gives.', perms: { off: [], workspace: null, blocked: false } },
  { id: 'robotics-tester', label: 'Robotics tester', note: 'Kept in Robotics (3D build, physics test, drone wiring). No AI helper, no community. Can still make parts and export.', perms: { off: ['ai', 'community'], workspace: 'robotics' } },
  { id: 'wiring-only', label: 'Wiring only', note: 'Kept in Electronics. No AI, community, code, examples or file import: the bench and the wires.', perms: { off: ['ai', 'community', 'code', 'examples', 'importFiles'], workspace: 'arduino-uno' } },
];
