// The full-body model in three.js: loads body.glb, bends either elbow, and lights the biceps and forearm muscles as they work.
// Body model: MakeHuman base mesh, CC0 (see ATTRIBUTION.md). Units: 1 = 100 mm; x = the person's right, y = front, z = up.
import { BODY_ARMS, BODY_SITES } from '../core/body-model.generated.js';
import { buildArmRig, poseArm, bentPoint } from '../core/arm-rig.js';

const bodyUrl = new URL('../assets/body.glb', import.meta.url).href;
const SKIN = [0.89, 0.72, 0.61], HOT = [0.86, 0.22, 0.16];

/** Load the model into a THREE.Group. Returns { group, setPose, sitePoint, dispose }. */
export async function loadBodyRig(THREE) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(bodyUrl);
  let mesh = null; gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error('no body mesh');
  const geo = mesh.geometry, posAttr = geo.attributes.position, base = Float32Array.from(posAttr.array);
  const colors = new Float32Array(posAttr.count * 3); for (let i = 0; i < posAttr.count; i++) colors.set(SKIN, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  const body = new THREE.Mesh(geo, mat), group = new THREE.Group(); group.add(body);
  const rigs = { R: buildArmRig(base, BODY_ARMS.r, 1), L: buildArmRig(base, BODY_ARMS.l, -1) };
  const angle = { R: 0, L: 0 }, glow = { bicepsR: 0, forearmR: 0, bicepsL: 0, forearmL: 0 };
  const paint = (idxs, level, key) => {
    if (Math.abs(glow[key] - level) < 0.01) return false; glow[key] = level;
    for (const v of idxs) for (let c = 0; c < 3; c++) colors[v * 3 + c] = SKIN[c] + (HOT[c] - SKIN[c]) * level;
    return true;
  };
  /** pose = { elbowR, elbowL (radians), glow: { flexR, flexL, fistR, fistL } } */
  function setPose(p) {
    let moved = false, painted = false;
    for (const [S, a] of [['R', p.elbowR || 0], ['L', p.elbowL || 0]]) {
      if (Math.abs(angle[S] - a) > 0.002) { angle[S] = a; poseArm(rigs[S], base, posAttr.array, a); moved = true; }
      painted = paint(rigs[S].biceps, Math.min(1, p.glow?.[`flex${S}`] || 0), `biceps${S}`) || painted;
      painted = paint(rigs[S].forearm, Math.min(1, Math.max(p.glow?.[`fist${S}`] || 0, (p.glow?.[`flex${S}`] || 0) * 0.15)), `forearm${S}`) || painted;
    }
    if (moved) { posAttr.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); }
    if (painted) geo.attributes.color.needsUpdate = true;
    return moved || painted;
  }
  /** Where an electrode site is now on the (possibly bent) body, in the group's frame. */
  const sitePoint = id => { const p = BODY_SITES[id]; if (!p) return null; const S = id.endsWith('-L') ? 'L' : 'R'; return bentPoint(rigs[S], p, angle[S]); };
  return { group, setPose, sitePoint, dispose() { geo.dispose(); mat.dispose(); } };
}
