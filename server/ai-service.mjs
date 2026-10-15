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
  return `You are helping a student edit a circuit and its Arduino (C/C++, arduino-cli, ATmega328P/Uno) firmware inside a browser simulator called CircuitBench.

Parts you can place, and their real pin/property names (use these exact ids — nothing else exists):
${describeCatalog()}

Current circuit (parts with their id/type/position, and wires as {from:{part,pin}, to:{part,pin}}):
${circuitText}

Current sketch.ino:
\`\`\`cpp
${(code || '').slice(0, LIMITS.codeChars)}
\`\`\`

Instruction: ${String(instruction || '').slice(0, LIMITS.promptChars)}

Reply with EXACTLY ONE fenced \`\`\`json block containing a single object:
{
  "actions": [ ... ],   // circuit edits needed, in order, [] if the instruction is firmware-only. Allowed "op" values: ${ACTION_OPS}.
                         //   add_part: {"op":"add_part","id":"<new short id>","type":"<part type>","x":<num optional>,"y":<num optional>,"rotate":<deg optional>,"props":{...}}
                         //   move_part: {"op":"move_part","id":"<id>","x":<num>,"y":<num>}
                         //   rotate_part: {"op":"rotate_part","id":"<id>","rotate":<deg>}
                         //   set_prop: {"op":"set_prop","id":"<id>","key":"<prop name>","value":<value>}
                         //   remove_part: {"op":"remove_part","id":"<id>"}
                         //   add_wire: {"op":"add_wire","from":{"part":"<id>","pin":"<pin>"},"to":{"part":"<id>","pin":"<pin>"}}
                         //   remove_wire: {"op":"remove_wire","id":"<wire id from the circuit above>"}
  "code": "<complete new sketch.ino, or null if firmware does not need to change>",
  "explanation": "<at most two short sentences on what you did>"
}
Use "id" values for new parts yourself (short, like "led2"); you can reference them in the same actions array before they exist in the circuit above. Only reference real part ids/pin names — never invent a pin that isn't listed for that part type.
To "rewire" or "move a connection" you must emit BOTH steps as separate actions: remove_wire with the exact id of the wire being replaced (copy it from the circuit above — never guess one), then add_wire for the new connection. A new wire does not delete an old one by itself, so skipping the remove_wire leaves both connected.
Your "explanation" must describe only what the "actions" array actually does — never claim a change (a rewire, a part added, a value changed) that has no matching action in the array; if you cannot find the exact id you need, say so in "explanation" and leave that part out of "actions" rather than guessing. Nothing outside that one fenced json block.`;
}

function extractJson(text) {
  const m = /```json\s*\n([\s\S]*?)```/i.exec(text || '') || /```\s*\n(\{[\s\S]*?\})\s*```/.exec(text || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Fallback for a reply that ignored the JSON instruction and just sent a ```cpp block — keeps the
// feature working (code-only) even if a provider/model is stubborn about format.
function extractBareCode(text) {
  const m = /```(?:cpp|c\+\+|ino|arduino)?\s*\n([\s\S]*?)```/i.exec(text || '');
  return m ? m[1].trim() : null;
}

function parseReply(text) {
  const parsed = extractJson(text);
  if (parsed && typeof parsed === 'object') {
    return {
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      code: typeof parsed.code === 'string' && parsed.code.trim() ? parsed.code : null,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
    };
  }
  const bareCode = extractBareCode(text);
  if (bareCode) return { actions: [], code: bareCode, explanation: text.replace(/```[\s\S]*?```/, '').trim() };
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
    if (!result || (!result.code && !result.actions.length)) throw new RequestError('The AI did not return a usable edit — try rephrasing the instruction.', 502);
    return { ok: true, ...result };
  }

  return { generateCode };
}
