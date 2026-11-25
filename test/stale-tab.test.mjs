import test from 'node:test';
import assert from 'node:assert/strict';
import { watchStaleTab } from '../src/ui/stale-tab.js';

const fakeDoc = () => { const added = []; const mk = tag => ({ tag, children: [], style: {}, listeners: {}, setAttribute() {}, addEventListener(t, f) { this.listeners[t] = f; }, append(...c) { this.children.push(...c); } }); return { added, createElement: mk, body: { append: n => added.push(n) } }; };

test('a failed lazy chunk after a deploy shows one reload prompt, and the button reloads', () => {
  const handlers = {}, doc = fakeDoc(); let reloaded = 0;
  const win = { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: t => { delete handlers[t]; }, location: { reload: () => { reloaded++; } } };
  const stop = watchStaleTab({ win, doc }); assert.ok(handlers['vite:preloadError']);
  handlers['vite:preloadError'](); handlers['vite:preloadError'](); assert.equal(doc.added.length, 1, 'only one prompt');
  const bar = doc.added[0], btn = bar.children.find(c => c.tag === 'button'); assert.match(bar.children[0].textContent, /updated/); btn.listeners.click(); assert.equal(reloaded, 1);
  stop(); assert.equal(handlers['vite:preloadError'], undefined);
});
test('without a window it does nothing', () => { assert.equal(typeof watchStaleTab({ win: null, doc: null }), 'function'); });
