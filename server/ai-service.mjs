// AI service: turns a plain-English instruction + the current circuit + sketch into a sketch edit.
//
// v0.1 (beta) is bring-your-own-key only: every call must carry the caller's own free Gemini key, so
// CircuitBench pays nothing and no quota bookkeeping is needed. This is intentional, not a shortcut —
// the freemium layer (a small server-funded daily quota before asking for a key) is meant to slot in
// later as a *second* way to satisfy the same call, without the client or this module's shape changing:
// a future "no userKey → try the house key under a quota, else ask for one" branch replaces the single
// `if (!userKey)` check below, and callers never need to change.
import { RequestError } from './compile-service.mjs';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = key => `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

const LIMITS = { promptChars: 4_000, codeChars: 20_000, partsN: 80, wiresN: 200 };

/** A compact, token-cheap view of the circuit — just enough for the model to reason about connections. */
export function summariseCircuit(project) {
  if (!project || typeof project !== 'object') return { parts: [], nets: [] };
  const parts = Array.isArray(project.parts) ? project.parts.slice(0, LIMITS.partsN).map(p => ({ id: p.id, type: p.type })) : [];
  const nets = Array.isArray(project.nets) ? project.nets.slice(0, LIMITS.wiresN).map(n => ({ name: n.name, pins: n.pins })) : [];
  return { parts, nets };
}

function buildPrompt({ instruction, circuit, code }) {
  const circuitText = JSON.stringify(circuit ?? { parts: [], nets: [] });
  return `You are helping a student edit Arduino (C/C++, arduino-cli, ATmega328P/Uno) firmware inside a browser circuit simulator called CircuitBench.

Current circuit (parts and electrical nets — a "net" is a set of pins wired/breadboarded together):
${circuitText}

Current sketch.ino:
\`\`\`cpp
${(code || '').slice(0, LIMITS.codeChars)}
\`\`\`

Instruction: ${String(instruction || '').slice(0, LIMITS.promptChars)}

Reply with the COMPLETE new sketch.ino (not a diff) inside a single \`\`\`cpp fenced code block, using only the pins the circuit above actually connects. After the code block, add at most two short sentences explaining what changed.`;
}

function extractCode(text) {
  const m = /```(?:cpp|c\+\+|ino|arduino)?\s*\n([\s\S]*?)```/i.exec(text || '');
  return m ? m[1].trim() : null;
}

export function createAiService({ fetchImpl = globalThis.fetch } = {}) {
  async function generateCode({ instruction, circuit, code, userKey }) {
    if (!instruction || !String(instruction).trim()) throw new RequestError('Describe what you want the sketch to do.');
    if (!userKey) {
      const err = new RequestError('AI features need a free API key for now — add one in Settings → AI.', 428);
      err.needsKey = true;
      throw err;
    }
    const prompt = buildPrompt({ instruction, circuit, code });
    let res;
    try {
      res = await fetchImpl(GEMINI_URL(userKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
      });
    } catch {
      throw new RequestError('Could not reach the AI provider — check your connection and try again.', 502);
    }
    let body; try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      const status = res.status === 400 && /API key/i.test(msg) ? 401 : res.status === 429 ? 429 : 502;
      throw new RequestError(`AI provider error: ${msg}`, status);
    }
    const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const newCode = extractCode(text);
    if (!newCode) throw new RequestError('The AI did not return usable code — try rephrasing the instruction.', 502);
    const explanation = text.replace(/```[\s\S]*?```/, '').trim();
    return { ok: true, code: newCode, explanation };
  }

  return { generateCode };
}
