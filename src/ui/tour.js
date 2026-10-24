import { mainBoard } from '../core/boards.js';
// First-visit tour + "Build it with me".
//
// Part 1 — the welcome tour: what CircuitBench is, then a popup pointing at each button and area in turn,
// ending with what you need for a first project. Part 2 — a guided first circuit (blink an LED): it lights up
// the exact part to add, the exact holes and pins to use, in order, and moves on by itself as soon as the
// circuit really is wired that way (checked on the live netlist, not on where you clicked).
//
// Shown automatically once per browser; the ? button in the top bar brings it back any time.
import { PART_DEFS } from '../core/parts.js';
import { pinWorld } from '../core/geometry.js';
import { pkey } from '../core/netlist.js';
import { sidePanes } from './side-panes.js';
import { getMe } from '../sim/session.mjs';
import { offFeatures } from './features.js';
// A student's teacher can switch features off; the tour must not point at things that are not there.
const off = id => offFeatures().includes(id);

const SEEN_KEY = 'circuitbench:tour-seen';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function initTour({ editor, sim, code, projects }) {
  const $ = id => document.getElementById(id);
  const panes = sidePanes(editor);
  const root = document.createElement('div');
  root.className = 'tour'; root.hidden = true;
  root.innerHTML = `<svg class="tour-dim" aria-hidden="true"><path fill-rule="evenodd"/></svg><div class="tour-rings"></div>
    <div class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tourTitle">
      <div class="tour-step" id="tourStep"></div><h3 id="tourTitle"></h3><div class="tour-body" id="tourBody"></div>
      <div class="tour-wait" id="tourWait" hidden><i></i><span>Waiting for you to do this…</span></div>
      <div class="tour-actions"><button type="button" class="tour-skip" id="tourSkip">Skip tour</button><span></span><button type="button" class="tour-back" id="tourBack">Back</button><button type="button" class="tour-next" id="tourNext">Next</button></div>
    </div>`;
  document.body.append(root);
  const card = root.querySelector('.tour-card'), dimPath = root.querySelector('.tour-dim path'), rings = root.querySelector('.tour-rings');

  let steps = [], i = 0, raf = 0, poll = 0, ctx = {}, blogClicked = false;
  document.addEventListener('click', e => { if (e.target.closest?.('.cm-blog-link')) { blogClicked = true; $('communityClose')?.click(); } });

  /* ── where things are on screen ──────── */
  const el = sel => (typeof sel === 'string' ? document.querySelector(sel) : sel);
  const rectOf = target => {
    const e = el(target);
    if (!e || e.hidden || !e.getClientRects().length) return null;
    const r = e.getBoundingClientRect();
    return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };
  /** A box around some world points (holes, pins) in screen pixels. */
  const worldRect = (points, pad = 7) => {
    const c = editor.canvas.getBoundingClientRect(), { x, y, z } = editor.view;
    const sx = points.map(p => c.left + p.x * z + x), sy = points.map(p => c.top + p.y * z + y);
    return { x: Math.min(...sx) - pad, y: Math.min(...sy) - pad, w: Math.max(...sx) - Math.min(...sx) + pad * 2, h: Math.max(...sy) - Math.min(...sy) + pad * 2 };
  };
  const bb = () => editor.state.parts.find(p => p.type === 'breadboard');
  const uno = () => mainBoard(editor.state.parts);
  const holes = (col, rows = 'ABCDE') => { const b = bb(); return b ? [...rows].map(r => pinWorld(b, `${r}${col}`)) : []; };
  const pinPt = (part, pin) => (part ? [pinWorld(part, pin)] : []);
  /** The breadboard column a part's lead is seated in, if any. */
  const seatedCol = (part, pin) => {
    if (!part) return null;
    const hole = editor.getCircuit().attachments.get(pkey(part.id, pin));
    const m = hole && /\|([A-J])(\d+)$/.exec(hole);
    return m ? { row: m[1], col: +m[2] } : null;
  };
  const net = (part, pin) => (part ? editor.getCircuit().netOf(part.id, pin) : null);

  /* ── drawing ─────────────────────────── */
  function layout() {
    const s = steps[i]; if (!s) return;
    const W = window.innerWidth, H = window.innerHeight;
    let spots = (typeof s.spots === 'function' ? s.spots() : (s.spots || [])).map(t => (t && typeof t === 'object' && !(t instanceof Element) && 'w' in t ? t : rectOf(t))).filter(Boolean);
    const pad = 6;
    spots = spots.map(r => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }));
    const rr = r => { const k = Math.min(10, r.w / 2, r.h / 2); return `M${r.x + k},${r.y}h${r.w - 2 * k}a${k},${k} 0 0 1 ${k},${k}v${r.h - 2 * k}a${k},${k} 0 0 1 -${k},${k}h-${r.w - 2 * k}a${k},${k} 0 0 1 -${k},-${k}v-${r.h - 2 * k}a${k},${k} 0 0 1 ${k},-${k}z`; };
    root.querySelector('.tour-dim').setAttribute('viewBox', `0 0 ${W} ${H}`);
    dimPath.setAttribute('d', `M0,0H${W}V${H}H0z ${spots.map(rr).join(' ')}`);
    root.classList.toggle('light', !!s.interactive);
    const ringHtml = spots.map(r => `<i style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></i>`).join('');
    if (rings.innerHTML !== ringHtml) rings.innerHTML = ringHtml;

    // card: beside the first spot (below, above, left, right — whichever fits), else centred
    const cw = card.offsetWidth || 340, ch = card.offsetHeight || 200, gap = 14, a = spots[0];
    let left = (W - cw) / 2, top = (H - ch) / 2, side = 'center';
    if (a && !s.center) {
      const tries = [
        ['bottom', a.x + a.w / 2 - cw / 2, a.y + a.h + gap, a.y + a.h + gap + ch < H - 8],
        ['top', a.x + a.w / 2 - cw / 2, a.y - gap - ch, a.y - gap - ch > 8],
        ['left', a.x - gap - cw, a.y + a.h / 2 - ch / 2, a.x - gap - cw > 8],
        ['right', a.x + a.w + gap, a.y + a.h / 2 - ch / 2, a.x + a.w + gap + cw < W - 8],
      ];
      const pick = tries.find(t => t[3]) || tries[0];
      [side, left, top] = pick;
    }
    card.style.left = `${Math.max(8, Math.min(left, W - cw - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(top, H - ch - 8))}px`;
    card.dataset.side = side;
  }
  const loop = () => { layout(); raf = requestAnimationFrame(loop); };

  function render() {
    const s = steps[i];
    s.before?.();
    $('tourStep').textContent = s.label || `${i + 1} of ${steps.length}`;
    $('tourTitle').innerHTML = s.title;            // titles are fixed strings in this file (some carry <kbd> keys)
    $('tourBody').innerHTML = typeof s.body === 'function' ? s.body() : s.body;
    const waiting = !!s.when;
    $('tourWait').hidden = !waiting;
    $('tourBack').hidden = i === 0 || s.noBack;
    $('tourNext').hidden = waiting && !s.nextLabel;
    $('tourNext').textContent = s.nextLabel || (i === steps.length - 1 ? 'Done' : 'Next');
    $('tourSkip').textContent = s.skipLabel || (ctx.guided ? 'Stop guide' : 'Skip tour');
    $('tourSkip').hidden = !!s.noSkip;
    card.classList.toggle('wide', !!s.center);
    card.classList.toggle('outro', !!s.outro);
    s.extra?.(card);
    layout();
    ($('tourNext').hidden ? card : $('tourNext')).focus?.({ preventScroll: true });
  }

  function go(n) {
    if (n < 0) return;
    if (n >= steps.length) return end(true);
    i = n; render();
  }
  function start(list, opts = {}) {
    steps = list; ctx = opts; i = 0; blogClicked = false;
    root.hidden = false; document.body.classList.add('touring'); cancelAnimationFrame(raf); loop();
    clearInterval(poll);
    poll = setInterval(() => { const s = steps[i]; if (s?.when?.()) go(i + 1); }, 300);
    render();
  }
  function end(finished = false) {
    root.hidden = true; document.body.classList.remove('touring'); cancelAnimationFrame(raf); clearInterval(poll); steps = [];
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    if (!finished && ctx.guided) editor.status('Guide stopped — press ? in the top bar to start it again.');
  }

  $('tourNext').addEventListener('click', () => { const s = steps[i]; if (s.onNext) s.onNext(); else go(i + 1); });
  $('tourBack').addEventListener('click', () => go(i - 1));
  $('tourSkip').addEventListener('click', () => { const s = steps[i]; if (s?.onSkip) s.onSkip(); else end(false); });

  /** The last word, however the tour ends. */
  const outro = () => ({ center: true, label: 'Ready', noBack: true, title: 'The world is yours to build.',
    body: `<p class="tour-outro">Start creating.</p><p class="tour-outro-sub">Press <b>?</b> in the top bar whenever you want the tour or a guided build again.</p>`,
    nextLabel: 'Start creating', noSkip: true, outro: true });
  const showOutro = () => { const g = ctx.guided; start([outro()], { guided: g }); };
  document.addEventListener('keydown', e => {
    if (root.hidden || e.target.matches?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if ((e.key === 'ArrowRight' || e.key === 'Enter') && !$('tourNext').hidden && e.target.closest?.('.tour-card')) { e.preventDefault(); $('tourNext').click(); }
    else if (e.key === 'ArrowLeft' && !$('tourBack').hidden && e.target.closest?.('.tour-card')) { e.preventDefault(); go(i - 1); }
  });

  /* ── part 1: the welcome tour ───────── */
  const kbd = k => `<kbd>${k}</kbd>`;
  const welcome = () => [
    { center: true, title: 'Welcome to CircuitBench!', noBack: true,
      body: `<p>CircuitBench is an electronics lab in your browser. You build real Arduino circuits on a breadboard, write the code, and run it on a simulated Arduino Uno. LEDs light up, sensors respond, and you can't fry anything.</p><p>This quick tour shows you what everything does (about a minute). Then, if you like, we'll build your first circuit together.</p>`,
      nextLabel: 'Show me around' },
    { spots: ['#canvas'], before: () => editor.fit(), title: 'Your workbench',
      body: `<p>This is where you build. The <b>Arduino Uno</b> (the blue board, the "brain") and a <b>breadboard</b> (the white board you plug parts into, no soldering needed) are already here.</p><p>Drag empty space to move around · scroll to zoom.</p>` },
    { spots: ['#partsPanel'], before: () => panes.open('parts'), title: 'Parts',
      body: `<p>Every component you can use: LEDs, resistors, buttons, sensors, displays… Press <b>Add</b>, or drag one onto the bench.</p><p>Close this panel with ×; reopen it from the strip at the bottom of the column.</p>` },
    { spots: ['.top-search'], title: 'Search parts',
      body: `<p>Type what you're looking for, like "temperature", "button", "display" or "gyro", and the Parts list filters to match.</p>` },
    { spots: ['#selectTool'], title: `Select ${kbd('V')}`,
      body: `<p>The normal mode, and the one you'll use most:</p><ul><li><b>Drag a part</b> to move it. Its legs click into breadboard holes.</li><li><b>Drag from any pin or hole</b> to another to draw a wire. No need to switch tools.</li><li><b>Right-click a part</b> to change it: resistor value, LED colour, sensor readings.</li></ul>` },
    { spots: ['#wireTool'], title: `Wire-only mode ${kbd('W')}`,
      body: `<p>A mode where clicks only draw wires (click a pin, then another), handy when lots of parts are close together.</p><p><b>Click any wire</b> to change it: its <b>type</b> (a jumper, flat hookup wire with stripped ends, or an alligator clip lead for grabbing a bare leg), its colour or its shape. Drag its ends to move them.</p>` },
    { spots: ['#rotateTool', '#deleteTool'], title: 'Rotate & delete',
      body: `<p><b>Rotate</b> ${kbd('R')} turns the selected part 90°. <b>Delete</b> ${kbd('Del')} removes the selected part or wire.</p>` },
    { spots: ['#undoTool', '#redoTool'], title: 'Undo & redo',
      body: `<p>Made a mistake? ${kbd('Ctrl')}+${kbd('Z')} undoes it, ${kbd('Ctrl')}+${kbd('Shift')}+${kbd('Z')} brings it back.</p>` },
    { spots: ['#zoomOut', '#zoomFit', '#zoomIn'], title: 'Zoom',
      body: `<p>Zoom out, in, or click the percentage to fit the whole circuit on screen.</p>` },
    { spots: ['#status'], title: 'Hints line',
      body: `<p>Tells you what just happened and what you can do next, like which two pins a new wire joined.</p>` },
    { spots: ['#runBtn'], title: `Run ${kbd('Ctrl')}+${kbd('Enter')}`,
      body: `<p>Compiles your code with the <b>real Arduino compiler</b> and runs it on the simulated Uno. While it runs, a panel at the bottom shows which pins are on, and warns you about wiring problems (like an LED with no resistor).</p>` },
    { spots: ['#codeToggle'], title: 'Code',
      body: () => `<p>Opens the coding area. Use <b>🧩 Blocks</b> to snap together a program — no typing! Blocks follow the parts you wired, so “turn LED 1 on” just works.${off('code') ? '' : ' Switch to <b>{ } Code</b> to see the real Arduino sketch (C++) your blocks make'}${off('code') ? ' You can also see' : ', and'} the compiler's messages and the <b>Serial Monitor</b> for text your Arduino prints${off('examples') ? '' : ', and an <b>Examples</b> menu with ready-made sketches'}.</p>` },
    { spots: ['#aiBtn'], title: 'Ask AI', skip: () => off('ai'),
      body: `<p>A chat that can see your circuit, your code, compile errors and the live readings while it runs. Ask "why isn't my LED on?" or "add a button on pin 2". It can wire parts and write code for you, and you choose whether to apply each change. Needs a free API key (it explains how).</p>` },
    { spots: ['.project-menu'], title: 'File menu',
      body: `<p>New project and My projects, import a project file or a KiCad circuit board, and download or copy your project.</p>` },
    { spots: ['#projectBtn'], title: 'Your project',
      body: `<p>The project you're working on. Everything saves automatically. Click here to rename it or switch to another.</p>` },
    { spots: ['#accountSlot'], title: 'Sign in with Google', skip: () => $('accountSlot')?.hidden !== false,
      body: `<p>Sign in so CircuitBench knows it's you. Your name and picture show up here. It's optional: everything works without it.</p>` },
    { spots: ['#communityBtn'], title: 'Community — click it', interactive: true, skip: () => !$('communityBtn') || off('community'),
      body: `<p>Updates from the team, fixes, and questions from other users. <b>Click Community</b> to open it.</p>`,
      before: () => { if (!$('communityModal')?.hidden) $('communityClose')?.click(); }, when: () => !$('communityModal')?.hidden },
    { spots: () => [document.querySelector('.cm-blog-link') || '#communityModal .modal-card'], title: 'The full blog — click it', interactive: true, skip: () => off('community'),
      body: () => `<p>Everything posted here also lives on the <b>blog</b>, which anyone can read without signing in. Sign in to post a bug report, a question, a workspace or a part, or to comment.</p><p><b>Click “Open the full blog”</b> (it opens in a new tab).</p>${getMe()?.entitlements?.admin ? '<p class="tour-why"><b>Team:</b> on the blog you can <b>📌 Pin</b> a post to the top and <b>Delete</b> anyone\'s post or comment.</p>' : ''}`,
      when: () => blogClicked },
    { spots: ['#settingsBtn'], title: 'Settings and help',
      body: () => `<p>Click <b>⚙</b> ${[off('ai') ? '' : 'for AI keys', off('themes') ? '' : (off('ai') ? 'for themes' : 'and themes')].filter(Boolean).join(' ')}${off('ai') && off('themes') ? 'to' : ', and to'} see this tour again or be guided through building a circuit.</p>` },
    { center: true, title: 'Your first project: blink an LED',
      body: `<p>The "hello world" of electronics. You'll need:</p><ul class="tour-needs"><li><b>Arduino Uno</b> (already on the bench)</li><li><b>Breadboard</b> (already on the bench)</li><li><b>1 LED</b>, the light</li><li><b>1 resistor (220 Ω)</b>, which stops too much current from burning out the LED</li><li><b>2 wires</b>, one from pin 13 and one to GND (ground)</li></ul><p>I'll point to each part and hole as you go. It takes about 3 minutes, in a new project so nothing you've made is touched.</p>`,
      nextLabel: 'Build it with me', skipLabel: 'I\'ll explore on my own', onNext: () => startGuide(), onSkip: () => showOutro() },
  ];

  /* ── part 2: build it with me ───────── */
  const led = () => editor.state.parts.find(p => p.type === 'led');
  const res = () => editor.state.parts.find(p => p.type === 'resistor');
  const card$ = type => () => [...document.querySelectorAll('#catalog .part-card')].find(c => c.querySelector('b')?.textContent === PART_DEFS[type].name)?.querySelector('.add');
  const showCard = type => () => { panes.open('parts'); $('partsSearch').value = ''; $('partsSearch').dispatchEvent(new Event('input')); card$(type)()?.scrollIntoView?.({ block: 'center' }); };
  const ledSeated = () => { const l = led(); return !!(seatedCol(l, 'A') && seatedCol(l, 'C')) && net(l, 'A') !== net(l, 'C'); };
  /** The resistor lead that shares the LED's + column, and the other one. */
  const resEnds = () => {
    const r = res(), l = led(); if (!r || !l) return null;
    const an = net(l, 'A');
    if (net(r, '1') === an) return { near: '1', far: '2' };
    if (net(r, '2') === an) return { near: '2', far: '1' };
    return null;
  };
  const resPlaced = () => { const e = resEnds(); return !!e && !!seatedCol(res(), e.far) && net(res(), e.far) !== net(led(), 'C'); };
  const farCol = () => { const e = resEnds(); return e ? seatedCol(res(), e.far) : null; };
  const pin13 = () => uno() && net(uno(), '13');
  const gnd = () => editor.getCircuit().uno.gnd;

  const guide = () => [
    { label: 'Step 1 of 7', title: 'Add an LED', interactive: true, noBack: true, before: showCard('led'), spots: () => [card$('led')()],
      body: `<p>Press <b>Add</b> on the LED (or drag it onto the bench).</p><p class="tour-why">An LED lights when current flows into its <b>+ leg</b> (anode, the longer one) and out of its <b>− leg</b> (cathode).</p>`,
      when: () => !!led() },
    { label: 'Step 2 of 7', title: 'Plug the LED into the breadboard', interactive: true, noBack: true, before: () => editor.fit(),
      spots: () => [worldRect([...holes(10, 'E'), ...holes(11, 'E')], 9), led() && worldRect([pinWorld(led(), 'A'), pinWorld(led(), 'C')], 12)],
      body: `<p>Drag the LED by its round top and drop it so its two legs click into <b>row E, holes 10 and 11</b> (highlighted). Any two neighbouring holes in rows A to E work too.</p><p class="tour-why">Each column of 5 holes (A to E) is joined by a metal strip inside the breadboard, so anything in the same column is connected.</p>`,
      when: ledSeated },
    { label: 'Step 3 of 7', title: 'Add a resistor', interactive: true, noBack: true, before: showCard('resistor'), spots: () => [card$('resistor')()],
      body: `<p>Press <b>Add</b> on the Resistor. It's already 220 Ω (right-click it later to see the colour bands).</p><p class="tour-why">Without it, too much current would flow and burn out the LED, and maybe the Arduino pin.</p>`,
      when: () => !!res() },
    { label: 'Step 4 of 7', title: 'Connect the resistor to the LED\'s + leg', interactive: true, noBack: true,
      spots: () => { const a = seatedCol(led(), 'A'); return [a && worldRect(holes(a.col), 8), res() && worldRect([pinWorld(res(), '1'), pinWorld(res(), '2')], 10)]; },
      body: () => { const a = seatedCol(led(), 'A'); return `<p>Drag the resistor by its middle so <b>one end goes into column ${a ? a.col : 'of the LED\'s + leg'}</b> (highlighted, the same column as the LED's + leg, any row A to D) and the other end into an <b>empty column</b>.</p><p class="tour-why">Now current can go resistor → LED.</p>`; },
      when: resPlaced },
    { label: 'Step 5 of 7', title: 'Wire pin 13 to the resistor', interactive: true, noBack: true,
      spots: () => { const f = farCol(); return [worldRect(pinPt(uno(), '13'), 9), f && worldRect(holes(f.col), 8)]; },
      body: () => { const f = farCol(); return `<p>Press on <b>pin 13</b> on the Arduino (top edge, highlighted) and drag to any hole in <b>column ${f ? f.col : '…'}</b>, the resistor's other end. Let go on the hole.</p><p class="tour-why">Pin 13 is what the code switches on and off.</p>`; },
      when: () => { const e = resEnds(); return !!e && pin13() === net(res(), e.far); } },
    { label: 'Step 6 of 7', title: 'Wire the LED\'s − leg to GND', interactive: true, noBack: true,
      spots: () => { const c = seatedCol(led(), 'C'); return [c && worldRect(holes(c.col), 8), worldRect(pinPt(uno(), 'GND.1'), 9)]; },
      body: () => { const c = seatedCol(led(), 'C'); return `<p>Drag a wire from any hole in <b>column ${c ? c.col : '…'}</b> (the LED's − leg) to the <b>GND</b> pin next to pin 13.</p><p class="tour-why">GND (ground) is where current returns to the Arduino, which completes the circuit.</p>`; },
      when: () => { const l = led(); return !!l && gnd().has(net(l, 'C')); } },
    { label: 'Step 7 of 7', title: 'Press Run', interactive: true, noBack: true, spots: ['#runBtn'],
      body: `<p>Press <b>Run</b>. CircuitBench compiles the Blink sketch with the real Arduino compiler and runs it (the first compile can take a few seconds).</p>`,
      when: () => !!sim?.running },
    { label: 'It works!', title: 'Your LED is blinking 🎉', noBack: true, spots: () => [led() && editor.els.get(led().id)],
      body: `<p>It turns on and off every half second, because the code sets pin 13 <b>HIGH</b> (on) for 500 ms, then <b>LOW</b> (off) for 500 ms, forever.</p>` },
    { label: 'Try this', title: 'Change the code', spots: ['#codeToggle'],
      body: () => `<p>Open <b>Code</b> and press <b>🧩 Blocks</b> to build a program from blocks (try <b>✨ Start from my circuit</b>), ${off('code') ? 'and change both <b>500</b>s to <b>100</b> in your blocks' : 'or switch to <b>{ } Code</b> and change both <code>500</code>s to <code>100</code>'}, then press <b>Stop</b> and <b>Run</b>. It blinks five times faster.</p>${off('examples') && off('ai') ? '' : `<p>Next, ${[off('examples') ? '' : 'try the <b>Examples</b> menu in Code', off('ai') ? '' : 'ask the AI to "add a button that turns the LED on"'].filter(Boolean).join(', or ')}.</p>`}`,
      nextLabel: 'Finish', onNext: () => showOutro() },
  ];

  async function startGuide() {
    end(true);
    sim?.stop?.();
    if (projects) await projects.create({ name: 'First circuit: Blink' });
    start(guide(), { guided: true });
  }

  const tourSteps = () => welcome().filter(s => !s.skip?.());
  const firstVisit = () => { try { return !localStorage.getItem(SEEN_KEY); } catch { return false; } };

  return {
    start: () => start(tourSteps()), startGuide, end,
    maybeAutoStart() { if (firstVisit()) start(tourSteps()); },
    get step() { return steps[i] || null; }, get index() { return i; }, get active() { return !root.hidden; },
  };
}
