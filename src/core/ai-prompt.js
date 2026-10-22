// The prompt a model is given and how its answer is read: pure functions, shared by the server (hosted models) and the
// browser (WebLLM, on the student's own device), so every provider sees the same instructions and returns the same shape.
import { BOARD_SPECS, DEFAULT_BOARD } from './boards.js';
import { describeCatalog } from './ai-actions.js';
import { PART_DEFS } from './parts.js';
import { BEHAVIOURS, validatePartSpec, describeCustomSpecs } from './custom-parts.js';

export const LIMITS = { promptChars: 4_000, codeChars: 20_000 };
export const ACTION_OPS = 'add_part, move_part, rotate_part, set_prop, remove_part, add_wire, remove_wire';

// A part's catalogue note (see describeCatalog) states its electrical behavior, but a model that reads
// "OUT falls as it gets hotter" still has to correctly derive and apply the inverted comparison itself —
// and in practice doesn't reliably: it wrote analogRead(A0) mapped straight to 0-100°C (higher reading =
// hotter) for the NTC sensor despite the note saying the opposite, because nothing forced it to actually
// use that fact instead of its own, much more common, prior. For a part listed here, give the model a
// ready, verbatim-correct conversion function instead of a fact to reason from — it can drop the
// function in and compare the returned real-world value normally, with no direction judgment call left
// to get wrong. The constants below must match src/core/sensors.js's NTC model exactly (NTC.r25, NTC.beta,
// FIXED_OHMS, 298.15 K reference) or the simulated and described behavior will again disagree.
const SENSOR_RECIPES = [
  {
    type: 'ntc-sensor',
    keywords: /ntc|thermistor|temperature|\bcelsius\b|°c|\bhot(ter)?\b|\bcold(er)?\b/i,
    recipe: `- ntc-sensor (its OUT pin): analogRead on OUT is NOT proportional to temperature — it falls as temperature rises — so never compare the raw analogRead value against a threshold meant in °C (that silently inverts the logic, as "OUT > threshold" then means colder, not hotter). Instead use this exact helper to get a real °C value first (matches the simulated part precisely; only the pin argument should change), then compare its return value normally — e.g. "if (ntcCelsius(A0) > 50)" is correct and reads naturally:
float ntcCelsius(int pin) {
  float v = analogRead(pin) * 5.0 / 1023.0;          // ADC reading -> volts (5 V reference)
  float rNtc = 10000.0 * v / (5.0 - v);               // volts -> thermistor resistance (10 kΩ fixed leg below it)
  float kelvin = 1.0 / (1.0 / 298.15 + log(rNtc / 10000.0) / 3950.0); // Steinhart-Hart (β = 3950, 10 kΩ at 25 °C)
  return kelvin - 273.15;
}`,
  },
];

const str = (v, max) => String(v ?? '').slice(0, max);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

/**
 * Renders the browser's live diagnostics (last compile, running-sim snapshot, Serial Monitor tail, other
 * project files) as plain prompt text. Everything is coerced and size-capped here: it comes from the
 * client, so nothing about its shape is trusted. Returns '' when there is nothing useful to say.
 */
