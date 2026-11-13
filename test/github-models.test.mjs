import test from 'node:test'; import assert from 'node:assert/strict';
import { parseGithubUrl, pickModels, rawUrl, listModels } from '../src/core/github-models.js';

test('GitHub links of every usual shape are understood', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/a/b'), { owner: 'a', repo: 'b', ref: '', path: '', file: false });
  assert.deepEqual(parseGithubUrl('github.com/a/b.git'), { owner: 'a', repo: 'b', ref: '', path: '', file: false });
  assert.deepEqual(parseGithubUrl('a/b'), { owner: 'a', repo: 'b', ref: '', path: '', file: false });
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/tree/main/cad/stl/'), { owner: 'a', repo: 'b', ref: 'main', path: 'cad/stl', file: false });
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/blob/dev/x/y.stl?raw=true'), { owner: 'a', repo: 'b', ref: 'dev', path: 'x/y.stl', file: true });
  assert.equal(parseGithubUrl('hello'), null); assert.equal(parseGithubUrl(''), null);
});
test('only model files inside the folder are listed', () => {
  const tree = [{ type: 'blob', path: 'cad/a.STL', size: 5 }, { type: 'blob', path: 'cad/sub/b.glb' }, { type: 'blob', path: 'cad/readme.md' }, { type: 'blob', path: 'other/c.stl' }, { type: 'tree', path: 'cad/d.stl' }];
  assert.deepEqual(pickModels(tree, 'cad').map(f => f.path), ['cad/a.STL', 'cad/sub/b.glb']);
  assert.equal(pickModels(tree).length, 3);
});
test('raw links escape names; listing uses the default branch when none is given', async () => {
  assert.equal(rawUrl({ owner: 'a', repo: 'b', ref: 'main' }, 'x y/z.stl'), 'https://raw.githubusercontent.com/a/b/main/x%20y/z.stl');
  const seen = []; const f = async u => { seen.push(u); return { ok: true, status: 200, json: async () => (u.endsWith('/b') ? { default_branch: 'trunk' } : { tree: [{ type: 'blob', path: 'p.stl' }] }) }; };
  const r = await listModels({ owner: 'a', repo: 'b', ref: '', path: '' }, f);
  assert.equal(r.ref, 'trunk'); assert.equal(r.files.length, 1); assert.ok(seen[1].includes('/git/trees/trunk'));
  await assert.rejects(listModels({ owner: 'a', repo: 'b', ref: 'm', path: '' }, async () => ({ ok: false, status: 404 })), /cannot find/);
});
