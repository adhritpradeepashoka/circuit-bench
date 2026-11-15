import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedback, createMemoryFeedbackStore, FEEDBACK_LIMITS } from '../server/feedback.mjs';

const accounts = { async me(t) { return t === 'admin' ? { email: 'boss@x.io', entitlements: { admin: true } } : t === 'kid' ? { email: 'kid@x.io', entitlements: {} } : null; } };

test('anyone can send feedback; the email is kept only when signed in', async () => {
  const fb = createFeedback({ store: createMemoryFeedbackStore(), accounts, now: () => 5 });
  assert.equal((await fb.send('', { text: 'hi' })).status, 400);                       // too short
  assert.ok((await fb.send('', { kind: 'problem', text: 'The LED does not light', page: 'electronics' })).ok);
  assert.ok((await fb.send('kid', { kind: 'nonsense', text: 'x'.repeat(5000) })).ok);
  const list = (await fb.list('admin')).feedback;
  assert.equal(list.length, 2);
  assert.deepEqual(list[1], { id: 1, kind: 'problem', text: 'The LED does not light', page: 'electronics', email: '', createdAt: 5 });
  assert.equal(list[0].email, 'kid@x.io'); assert.equal(list[0].kind, 'other'); assert.equal(list[0].text.length, FEEDBACK_LIMITS.text);
});

test('only admins can read or remove feedback', async () => {
  const fb = createFeedback({ store: createMemoryFeedbackStore(), accounts });
  await fb.send('', { text: 'an idea for you' });
  assert.equal((await fb.list('')).status, 403); assert.equal((await fb.list('kid')).status, 403); assert.equal((await fb.remove('kid', 1)).status, 403);
  assert.ok((await fb.remove('admin', 1)).ok); assert.equal((await fb.remove('admin', 1)).status, 404);
  assert.equal((await fb.list('admin')).feedback.length, 0);
});
