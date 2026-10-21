// MPU-6050 (GY-521 module): 3-axis accelerometer + 3-axis gyroscope + temperature, on I²C at 0x68
// (0x69 when AD0 is pulled high). A register-level model — Wire code, Adafruit_MPU6050, MPU6050_light and
// I2Cdev all talk to it the way they talk to the real chip. Pure and DOM-free.
//
// The board's orientation comes from the user (roll / pitch / yaw, intrinsic Z-Y-X, degrees). The
// accelerometer reports gravity in the board's own frame (+1 g on Z when lying flat, component up), the
// gyroscope reports how fast the orientation is changing, in the board's frame, in °/s.

export const MPU_ADDR = 0x68, MPU_ADDR_AD0 = 0x69;
const R = {
  SMPLRT_DIV: 0x19, CONFIG: 0x1a, GYRO_CONFIG: 0x1b, ACCEL_CONFIG: 0x1c, INT_ENABLE: 0x38, INT_STATUS: 0x3a,
  ACCEL_XOUT_H: 0x3b, TEMP_OUT_H: 0x41, GYRO_XOUT_H: 0x43, GYRO_ZOUT_L: 0x48,
  SIGNAL_PATH_RESET: 0x68, USER_CTRL: 0x6a, PWR_MGMT_1: 0x6b, PWR_MGMT_2: 0x6c, WHO_AM_I: 0x75,
};
const ACCEL_LSB = [16384, 8192, 4096, 2048];      // per g, for ±2/4/8/16 g
const GYRO_LSB = [131, 65.5, 32.8, 16.4];          // per °/s, for ±250/500/1000/2000 °/s
const rad = d => (d * Math.PI) / 180;
const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Gravity as the accelerometer sees it, in g, for a board at (roll, pitch, yaw) degrees. Yaw doesn't change it. */
export function gravityInBody(roll, pitch) {
  const r = rad(roll), p = rad(pitch);
  return { x: -Math.sin(p), y: Math.sin(r) * Math.cos(p), z: Math.cos(r) * Math.cos(p) };
}

/** Body-frame angular velocity (°/s) from Z-Y-X Euler angles and their rates (°/s). */
export function bodyRates({ roll, pitch }, { droll, dpitch, dyaw }) {
  const r = rad(roll), p = rad(pitch);
  return {
    x: droll - dyaw * Math.sin(p),
    y: dpitch * Math.cos(r) + dyaw * Math.sin(r) * Math.cos(p),
    z: -dpitch * Math.sin(r) + dyaw * Math.cos(r) * Math.cos(p),
  };
}
const wrap180 = d => ((((d + 180) % 360) + 360) % 360) - 180;

export class Mpu6050 {
  constructor() {
    this.regs = new Uint8Array(128);
    this.pointer = 0; this.expectPointer = false;
    this.pose = { roll: 0, pitch: 0, yaw: 0 }; this.tempC = 25;
    this.gyro = { x: 0, y: 0, z: 0 };
    this.lastPose = null; this.lastT = null;
    this.reset();
  }
  reset() { this.regs.fill(0); this.regs[R.PWR_MGMT_1] = 0x40; this.regs[R.WHO_AM_I] = 0x68; }   // powers up asleep, like the real chip
  get asleep() { return !!(this.regs[R.PWR_MGMT_1] & 0x40); }
  get accelRange() { return [2, 4, 8, 16][(this.regs[R.ACCEL_CONFIG] >> 3) & 3]; }
  get gyroRange() { return [250, 500, 1000, 2000][(this.regs[R.GYRO_CONFIG] >> 3) & 3]; }

  /** Feed the user's orientation (degrees) at simulated time t (s); the gyroscope follows how fast it changes. */
  setPose({ roll = 0, pitch = 0, yaw = 0, temp }, t) {
    const pose = { roll: +roll || 0, pitch: +pitch || 0, yaw: +yaw || 0 };
    if (Number.isFinite(+temp)) this.tempC = +temp;
    if (this.lastPose && t > this.lastT) {
      const dt = t - this.lastT;
      const rates = { droll: wrap180(pose.roll - this.lastPose.roll) / dt, dpitch: wrap180(pose.pitch - this.lastPose.pitch) / dt, dyaw: wrap180(pose.yaw - this.lastPose.yaw) / dt };
      const w = bodyRates(pose, rates), k = Math.min(1, dt / 0.05);       // ~50 ms smoothing, and back to 0 once you stop moving it
      for (const a of ['x', 'y', 'z']) this.gyro[a] += (w[a] - this.gyro[a]) * k;
      this.lastPose = pose; this.lastT = t;
    } else if (this.lastT == null || t > this.lastT) { this.lastPose = pose; this.lastT = t; }
    this.pose = pose;
  }

  /** What the registers would hold right now, in engineering units — also used for the AI's live readings. */
  readings() {
    const g = gravityInBody(this.pose.roll, this.pose.pitch);
    return { accel: g, gyro: { ...this.gyro }, tempC: this.tempC };
  }

  readRegister(r) {
    if (r >= R.ACCEL_XOUT_H && r <= R.GYRO_ZOUT_L) {
      if (this.asleep) return 0;                     // sleeping: the data registers are never updated
      const { accel, gyro, tempC } = this.readings();
      const a = ACCEL_LSB[(this.regs[R.ACCEL_CONFIG] >> 3) & 3], gl = GYRO_LSB[(this.regs[R.GYRO_CONFIG] >> 3) & 3];
      const words = [accel.x * a, accel.y * a, accel.z * a, (tempC - 36.53) * 340, gyro.x * gl, gyro.y * gl, gyro.z * gl].map(i16);
      const word = words[(r - R.ACCEL_XOUT_H) >> 1];
      return (r - R.ACCEL_XOUT_H) & 1 ? word & 0xff : (word >> 8) & 0xff;
    }
    if (r === R.INT_STATUS) return this.asleep ? 0 : 0x01;     // DATA_RDY
    return this.regs[r & 0x7f];
  }
  writeRegister(r, v) {
    if (r === R.PWR_MGMT_1 && v & 0x80) { this.reset(); return; }   // DEVICE_RESET
    if (r === R.WHO_AM_I) return;
    this.regs[r & 0x7f] = v;
  }

  // ── I²C device interface (see src/sim/i2c.js) ──
  start() { this.expectPointer = true; }
  connect(write) { if (write) this.expectPointer = true; return true; }
  write(b) {
    if (this.expectPointer) { this.pointer = b & 0x7f; this.expectPointer = false; return true; }
    this.writeRegister(this.pointer, b); this.pointer = (this.pointer + 1) & 0x7f; return true;
  }
  read() { const v = this.readRegister(this.pointer); this.pointer = (this.pointer + 1) & 0x7f; return v; }
}
