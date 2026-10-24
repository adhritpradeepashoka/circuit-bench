// The server-issued session (after Google sign-in): a token we send with requests, and what the server says this
// account may do. The server is the authority — everything here is only for showing the right buttons.
const TOKEN = 'circuitbench:session', ME = 'circuitbench:me';
const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
export const getToken = () => read(TOKEN) || '';
export function getMe() { try { return JSON.parse(read(ME) || 'null'); } catch { return null; } }
export function setSession(token, me) {
  try { token ? localStorage.setItem(TOKEN, token) : localStorage.removeItem(TOKEN); me ? localStorage.setItem(ME, JSON.stringify(me)) : localStorage.removeItem(ME); } catch { /* ignore */ }
  try { globalThis.dispatchEvent?.(new Event('cb-session')); } catch { /* ignore */ }
}
export const clearSession = () => setSession('', null);
export const hasHostedAi = (me = getMe()) => !!(me?.entitlements?.hostedAi && me.hostedAiReady);
/** A student can use their own personal profile (everything on) unless a class turned that off. 'class' or 'personal'. */
export const profileMode = () => (read('circuitbench:profile') === 'personal' ? 'personal' : 'class');
export function setProfileMode(mode) { try { mode === 'personal' ? localStorage.setItem('circuitbench:profile', 'personal') : localStorage.removeItem('circuitbench:profile'); } catch { /* ignore */ } try { globalThis.dispatchEvent?.(new Event('cb-session')); } catch { /* ignore */ } }
/** Fetch with the session token attached. */
export const authed = (path, { method = 'GET', body, fetchImpl = globalThis.fetch, token = getToken() } = {}) =>
  fetchImpl(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(profileMode() === 'personal' ? { 'x-cb-profile': 'personal' } : {}) }, body: body ? JSON.stringify(body) : undefined });
