// "Sign in with Google" (Google Identity Services). Display-only for now: after you sign in, your name and
// picture show in the top bar. Nothing is sent to or stored on CircuitBench's server; the profile is kept in
// this browser only so it shows after a reload. The ID token is not verified server-side and is not used to
// authorize anything — when projects sync to the cloud, that is where verification belongs.
//
// The button only appears when the host provides a Google OAuth client ID (GOOGLE_CLIENT_ID → /api/config).

import { getToken, getMe, setSession, clearSession, authed } from '../sim/session.mjs';

const STORE = 'circuitbench:account';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** The readable part of a Google ID token (a JWT). */
export function decodeIdToken(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = decodeURIComponent([...atob(b64)].map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    const p = JSON.parse(json);
    return p && p.sub ? { sub: p.sub, name: p.name || '', given: p.given_name || p.name || '', email: p.email || '', picture: p.picture || '' } : null;
  } catch { return null; }
}

const loadScript = src => new Promise((resolve, reject) => {
  const s = document.createElement('script'); s.src = src; s.async = true; s.defer = true;
  s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google sign-in'));
  document.head.append(s);
});

export function initAccount({ fetchConfig = () => fetch('/api/config').then(r => r.json()), load = loadScript, status = () => {}, fetchImpl = (...a) => globalThis.fetch(...a), heartbeatMs = 60_000 } = {}) {
  const $ = id => document.getElementById(id);
  const slot = $('accountSlot'), menu = $('accountMenu');
  let user = null, google = null, enabled = false;
  try { user = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { user = null; }

  function paint() {
    slot.replaceChildren(); menu.hidden = true;
    if (user) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'account-btn'; btn.id = 'accountBtn';
      btn.title = `Signed in as ${user.email || user.name}`; btn.setAttribute('aria-haspopup', 'true');
      if (user.picture) { const img = document.createElement('img'); img.src = user.picture; img.alt = ''; img.referrerPolicy = 'no-referrer'; btn.append(img); }
      else { const i = document.createElement('i'); i.textContent = (user.given || '?')[0].toUpperCase(); btn.append(i); }
      const span = document.createElement('span'); span.textContent = user.given || user.name; btn.append(span);
      btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
      slot.append(btn);
      $('accountWho').textContent = user.name || '';
      const role = getMe()?.role; $('accountRole').textContent = role && role !== 'user' ? role : ''; $('accountRole').hidden = !(role && role !== 'user');
      $('accountEmail').textContent = user.email || '';
      slot.hidden = false;
    } else if (google) {
      const host = document.createElement('div'); host.className = 'gsi-host'; slot.append(host);
      google.accounts.id.renderButton(host, { type: 'standard', theme: 'filled_black', size: 'medium', shape: 'pill', text: 'signin', logo_alignment: 'left' });
      slot.hidden = false;
    } else slot.hidden = true;
  }

  function signedIn(resp) {
    const u = decodeIdToken(resp?.credential);
    if (!u) { status('Google sign-in did not return a usable profile.'); return; }
    user = u;
    try { localStorage.setItem(STORE, JSON.stringify(user)); } catch { /* ignore */ }
    paint(); status(`Signed in as ${user.name || user.email}`);
    serverSignIn(resp.credential);
  }
  /** Ask the server to verify the Google token and tell us this account's role. Failing is fine: the app works without it. */
  async function serverSignIn(credential) {
    try {
      const r = await fetchImpl('/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
      const b = await r.json();
      if (b?.ok) { setSession(b.token, { ...b.me, hostedAiReady: false }); await refresh(); paint(); if (b.me.role !== 'user') status(`Signed in as ${user?.name || b.me.email} · ${b.me.role}`); }
    } catch { /* offline or accounts disabled */ }
  }
  /** Re-read the role (it can change while you are signed in) and tell the server we are here. */
  async function refresh() {
    if (!user || !getToken()) return;
    try {
      const r = await authed('/api/presence', { method: 'POST', fetchImpl });
      if (r.status === 401) { clearSession(); paint(); return; }
      const b = await r.json(); if (b?.ok) { setSession(getToken(), b.me); paint(); }
    } catch { /* ignore */ }
  }
  if (heartbeatMs) setInterval(refresh, heartbeatMs);
  function signOut() {
    user = null; clearSession();
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
    google?.accounts.id.disableAutoSelect();
    paint(); status('Signed out');
  }
  $('accountSignOut').addEventListener('click', signOut);
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.account')) menu.hidden = true; });

  const ready = (async () => {
    paint(); refresh();                                       // a remembered user shows straight away
    let id = null;
    try { id = (await fetchConfig())?.googleClientId || null; } catch { id = null; }
    if (!id) { if (!user) slot.hidden = true; return; }
    enabled = true;
    try { await load(GIS_SRC); } catch { return; }            // offline / blocked: the rest of the app is unaffected
    google = globalThis.google;
    if (!google?.accounts?.id) return;
    google.accounts.id.initialize({ client_id: id, callback: signedIn, auto_select: false, cancel_on_tap_outside: true, ux_mode: 'popup' });
    paint();
  })();

  /** Draw the Google button somewhere else (the start menu). Does nothing when sign-in is not available. */
  const mountButton = host => ready.then(() => { if (google && !user) google.accounts.id.renderButton(host, { type: 'standard', theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left' }); });
  return { ready, signOut, refresh, mountButton, get enabled() { return enabled; }, get user() { return user; }, get me() { return getMe(); } };
}
