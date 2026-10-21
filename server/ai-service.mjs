// AI service: turns a plain-English instruction + the current circuit + sketch into a circuit edit
// (add/move/wire/remove parts), a firmware edit, or both.
//
// v0.1 (beta) is bring-your-own-key only: every call must carry the caller's own free key, so
// CircuitBench pays nothing and no quota bookkeeping is needed. This is intentional, not a shortcut —
// the freemium layer (a small server-funded daily quota before asking for a key) is meant to slot in
// later as a *second* way to satisfy the same call, without the client or this module's shape changing:
// a future "no userKey → try the house key under a quota, else ask for one" branch replaces the single
// `if (!userKey)` check below, and callers never need to change.
//
// Two providers are supported because Google AI Studio's key-creation flow fails for some accounts
// (a known, longstanding "project creation failed" bug unrelated to anything here) — Groq is a working
// fallback that doesn't involve that step at all. Both are wrapped to the same
// { ok, code, actions, explanation } shape so the rest of the app never needs to know which one answered.
//
// This module only asks the model for actions and parses what comes back — it never applies them.
// src/core/ai-actions.js (imported client-side, DOM-free so it also unit-tests here) validates each
// action against the real part/pin catalogue and applies it to the live project; a made-up part type or
// pin name is silently dropped with a warning there, never trusted blindly from the model's output.
import { RequestError } from './compile-service.mjs';
import { describeCatalog } from '../src/core/ai-actions.js';

const LIMITS = { promptChars: 4_000, codeChars: 20_000 };
const ACTION_OPS = 'add_part, move_part, rotate_part, set_prop, remove_part, add_wire, remove_wire';

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
      out.push(`Simulation: RUNNING${s.paused ? ' (paused)' : ''}, ${Number(s.seconds) || 0} s of simulated time on the ATmega328P.`);
      const pins = list(s.pins, 30).map(p => `${str(p?.pin, 6)}=${str(p?.mode, 20)}${p?.volts != null ? ` ${Number(p.volts)} V` : ''}${p?.adc != null ? ` (analogRead≈${Number(p.adc)})` : ''}`);
      out.push(`  Uno pins in use: ${pins.length ? pins.join('; ') : 'none'}`);
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
        if (d.on != null) bits.push(d.on ? `display on, ${Number(d.litPixels) || 0} pixels lit${d.inverted ? ', inverted' : ''}` : 'display off / never initialised');
        out.push(`  I²C: ${bits.join('; ')}`);
        for (const p of list(d.problems, 5)) out.push(`    problem: ${str(p, 200)}`);
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

