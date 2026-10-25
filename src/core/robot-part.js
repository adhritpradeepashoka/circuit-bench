// The robot part description: ONE DATA FILE (never code) that says what a physical part is — its model, mass, where it connects, how it
// moves, what drives it and what it senses. Everything in the robotics workbench is built from these few blocks (see
// docs/robotics-workbench.md), so a new robot never needs new app code, only new descriptions.
//
// Units: millimetres, grams, degrees, newton-metres. Frames are positions in the part's own model space (Z up).
// Every group of numbers that came from somewhere says where: 'datasheet' | 'measured' | 'estimated'.
// Pure and DOM-free (tests run in Node). The validator trusts nothing: ids and strings are cleaned, numbers clamped, references checked.
export const ROBOT_PART_FORMAT = 'circuitbench-robot-part';
export const ROBOT_PART_VERSION = 1;
export const SOURCES = ['datasheet', 'measured', 'estimated'];
export const FRAME_KINDS = ['hole', 'shaft', 'horn', 'face', 'connector', 'point'];
export const JOINT_TYPES = ['fixed', 'revolute', 'prismatic', 'ball'];
export const ACTUATOR_KINDS = ['servo', 'dc-motor', 'stepper', 'linear'];
export const SENSOR_KINDS = ['imu', 'encoder', 'ultrasonic', 'contact', 'limit'];
/** Common metric threads: nominal diameter and the clearance hole a screw passes through (mm). */
export const THREADS = { M1: [1, 1.2], M1_6: [1.6, 1.8], M2: [2, 2.4], M2_5: [2.5, 2.9], M3: [3, 3.4], M4: [4, 4.5], M5: [5, 5.5], M6: [6, 6.6], M8: [8, 9] };

const MAX = { frames: 200, joints: 40, actuators: 40, sensors: 40, ports: 20, mesh: 25_000_000 };
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const slug = s => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fin = v => typeof v === 'number' && Number.isFinite(v);

/** A numeric field, clamped; an absent or non-numeric one is an error when `required`, else the default. */
function num(v, lo, hi, { required = false, def = 0, label, errors } = {}) {
  if (v === undefined || v === null || v === '') { if (required) errors.push(`${label} is required.`); return def; }
  const n = Number(v);
  if (!Number.isFinite(n)) { errors.push(`${label} must be a number.`); return def; }
  if (n < lo || n > hi) { errors.push(`${label} must be between ${lo} and ${hi} (got ${n}).`); return Math.min(hi, Math.max(lo, n)); }
  return n;
}
function vec(v, label, errors, { unit = false, lim = 5000 } = {}) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(fin)) { errors.push(`${label} must be three numbers [x, y, z].`); return [0, 0, unit ? 1 : 0]; }
  if (v.some(x => Math.abs(x) > lim)) errors.push(`${label} is outside ±${lim} mm.`);
  if (!unit) return v.map(x => Math.max(-lim, Math.min(lim, x)));
  const L = Math.hypot(...v);
  if (L < 1e-9) { errors.push(`${label} must point somewhere (not all zero).`); return [0, 0, 1]; }
  return v.map(x => x / L);
}
const prov = (v, label, errors, warnings) => {
  const s = str(v?.source ?? v, 20);
  if (!SOURCES.includes(s)) { errors.push(`${label}: say where it came from — one of ${SOURCES.join(', ')}.`); return { source: 'estimated' }; }
  if (s === 'estimated') warnings.push(`${label} is estimated — check it against the real part before relying on it.`);
  return { source: s, ...(v?.ref ? { ref: str(v.ref, 200) } : {}) };
};

/**
 * @returns {{ok:true, part:object, warnings:string[]} | {ok:false, errors:string[]}}
 */
