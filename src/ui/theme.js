// App themes. A theme is a set of CSS variables under html[data-theme]; "custom" lets you pick the colours and font.
// The choice lives in this browser only.
export const THEMES = [
  { id: 'classic', label: 'Classic', note: 'The standard dark bar and light bench.' },
  { id: 'kids', label: 'Kids', note: 'Bright colours, rounder and bigger buttons, friendlier look.' },
  { id: 'hacker', label: 'Hacker', note: 'Black screen, green terminal text, monospace everything.' },
  { id: 'techno', label: 'Techno', note: 'Deep purple with neon cyan and magenta.' },
  { id: 'contrast', label: 'High contrast', note: 'Strong black and white, easier to read.' },
  { id: 'custom', label: 'Custom', note: 'Pick your own colours and font.' },
];
export const FONTS = {
  default: { label: 'Default', css: '' },
  mono: { label: 'Monospace', css: 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace' },
  rounded: { label: 'Rounded', css: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
  serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
};
export const DEFAULT_CUSTOM = { bar: '#1b1f3b', bg: '#f4f1ea', text: '#222222', accent: '#e4572e', font: 'default' };
const KEY = 'virtual-lab:theme', CUSTOM_KEY = 'virtual-lab:theme-custom';
const HEX = /^#[0-9a-fA-F]{6}$/;
export const getTheme = () => { try { const t = localStorage.getItem(KEY); return THEMES.some(x => x.id === t) ? t : 'classic'; } catch { return 'classic'; } };
export function getCustom() {
  try { const c = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); return { ...DEFAULT_CUSTOM, ...Object.fromEntries(Object.entries(c).filter(([k, v]) => valid(k, v))) }; }
  catch { return { ...DEFAULT_CUSTOM }; }
}
const valid = (k, v) => k in DEFAULT_CUSTOM && (k === 'font' ? !!FONTS[v] : HEX.test(v));
export function setCustom(patch) { patch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => valid(k, v))); try { localStorage.setItem(CUSTOM_KEY, JSON.stringify({ ...getCustom(), ...patch })); } catch { /* ignore */ } applyTheme(); }
const VARS = ['--ink', '--ink-2', '--paper', '--text', '--blue', '--ui'];
export function applyTheme(id = getTheme(), root = document.documentElement) {
  for (const v of VARS) root.style.removeProperty(v);
  if (id === 'classic') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', id);
  if (id === 'custom') {
    const c = getCustom();
    root.style.setProperty('--ink', c.bar); root.style.setProperty('--ink-2', `color-mix(in srgb, ${c.bar} 88%, white)`);
    root.style.setProperty('--paper', c.bg); root.style.setProperty('--text', c.text); root.style.setProperty('--blue', c.accent);
    if (FONTS[c.font].css) root.style.setProperty('--ui', FONTS[c.font].css);
  }
}
export function setTheme(id) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } applyTheme(id); }
