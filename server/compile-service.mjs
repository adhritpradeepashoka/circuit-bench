// Compile service: turns Arduino sketches into real firmware with Arduino CLI (avr-gcc + the official Arduino AVR core).
// Nothing here interprets or simplifies the language — it is the same toolchain the Arduino IDE uses.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

/** Boards the service will build for. The map is the extension point for Phase 6 (more MCU families). */
export const BOARDS = { 'arduino:avr:uno': { name: 'Arduino Uno', mcu: 'atmega328p', hexFile: 'ino.hex' } };
export const DEFAULT_FQBN = 'arduino:avr:uno';

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(ino|h|hpp|c|cpp)$/;
const LIMITS = { files: 24, totalBytes: 256 * 1024, outputChars: 60_000 };

/** Cheap guards so a sketch cannot make the compiler read or embed files from the host. (Run the service in a container too.) */
export function findForbidden(name, content) {
  const inc = /^\s*#\s*(?:include|include_next|import)\s*[<"]\s*([^>"\n]*)[>"]/gm;
  for (let m; (m = inc.exec(content));) {
    const p = m[1].trim();
    if (p.startsWith('/') || p.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(p) || /^[A-Za-z]:/.test(p)) return `${name}: #include paths must not be absolute or contain “..” (${p})`;
  }
  if (/\.(incbin|include)\b/.test(content)) return `${name}: inline-assembly file directives (.incbin / .include) are not allowed`;
  return null;
}

/** Normalise a request into { files:[{name,content}] } with exactly one main .ino. */
export function normaliseRequest(body) {
  if (!body || typeof body !== 'object') throw new RequestError('Send a JSON body: { sketch } or { files: [{ name, content }] }.');
  let files = body.files;
  if (files === undefined && typeof body.sketch === 'string') files = [{ name: 'sketch.ino', content: body.sketch }];
  if (!Array.isArray(files) || !files.length) throw new RequestError('No source files.');
  if (files.length > LIMITS.files) throw new RequestError(`Too many files (max ${LIMITS.files}).`);
  let total = 0; const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') throw new RequestError('Each file needs a string name and content.');
    if (!NAME_RE.test(f.name)) throw new RequestError(`Bad file name “${f.name}” (letters, digits, _ - . and an .ino/.h/.hpp/.c/.cpp extension).`);
    if (seen.has(f.name)) throw new RequestError(`Duplicate file “${f.name}”.`);
    seen.add(f.name); total += Buffer.byteLength(f.content);
    const bad = findForbidden(f.name, f.content);
    if (bad) throw new RequestError(bad);
  }
  if (total > LIMITS.totalBytes) throw new RequestError(`Sketch is too large (max ${LIMITS.totalBytes / 1024} KB).`, 413);
  const inos = files.filter(f => f.name.endsWith('.ino'));
  if (inos.length < 1) throw new RequestError('A sketch needs at least one .ino file.');
  const main = inos.find(f => f.name === 'sketch.ino') || inos[0];
  const fqbn = body.fqbn ?? DEFAULT_FQBN;
  if (!(fqbn in BOARDS)) throw new RequestError(`Unsupported board “${fqbn}”. Available: ${Object.keys(BOARDS).join(', ')}.`);
  return { files, main: main.name, fqbn };
}

/**
 * Split GCC output into diagnostics. Paths under the temp sketch folder become plain file names.
 * "sketch.ino:12:5: error: message" → { file, line, col, severity, message }
 */