export function validateRobotPart(raw) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['A robot part must be a JSON object.'] };
  if (raw.format !== ROBOT_PART_FORMAT) errors.push('This is not a CircuitBench robot part file.');
  if (raw.version !== ROBOT_PART_VERSION) errors.push(`Unsupported version ${raw.version} (this build reads version ${ROBOT_PART_VERSION}).`);
  const name = str(raw.name, 60); if (!name) errors.push('A part needs a name.');
  const id = slug(raw.id) || slug(name); if (!id) errors.push('A part needs an id.');

  // model: a reference to a mesh the workspace stores separately (the description itself stays small and diff-able)
  const m = raw.model && typeof raw.model === 'object' ? raw.model : {};
  const model = {
    file: str(m.file, 120), format: ['stl', 'obj', 'glb', 'step'].includes(str(m.format, 8).toLowerCase()) ? str(m.format, 8).toLowerCase() : null,
    units: ['mm', 'cm', 'm', 'in'].includes(m.units) ? m.units : 'mm', up: m.up === 'y' ? 'y' : 'z',
  };
  if (model.file && !/^[\w.\- ()]+$/.test(model.file)) errors.push('The model file name may only use letters, digits, spaces and . - _ ( ).');
  if (model.file && !model.format) errors.push('Say the model format: stl, obj, glb or step.');

  const mass = { grams: num(raw.mass?.grams, 0, 100_000, { required: true, label: 'mass.grams', errors }), ...prov(raw.mass, 'mass', errors, warnings) };
  const com = raw.com === undefined ? null : vec(raw.com, 'com', errors);
  const dims = raw.dims ? { size: vec(raw.dims.size, 'dims.size', errors, { lim: 5000 }).map(Math.abs), ...prov(raw.dims, 'dims', errors, warnings) } : null;
  if (!dims) warnings.push('No overall dimensions given — fit and clearance checks will use the mesh bounds.');

  // frames
  const frames = [], frameIds = new Set();
  for (const f of (Array.isArray(raw.frames) ? raw.frames : []).slice(0, MAX.frames)) {
    const fid = slug(f?.id), label = `frame "${fid || '?'}"`;
    if (!fid) { errors.push('A frame needs an id.'); continue; }
    if (frameIds.has(fid)) { errors.push(`Two frames are called "${fid}".`); continue; }
    frameIds.add(fid);
    if (!FRAME_KINDS.includes(f.kind)) { errors.push(`${label}: kind must be one of ${FRAME_KINDS.join(', ')}.`); continue; }
    const fr = { id: fid, kind: f.kind, pos: vec(f.pos, `${label} pos`, errors), dir: vec(f.dir, `${label} dir`, errors, { unit: true }), ...prov(f, label, errors, warnings) };
    if (f.label) fr.label = str(f.label, 40);
    if (f.kind === 'hole') {
      fr.diameter = num(f.diameter, 0.2, 100, { required: true, label: `${label} diameter`, errors });
      if (f.depth !== undefined) fr.depth = num(f.depth, 0, 500, { label: `${label} depth`, errors });
      if (f.thread !== undefined) { const t = String(f.thread).toUpperCase().replace('.', '_'); if (THREADS[t]) fr.thread = t; else errors.push(`${label}: unknown thread "${str(f.thread, 10)}" (use ${Object.keys(THREADS).join(', ')}).`); }
      fr.through = f.through === true;
    }
    if (f.kind === 'shaft' || f.kind === 'horn') {
      fr.diameter = num(f.diameter, 0.2, 100, { label: `${label} diameter`, errors, def: 0 });
      if (f.teeth !== undefined) fr.teeth = Math.round(num(f.teeth, 3, 200, { label: `${label} teeth`, errors }));
    }
    frames.push(fr);
  }
  const hasFrame = fid => frameIds.has(fid);

  // joints
  const joints = [], jointIds = new Set();
  for (const j of (Array.isArray(raw.joints) ? raw.joints : []).slice(0, MAX.joints)) {
    const jid = slug(j?.id), label = `joint "${jid || '?'}"`;
    if (!jid) { errors.push('A joint needs an id.'); continue; }
    if (jointIds.has(jid)) { errors.push(`Two joints are called "${jid}".`); continue; }
    jointIds.add(jid);
    if (!JOINT_TYPES.includes(j.type)) { errors.push(`${label}: type must be one of ${JOINT_TYPES.join(', ')}.`); continue; }
    if (!hasFrame(slug(j.frame))) { errors.push(`${label}: frame "${str(j.frame, 40)}" does not exist.`); continue; }
    const jo = { id: jid, type: j.type, frame: slug(j.frame) };
    if (j.type === 'revolute' || j.type === 'prismatic') {
      const unit = j.type === 'revolute' ? 'degrees' : 'mm', lim = j.type === 'revolute' ? 360 : 2000;
      if (!Array.isArray(j.range) || j.range.length !== 2 || !j.range.every(fin) || j.range[0] >= j.range[1] || j.range.some(x => Math.abs(x) > lim)) errors.push(`${label}: range must be [min, max] in ${unit}, min below max (within ±${lim}).`);
      else jo.range = j.range;
    }
    joints.push(jo);
  }

  // actuators — the physics of what drives a joint
  const actuators = [];
  for (const a of (Array.isArray(raw.actuators) ? raw.actuators : []).slice(0, MAX.actuators)) {
    const aid = slug(a?.id), label = `actuator "${aid || '?'}"`;
    if (!aid) { errors.push('An actuator needs an id.'); continue; }
    if (!ACTUATOR_KINDS.includes(a.kind)) { errors.push(`${label}: kind must be one of ${ACTUATOR_KINDS.join(', ')}.`); continue; }
    if (!jointIds.has(slug(a.joint))) { errors.push(`${label}: joint "${str(a.joint, 40)}" does not exist.`); continue; }
    const p = a.params && typeof a.params === 'object' ? a.params : {}, params = {};
    if (a.kind === 'servo') {
      params.stallTorque = num(p.stallTorque, 0.0001, 1000, { required: true, label: `${label} stallTorque (N·m)`, errors });
      params.noLoadSpeed = num(p.noLoadSpeed, 1, 5000, { required: true, label: `${label} noLoadSpeed (deg/s)`, errors });
      params.supplyVolts = num(p.supplyVolts, 0.5, 60, { required: true, label: `${label} supplyVolts`, errors });
      params.stallCurrent = num(p.stallCurrent, 0, 200, { label: `${label} stallCurrent (A)`, errors });
      params.idleCurrent = num(p.idleCurrent, 0, 10, { label: `${label} idleCurrent (A)`, errors });
    } else if (a.kind === 'dc-motor') {
      params.torqueConstant = num(p.torqueConstant, 1e-6, 10, { required: true, label: `${label} torqueConstant (N·m/A)`, errors });
      params.resistance = num(p.resistance, 0.01, 10000, { required: true, label: `${label} resistance (Ω)`, errors });
      params.inertia = num(p.inertia, 0, 1, { label: `${label} inertia (kg·m²)`, errors });
      params.gearRatio = num(p.gearRatio, 1, 100000, { label: `${label} gearRatio`, errors, def: 1 });
      params.supplyVolts = num(p.supplyVolts, 0.5, 60, { required: true, label: `${label} supplyVolts`, errors });
    } else if (a.kind === 'stepper') {
      params.stepsPerRev = Math.round(num(p.stepsPerRev, 1, 100000, { required: true, label: `${label} stepsPerRev`, errors }));
      params.holdingTorque = num(p.holdingTorque, 0.0001, 1000, { required: true, label: `${label} holdingTorque (N·m)`, errors });
    } else {
      params.maxForce = num(p.maxForce, 0.001, 100000, { required: true, label: `${label} maxForce (N)`, errors });
      params.maxSpeed = num(p.maxSpeed, 0.001, 5000, { required: true, label: `${label} maxSpeed (mm/s)`, errors });
    }
    actuators.push({ id: aid, kind: a.kind, joint: slug(a.joint), params, ...prov(a, label, errors, warnings), ...(a.port ? { port: str(a.port, 40) } : {}) });
  }

  const sensors = [];
  for (const s of (Array.isArray(raw.sensors) ? raw.sensors : []).slice(0, MAX.sensors)) {
    const sid = slug(s?.id), label = `sensor "${sid || '?'}"`;
    if (!sid) { errors.push('A sensor needs an id.'); continue; }
    if (!SENSOR_KINDS.includes(s.kind)) { errors.push(`${label}: kind must be one of ${SENSOR_KINDS.join(', ')}.`); continue; }
    if (s.kind === 'encoder' && !jointIds.has(slug(s.joint))) { errors.push(`${label}: joint "${str(s.joint, 40)}" does not exist.`); continue; }
    if (s.kind !== 'encoder' && !hasFrame(slug(s.frame))) { errors.push(`${label}: frame "${str(s.frame, 40)}" does not exist.`); continue; }
    sensors.push({ id: sid, kind: s.kind, ...(s.kind === 'encoder' ? { joint: slug(s.joint) } : { frame: slug(s.frame) }), ...(s.port ? { port: str(s.port, 40) } : {}) });
  }

  // the electrical side: which CircuitBench parts this physical part is
  const ports = (Array.isArray(raw.ports) ? raw.ports : []).slice(0, MAX.ports).map(p => str(p?.circuitPart ?? p, 60)).filter(Boolean);
  const meshBytes = num(raw.model?.bytes, 0, MAX.mesh, { label: 'model.bytes', errors });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true, warnings,
    part: {
      format: ROBOT_PART_FORMAT, version: ROBOT_PART_VERSION, id, name, category: str(raw.category, 30) || 'Parts', blurb: str(raw.blurb, 160), author: str(raw.author, 60),
      model: { ...model, ...(meshBytes ? { bytes: meshBytes } : {}) }, mass, ...(com ? { com } : {}), ...(dims ? { dims } : {}), frames, joints, actuators, sensors, ports,
    },
  };
}

/** How trustworthy is this part? → { verified, estimated:[labels] } — the bill of materials shows unverified parts. */
export function provenanceOf(part) {
  const est = [];
  if (part.mass?.source === 'estimated') est.push('mass');
  if (part.dims?.source === 'estimated') est.push('dimensions');
  for (const f of part.frames || []) if (f.source === 'estimated') est.push(`frame ${f.id}`);
  for (const a of part.actuators || []) if (a.source === 'estimated') est.push(`actuator ${a.id}`);
  return { verified: est.length === 0, estimated: est };
}
