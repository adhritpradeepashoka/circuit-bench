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

## Order of work
1. Part description format + provenance + validator (JSON, versioned).
2. Assembly view (three.js is already a dependency): real hole positions, snapping, fit checks, BOM.
3. Circuit link + motion (sketch drives servo joints).
4. Human body model + alignment/torque checks.
5. Authoring: import mesh/STEP, click-to-place frames, AI-drafted descriptions from datasheets, packs.
