import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch, isPrivateAddress, ogImage, findPhoto } from '../server/part-photo.mjs';
import { validatePartSpec } from '../src/core/custom-parts.js';
import { createAiService } from '../server/ai-service.mjs';

const resp = (body, type = 'image/jpeg', status = 200, extra = {}) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': type, ...extra }), arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body) : body).buffer });
const pub = async () => ['93.184.216.34'];

test('the photo fetcher refuses anything that is not a public https address', async () => {
  for (const bad of ['http://example.com/a.jpg', 'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://169.254.169.254/latest', 'https://[::1]/a.jpg', 'https://user:pw@example.com/a.jpg', 'https://example.com:8443/a.jpg', 'file:///etc/passwd', 'not a url', 'https://printer.local/a.jpg'])
    await assert.rejects(safeFetch(bad, { fetchImpl: async () => resp(new Uint8Array(10)), resolve: pub }), undefined, bad);
  await assert.rejects(safeFetch('https://sneaky.example.com/a.jpg', { fetchImpl: async () => resp(new Uint8Array(10)), resolve: async () => ['10.0.0.5'] }), /private/, 'a name that points inside is refused');
  assert.ok(isPrivateAddress('192.168.1.1') && isPrivateAddress('fd00::1') && isPrivateAddress('::ffff:127.0.0.1') && !isPrivateAddress('8.8.8.8'));
});
test('redirects are re-checked, size and type are limited', async () => {
  const hops = [];
  const r = await safeFetch('https://a.example.com/x', { resolve: pub, fetchImpl: async u => { hops.push(u); return hops.length === 1 ? { ...resp(''), status: 302, ok: false, headers: new Headers({ location: 'https://cdn.example.com/p.png' }) } : resp(new Uint8Array(50), 'image/png'); } });
  assert.equal(r.type, 'image/png'); assert.equal(hops.length, 2);
  await assert.rejects(safeFetch('https://a.example.com/x', { resolve: pub, fetchImpl: async () => ({ ...resp(''), status: 302, ok: false, headers: new Headers({ location: 'http://127.0.0.1/admin' }) }) }), /https/);
  await assert.rejects(safeFetch('https://a.example.com/x', { resolve: pub, fetchImpl: async () => resp('<html>', 'text/html') }), /type/);
  await assert.rejects(safeFetch('https://a.example.com/x', { resolve: pub, fetchImpl: async () => resp(new Uint8Array(5_000_000)) }), /big/);
});
test('og:image is read from a page, and findPhoto falls back from a bad image link to the page picture', async () => {
  assert.equal(ogImage('<head><meta content="/img/p.jpg" property="og:image"></head>', 'https://shop.example.com/p/1'), 'https://shop.example.com/img/p.jpg');
  const safe = async (u, o) => {
    if (u === 'https://bad.example.com/a.jpg') throw new Error('HTTP 404');
    if (u === 'https://shop.example.com/p/1') return { type: 'text/html', bytes: new TextEncoder().encode('<meta property="og:image" content="https://shop.example.com/i.jpg">'), url: u };
    if (u === 'https://shop.example.com/i.jpg') return { type: 'image/jpeg', bytes: new Uint8Array(5000), url: u };
    throw new Error('nope');
  };
  const hit = await findPhoto({ imageUrls: ['https://bad.example.com/a.jpg'], pageUrls: ['https://shop.example.com/p/1'], safe });
  assert.equal(hit.url, 'https://shop.example.com/i.jpg'); assert.equal(hit.type, 'image/jpeg');
  assert.equal(await findPhoto({ imageUrls: ['https://bad.example.com/a.jpg'], safe }), null);
});
test('a model that cannot see pictures still makes the part (drawn from the facts), and the photo is marked as not used', async () => {
  const sound = { name: 'Sound sensor', label: 'KY-038', color: '#2b6cb0', package: 'module', breadboard: true, pins: ['VCC', 'GND', 'AO', 'DO'].map(id => ({ id, side: 'bottom' })), behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'AO' } } };
  let calls = 0;
  const fetchImpl = async (_u, o) => {
    calls++; const b = JSON.parse(o.body), hasImg = b.contents[0].parts.length > 1;
    if (calls === 1) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"imageUrls":["https://example.com/p.jpg"]}\n```' }] } }] }) };
    if (hasImg) return { ok: false, status: 400, json: async () => ({ error: { message: 'Image input is not supported by this model' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(sound) + '\n```' }] } }] }) };
  };
  const ai = createAiService({ fetchImpl, photoFetch: async () => ({ type: 'image/jpeg', bytes: new Uint8Array(5000), url: 'https://example.com/p.jpg' }) });
  const r = await ai.createPart({ description: 'KY-038', userKey: 'k' });
  assert.equal(r.ok, true); assert.equal(r.photo.grounded, false);
});
test('robotics parts carry their robot data (menu section, kind, mass, size, voltage, price), cleaned', () => {
  const base = { name: 'SG90 servo', pins: [{ id: 'GND' }, { id: 'VCC' }, { id: 'SIG' }], behaviour: { kind: 'none' } };
  const v = validatePartSpec({ ...base, robot: { category: 'Motors', kind: 'servo', massGrams: 9, sizeMm: [22.2, 11.8, 31], supplyVolts: [4.8, 6], priceInr: 149.6, source: 'datasheet' } });
  assert.deepEqual(v.spec.robot, { category: 'Motors', kind: 'servo', source: 'datasheet', massGrams: 9, sizeMm: [22.2, 11.8, 31], supplyVolts: [4.8, 6], priceInr: 150 });
  const w = validatePartSpec({ ...base, robot: { category: '<b>x</b>', kind: 'laser', massGrams: -5, sizeMm: [1, 2], priceInr: 'free' } });
  assert.deepEqual(w.spec.robot, { category: 'Mechanics', kind: 'structure', source: 'estimated', massGrams: 0.01 });
  assert.equal(validatePartSpec(base).spec.robot, undefined);
});
