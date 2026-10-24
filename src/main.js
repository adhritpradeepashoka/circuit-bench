import '@wokwi/elements';
import './styles.css';
import { Editor } from './ui/editor.js';
import { initSidebar } from './ui/sidebar.js';
import { Simulation } from './ui/simulation.js';
import { initBlocks } from './ui/blocks.js';
import { initFeatures } from './ui/features.js';
import { initClassroom } from './ui/classroom.js';
import { initCode } from './ui/code.js';
import { initResistorEditor } from './ui/resistor-editor.js';
import { initLedEditor } from './ui/led-editor.js';
import { initValueEditor } from './ui/value-editor.js';
import { initSettingsEditor } from './ui/settings-editor.js';
import { initPartCreator } from './ui/part-creator.js';
import './parts/elements.js';
import { initAiPanel } from './ui/ai-panel.js';
import { initProjects } from './ui/projects.js';
import { initMpuInspector } from './ui/mpu-inspector.js';
import { initTour } from './ui/tour.js';
import { initSettings } from './ui/settings.js';
import { initCommunity } from './ui/community.js';
import { applyTheme } from './ui/theme.js';
applyTheme();
import { initAccount } from './ui/account.js';
import { importPcbFile } from './ui/pcb-import.js';
import { initWorkspaces } from './ui/workspaces.js';
import { initVisualizer } from './ui/visualizer.js';
import { loadSavedWorkspaces } from './core/workspaces.js';
loadSavedWorkspaces();                  // your own and imported workspaces, and their parts, before any project opens
import { WOKWI_PINS } from './core/pins.generated.js';

const $ = id => document.getElementById(id);

// Wait until the web components are defined so their geometry can be sanity-checked and they render immediately.
await Promise.all(['wokwi-arduino-uno', 'wokwi-arduino-nano', 'wokwi-arduino-mega', 'wokwi-lcd1602', 'wokwi-dht22', 'cb-dc-motor', 'cb-l298n', 'cb-battery', 'cb-custom-part', 'wokwi-led', 'wokwi-resistor', 'wokwi-pushbutton', 'wokwi-mpu6050', 'wokwi-ssd1306'].map(t => customElements.whenDefined(t)));

// Dev safety net: the generated pin tables must match what the installed library reports.
for (const [tag, pins] of Object.entries(WOKWI_PINS)) {
  const live = document.createElement(tag).pinInfo || [];
  const same = live.length === pins.length && live.every((p, i) => p.name === pins[i].name && Math.abs(p.x - pins[i].x) < 0.01 && Math.abs(p.y - pins[i].y) < 0.01);
  if (!same) console.warn(`[virtual-lab] ${tag} pin geometry differs from src/core/pins.generated.js — run "npm run extract-pins".`);
}

const editor = new Editor();
initSidebar(editor);
const code = initCode();
const sim = new Simulation(editor, code);
const blocks = initBlocks({ editor, code });
code.setBoard(() => editor.getCircuit().uno.spec?.fqbn || null);
initPartCreator(editor);                 // registers "My parts" before any saved circuit that uses them loads
editor.init();
initResistorEditor(editor);
initLedEditor(editor);
initValueEditor(editor);
initSettingsEditor(editor);
initMpuInspector(editor);
const ai = initAiPanel(editor, code, sim);
const projects = initProjects({ editor, code, sim });
const workspaces = initWorkspaces({ editor, code, projects });
initVisualizer({ editor });
projects.onSwitch(p => ai.setScope(p.id));
const account = initAccount({ status: t => editor.status(t) });
initFeatures({ blocks });
initClassroom({ editor, code, projects, status: t => editor.status(t), refreshAccount: () => account.refresh() });
const tour = initTour({ editor, sim, code, projects });
initCommunity({ status: t => editor.status(t) });
initSettings({ tour, ai, status: t => editor.status(t) });
projects.ready.then(() => tour.maybeAutoStart());
$('simAskAi').addEventListener('click', e => { e.stopPropagation(); ai.askAi('Using the live readings, why is the circuit not doing what I expect? I expected: '); });

