// Find 3D models in a public GitHub repository so they can be imported. Pure parts (URL parsing, filtering, raw links) are tested; the two fetches use
// GitHub's public API (CORS-enabled, no sign-in; about 60 requests an hour per visitor) and raw.githubusercontent.com.
export const MODEL_EXT = /\.(stl|obj|glb|gltf)$/i;
export const MAX_LIST = 300;

/** "github.com/owner/repo", ".../tree/branch/some/folder", ".../blob/branch/file.stl", "owner/repo" -> { owner, repo, ref, path } or null */
export function parseGithubUrl(text) {
  let s = String(text || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\.git$/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (/^(raw\.githubusercontent\.com)\//i.test(s)) { const [, owner, repo, ref, ...rest] = s.split('/'); return owner && repo && ref ? { owner, repo, ref, path: rest.join('/'), file: MODEL_EXT.test(s) } : null; }
  s = s.replace(/^github\.com\//i, '');
  const p = s.split('/').filter(Boolean); if (p.length < 2 || !/^[\w.-]+$/.test(p[0]) || !/^[\w.-]+$/.test(p[1])) return null;
  const [owner, repo, kind, ref, ...rest] = p;
  if ((kind === 'tree' || kind === 'blob') && ref) return { owner, repo, ref, path: rest.join('/'), file: kind === 'blob' };
  if (kind && kind !== 'tree' && kind !== 'blob') return { owner, repo, ref: '', path: '', file: false };
  return { owner, repo, ref: '', path: '', file: false };
}

export const rawUrl = ({ owner, repo, ref }, path) => `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** the model files of a git tree listing, inside `path`, biggest folders last, capped */
export function pickModels(tree, path = '') {
  const pre = path ? path.replace(/\/+$/, '') + '/' : '';
  return (tree || []).filter(t => t.type === 'blob' && t.path.startsWith(pre) && MODEL_EXT.test(t.path)).map(t => ({ path: t.path, name: t.path.slice(t.path.lastIndexOf('/') + 1), size: t.size || 0 })).sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_LIST);
}

async function json(url, f) {
  const r = await f(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) throw new Error('GitHub cannot find that. Is the repository public, and is the link right?');
  if (r.status === 403 || r.status === 429) throw new Error('GitHub says too many requests from this network. Wait a few minutes and try again.');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
  return r.json();
}

/** @returns { ref, files: [{ path, name, size }], truncated } */
export async function listModels(target, f = fetch) {
  let ref = target.ref;
  if (!ref) ref = (await json(`https://api.github.com/repos/${target.owner}/${target.repo}`, f)).default_branch;
  if (target.file) { const name = target.path.slice(target.path.lastIndexOf('/') + 1); return { ref, files: MODEL_EXT.test(name) ? [{ path: target.path, name, size: 0 }] : [], truncated: false }; }
  const t = await json(`https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, f);
  return { ref, files: pickModels(t.tree, target.path), truncated: !!t.truncated };
}

/** download one model as a File */
export async function fetchModel(target, ref, file, f = fetch) {
  const r = await f(rawUrl({ ...target, ref }, file.path)); if (!r.ok) throw new Error(`Could not download ${file.name} (${r.status}).`);
  return new File([await r.arrayBuffer()], file.name);
}
