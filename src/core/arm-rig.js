// Bends an arm of the full-body model at the elbow, and finds which skin vertices are over the biceps and the forearm muscles (to light them up).
// No bones: the vertices of the forearm and hand rotate about the elbow, blended over a few centimetres so the skin folds smoothly. DOM-free.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const segDist = (p, a, b) => { const ab = sub(b, a), ap = sub(p, a), t = Math.max(0, Math.min(1, dot(ab, ap) / (dot(ab, ab) || 1))); return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t); };
const smooth = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
/** The largest the elbow bends (degrees). */
export const MAX_ELBOW = 140;

/**
 * Work out which vertices follow the forearm. `arm` = { shoulder, elbow, hand } (model units), `side` = +1 for the right arm (x > 0), −1 for the left.
 * Returns { pivot, axis, idx, w } — the vertices that move, how much of the bend each takes (0..1) — and the muscle regions.
 */
export function buildArmRig(positions, arm, side) {
  const e = arm.elbow, u = unit(sub(e, arm.shoulder)), fore = unit(sub(arm.hand, e)), axis = unit(cross(fore, [0, 1, 0]));
  const reach = 1.6, upLen = Math.hypot(...sub(e, arm.shoulder)), foreLen = Math.hypot(...sub(arm.hand, e)), blend = 0.55;
  const idx = [], w = [], biceps = [], forearm = [], front = [0, 1, 0];
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i], positions[i + 1], positions[i + 2]];
    if (p[0] * side < e[0] * side - 1.0 || p[2] < 4) continue;                  // not on this arm
    if (Math.min(segDist(p, arm.shoulder, e), segDist(p, e, arm.hand)) > reach) continue;       // the knee and shin lie 'beyond the elbow' too: only skin near the arm's own bones moves
    const d = sub(p, e), t = dot(d, u);
    const ww = smooth((t + blend) / (2 * blend));
    if (ww > 0) { idx.push(i / 3); w.push(ww); }
    const radial = sub(d, [u[0] * t, u[1] * t, u[2] * t]);
    if (t < -0.12 * upLen && t > -0.85 * upLen && dot(radial, front) > -0.1) biceps.push(i / 3);
    else if (t > 0.1 * foreLen && t < 0.75 * foreLen) forearm.push(i / 3);
  }
  return { pivot: e.slice(), axis, u, blend, idx: Uint32Array.from(idx), w: Float32Array.from(w), biceps: Uint32Array.from(biceps), forearm: Uint32Array.from(forearm) };
}

/** Write the posed positions of the moving vertices into `out` (the same layout as `base`): the forearm bent by `angle` radians at the elbow. */
export function poseArm(rig, base, out, angle) {
  const { pivot: c, axis: k, idx, w } = rig;
  for (let n = 0; n < idx.length; n++) {
    const i = idx[n] * 3, a = angle * w[n], cs = Math.cos(a), sn = Math.sin(a);
    const vx = base[i] - c[0], vy = base[i + 1] - c[1], vz = base[i + 2] - c[2];
    const kv = k[0] * vx + k[1] * vy + k[2] * vz;                              // Rodrigues' rotation formula
    const cx = k[1] * vz - k[2] * vy, cy = k[2] * vx - k[0] * vz, cz = k[0] * vy - k[1] * vx;
    out[i] = c[0] + vx * cs + cx * sn + k[0] * kv * (1 - cs);
    out[i + 1] = c[1] + vy * cs + cy * sn + k[1] * kv * (1 - cs);
    out[i + 2] = c[2] + vz * cs + cz * sn + k[2] * kv * (1 - cs);
  }
}

/** Where a point on the forearm (e.g. the hand or a forearm electrode) ends up when the elbow is bent by `angle` radians. */
export function bentPoint(rig, p, angle) {
  const t = dot(sub(p, rig.pivot), rig.u), tmp = Float32Array.from(p), out = new Float32Array(3), r = { ...rig, idx: Uint32Array.of(0), w: Float32Array.of(smooth((t + rig.blend) / (2 * rig.blend))) };
  poseArm(r, tmp, out, angle); return [out[0], out[1], out[2]];
}

/** The angle (radians) the elbow bends for a muscle activation 0..1 and, when a servo is driving the arm, for its horn angle 0..180°. */
export const elbowFromMuscle = level => (MAX_ELBOW * Math.PI / 180) * Math.max(0, Math.min(1, level));
export const elbowFromServo = deg => (MAX_ELBOW * Math.PI / 180) * Math.max(0, Math.min(180, deg)) / 180;
