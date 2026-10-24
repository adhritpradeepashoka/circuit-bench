// The block palette for the circuit on the bench, and a ready-made starter program. Pure (no DOM, no Blockly): it only builds
// plain objects in Blockly's toolbox / saved-workspace JSON shapes.
//
// The palette follows the bench: a "Lights" drawer only appears when there is a light, "Screens" when there is a screen, and any
// part the app has no special block for still gets its pin blocks (kind 'pin'). Device blocks come pre-filled with a part, so a
// child drags out "turn LED 1 on" rather than choosing from a list first.
import { BLOCKS, HUES } from './blocks.js';

const n = v => ({ shadow: { type: 'cb_number', fields: { NUM: v } } });
const t = v => ({ shadow: { type: 'cb_text', fields: { TEXT: v } } });
const blk = (type, extra = {}) => ({ kind: 'block', type, ...extra });
const first = (bench, kind) => (bench?.devices || []).find(d => d.kind === kind);
const has = (bench, ...kinds) => (bench?.devices || []).some(d => kinds.includes(d.kind));
/** A device block pre-filled with the first part of its kind. */
const devBlock = (bench, type, extra = {}) => {
  const kind = BLOCKS[type]?.dev; const d = kind && first(bench, kind);
  return blk(type, { ...extra, fields: { ...(extra.fields || {}), ...(d ? { DEV: d.id } : {}) } });
};

export function buildToolbox(bench) {
  const cat = (name, colour, contents, id) => ({ kind: 'category', name, colour: String(colour), contents, ...(id ? { categorystyle: id } : {}) });
  const out = [];
  out.push(cat('Start', HUES.program, [blk('cb_setup'), blk('cb_loop')]));
  out.push(cat('Control', HUES.control, [
    blk('cb_wait', { inputs: { S: n(1) } }), blk('cb_repeat', { inputs: { N: n(10) } }), blk('cb_while'), blk('cb_wait_until'), blk('cb_if'), blk('cb_ifelse'),
  ]));
  const lights = [];
  if (has(bench, 'led')) lights.push(devBlock(bench, 'led_set'), devBlock(bench, 'led_bright', { inputs: { V: n(50) } }));
  if (has(bench, 'rgb')) lights.push(devBlock(bench, 'rgb_set', { inputs: { R: n(255), G: n(0), B: n(120) } }));
  if (lights.length) out.push(cat('Lights', HUES.light, lights));
  const input = [];
  if (has(bench, 'button')) input.push(devBlock(bench, 'button_down'));
  if (has(bench, 'switch')) input.push(devBlock(bench, 'switch_on'));
  if (has(bench, 'pot')) input.push(devBlock(bench, 'pot_value'));
  if (input.length) out.push(cat('Buttons & knobs', HUES.input, input));
  const sens = [];
  if (has(bench, 'ldr')) sens.push(devBlock(bench, 'ldr_bright'));
  if (has(bench, 'ntc')) sens.push(devBlock(bench, 'ntc_temp'));
  if (has(bench, 'pir')) sens.push(devBlock(bench, 'pir_motion'));
  if (has(bench, 'dht')) sens.push(devBlock(bench, 'dht_read'));
  if (has(bench, 'mpu')) sens.push(devBlock(bench, 'mpu_tilt'));
  if (sens.length) out.push(cat('Sensors', HUES.sensor, sens));
  const scr = [];
  if (has(bench, 'oled')) scr.push(devBlock(bench, 'oled_text', { inputs: { X: t('hello') } }), devBlock(bench, 'oled_clear'));
  if (has(bench, 'lcd')) scr.push(devBlock(bench, 'lcd_text', { inputs: { X: t('hello') } }), devBlock(bench, 'lcd_clear'));
  if (has(bench, 'seg')) scr.push(devBlock(bench, 'seg_digit', { inputs: { N: n(5) } }), devBlock(bench, 'seg_off'));
  if (scr.length) out.push(cat('Screens', HUES.screen, scr));
  if (has(bench, 'driver')) out.push(cat('Motors', HUES.motor, [devBlock(bench, 'motor_run', { inputs: { V: n(70) } }), devBlock(bench, 'motor_stop')]));
  if (has(bench, 'pin')) out.push(cat('Other parts', HUES.pin, [devBlock(bench, 'pin_set'), devBlock(bench, 'pin_read'), devBlock(bench, 'pin_analog'), devBlock(bench, 'pin_pwm', { inputs: { V: n(128) } })]));
  out.push(cat('Say', HUES.say, [blk('cb_say', { inputs: { X: t('hello') } }), blk('cb_text'), blk('cb_join')]));
  out.push(cat('Logic', HUES.logic, [blk('cb_compare', { inputs: { A: n(0), B: n(0) } }), blk('cb_andor'), blk('cb_not'), blk('cb_bool')]));
  out.push(cat('Numbers', HUES.math, [
    blk('cb_number'), blk('cb_arith', { inputs: { A: n(1), B: n(1) } }), blk('cb_random', { inputs: { A: n(1), B: n(6) } }),
    blk('cb_map', { inputs: { X: n(50), A: n(0), B: n(100), C: n(0), D: n(255) } }), blk('cb_round', { inputs: { X: n(2.5) } }), blk('cb_seconds'),
  ]));
  out.push({ kind: 'category', name: 'Variables', colour: String(HUES.vars), custom: 'VARIABLE' });
  out.push(cat('Any pin', HUES.pin, [blk('anypin_set'), blk('anypin_pwm', { inputs: { V: n(128) } }), blk('anypin_read'), blk('anypin_analog')]));
  return { kind: 'categoryToolbox', contents: out };
}

