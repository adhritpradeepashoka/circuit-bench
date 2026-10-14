// Browser side of compiling: sends the sketch to the compile service (Arduino CLI) and returns the real build result.
// The bundled example sketches carry prebuilt firmware (built by the same toolchain), so they run with no service at all.
import { PREBUILT } from './prebuilt.generated.js';

/** Where the compile service lives: ?compiler=URL, window.VLAB_COMPILE_URL, or same-origin /api/compile. */
export function compileEndpoint(loc = globalThis.location, win = globalThis) {
  try { const q = new URLSearchParams(loc?.search || '').get('compiler'); if (q) return q.replace(/\/?$/, '/api/compile').replace(/\/api\/compile\/api\/compile$/, '/api/compile'); } catch { /* ignore */ }
  if (win.VLAB_COMPILE_URL) return win.VLAB_COMPILE_URL;
  return loc?.protocol === 'file:' ? null : '/api/compile';       // a page opened from disk has no same-origin service
}

const norm = s => s.replace(/\r\n?/g, '\n');

/** A sketch is one source string or a project: [{ name, content }] (first .ino is the main sketch). */
export const toFiles = input => (typeof input === 'string' ? [{ name: 'sketch.ino', content: input }] : input.map(f => ({ name: f.name, content: norm(f.content) })));

/**
 * @returns {Promise<{ok:boolean, hex?:string, output:string, diagnostics:Array, size?:object, prebuilt?:boolean,
 *                    cached?:boolean, ms?:number, unreachable?:boolean, error?:string}>}
 */
export async function compileSketch(input, { fetchImpl = globalThis.fetch, endpoint = compileEndpoint(), prebuilt = PREBUILT, signal } = {}) {
  const files = toFiles(input);
  const src = files.length === 1 ? norm(files[0].content) : null;          // prebuilt firmware exists for the bundled single-file examples
  const hit = src !== null && (prebuilt[src] || Object.entries(prebuilt).find(([k]) => norm(k) === src)?.[1]);
  if (hit) return { ok: true, hex: hit.hex, size: hit.size, output: hit.output, diagnostics: [], prebuilt: true, ms: 0 };

  if (!endpoint) {
    return unreachable('This page was opened from a file, so there is no compile service next to it.', `Either open the app from the running server (npm run server → http://127.0.0.1:8787),
or keep this file and point it at the service by adding  ?compiler=http://127.0.0.1:8787  to the address
(start the service with VLAB_CORS_ORIGIN=* so the browser allows it).`);
  }
  let res;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return unreachable(`Could not reach the compile service at ${endpoint}.`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!body) return unreachable(`The compile service at ${endpoint} did not answer with a build result (HTTP ${res.status}). Is it running?`);
  if (typeof body.ok !== 'boolean') return { ok: false, output: body.error || `HTTP ${res.status}`, diagnostics: [], error: body.error || `HTTP ${res.status}`, serviceError: true };
  return { diagnostics: [], output: '', ...body };
}

function unreachable(message, how = 'It has to be running while you use the app:\n\n  1. One-time setup: install Arduino CLI (https://arduino.github.io/arduino-cli/latest/installation/) and run\n         arduino-cli core install arduino:avr\n  2. In a second terminal, in the project folder, run\n         npm run server\n  3. Not sure it is set up? Run\n         npm run doctor') {
  return {
    ok: false, unreachable: true, diagnostics: [], error: message,
    output: `${message}\n\nCompiling needs the Arduino compile service (Arduino CLI + avr-gcc). ${how}\n\nThe bundled examples in the Examples menu run without it.`,
  };
}