function buildPrompt({ instruction, circuit, code, context, history }) {
  const past = describeHistory(history);
  const historyBlock = past
    ? `\n\nConversation so far (oldest first). The circuit and sketch above are the CURRENT state: edits marked "applied" are already in them; edits marked "not applied" were never made, so don't assume them. Use this to resolve follow-ups like "now make it faster" or "undo that":\n${past}`
    : '';
  const diagnostics = describeContext(context);
  const diagnosticsBlock = diagnostics
    ? `\n\nLive diagnostics from the student's browser — this is what ACTUALLY happened, so treat it as ground truth over what the code or circuit "should" do. When the student asks why something doesn't work, find the cause in these readings (a pin that's LOW when it should be HIGH, an analogRead value on the wrong side of a threshold, a compile error, an open lead, a wiring problem) and name the specific reading in your explanation. If the last compile FAILED, fixing those errors comes first, whatever else was asked:\n${diagnostics}`
    : '';
  const circuitText = JSON.stringify(circuit ?? { parts: [], wires: [] });
  const parts = circuit?.parts ?? [];
  const recipes = SENSOR_RECIPES
    .filter(r => parts.some(p => p.type === r.type) || r.keywords.test(instruction || ''))
    .map(r => r.recipe);
  const recipeBlock = recipes.length
    ? `\n\nFor any of these parts in play, a ready, verified-correct conversion is given below — use it verbatim (only the pin argument may change) instead of writing your own analogRead comparison or formula for that part, even if your own would look reasonable; theirs accounts for a non-obvious inversion in the real part that a plausible-looking guess gets wrong:\n${recipes.join('\n')}`
    : '';

  return `You are editing a LIVE circuit and its Arduino (C/C++, arduino-cli, ATmega328P/Uno) firmware inside a browser simulator called CircuitBench, for a student.

You directly control the circuit, not just the firmware. Placing a part, moving it, wiring two pins together, or removing something is not a physical act you are being asked to describe or hand off — it is a data edit you make yourself by emitting the matching action(s) below, and the simulator applies it immediately. When the instruction asks for a circuit change (add/move/rotate/wire/remove), you MUST do it via "actions" — never reply that this "can't be done by you", that it requires "physically" connecting something, or tell the student to do it themselves; any of those means you are refusing a request you are fully able to carry out. Only decline a circuit change (actions: [], explained why) when it is genuinely impossible with the real catalogue below — an unknown part, a pin that doesn't exist, or a truly ambiguous target with no reasonable reading — never because wiring "sounds physical".

Parts you can place, and their real pin/property names (use these exact ids — nothing else exists). Where a part lists an electrical note after " — ", that note states its real analog behavior and OVERRIDES whatever direction you'd normally assume (e.g. most temperature/light sensors you've seen read HIGHER for MORE of the quantity — these may not; read each note literally and write comparisons that match it, not the usual assumption):
${describeCatalog()}${recipeBlock}

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
function matchJsonFence(text) {
  return /```json\s*\n([\s\S]*?)```/i.exec(text || '') || /```\s*\n(\{[\s\S]*?\})\s*```/.exec(text || '');
}

/** JSON.parse, with one repair pass for the trailing-comma mistake models make often enough to be worth tolerating. */
function tryParseJson(str) {
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

function parseReply(text) {
  const t = text || '';
  const jsonMatch = matchJsonFence(t);
  const parsed = jsonMatch ? tryParseJson(jsonMatch[1]) : null;
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
  return null;
}

function statusFor(httpStatus, message) {
  if (httpStatus === 429) return 429;
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) return /key|unauthoriz|permission/i.test(message) ? 401 : 400;
  return 502;
}

const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    url: key => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    headers: () => ({ 'content-type': 'application/json' }),
    body: prompt => JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
    errorMessage: body => body?.error?.message,
    text: body => body?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '',
  },
  groq: {
    label: 'Groq',
    url: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: key => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    // openai/gpt-oss-120b, not llama-3.3-70b-versatile — that one needs Groq's paid tier and 404s on free accounts.
    body: prompt => JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
    errorMessage: body => body?.error?.message,
    text: body => body?.choices?.[0]?.message?.content || '',
  },
};

export function createAiService({ fetchImpl = globalThis.fetch } = {}) {
  async function generateCode({ instruction, circuit, code, context, history, userKey, provider = 'gemini' }) {
    if (!instruction || !String(instruction).trim()) throw new RequestError('Describe what you want the sketch to do.');
    const p = PROVIDERS[provider];
    if (!p) throw new RequestError(`Unknown AI provider "${provider}".`);
    if (!userKey) {
      const err = new RequestError('AI features need a free API key for now — add one in Settings → AI.', 428);
      err.needsKey = true;
      throw err;
    }
    const prompt = buildPrompt({ instruction, circuit, code, context, history });
    let res;
    try {
      res = await fetchImpl(p.url(userKey), { method: 'POST', headers: p.headers(userKey), body: p.body(prompt) });
    } catch {
      throw new RequestError(`Could not reach ${p.label} — check your connection and try again.`, 502);
    }
    let body; try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const msg = p.errorMessage(body) || `HTTP ${res.status}`;
      throw new RequestError(`${p.label} error: ${msg}`, statusFor(res.status, msg));
    }
    const text = p.text(body);
    const result = parseReply(text);
    // actions:[] + code:null is not automatically a failure: a model that correctly decides nothing
    // needs to change (the sketch already does what was asked, or the circuit already has the part)
    // answers exactly this way, with the reasoning in "explanation". That's a valid, useful reply — only
    // a reply with NOTHING at all (parseReply found no json/code block, or an empty explanation too) is
    // actually unusable and worth erroring on.
    if (!result || (!result.code && !result.actions.length && !result.explanation.trim())) {
      throw new RequestError('The AI did not return a usable edit — try rephrasing the instruction.', 502);
    }
    return { ok: true, ...result };
  }

  return { generateCode };
}
