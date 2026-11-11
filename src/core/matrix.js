// The 13 × 8 blue LED matrix on the Arduino UNO Q and VENTUNO Q (104 LEDs, drawn by the board's microcontroller). A frame is 104 on/off bits,
// row by row from the top-left, kept as a 26-character hex string so it saves in the project. Pure; the drawings live in src/parts/art-board.js.
export const MATRIX_COLS = 13, MATRIX_ROWS = 8, MATRIX_LEDS = MATRIX_COLS * MATRIX_ROWS;
export const EMPTY_FRAME = '0'.repeat(26);
/** The UNO R4 WiFi's matrix is 12 wide; every frame is still stored 13 wide, with the last column off. */
export const matrixCols = type => (type === 'arduino-uno-r4-wifi' ? 12 : MATRIX_COLS);

/** 26 hex characters → an array of 104 zeros and ones (anything malformed is an empty frame). */
export function decodeFrame(hex) {
  const s = String(hex || '').toLowerCase(), out = new Array(MATRIX_LEDS).fill(0);
  if (!/^[0-9a-f]{26}$/.test(s)) return out;
  for (let i = 0; i < MATRIX_LEDS; i++) out[i] = (parseInt(s[i >> 2], 16) >> (3 - (i & 3))) & 1;
  return out;
}
export function encodeFrame(bits) {
  let s = '';
  for (let n = 0; n < 26; n++) { let v = 0; for (let k = 0; k < 4; k++) v = (v << 1) | (bits[n * 4 + k] ? 1 : 0); s += v.toString(16); }
  return s;
}
/** Build a frame from row strings of '#' (on) and '.' (off), up to 8 rows of 13, anchored top-left. */
export function fromRows(rows) {
  const bits = new Array(MATRIX_LEDS).fill(0);
  rows.slice(0, MATRIX_ROWS).forEach((r, y) => [...String(r).slice(0, MATRIX_COLS)].forEach((ch, x) => { if (ch === '#') bits[y * MATRIX_COLS + x] = 1; }));
  return bits;
}
export const toggle = (bits, i) => bits.map((b, k) => (k === i ? b ^ 1 : b));
export const invert = bits => bits.map(b => b ^ 1);

export const PRESETS = {
  Heart: ['.............', '..##.....##..', '.####...####.', '.#####.#####.', '..#########..', '...#######...', '....#####....', '.....###.....'],
  Smile: ['.............', '...##...##...', '...##...##...', '.............', '.#.........#.', '..#.......#..', '...#######...', '.............'],
  Arrow: ['......#......', '.......#.....', '........#....', '###########..', '........#....', '.......#.....', '......#......', '.............'],
  Border: ['#############', '#...........#', '#...........#', '#...........#', '#...........#', '#...........#', '#...........#', '#############'],
  Checker: ['#.#.#.#.#.#.#', '.#.#.#.#.#.#.', '#.#.#.#.#.#.#', '.#.#.#.#.#.#.', '#.#.#.#.#.#.#', '.#.#.#.#.#.#.', '#.#.#.#.#.#.#', '.#.#.#.#.#.#.'],
  Wave: ['.............', '....##.......', '...#..#......', '..#....#...##.', '.#......#.#..#', '#........#...', '.............', '.............'],
};

/** Scrolling text: `columns` is a list of 8-bit-tall columns (an array of 8 zeros and ones each) made by a rasteriser; this slides a 13-wide window across them. */
export function scrollFrames(columns) {
  const pad = new Array(MATRIX_COLS).fill(0).map(() => new Array(MATRIX_ROWS).fill(0)), all = [...pad, ...columns, ...pad], frames = [];
  for (let s = 0; s + MATRIX_COLS <= all.length; s++) {
    const bits = new Array(MATRIX_LEDS).fill(0);
    for (let x = 0; x < MATRIX_COLS; x++) for (let y = 0; y < MATRIX_ROWS; y++) bits[y * MATRIX_COLS + x] = all[s + x][y] ? 1 : 0;
    frames.push(bits);
  }
  return frames;
}
