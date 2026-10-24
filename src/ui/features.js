// Hides what a student's teacher has switched off. This is only the page reflecting it: the server refuses AI and community
// requests from such students even if someone calls the API directly (server/classes.mjs).
import { getMe, profileMode } from '../sim/session.mjs';
import { FEATURE_IDS } from '../core/classroom.js';

export function offFeatures(me = getMe()) {
  if (me?.kind !== 'student') return [];
  const f = me.classroom?.features || {};
  if (f.personal && profileMode() === 'personal') return [];                // their own profile: everything on
  return FEATURE_IDS.filter(id => f[id] === false);
}
export function initFeatures({ blocks } = {}) {
  const apply = () => {
    const off = offFeatures(), root = document.documentElement;
    if (off.length) root.dataset.off = off.join(' '); else delete root.dataset.off;
    if (off.includes('code')) blocks?.setMode?.('blocks', { quiet: true });
  };
  globalThis.addEventListener?.('cb-session', apply); apply();
  return { apply };
}
