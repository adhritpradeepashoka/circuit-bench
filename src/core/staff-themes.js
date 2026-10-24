// Themes only the team can wear. `tier` says who gets it automatically: 'owner' = the owner only, 'admin' = admins and the owner.
// The owner can also grant any of them to a particular person (stored on their account, see server/accounts.mjs).
// This is appearance only; the server decides who holds which theme and the page just reflects it.
export const STAFF_THEMES = [
  { id: 'founder',  tier: 'owner', label: 'Founder',  note: 'Black and gold. Only the owner (or someone the owner grants it to).' },
  { id: 'operator', tier: 'admin', label: 'Operator', note: 'Steel and amber control room. Admins and the owner.' },
];
export const STAFF_THEME_IDS = STAFF_THEMES.map(t => t.id);
/** Which staff themes a role gets by itself. */
export const themesForRole = role => STAFF_THEMES.filter(t => (t.tier === 'owner' ? role === 'owner' : role === 'owner' || role === 'admin')).map(t => t.id);
/** Role themes plus anything granted, as a clean list of known ids. */
export const themesFor = (role, granted = []) => [...new Set([...themesForRole(role), ...(granted || [])])].filter(id => STAFF_THEME_IDS.includes(id));
