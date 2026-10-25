# Robotics workbench — design notes (draft)

Goal: assemble real 3D parts and electronics for ANY hobby robot (dog, hexapod, arm, exoskeleton…) and run the firmware against it.
Freedom rule: supporting a new robot must never need new app code — only new part descriptions (data).

## Building blocks (everything is a combination of these)
- **Body**: geometry, mass, centre of mass, collision shape.
- **Frame**: named position + direction on a body (hole, shaft axis, face, connector).
- **Joint**: fixed (bolted), revolute, prismatic, ball.
- **Actuator**: servo / DC motor + gearbox / stepper / linear — data records (stall torque, no-load speed, position gain, motor constants).
- **Sensor**: encoder, IMU, ultrasonic (raycast), limit switch, contact.
- **Port**: which CircuitBench part this is electrically (a servo's 3 pins, a motor's 2 terminals).
- **Fastener rule**: what may join two frames (M3 into 3.2 mm hole, snap fit, glue…). No matching rule → user can still mate by hand, with a warning.

## Placement is 75 % of the job → real dimensions, not placeholders
Parts are described with accurate dimensions (datasheet drawing → body, ears, horn, screw holes). Each dimension carries provenance:
datasheet | measured | estimated. Unverified values are flagged in the BOM. Users can override with caliper readings.
Demo parts may come from anywhere (decided by the owner); sharing/licensing is revisited before public packs.
Exoskeleton-style projects: the human is a part (segment lengths, joint axes, range of motion, limb masses) → axis-alignment, clearance and torque checks.

## Loop
sketch → pins → circuit solver (motor voltage/current, battery sag) → physics step → sensors (IMU, encoders) → sketch.

## Physics engine: MuJoCo (WebAssembly) — spike results (2026-10-25)
- `@mujoco/mujoco` 3.17.0, Apache-2.0, ESM, single-threaded build works without special headers (the `mt` build needs COOP/COEP).
- wasm 10.9 MB raw / 2.7 MB gzipped; loads in ~120 ms (node). Lazy-load only when the workbench opens.
- 2-joint leg: ~43× real time; 18-servo hexapod with floor contact: ~57× real time (node, single thread).
- Position actuators with force limits (servo stall torque), accelerometer/gyro/joint-position sensors all available.
- Bindings are "work in progress"; embind objects must be `.delete()`d exactly once; `data.contact` is a copy.
Still to check: in-browser (Chromium) load, memory on the 512 MB host (the wasm runs client-side so the server is unaffected), gzip serving.

## Decisions (owner, 2026-10-25)
- **Three tabs**: Circuit (today's editor) · Assembly (import, annotate, mate, BOM, fit checks) · Test (sketch + physics, sensors back to the sketch).
- **No native CAD.** Geometry comes from the user's own CAD (Fusion, Onshape, FreeCAD) or downloads. Assembly never edits geometry — it annotates and mates.
  Parametric bracket generators are therefore out of scope.
- Import: STEP (exact cylinders → reliable hole detection; reader lazy-loaded, size still to be measured) · STL/OBJ/glTF (click a hole/face, app proposes a frame and bolt size) · AI proposals from datasheet drawings, always confirmed by the user.
- Lives in the **Robotics workspace** (`robotics` is already a placeholder in `core/projects.js` WORKSPACES, currently unavailable). Electronics workspaces keep only the Circuit tab.

## Part description format (built: `src/core/robot-part.js`, tests: `test/robot-part.test.mjs`)
Data only (`circuitbench-robot-part` v1). mm / g / deg / N·m. Blocks: model reference, mass (+COM), dims, frames (hole, shaft, horn, face, connector, point),
joints (fixed, revolute, prismatic, ball), actuators (servo, dc-motor, stepper, linear — each with its own physical parameters), sensors, ports (circuit parts).
Every numeric group has provenance (datasheet | measured | estimated); `provenanceOf()` lists what is still unverified for the BOM.
The validator resolves every reference (joint→frame, actuator→joint, encoder→joint), clamps numbers, cleans strings and caps counts.

## Order of work
1. ✅ Part description format + provenance + validator (JSON, versioned).
2. Assembly view (three.js is already a dependency): real hole positions, snapping, fit checks, BOM.
3. Circuit link + motion (sketch drives servo joints).
4. Human body model + alignment/torque checks.
5. Authoring: import mesh/STEP, click-to-place frames, AI-drafted descriptions from datasheets, packs.
