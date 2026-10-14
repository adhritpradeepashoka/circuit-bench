// "Is my machine ready to compile?" — checks, in order: is the compile service already running, is Arduino CLI installed,
// and can it actually build a sketch for the Uno (which needs the AVR core + avr-gcc). Each failed check says how to fix it.

const INSTALL = {
  win32: 'Install Arduino CLI for Windows from https://arduino.github.io/arduino-cli/latest/installation/ (download the zip or installer, and make sure arduino-cli.exe is on your PATH), then open a NEW terminal.',
  darwin: 'Install it with Homebrew:  brew install arduino-cli   (or see https://arduino.github.io/arduino-cli/latest/installation/)',
  linux: 'Install it with:  curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh   (or see https://arduino.github.io/arduino-cli/latest/installation/). If downloads.arduino.cc is blocked on your network, use scripts/setup-toolchain.sh instead.',
};
const CORE_FIX = 'arduino-cli core update-index && arduino-cli core install arduino:avr';

/**
 * @param {{version: () => Promise<string|null>, compile: (b: object) => Promise<any>, config?: {cli?: string}}} compiler
 * @param {{platform?: string, healthUrl?: string, fetchImpl?: Function}} [opts]
 * @returns {Promise<Array<{ok: boolean, name: string, detail: string, fix?: string}>>}
 */
export async function checkToolchain(compiler, { platform = process.platform, healthUrl = 'http://127.0.0.1:8787/api/health', fetchImpl = globalThis.fetch } = {}) {
  const checks = [];

  // 1) is the service already up? (informational — it is what the browser actually talks to)
  try {
    const res = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(1500) });
    const j = await res.json();
    checks.push({ ok: !!j.ok, name: 'Compile service', detail: j.ok ? `running at ${healthUrl.replace('/api/health', '')} (Arduino CLI ${j.arduinoCli})` : 'answered, but Arduino CLI is not working (see below)' });
  } catch {
    checks.push({ ok: false, name: 'Compile service', detail: 'not running', fix: 'In a terminal in the project folder, run:  npm run server   (keep it open while you use the app)' });
  }

  // 2) Arduino CLI
  const version = await compiler.version();
  if (!version) {
    checks.push({ ok: false, name: 'Arduino CLI', detail: `“${compiler.config?.cli || 'arduino-cli'}” could not be run`, fix: INSTALL[platform] || INSTALL.linux });
    return checks;
  }
  checks.push({ ok: true, name: 'Arduino CLI', detail: `version ${version}` });

  // 3) a real build of the smallest possible sketch
  let r;
  try { r = await compiler.compile({ sketch: 'void setup() {}\nvoid loop() {}\n' }); } catch (err) { r = { ok: false, output: String(err?.message || err) }; }
  if (r.ok) checks.push({ ok: true, name: 'Arduino AVR core + avr-gcc', detail: `built a test sketch (${r.size?.flash ?? '?'} bytes of flash${r.cached ? ', cached' : `, ${r.ms} ms`})` });
  else {
    const text = String(r.output || r.error || '');
    const noCore = /platform not installed|not installed|Platform .* not found|unknown package|arduino:avr/i.test(text);
    checks.push({ ok: false, name: 'Arduino AVR core + avr-gcc', detail: text.split('\n').find(l => l.trim()) || 'the test build failed',
      fix: noCore ? `Install the Arduino AVR core once:  ${CORE_FIX}` : 'Read the message above; if it mentions a missing tool, reinstall the AVR core:  arduino-cli core install arduino:avr' });
  }
  return checks;
}

export function formatChecks(checks) {
  const lines = checks.map(c => `${c.ok ? '  ✓' : '  ✗'} ${c.name}: ${c.detail}${c.ok ? '' : `\n      → ${c.fix}`}`);
  const buildable = checks.filter(c => c.name !== 'Compile service').every(c => c.ok);
  const running = checks.find(c => c.name === 'Compile service')?.ok;
  lines.push('', buildable ? (running ? 'All good — the compile service is up. Reload the app and press Run.' : 'Your machine can compile. Now start the service:  npm run server') : 'Fix the ✗ items above, then run  npm run doctor  again.');
  return lines.join('\n');
}
