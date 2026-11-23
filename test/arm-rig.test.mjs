import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildArmRig, poseArm, bentPoint, elbowFromMuscle, elbowFromServo, MAX_ELBOW } from '../src/core/arm-rig.js';
import { BODY_ARMS, BODY_SITES, BODY_HEIGHT } from '../src/core/body-model.generated.js';
import { SITES, SITE, sitePosition, siteSignal } from '../src/core/body-sites.js';
import { neutralSubject } from '../src/core/subject.js';

const glb = fs.readFileSync(new URL('../src/assets/body.glb', import.meta.url));
const jl = glb.readUInt32LE(12), bin = glb.subarray(20 + jl + 8);
const accP = JSON.parse(glb.subarray(20, 20 + jl).toString()).accessors[0];
const pos = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + accP.count * 12));

test('the body model is a person 1.75 m tall standing on z = 0', () => {
  let lo = 1e9, hi = -1e9; for (let i = 2; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  assert.ok(Math.abs(lo) < 0.01 && Math.abs(hi - BODY_HEIGHT) < 0.01);
  assert.ok(pos.length / 3 > 10000);
});

test('bending the right elbow moves the hand and leaves the rest of the body alone', () => {
  const rig = buildArmRig(pos, BODY_ARMS.r, 1), out = Float32Array.from(pos);
  assert.ok(rig.idx.length > 200 && rig.biceps.length > 20 && rig.forearm.length > 20);
  poseArm(rig, pos, out, (90 * Math.PI) / 180);
  const hand = BODY_ARMS.r.hand, moved = bentPoint(rig, hand, (90 * Math.PI) / 180);
  const e = BODY_ARMS.r.elbow, len0 = Math.hypot(hand[0] - e[0], hand[1] - e[1], hand[2] - e[2]), len1 = Math.hypot(moved[0] - e[0], moved[1] - e[1], moved[2] - e[2]);
  assert.ok(Math.abs(len0 - len1) < 1e-3, 'a rotation keeps the forearm the same length');
  assert.ok(moved[2] > hand[2] + 1.5, 'the hand rises toward the shoulder');
  const inArm = new Set(rig.idx); let touched = 0, stray = 0;
  for (let v = 0; v < pos.length / 3; v++) { const d = Math.hypot(out[v * 3] - pos[v * 3], out[v * 3 + 1] - pos[v * 3 + 1], out[v * 3 + 2] - pos[v * 3 + 2]); if (d > 1e-5) { touched++; if (!inArm.has(v)) stray++; } }
  assert.ok(touched > 100 && stray === 0);
  const nearArm = (p, a, b) => { const ab = b.map((v, i) => v - a[i]), ap = p.map((v, i) => v - a[i]), k = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * ap[i], 0) / ab.reduce((s, v) => s + v * v, 0))); return Math.hypot(...ap.map((v, i) => v - ab[i] * k)); };
  for (const v of rig.idx) { const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]; assert.ok(Math.min(nearArm(p, BODY_ARMS.r.shoulder, BODY_ARMS.r.elbow), nearArm(p, BODY_ARMS.r.elbow, BODY_ARMS.r.hand)) <= 1.6 + 1e-6, 'only the arm moves (not the knee or shin)'); }
  for (let v = 0; v < pos.length / 3; v++) if (pos[v * 3] < 0) assert.equal(out[v * 3], pos[v * 3], 'the left arm does not move');
});

test('the left arm bends the mirror way, and zero bend changes nothing', () => {
  const R = buildArmRig(pos, BODY_ARMS.r, 1), Lr = buildArmRig(pos, BODY_ARMS.l, -1), o = Float32Array.from(pos);
  poseArm(R, pos, o, 0); assert.deepEqual(Array.from(o.slice(0, 300)), Array.from(pos.slice(0, 300)));
  const a = bentPoint(R, BODY_ARMS.r.hand, 1.2), b = bentPoint(Lr, BODY_ARMS.l.hand, 1.2);
  assert.ok(Math.abs(a[0] + b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05 && Math.abs(a[2] - b[2]) < 0.05);
});

test('angles from a muscle level or a servo horn', () => {
  assert.equal(elbowFromMuscle(0), 0); assert.ok(Math.abs(elbowFromMuscle(1) - (MAX_ELBOW * Math.PI) / 180) < 1e-9);
  assert.ok(Math.abs(elbowFromServo(90) - elbowFromMuscle(0.5)) < 1e-9); assert.equal(elbowFromServo(400), elbowFromMuscle(1));
});

test('every body electrode site has a position on the model, and the muscles show up where they should', () => {
  for (const s of SITES.filter(s => s.frame === 'body')) assert.ok(sitePosition(s.id), s.id);
  assert.ok(Object.keys(BODY_SITES).length >= 18);
  const subj = neutralSubject(), peak = (a, b) => { let m = 0; for (let i = 0; i < 3000; i++) m = Math.max(m, Math.abs(siteSignal(a, b, i / 1000, { subject: subj }))); return m; };
  subj.holds = ['flexR'];
  assert.ok(peak('bicep-R', 'elbow-R') > 5 * peak('bicep-L', 'elbow-L'), 'a right-arm flex shows on the right biceps, not the left');
  assert.ok(peak('bicep-R', 'elbow-R') > 3 * peak('flexor-R', 'wrist-R'));
  subj.holds = ['fistR'];
  assert.ok(peak('flexor-R', 'wrist-R') > 10 * peak('bicep-R', 'elbow-R'), 'a fist shows on the forearm, not the biceps');
  subj.holds = [];
  assert.ok(peak('ecg-LL', 'ecg-RA') > 5e-4 && peak('bicep-R', 'elbow-R') < 2e-5, 'the chest leads see the heartbeat, a resting arm sees almost nothing');
  assert.ok(SITE['bicep-R'].frame === 'body' && SITE.Fp1.frame === 'head');
});
