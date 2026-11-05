import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, classTheme, newCurriculum, defaultSettings, GRADES } from '../src/core/classroom.js';

test('grade, experience and look are cleaned and kept', () => {
  const s = cleanSettings({ grade: 'g6-8', level: 'some', theme: 'contrast' }); assert.deepEqual([s.grade, s.level, s.theme], ['g6-8', 'some', 'contrast']);
  const bad = cleanSettings({ grade: 'nope', level: 'x', theme: 'operator' }, s); assert.deepEqual([bad.grade, bad.level, bad.theme], [null, null, null], 'junk clears them; team-only themes are not offered');
  assert.equal(cleanSettings({ unlock: 'open' }, s).grade, 'g6-8', 'a patch that leaves them out keeps them');
});
test('the look follows the teacher, then the grade, then Kids', () => {
  assert.equal(classTheme({ theme: 'techno', grade: 'g3-5' }), 'techno'); assert.equal(classTheme({ grade: 'g11-12' }), 'classic'); assert.equal(classTheme({ grade: 'g3-5' }), 'kids'); assert.equal(classTheme(defaultSettings()), 'kids');
  assert.ok(GRADES.every(g => g.theme));
});
test('a class that has tried a little skips the first projects, and the teacher can unhide them', () => {
  assert.equal(newCurriculum('new').filter(p => p.hidden).length, 0); assert.equal(newCurriculum('some').filter(p => p.hidden).length, 5); assert.ok(newCurriculum('confident')[11].hidden && !newCurriculum('confident')[12].hidden); assert.equal(newCurriculum().filter(p => p.hidden).length, 0);
});

import { createAccounts, createMemoryStore } from '../server/accounts.mjs';
import { createClasses, createMemoryClassStore } from '../server/classes.mjs';
test('a class made with a grade and level carries them, and its students are told the look', async () => {
  const accounts = createAccounts({ store: createMemoryStore(), ownerEmails: [], verifyGoogle: async c => ({ email: c.slice(5), sub: c, name: 'x', picture: '' }) }), classes = createClasses({ accounts, store: createMemoryClassStore() });
  const tok = async e => (await accounts.signIn(`good:${e}`)).token, t = await tok('t@x.com'), k = await tok('k@x.com'); await accounts.chooseKind(t, 'teacher'); await accounts.chooseKind(k, 'student');
  const made = await classes.create(t, { name: 'Six B', grade: 'g6-8', level: 'some', theme: 'contrast' }); assert.equal(made.ok, true);
  const d = await classes.view(t, made.class.id); assert.deepEqual([d.class.settings.grade, d.class.settings.level, d.class.settings.theme], ['g6-8', 'some', 'contrast']); assert.equal(d.curriculum.filter(p => p.hidden).length, 5);
  await classes.join(k, made.class.code);
  const me = await classes.forUser('k@x.com', 'student'); assert.equal(me.look.theme, 'contrast');
  await classes.patch(t, made.class.id, { settings: { theme: null } }); assert.equal((await classes.forUser('k@x.com', 'student')).look.theme, 'kids', 'no pick falls back to the grade (6–8 → Kids)');
});
