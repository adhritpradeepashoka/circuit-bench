// Hides what a student's teacher has switched off. This is only the page reflecting it: the server refuses AI and community
// requests from such students even if someone calls the API directly (server/classes.mjs).
import { getMe, profileMode } from '../sim/session.mjs';
import { FEATURE_IDS } from '../core/classroom.js';
import { offByAdmin, isBlocked } from '../core/permissions.js';

export function offFeatures(me = getMe()) {
  const admin = offByAdmin(me);                                             // limits set in the admin console always apply, in any profile
  if (me?.kind !== 'student') return admin;
  const f = me.classroom?.features || {};
  if (f.personal && profileMode() === 'personal') return admin;             // their own profile: everything the class turned off is on again
  return [...new Set([...admin, ...FEATURE_IDS.filter(id => f[id] === false)])];
}
/** An admin paused this account: the page says so and nothing underneath can be used. */
function paintBlocked(on, me) {
  let o = document.getElementById('blockedOverlay');
  if (!on) { o?.remove(); return; }
  if (!o) {
    o = document.createElement('div'); o.id = 'blockedOverlay'; o.className = 'blocked-overlay'; o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 'blockedTitle');
    const box = document.createElement('div'); box.className = 'blocked-box';
    const h = document.createElement('h2'); h.id = 'blockedTitle'; h.textContent = 'This account is blocked';
    const p = document.createElement('p'); p.id = 'blockedNote';
    box.append(h, p); o.append(box); document.body.append(o);
  }
  o.querySelector('#blockedNote').textContent = me?.permissions?.note ? `An admin blocked this account: ${me.permissions.note}` : 'An admin blocked this account. If that is a mistake, ask them to unblock it, and this page will open again by itself.';
}
export function initFeatures({ blocks } = {}) {
  const apply = () => {
    const off = offFeatures(), root = document.documentElement;
    if (off.length) root.dataset.off = off.join(' '); else delete root.dataset.off;
    if (off.includes('code')) blocks?.setMode?.('blocks', { quiet: true });
    paintBlocked(isBlocked(getMe()), getMe());
  };
  globalThis.addEventListener?.('cb-session', apply); apply();
  return { apply };
}