/* ───────────────── starter program ───────────────── */
let seq = 0;
const bid = () => `s${++seq}`;
const B = (type, o = {}) => ({ type, id: bid(), ...o });
const num = v => ({ block: B('cb_number', { fields: { NUM: v } }) });
const chain = bs => { for (let i = 0; i < bs.length - 1; i++) bs[i].next = { block: bs[i + 1] }; return bs[0]; };

/**
 * A small program that already does something with what is on the bench: a button lights a light, a knob dims it, otherwise the
 * first light blinks. Returns Blockly's saved-workspace JSON, or null when there is nothing to build on.
 */
export function starterProgram(bench) {
  seq = 0;
  const led = first(bench, 'led') || first(bench, 'rgb'), btn = first(bench, 'button') || first(bench, 'switch'), pot = first(bench, 'pot');
  const ledTypes = led?.kind === 'rgb' ? null : { set: 'led_set', bright: 'led_bright' };
  const setL = s => B('led_set', { fields: { DEV: led.id, S: s } });
  let body;
  if (led && ledTypes && btn) {
    const test = B(btn.kind === 'switch' ? 'switch_on' : 'button_down', { fields: { DEV: btn.id } });
    body = B('cb_ifelse', { inputs: { C: { block: test }, DO: { block: setL('ON') }, ELSE: { block: setL('OFF') } } });
  } else if (led && ledTypes && pot) {
    body = B('led_bright', { fields: { DEV: led.id }, inputs: { V: { block: B('pot_value', { fields: { DEV: pot.id } }) } } });
  } else if (led && ledTypes) {
    body = chain([setL('ON'), B('cb_wait', { inputs: { S: num(1) } }), setL('OFF'), B('cb_wait', { inputs: { S: num(1) } })]);
  } else if (led) {
    body = chain([
      B('rgb_set', { fields: { DEV: led.id }, inputs: { R: num(255), G: num(0), B: num(0) } }), B('cb_wait', { inputs: { S: num(1) } }),
      B('rgb_set', { fields: { DEV: led.id }, inputs: { R: num(0), G: num(0), B: num(255) } }), B('cb_wait', { inputs: { S: num(1) } }),
    ]);
  } else {
    body = B('cb_say', { inputs: { X: { block: B('cb_text', { fields: { TEXT: 'hello from my circuit' } }) } } });
    body = chain([body, B('cb_wait', { inputs: { S: num(1) } })]);
  }
  return { blocks: { languageVersion: 0, blocks: [B('cb_loop', { x: 24, y: 24, inputs: { DO: { block: body } } })] }, variables: [] };
}
