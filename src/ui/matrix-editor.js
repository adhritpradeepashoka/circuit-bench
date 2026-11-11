// Right-click an UNO Q or VENTUNO Q → a small panel for its 13 × 8 LED matrix: click or drag to draw, ready-made pictures, invert / clear, and scrolling text.
// The frame is a part property (saved with the project); scrolling is a live animation that leaves the last frame behind.
import { MATRIX_COLS, MATRIX_ROWS, MATRIX_LEDS, EMPTY_FRAME, decodeFrame, encodeFrame, fromRows, invert, PRESETS, scrollFrames } from '../core/matrix.js';

const TYPES = new Set(['arduino-uno-q', 'arduino-ventuno-q']);
/** Text → 8-pixel-tall columns, by drawing it on a canvas and keeping the dark pixels (empty where canvas is missing). */
export function rasterText(text) {
  try {
    const c = document.createElement('canvas'), ctx = c.getContext('2d'); if (!ctx) return [];
    ctx.font = 'bold 9px sans-serif'; const w = Math.min(600, Math.ceil(ctx.measureText(text).width) + 2); c.width = w; c.height = MATRIX_ROWS;
    const g = c.getContext('2d'); g.font = 'bold 9px sans-serif'; g.fillStyle = '#000'; g.textBaseline = 'alphabetic'; g.fillText(text, 1, 7);
    const d = g.getImageData(0, 0, w, MATRIX_ROWS).data, cols = [];
    for (let x = 0; x < w; x++) cols.push(Array.from({ length: MATRIX_ROWS }, (_, y) => (d[(y * w + x) * 4 + 3] > 110 ? 1 : 0)));
    return cols;
  } catch { return []; }
}

export function initMatrixEditor(editor) {
  const box = document.createElement('div'); box.className = 'part-editor matrix-editor'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'LED matrix');
  box.innerHTML = `<div class="mx-title">LED matrix · 13 × 8</div><div class="mx-grid" id="mxGrid"></div>
    <div class="mx-row" id="mxPresets"></div>
    <div class="mx-row"><button type="button" data-act="invert">Invert</button><button type="button" data-act="clear">Clear</button><button type="button" data-act="fill">All on</button></div>
    <div class="mx-row"><input id="mxText" type="text" maxlength="40" placeholder="Scroll some text…" aria-label="Text to scroll"><button type="button" data-act="scroll">Scroll</button><button type="button" data-act="stop" hidden>Stop</button></div>
    <p class="mx-note">This is the picture shown when nothing is running; while a sketch runs, it draws the matrix itself. Saved with your project.</p>`;
  document.body.append(box);
  const grid = box.querySelector('#mxGrid'), presets = box.querySelector('#mxPresets'), text = box.querySelector('#mxText'), scrollBtn = box.querySelector('[data-act="scroll"]'), stopBtn = box.querySelector('[data-act="stop"]');
  grid.style.setProperty('--cols', MATRIX_COLS);
  const cells = []; for (let i = 0; i < MATRIX_LEDS; i++) { const b = document.createElement('button'); b.type = 'button'; b.className = 'mx-cell'; b.dataset.i = i; b.setAttribute('aria-label', `LED row ${Math.floor(i / MATRIX_COLS) + 1}, column ${i % MATRIX_COLS + 1}`); grid.append(b); cells.push(b); }
  for (const name of Object.keys(PRESETS)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.dataset.preset = name; presets.append(b); }
  let partId = null, bits = decodeFrame(''), timer = 0, painting = null;
  const part = () => (partId ? editor.partById(partId) : null);
  const draw = () => cells.forEach((c, i) => c.classList.toggle('on', !!bits[i]));
  const save = (commit = true) => { editor.setPartProp(partId, 'matrix', encodeFrame(bits) === EMPTY_FRAME ? '' : encodeFrame(bits), { commit }); };
  const stop = () => { if (timer) { clearInterval(timer); timer = 0; } stopBtn.hidden = true; scrollBtn.hidden = false; if (partId) save(true); };
  const close = () => { stop(); box.hidden = true; partId = null; };
  const set = next => { bits = next; draw(); save(true); };
  function open({ part: p, clientX, clientY }) {
    if (!TYPES.has(p.type)) return;
    stop(); partId = p.id; bits = decodeFrame(p.matrix); draw(); box.hidden = false;
    const r = editor.canvas.getBoundingClientRect(), bw = box.offsetWidth || 300, bh = box.offsetHeight || 330;
    box.style.left = `${Math.max(8, Math.min(clientX + 10, innerWidth - bw - 8))}px`; box.style.top = `${Math.max(8, Math.min(clientY + 10, innerHeight - bh - 8))}px`;
    void r;
  }
  grid.addEventListener('pointerdown', e => { const b = e.target.closest('.mx-cell'); if (!b || !partId) return; stop(); const i = +b.dataset.i; painting = !bits[i]; bits = bits.map((v, k) => (k === i ? +painting : v)); draw(); save(false); grid.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  grid.addEventListener('pointerover', e => { if (painting === null) return; const b = e.target.closest('.mx-cell'); if (!b) return; const i = +b.dataset.i; if (bits[i] !== +painting) { bits = bits.map((v, k) => (k === i ? +painting : v)); draw(); save(false); } });
  addEventListener('pointerup', () => { if (painting !== null) { painting = null; if (partId) save(true); } });
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !partId) return;
    if (b.dataset.preset) { stop(); set(fromRows(PRESETS[b.dataset.preset])); return; }
    const act = b.dataset.act;
    if (act === 'invert') set(invert(bits)); else if (act === 'clear') set(new Array(MATRIX_LEDS).fill(0)); else if (act === 'fill') set(new Array(MATRIX_LEDS).fill(1));
    else if (act === 'stop') stop();
    else if (act === 'scroll') {
      const cols = rasterText(text.value.trim() || 'HELLO'); if (!cols.length) { editor.status('Scrolling text needs a browser with canvas.'); return; }
      const frames = scrollFrames(cols); let n = 0; stop(); scrollBtn.hidden = true; stopBtn.hidden = false;
      timer = setInterval(() => { if (!part()) return close(); bits = frames[n++ % frames.length]; draw(); save(false); if (n >= frames.length) stop(); }, 90);
    }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', e => { if (!box.hidden && !e.target.closest('.matrix-editor')) close(); }, true);
  editor.on('part-context', open);
  editor.on('workspace', () => { if (!box.hidden && !part()) close(); });
  return { isOpen: () => !box.hidden, close };
}