export function describeContext(context) {
  if (!context || typeof context !== 'object') return '';
  const out = [];
  const c = context.compile;
  if (c && typeof c === 'object') {
    if (c.unreachable) out.push('Last compile: the compile service could not be reached (not a code problem).');
    else if (c.ok) out.push(`Last compile: SUCCEEDED${c.stale ? ' (but the sketch has been edited since, so it may no longer match the code below)' : ''}.`);
    else {
      out.push(`Last compile: FAILED${c.stale ? ' (the sketch has been edited since, so line numbers may have shifted)' : ''}.`);
      for (const e of list(c.errors, 10)) out.push(`  error ${str(e?.file, 80)}:${Number(e?.line) || '?'} — ${str(e?.message, 300)}`);
      const o = str(c.output, 4000).trim();
      if (o) out.push('Full compiler output:\n```\n' + o + '\n```');
    }
    if (!c.unreachable) for (const n of list(c.notes, 5)) out.push(`  Compiler note: ${str(n, 600)}`);
  }
  const s = context.sim;
  if (s && typeof s === 'object') {
    if (!s.running) out.push('Simulation: NOT running — there are no live readings; reason from the circuit and code only.');
    else {
      out.push(`Simulation: RUNNING${s.paused ? ' (paused)' : ''}, ${Number(s.seconds) || 0} s of simulated time on the ${s.board || 'Arduino Uno'} (${s.chip || 'ATmega328P'}).`);
      const pins = list(s.pins, 30).map(p => `${str(p?.pin, 6)}=${str(p?.mode, 20)}${p?.volts != null ? ` ${Number(p.volts)} V` : ''}${p?.adc != null ? ` (analogRead≈${Number(p.adc)})` : ''}`);
      out.push(`  Board pins in use: ${pins.length ? pins.join('; ') : 'none'}`);
      const leds = list(s.leds, 30).map(l => `${str(l?.id, 30)} ${l?.on ? 'ON' : 'off'} ${Number(l?.mA) || 0} mA`);
      if (leds.length) out.push(`  LEDs: ${leds.join('; ')}`);
      const pressed = list(s.pressed, 10).map(p => str(p, 30));
      if (pressed.length) out.push(`  Buttons held down right now: ${pressed.join(', ')}`);
      for (const w of list(s.warnings, 10)) out.push(`  Electrical warning: ${str(w, 300)}`);
      for (const d of list(s.i2c, 8)) {
        if (!d || typeof d !== 'object') continue;
        const bits = [`${str(d.id, 30)} (${str(d.type, 20)}) at ${str(d.address, 6)}: ${d.onBus ? 'answering on the I²C bus' : 'NOT on the bus'}`];
        if (d.asleep) bits.push('still asleep (the sketch has not woken it: PWR_MGMT_1 / begin())');
        if (d.accelG) bits.push(`accel ${['x', 'y', 'z'].map(k => `${k}=${Number(d.accelG[k]) || 0} g`).join(' ')}`);
        if (d.gyroDps) bits.push(`gyro ${['x', 'y', 'z'].map(k => `${k}=${Number(d.gyroDps[k]) || 0} °/s`).join(' ')}`);
        if (d.tempC != null) bits.push(`temp ${Number(d.tempC)} °C`);
        if (Array.isArray(d.text)) bits.push(d.displayOn ? `LCD shows "${str(d.text[0], 16)}" / "${str(d.text[1], 16)}"${d.backlight ? '' : ' (backlight off)'}` : 'LCD display off / never initialised');
        if (d.on != null) bits.push(d.on ? `display on, ${Number(d.litPixels) || 0} pixels lit${d.inverted ? ', inverted' : ''}` : 'display off / never initialised');
        out.push(`  I²C: ${bits.join('; ')}`);
        for (const p of list(d.problems, 5)) out.push(`    problem: ${str(p, 200)}`);
      }
      for (const d of list(s.dht, 6)) {
        if (!d || typeof d !== 'object') continue;
        out.push(`  ${str(d.model, 6)} sensor ${str(d.id, 30)}: set to ${Number(d.tempC)} °C, ${Number(d.humidity)} %RH; DATA on ${str(d.dataPin, 6) || 'no pin'}; ${Number(d.reads) || 0} successful reads so far${d.problem ? ` — ${str(d.problem, 120)} (the sketch's DHT type must match the part's model)` : ''}`);
        for (const p of list(d.problems, 5)) out.push(`    problem: ${str(p, 200)}`);
      }
      for (const m of list(s.motors, 6)) if (m && typeof m === 'object') out.push(`  Motor ${str(m.id, 30)}: ${Number(m.volts)} V across it, ${Number(m.rpm) ? `${Math.abs(Number(m.rpm))} rpm ${Number(m.rpm) > 0 ? 'forward' : 'reverse'}` : 'not turning'}`);
      for (const m of list(s.muxes, 6)) if (m && typeof m === 'object') out.push(`  Multiplexer ${str(m.id, 30)}: ${m.channel == null ? 'no channel connected (unpowered or EN HIGH)' : `common pin joined to channel ${Number(m.channel)}`}`);
      for (const d of list(s.drivers, 6)) if (d && typeof d === 'object') out.push(`  Motor driver ${str(d.id, 30)}: ${d.powered ? 'powered' : 'NO motor power'}; motor A ${str(d.motorA, 10)}, motor B ${str(d.motorB, 10)}`);
      for (const e of list(s.library, 24)) {
        if (!e || typeof e !== 'object') continue;
        const bits = Object.entries(e).filter(([k, v]) => !['id', 'name', 'kind', 'problems'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')).map(([k, v]) => `${str(k, 20)}=${str(String(v), 30)}`);
        out.push(`  ${str(e.name, 40) || str(e.kind, 20)} (${str(e.kind, 20)}, ${str(e.id, 30)}): ${bits.join(', ') || 'no live state'}`);
        for (const p of list(e.problems, 4)) out.push(`    problem: ${str(p, 200)}`);
      }
      const ua = list(s.i2cUnanswered, 8).map(a => str(a, 6));
      if (ua.length) out.push(`  I²C: the sketch addressed ${ua.join(', ')}, and nothing on the bus has that address`);
    }
    if (s.error) out.push(`  Simulator error: ${str(s.error, 300)}`);
    for (const i of list(s.issues, 10)) out.push(`Wiring problem detected: ${str(i, 300)}`);
  }
  const serial = str(context.serial, 2000).trim();
  if (serial) out.push('Serial Monitor (most recent output):\n```\n' + serial + '\n```');
  for (const f of list(context.otherFiles, 8)) {
    const name = str(f?.name, 64), content = str(f?.content, 6000);
    if (name) out.push(`Other project file ${name} (read-only for you — you can only rewrite sketch.ino; if a fix belongs here, say exactly what to change in "explanation"):\n\`\`\`cpp\n${content}\n\`\`\``);
  }
  return out.join('\n');
}

/** Earlier turns of the chat, oldest first — coerced and capped like describeContext, since they come from the client. */
export function describeHistory(history) {
  const lines = list(history, 8)
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && String(t.text ?? '').trim())
    .map(t => `${t.role === 'user' ? 'Student' : 'You'}: ${str(t.text, 800).trim()}`);
  return lines.join('\n');
}

/** Part types worth listing for a small model: everything already on the board, the basics, and anything the request names. */
export function relevantTypes(instruction, circuit) {
  const set = new Set(['arduino-uno', 'breadboard', 'led', 'resistor', 'pushbutton']);
  for (const p of circuit?.parts ?? []) set.add(p.type);
  const words = String(instruction || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  for (const def of Object.values(PART_DEFS)) {
    const name = def.type.toLowerCase(), label = String(def.label || '').toLowerCase();
    if (words.some(w => name.includes(w) || (label && label.includes(w)))) set.add(def.type);
  }
  return set;
}

export function buildPrompt({ instruction, circuit, code, context, history, compact = false }) {
  const past = describeHistory(history);
  const historyBlock = past
    ? `\n\nConversation so far (oldest first). The circuit and sketch above are the CURRENT state: edits marked "applied" are already in them; edits marked "not applied" were never made, so don't assume them. Use this to resolve follow-ups like "now make it faster" or "undo that":\n${past}`
    : '';
  const diagnostics = describeContext(context);
  const diagnosticsBlock = diagnostics
    ? `\n\nLive diagnostics from the student's browser — this is what ACTUALLY happened, so treat it as ground truth over what the code or circuit "should" do. When the student asks why something doesn't work, find the cause in these readings (a pin that's LOW when it should be HIGH, an analogRead value on the wrong side of a threshold, a compile error, an open lead, a wiring problem) and name the specific reading in your explanation. If the last compile FAILED, fixing those errors comes first, whatever else was asked:\n${diagnostics}`
    : '';
  const customLines = describeCustomSpecs(circuit?.customParts);
  const customBlock = customLines ? `\nParts the student made themselves (use them exactly like the ones above):\n${customLines}` : '';
  const circuitText = JSON.stringify(circuit ? { ...circuit, customParts: undefined, nets: undefined, seated: undefined } : { parts: [], wires: [] });
  const parts = circuit?.parts ?? [];
  const recipes = SENSOR_RECIPES
    .filter(r => parts.some(p => p.type === r.type) || r.keywords.test(instruction || ''))
    .map(r => r.recipe);
  const recipeBlock = recipes.length
    ? `\n\nFor any of these parts in play, a ready, verified-correct conversion is given below — use it verbatim (only the pin argument may change) instead of writing your own analogRead comparison or formula for that part, even if your own would look reasonable; theirs accounts for a non-obvious inversion in the real part that a plausible-looking guess gets wrong:\n${recipes.join('\n')}`
    : '';

  const board = BOARD_SPECS[parts.find(p => BOARD_SPECS[p.type])?.type] || BOARD_SPECS[DEFAULT_BOARD];
  return `You are editing a LIVE circuit and its Arduino (C/C++, arduino-cli) firmware inside a browser simulator called CircuitBench, for a student.

The circuit's board is the ${board.name} (${board.chip === 'atmega2560' ? 'ATmega2560' : 'ATmega328P'}); the sketch is compiled for it. Its I²C pins are SDA = ${/^\d+$/.test(board.i2c.sda) ? `D${board.i2c.sda}` : board.i2c.sda} and SCL = ${/^\d+$/.test(board.i2c.scl) ? `D${board.i2c.scl}` : board.i2c.scl}${board.chip === 'atmega2560' ? '; PWM (analogWrite) works on D2–D13 and D44–D46; analog inputs are A0–A15' : '; PWM (analogWrite) works on D3, D5, D6, D9, D10, D11'}${board.pins.A6 && !board.pins.A6.port ? '; A6 and A7 are analog-input only (analogRead, never digitalRead/digitalWrite)' : ''}. Only one board runs at a time — don't add a second one.

You directly control the circuit, not just the firmware. Placing a part, moving it, wiring two pins together, or removing something is not a physical act you are being asked to describe or hand off — it is a data edit you make yourself by emitting the matching action(s) below, and the simulator applies it immediately. When the instruction asks for a circuit change (add/move/rotate/wire/remove), you MUST do it via "actions" — never reply that this "can't be done by you", that it requires "physically" connecting something, or tell the student to do it themselves; any of those means you are refusing a request you are fully able to carry out. Only decline a circuit change (actions: [], explained why) when it is genuinely impossible with the real catalogue below — an unknown part, a pin that doesn't exist, or a truly ambiguous target with no reasonable reading — never because wiring "sounds physical".

Parts you can place, and their real pin/property names (use these exact ids — nothing else exists). Where a part lists an electrical note after " — ", that note states its real analog behavior and OVERRIDES whatever direction you'd normally assume (e.g. most temperature/light sensors you've seen read HIGHER for MORE of the quantity — these may not; read each note literally and write comparisons that match it, not the usual assumption):
${describeCatalog(compact ? relevantTypes(instruction, circuit) : null)}${customBlock}${recipeBlock}

Current circuit (parts with their id/type/position, and wires as {from:{part,pin}, to:{part,pin}}):
${circuitText}

Current sketch.ino:
\`\`\`cpp
${(code || '').slice(0, LIMITS.codeChars)}
\`\`\`${diagnosticsBlock}${historyBlock}

Student's latest message: ${String(instruction || '').slice(0, LIMITS.promptChars)}

This is a chat. If that message only asks a question ("why…", "what does…", "how do I…") and doesn't ask for a change, answer it in "explanation" — plain text, a few short sentences, no markdown — with "actions": [] and no cpp block. Only propose an edit when one is asked for or is clearly needed to fix what they're asking about.

Reply with EXACTLY ONE fenced \`\`\`json block containing a single object — and NOTHING else in it, especially not firmware code (see below for why):
{
  "actions": [ ... ],   // circuit edits needed, in order, [] if the instruction is firmware-only. Allowed "op" values: ${ACTION_OPS}.
                         //   add_part: {"op":"add_part","id":"<new short id>","type":"<part type>","x":<num optional>,"y":<num optional>,"rotate":<deg optional>,"props":{...}}
                         //   move_part: {"op":"move_part","id":"<id>","x":<num>,"y":<num>}
                         //   rotate_part: {"op":"rotate_part","id":"<id>","rotate":<deg>}
                         //   set_prop: {"op":"set_prop","id":"<id>","key":"<prop name>","value":<value>}
                         //   remove_part: {"op":"remove_part","id":"<id>"}
                         //   add_wire: {"op":"add_wire","from":{"part":"<id>","pin":"<pin>"},"to":{"part":"<id>","pin":"<pin>"}}
                         //   remove_wire: {"op":"remove_wire","id":"<wire id from the circuit above>"}
  "explanation": "<your reply to the student, plain text, no markdown. For an edit: what was wrong (citing the reading or error that shows it, if any) and what you changed, in at most three short sentences. For a question: the answer.>"
}
If the firmware/sketch needs to change, follow that json block with a SECOND fenced block, tagged \`\`\`cpp, containing the COMPLETE new sketch.ino (not a diff/snippet). If firmware does not need to change, do not include a \`\`\`cpp block at all.
Never put firmware code inside the json block or inside any string field — a multi-line C/C++ program's own newlines break JSON parsing unless perfectly escaped, which models get wrong often enough that this feature breaks when they do; keeping code in its own plain \`\`\`cpp block avoids that entirely. Nothing is allowed outside these one or two fenced blocks.
Use "id" values for new parts yourself (short, like "led2"); you can reference them in the same actions array before they exist in the circuit above. Only reference real part ids/pin names — never invent a pin that isn't listed for that part type.
To "rewire" or "move a connection" you must emit BOTH steps as separate actions: remove_wire with the exact id of the wire being replaced (copy it from the circuit above — never guess one), then add_wire for the new connection. A new wire does not delete an old one by itself, so skipping the remove_wire leaves both connected.
Your "explanation" must describe only what the "actions" array (and the \`\`\`cpp block, if present) actually do — never claim a change (a rewire, a part added, a value changed) that has no matching action; if you cannot find the exact id you need, say so in "explanation" and leave that part out of "actions" rather than guessing.`;
}

/** Finds the one allowed ```json fence and returns the regex match (so callers can also strip exactly that span), or null. */
export function matchJsonFence(text) {
  return /```json\s*\n([\s\S]*?)```/i.exec(text || '') || /```\s*\n(\{[\s\S]*?\})\s*```/.exec(text || '');
}

/** JSON.parse, with one repair pass for the trailing-comma mistake models make often enough to be worth tolerating. */
export function tryParseJson(str) {
  try { return JSON.parse(str); } catch { /* fall through to repair */ }
  try { return JSON.parse(str.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

// Fallback/companion extraction for a ```cpp (or untagged ```) block — either the model's real sketch
// handed over outside the JSON (the normal path now), or, if the json block is missing/unparseable
// entirely, the model having ignored the schema and just sent code.
function extractBareCode(text) {
  const m = /```(?:cpp|c\+\+|ino|arduino)?\s*\n([\s\S]*?)```/i.exec(text || '');
  return m ? m[1].trim() : null;
}

export function parseReply(text) {
  const t = text || '';
  const jsonMatch = matchJsonFence(t);
  let parsed = jsonMatch ? tryParseJson(jsonMatch[1]) : null;
  if (!parsed) {                                         // some models skip the fence and send the bare object (maybe with chatter around it)
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    const bare = a >= 0 && b > a ? tryParseJson(t.slice(a, b + 1)) : null;
    if (bare && typeof bare === 'object' && ('explanation' in bare || 'actions' in bare || 'code' in bare)) parsed = bare;
  }
  // Strip exactly the matched json fence (not any ``` fence) before hunting for a separate code block,
  // so the json block itself is never mistaken for "bare code" when it has no "json" language tag.
  const withoutJson = jsonMatch ? t.slice(0, jsonMatch.index) + t.slice(jsonMatch.index + jsonMatch[0].length) : t;
  const bareCode = extractBareCode(withoutJson);

  if (parsed && typeof parsed === 'object') {
    return {
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      // Prefer the dedicated cpp fence; fall back to a "code" field inside the json in case a model
      // puts it there anyway and happens to escape it correctly.
      code: bareCode || (typeof parsed.code === 'string' && parsed.code.trim() ? parsed.code : null),
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
    };
  }
  // No valid/parseable json at all — the model ignored the schema and just sent code.
  if (bareCode) return { actions: [], code: bareCode, explanation: withoutJson.replace(/```[\s\S]*?```/g, '').trim() };
  // Plain prose and nothing else: a model that ignored the format but still answered ("what's wrong with my circuit?") — show it as the answer.
  const prose = t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (prose.length > 15 && !/^[{[]/.test(prose)) return { actions: [], code: null, explanation: prose.slice(0, 4000) };
  return null;
}


/** The prompt that turns a student's description into a part spec (see src/core/custom-parts.js). Data only — never code. */
export function buildPartPrompt(description, problems = null) {
  const kinds = Object.entries(BEHAVIOURS).map(([k, b]) => `  - "${k}": ${b.label}. ${b.note}${b.roles.length ? ` Roles (each must name one of the part's pin ids): ${b.roles.join(', ')}.` : ''}${b.optional ? ` Optional roles: ${b.optional.join(', ')}.` : ''}${b.lists ? ` Also needs ${Object.entries(b.lists).map(([l, d]) => `"${l}": [pin ids — ${d}]`).join(' and ')} in the behaviour object.` : ''}${b.params ? ` Numbers to set in the behaviour object: ${b.params.map(p => (p.options ? `"${p.key}" (${p.options.map(([v]) => `"${v}"`).join(' | ')}, default "${p.def}")` : `"${p.key}" (${p.label}${p.unit ? `, ${p.unit}` : ''}; ${p.min}–${p.max}, default ${p.def})`)).join('; ')}.` : ''}`).join('\n');
  return `You design a component for CircuitBench, a browser electronics simulator for students. The student describes a part; you reply with its definition as data.

FIRST: if the part is a real, named component (a chip, a module, a breakout board), look it up on the web and use its ACTUAL pinout — the real pin names, in the real order, from the datasheet — and its real behaviour. Do not work from memory if you can check. Getting the pin names and order right matters more than anything else here, because the student will wire it up by those names.

Then describe it with one of the behaviours below. If the part IS one of the specific components — a switch, relay, potentiometer, flex/force sensor, diode or Zener, transistor or MOSFET, voltage regulator, capacitor, inductor, buzzer, motor, LED bar, servo, ultrasonic sensor, rotary encoder, stepper — use that behaviour and set its numbers from the datasheet (forward voltage, gain, threshold, output voltage, coil resistance…). Pick "logic" for any chip whose behaviour is digital and definable (gates, shift registers, counters, flip-flops, latches, decoders, drivers). Use "none" only as a last resort, for something genuinely unmodellable here (an RF module, a microcontroller, an I2C/SPI peripheral with an internal register map) — and then say what is missing in "note".

Behaviours:
${kinds}
Extra fields: "resistor" needs "ohms" (1 – 10000000). "led" and "led-array" take "color": one of red, green, blue, yellow, orange, white. The numbers listed for a behaviour go directly inside the "behaviour" object (for example {"kind":"diode","roles":{"anode":"A","cathode":"K"},"vf":0.3}); leave them out to use the defaults.

THE "logic" BEHAVIOUR — how to write rules
A logic part is described by three things, all written as arithmetic expressions (NOT code — there are no statements, no loops, no assignment inside an expression):
  "vars":    { "<name>": <starting number> }   what the chip remembers. Omit or {} for a part with no memory (plain gates).
  "rules":   [ { "when": "<expression>", "set": { "<var>": "<expression>" } } ]   run in order, every time any input changes.
  "outputs": { "<pin id>": "<expression>" }    what each driven pin puts out: 0 = LOW, anything else = HIGH.
  "analog":  [ "<pin id>" ]                    optional: these outputs are VOLTS above GND instead of HIGH/LOW.
In an expression you may use:
  - any pin name → 1 when that pin is above half the supply, else 0 (only pins whose id is letters, digits and _ can be named in an expression, so prefer names like "Q0", "OE", "MR")
  - any of your own "vars" names → its current number
  - v(PIN) → that pin's actual voltage above GND
  - rising(PIN) / falling(PIN) / changed(PIN) → 1 on the edge that just happened
  - numbers (12, 0x1F, 0b1010), + - * / %, & | ^ ~ << >>, == != < <= > >=, && || !, a ? b : c
  - min, max, abs, floor, ceil, round, clamp(x,lo,hi), select(cond,a,b)
Nothing else exists: no function calls of your own, no strings, no arrays, no property access. Every pin you name must be one of the pins you listed. Power the part through its "vcc" and "gnd" roles; below 2 V it switches off and forgets its vars. An optional "enable" role is an active-LOW output enable.

Worked example — a 74HC595 serial-in / parallel-out shift register:
  "pins": [ {"id":"Q1"},{"id":"Q2"},{"id":"Q3"},{"id":"Q4"},{"id":"Q5"},{"id":"Q6"},{"id":"Q7"},{"id":"GND"},{"id":"Q7S"},{"id":"MR"},{"id":"SHCP"},{"id":"STCP"},{"id":"OE"},{"id":"DS"},{"id":"Q0"},{"id":"VCC"} ],
  "behaviour": {
    "kind": "logic",
    "roles": { "vcc": "VCC", "gnd": "GND", "enable": "OE" },
    "vars": { "shift": 0, "latch": 0 },
    "rules": [
      { "when": "!MR", "set": { "shift": "0" } },
      { "when": "rising(SHCP) && MR", "set": { "shift": "(shift * 2 + DS) % 256" } },
      { "when": "rising(STCP)", "set": { "latch": "shift" } }
    ],
    "outputs": { "Q0": "latch & 1", "Q1": "(latch >> 1) & 1", "Q2": "(latch >> 2) & 1", "Q3": "(latch >> 3) & 1", "Q4": "(latch >> 4) & 1", "Q5": "(latch >> 5) & 1", "Q6": "(latch >> 6) & 1", "Q7": "(latch >> 7) & 1", "Q7S": "(shift >> 7) & 1" }
  }
A quad NAND gate (74HC00) needs no vars and no rules at all — just "outputs": { "Y1": "!(A1 && B1)", ... }.

Student's description: ${String(description).slice(0, 1500)}
${problems ? `\nYour previous answer was rejected by the simulator for these reasons — fix them and reply again:\n${problems.map(p => `- ${p}`).join('\n')}\n` : ''}
Reply with EXACTLY ONE fenced \`\`\`json block and nothing else after it:
{
  "name": "<part name, max 40 chars>",
  "label": "<short text printed on the part, max 16 chars>",
  "description": "<one sentence: what it is and how to wire it>",
  "color": "<#rrggbb body colour that looks like the real part>",
  "textColor": "<#rrggbb, readable on that colour>",
  "package": "dip" | "dip-wide" | "quad" | "module",
  "pins": [ { "id": "<pin name exactly as the datasheet prints it: letters, digits, + - _ . — max 12>", "label": "<what the pin is for>", "side": "left" | "right" | "top" | "bottom" } ],
  "breadboard": <"module" only: true if the real part plugs into a breadboard; then every pin must be on "bottom">,
  "behaviour": { "kind": "<one of the behaviours>", "roles": { "<role>": "<pin id>" }, "<the behaviour's own numbers, e.g. vf, beta, vout, uF>": <number or choice>, "ohms": <resistor only>, "color": "<led / led-array only>", "segments": [<led-array only>], "coils": [<stepper only>], "select": [<mux only>], "channels": [<mux only>], "vars": {<logic only>}, "rules": [<logic only>], "outputs": {<logic only>}, "analog": [<logic only>] },
  "note": "<anything the simulator can't reproduce about the real part — timing, drive current, analog detail — else empty>"
}
PACKAGE — get this right or the part will be the wrong shape and unusable:
  For every chip package ("dip", "dip-wide", "quad") list the pins in DATASHEET ORDER, pin 1 first, all the way round the chip, and leave "side" out entirely — the simulator places each leg from its pin number, exactly as the datasheet numbers them. Never put all of a chip's pins on one side.
  - "dip": a through-hole chip 0.3" wide — 8 to 20 pins (555, 4051, 74HC595, an op-amp…). Two rows that straddle a breadboard's centre trench; notch and pin 1 at the left; numbering runs down the bottom row and back along the top. Needs an even number of pins.
  - "dip-wide": the same but 0.6" wide, for the big through-hole chips — 24 to 40 pins (ATmega328P, 8051, a 68000…). Needs an even number of pins.
  - "quad": a quad flat pack (QFP/QFN/PLCC) — pins on all FOUR sides, which is how most microprocessors, microcontrollers and FPGAs are actually packaged. Numbering is the QFP standard: anticlockwise seen from above, starting at the TOP of the LEFT side, so pin 1 runs down the left side, then along the bottom left→right, then up the right side, then back along the top right→left. The total must divide by 4 (the same number of pins on each side), minimum 8. Surface mount, so it does not plug into a breadboard — that's expected, wire to it directly.
  - "module" for a breakout board or anything with its own header: then "side" places each pin ("left" | "right" | "top" | "bottom"), and "breadboard": true means a single row of pins along the bottom edge.
1–64 pins.`;
}