// The code dock starts on the lightweight editor; Monaco (a few hundred KB, loaded on demand) takes over the first time it's opened —
// unless you chose the simple editor, or Monaco fails to show your code (then we fall back automatically and remember that).
const EDITOR_KEY = 'virtual-lab:editor';
const pref = () => { try { return localStorage.getItem(EDITOR_KEY); } catch { return null; } };
const setPref = v => { try { localStorage.setItem(EDITOR_KEY, v); } catch { /* ignore */ } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function monacoShowsCode() {                       // did Monaco actually paint the project's main file?
  await sleep(350);
  const host = document.getElementById('codeMonaco');
  if (document.getElementById('codeDock').classList.contains('collapsed') || !code.source.trim()) return true;    // nothing to check
  return host.offsetHeight > 20 && (host.querySelector('.view-lines')?.textContent || '').trim().length > 0;
}
async function useMonaco() {
  try {
    const { createMonacoEditor } = await import('./ui/editors/monaco-editor.js');
    if (!code.setEditor(createMonacoEditor({ onRun: () => sim.toggle() }))) throw new Error('Monaco could not take over');
    if (!(await monacoShowsCode())) throw new Error('Monaco rendered nothing');
    setPref('monaco');
  } catch (err) {
    console.warn('[virtual-lab] Monaco is not usable here — using the simple editor. (Use the “Monaco editor” button to retry.)', err);
    code.useSimpleEditor(); setPref('simple');
  }
}
code.onFirstOpen(() => { if (pref() !== 'simple') useMonaco(); });
code.onEditorToggle(() => { if (code.editor.kind === 'monaco') { code.useSimpleEditor(); setPref('simple'); } else useMonaco(); });

// toolbar
$('selectTool').onclick = () => editor.setTool('select');
$('wireTool').onclick = () => editor.setTool('wire');
$('rotateTool').onclick = () => editor.rotateSelected();
$('deleteTool').onclick = () => editor.deleteSelected();
$('undoTool').onclick = () => editor.undo();
$('redoTool').onclick = () => editor.redo();
$('zoomIn').onclick = () => editor.zoomBy(1.25);
$('zoomOut').onclick = () => editor.zoomBy(0.8);
$('zoomFit').onclick = () => editor.fit();

// project menu
const menu = $('exportMenu');
const setMenu = open => { menu.hidden = !open; $('exportBtn').setAttribute('aria-expanded', String(open)); };
$('exportBtn').onclick = e => { e.stopPropagation(); setMenu(menu.hidden); };
document.addEventListener('click', e => { if (!e.target.closest('.project-menu')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
$('exportJson').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...editor.exportProject(), ...code.exportState() }, null, 2)], { type: 'application/json' }));
  a.download = `${(projects.current?.name || 'circuitbench-project').replace(/[^\w\- ]+/g, '').trim() || 'circuitbench-project'}.json`; a.click(); URL.revokeObjectURL(a.href);
  setMenu(false); editor.status('Project downloaded');
};
$('copyJson').onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify({ ...editor.exportProject(), ...code.exportState() }, null, 2)); editor.status('Project JSON copied to clipboard'); }
  catch { editor.status('Clipboard is not available in this browser context'); }
  setMenu(false);
};
$('importJson').onclick = () => { setMenu(false); $('importFile').click(); };
$('importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try { const data = JSON.parse(await file.text()); await projects.importFile(data, file.name.replace(/\.json$/i, '')); }
  catch (err) { editor.status(`Could not open that file: ${err.message}`); }
};
$('importPcb').onclick = () => { setMenu(false); $('importPcbFile').click(); };
$('importPcbFile').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) await importPcbFile(editor, file); };
$('newProject').onclick = () => { setMenu(false); projects.openModal({ focusNew: true }); };
$('openProjects').onclick = () => { setMenu(false); projects.openModal(); };

window.__vlab = { editor, sim, code, projects, workspaces, tour, account };   // handy in the browser console
