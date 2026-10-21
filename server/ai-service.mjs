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

function buildPrompt({ instruction, circuit, code }) {
  const circuitText = JSON.stringify(circuit ?? { parts: [], wires: [] });
  return `You are editing a LIVE circuit and its Arduino (C/C++, arduino-cli, ATmega328P/Uno) firmware inside a browser simulator called CircuitBench, for a student.

You directly control the circuit, not just the firmware. Placing a part, moving it, wiring two pins together, or removing something is not a physical act you are being asked to describe or hand off — it is a data edit you make yourself by emitting the matching action(s) below, and the simulator applies it immediately. When the instruction asks for a circuit change (add/move/rotate/wire/remove), you MUST do it via "actions" — never reply that this "can't be done by you", that it requires "physically" connecting something, or tell the student to do it themselves; any of those means you are refusing a request you are fully able to carry out. Only decline a circuit change (actions: [], explained why) when it is genuinely impossible with the real catalogue below — an unknown part, a pin that doesn't exist, or a truly ambiguous target with no reasonable reading — never because wiring "sounds physical".

Parts you can place, and their real pin/property names (use these exact ids — nothing else exists):
${describeCatalog()}

Current circuit (parts with their id/type/position, and wires as {from:{part,pin}, to:{part,pin}}):
${circuitText}

Current sketch.ino:
\`\`\`cpp
${(code || '').slice(0, LIMITS.codeChars)}
\`\`\`

Instruction: ${String(instruction || '').slice(0, LIMITS.promptChars)}

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
  "explanation": "<at most two short sentences on what you did>"
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
  async function generateCode({ instruction, circuit, code, userKey, provider = 'gemini' }) {
    if (!instruction || !String(instruction).trim()) throw new RequestError('Describe what you want the sketch to do.');
    const p = PROVIDERS[provider];
    if (!p) throw new RequestError(`Unknown AI provider "${provider}".`);
    if (!userKey) {
      const err = new RequestError('AI features need a free API key for now — add one in Settings → AI.', 428);
      err.needsKey = true;
      throw err;
    }
    const prompt = buildPrompt({ instruction, circuit, code });
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