export function parseDiagnostics(text, sketchDir = '') {
  const out = [], lines = text.split('\n');
  const re = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/;
  for (const raw of lines) {
    const line = sketchDir ? raw.split(`${sketchDir}/`).join('') : raw;
    const m = re.exec(line);
    if (!m) continue;
    if (sketchDir && m[1].includes('/')) continue;             // not under the sketch folder → a library / core file: raw output only
    const file = m[1].replace(/^.*\//, '');
    if (!NAME_RE.test(file)) continue;
    out.push({ file, line: Number(m[2]), col: m[3] ? Number(m[3]) : 1, severity: m[4] === 'fatal error' ? 'error' : m[4], message: m[5].trim() });
  }
  return out;
}

export function createCompiler(options = {}) {
  const env = options.env || process.env;
  const cfg = {
    cli: options.cli || env.ARDUINO_CLI || 'arduino-cli',
    timeoutMs: options.timeoutMs || 90_000,
    maxParallel: options.maxParallel || 2,
    cacheSize: options.cacheSize || 64,
    // Optional overrides for machines where the core/toolchain live in unusual places (see scripts/setup-toolchain.sh)
    compilerPath: options.compilerPath ?? env.AVR_GCC_DIR,          // directory containing avr-gcc, e.g. /usr/bin/
    ctagsPath: options.ctagsPath ?? env.ARDUINO_CTAGS_DIR,          // directory containing Arduino's ctags
    cacheDir: options.cacheDir || env.VLAB_BUILD_CACHE || join(tmpdir(), 'vlab-build-cache'),
  };
  const childEnv = { ...env, ARDUINO_UPDATER_ENABLE_NOTIFICATION: 'false' };
  const cache = new Map();          // sha256 → result (LRU by insertion order)
  let running = 0; const waiting = [];

  const slot = () => new Promise(resolve => { const go = () => { running++; resolve(() => { running--; waiting.shift()?.(); }); }; running < cfg.maxParallel ? go() : waiting.push(go); });

  function run(args, { cwd, timeout }) {
    return new Promise(resolve => {
      const child = spawn(cfg.cli, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', killed = false;
      const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);
      child.stdout.on('data', d => { if (stdout.length < 4e6) stdout += d; });
      child.stderr.on('data', d => { if (stderr.length < 4e6) stderr += d; });
      child.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err.message), killed, spawnError: err }); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, killed }); });
    });
  }

  async function version() {
    const r = await run(['version', '--format', 'json'], { timeout: 15_000 });
    try { return JSON.parse(r.stdout).VersionString || null; } catch { return null; }
  }

  /** @returns {Promise<{ok, hex?, output, diagnostics, size?, cached, ms}>} */
  async function compile(body) {
    const { files, main, fqbn } = normaliseRequest(body);
    const key = createHash('sha256').update(JSON.stringify([fqbn, main, files.map(f => [f.name, f.content]).sort()])).digest('hex');
    if (cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return { ...hit, cached: true, ms: 0 }; }

    const release = await slot();
    const started = Date.now();
    const root = await mkdtemp(join(tmpdir(), 'vlab-'));
    try {
      const sketchDir = join(root, 'sketch'), outDir = join(root, 'out');
      await mkdir(sketchDir); await mkdir(cfg.cacheDir, { recursive: true });
      // The Arduino builder needs <folder>/<folder>.ino
      for (const f of files) await writeFile(join(sketchDir, f.name === main ? 'sketch.ino' : f.name), f.content);
      const args = ['compile', '--fqbn', fqbn, '--warnings', 'default', '--format', 'json', '--output-dir', outDir, '--build-cache-path', cfg.cacheDir];
      if (cfg.compilerPath) args.push('--build-property', `compiler.path=${cfg.compilerPath.replace(/\/?$/, '/')}`);
      if (cfg.ctagsPath) args.push('--build-property', `runtime.tools.ctags.path=${cfg.ctagsPath}`);
      args.push(sketchDir);
      const r = await run(args, { cwd: root, timeout: cfg.timeoutMs });
      if (r.spawnError) throw new RequestError(`The Arduino CLI could not be started (${r.spawnError.code || r.spawnError.message}). Install it and make sure “${cfg.cli}” is on PATH.`, 503);
      if (r.killed) throw new RequestError('Compilation timed out.', 504);

      let json = null; try { json = JSON.parse(r.stdout); } catch { /* fall through to raw text */ }
      const clean = s => (s || '').split(`${sketchDir}/`).join('').split(root).join('').slice(0, LIMITS.outputChars);
      const text = json ? clean([json.compiler_out, json.compiler_err].filter(Boolean).join('')) : clean(r.stdout + r.stderr);
      const diagnostics = parseDiagnostics(json ? `${json.compiler_out || ''}\n${json.compiler_err || ''}` : r.stdout + r.stderr, sketchDir)
        .map(d => (d.file === 'sketch.ino' && main !== 'sketch.ino' ? { ...d, file: main } : d));
      const rename = s => (main === 'sketch.ino' ? s : s.split('sketch.ino').join(main));

      let result;
      if (json?.success) {
        const hex = await readFile(join(outDir, 'sketch.ino.hex'), 'utf8');
        const sec = Object.fromEntries((json.builder_result?.executable_sections_size || []).map(s => [s.name, s]));
        result = {
          ok: true, hex, output: rename(text), diagnostics,
          size: { flash: sec.text?.size ?? null, flashMax: sec.text?.max_size ?? null, ram: sec.data?.size ?? null, ramMax: sec.data?.max_size ?? null },
        };
      } else {
        const failText = rename(text) || clean(json?.error || r.stderr || 'Compilation failed.');
        result = { ok: false, output: failText, diagnostics, error: json?.error || 'Compilation failed.' };
      }
      result.fqbn = fqbn;
      cache.set(key, result); if (cache.size > cfg.cacheSize) cache.delete(cache.keys().next().value);
      return { ...result, cached: false, ms: Date.now() - started };
    } finally {
      release();
      rm(root, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { compile, version, config: cfg };
}
