// The shape of one ECG heartbeat, shared by the generic ECG source and the chest electrodes of the body model.
const g = (x, mu, sd) => Math.exp(-0.5 * ((x - mu) / sd) ** 2);

/** One heartbeat: P, Q, R, S, T as Gaussians, phase 0..1 within the beat. Volts, R peak ≈ 1 mV. */
export function ecgBeat(phase) {
  return 0.00012 * g(phase, 0.16, 0.025) - 0.00015 * g(phase, 0.285, 0.008) + 0.001 * g(phase, 0.31, 0.011) - 0.00025 * g(phase, 0.335, 0.009) + 0.00030 * g(phase, 0.55, 0.045);
}
