// What kind of robot is this project? A robotics project starts by asking, and the answer shapes the rest: which circuit parts lead the sidebar, which 3D parts
// lead the Assembly list, what the AI assumes, and which Test view opens first. Pure data, so tests and the AI prompt can use it without a browser.
import { DRONE_PRESETS } from './drone-parts.js';
import { KIT_PRESETS } from './robot-kit.js';

export const ROBOT_TYPES = [
  { id: 'arm', name: 'Robot arm', blurb: 'Servo joints that reach out and pick things up', test: 'robot',
    circuit: ['arduino-uno', 'arduino-nano', 'esp32-devkit', 'servo', 'potentiometer', 'slide-pot', 'joystick', 'pushbutton', 'slide-switch', 'led', 'battery', 'mpu6050', 'stepper', 'tb6612', 'hc-sr04', 'buzzer'],
    parts3d: ['servo-sg90', 'servo-mg90s', 'servo-mg996r', 'servo-ds3218', 'link-40', 'link-60', 'link-80', 'link-120', 'link-160', 'bracket-sg90', 'bracket-mg996r', 'plate-100x50-f18', 'plate-100x80', 'plate-150x100'],
    notes: 'This is a ROBOT ARM: a base plate, hobby servos as the joints and links between them (servo horn → link → next servo). Each joint is one servo on its own PWM pin, powered from a separate 5 V supply (a servo stall pulls 0.5 A or more, so never from the board\'s 5 V pin), with the grounds joined. Use servo-sg90 for small arms, servo-mg996r for the shoulder. Suggest potentiometers or a serial command for control, and keep each servo\'s angle inside its limits.' },
  { id: 'rover', name: 'Car / rover', blurb: 'Wheels, motors and a driver — drives around', test: 'robot',
    circuit: ['arduino-uno', 'arduino-nano', 'esp32-devkit', 'raspberry-pi-pico', 'l298n', 'tb6612', 'drv8833', 'l9110s', 'dc-motor', 'hc-sr04', 'ky-040', 'mpu6050', 'servo', 'battery', 'pushbutton', 'led', 'buzzer'],
    parts3d: ['plate-150x100', 'plate-100x80', 'gearmotor-tt', 'gearmotor-n20', 'wheel-65', 'wheel-43', 'caster-ball', 'holder-4aa', 'holder-2aa', 'servo-sg90', 'link-60'],
    notes: 'This is a WHEELED ROVER (car): a base plate, two driven wheels (TT or N20 gear motors) and a ball caster. Each motor needs a driver (TB6612, L298N, DRV8833 or L9110S) with two direction pins plus one PWM speed pin per side; the motors run from the battery, not the board; the grounds are joined. Suggest an ultrasonic sensor (HC-SR04) up front for obstacle avoidance and an encoder or IMU for driving straight.' },
  { id: 'drone', name: 'Drone', blurb: 'Frame, motors, props, flight controller and battery', test: 'fly',
    circuit: ['drone-aio', 'drone-fc', 'drone-esc', 'drone-motor', 'bmotor-cw', 'bmotor-ccw', 'drone-battery', 'drone-rx', 'drone-vtx', 'drone-camera', 'drone-cap', 'esp32-c3-mini', 'mpu6050', 'battery'],
    parts3d: DRONE_PRESETS.map(([, id]) => id),
    notes: 'This is a DRONE (quadcopter). Prefer the Drone parts: frame, four motors (two CW, two CCW), props, a flight controller or AIO board, an ESC, a battery, optionally a camera. Motors must alternate direction diagonally. Check the battery cell count against the motors\' Kv and the props\' size, and keep thrust above twice the weight.' },
  { id: 'walker', name: 'Walker', blurb: 'Legs on servos — walks on two, four or more', test: 'robot',
    circuit: ['arduino-uno', 'arduino-nano', 'esp32-devkit', 'raspberry-pi-pico', 'servo', 'mpu6050', 'hc-sr04', 'pushbutton', 'led', 'battery', 'buzzer'],
    parts3d: ['servo-sg90', 'servo-mg90s', 'link-40', 'link-60', 'link-80', 'plate-100x80', 'plate-150x100', 'holder-2aa', 'holder-4aa'],
    notes: 'This is a LEGGED WALKER: a body plate and legs, each leg two or three servos (hip, knee, ankle) joined by links. Many servos means a lot of current: power them from a separate 5 V supply of 2 A or more, never from the board. A pins-saving servo board (PCA9685) or an ESP32 helps once there are more than six servos. An IMU on the body helps it stay upright.' },
  { id: 'standalone', name: 'Something else', blurb: 'My own design — show me every part', test: 'auto', circuit: null, parts3d: null,
    notes: 'The person has not said what kind of robot this is. Ask one short question if the answer matters, otherwise help with what they asked for.' },
];
export const robotType = id => ROBOT_TYPES.find(t => t.id === id) || null;
/** Is this a type we know? (A project file from somewhere else might say anything.) */
export const cleanRobotType = v => (robotType(String(v ?? '')) ? String(v) : null);

/** The circuit parts to show first for a type, as part type ids that exist, in order; null means "everything". */
export function circuitPartsFor(id, exists = () => true) {
  const t = robotType(id); if (!t?.circuit) return null;
  return t.circuit.map(p => [p, `custom-${p}`].find(exists)).filter(Boolean);      // ready-made template parts are stored as custom-<id>; the built-in ones are plain
}
/** The 3D parts to show first for a type (ids); null means "everything". */
export function parts3dFor(id) { const t = robotType(id); return t?.parts3d || null; }
/** Test tab: 'fly' | 'robot' | 'auto'. */
export const testFor = id => robotType(id)?.test || 'auto';
/** A short paragraph for the AI: what the person is building, so it does not have to guess. */
export function robotTypeNotes(id) { const t = robotType(id); return t ? `The person chose "${t.name}" when starting this project. ${t.notes}` : ''; }
/** Preset names (for lookups in tests and the list): id → name. */
export const PRESET_NAMES = Object.fromEntries([...DRONE_PRESETS, ...KIT_PRESETS].map(([n, id]) => [id, n]));
/** When the project has not said what it is building, the short AI prompt still lists these (template parts are stored as custom-<id>). */
export const ROBOTICS_STARTERS = ['servo', 'dc-motor', 'l298n', 'custom-tb6612', 'hc-sr04', 'mpu6050', 'battery', 'custom-drone-aio', 'custom-drone-motor', 'custom-drone-battery'];
