// What tells one robot from the next: very little. They are plain machines off
// the same line, a pale shell over a dark frame with a blank visor, so a look
// is only a build, a shade, and the umbrella it carries in the rain.

const SHELLS = [[0.6, 0.6, 0.585], [0.6, 0.6, 0.585], [0.6, 0.6, 0.585], [0.42, 0.43, 0.44], [0.26, 0.27, 0.285]];
const BROLLIES = [[0.02, 0.02, 0.025], [0.02, 0.02, 0.025], [0.09, 0.09, 0.1], [0.3, 0.3, 0.32], [0.62, 0.62, 0.6]];

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

/** Someone off the street. `rnd` gives numbers in [0, 1). */
export function randomLook(rnd) {
  return {
    frame: rnd() < 0.5 ? 'a' : 'b', // broad or slight
    shell: pick(rnd, SHELLS),
    build: [0.95 + rnd() * 0.12, 0.93 + rnd() * 0.13], // width, height
    brolly: pick(rnd, BROLLIES),
    cake: false,
    _norm: true,
  };
}

/** Fill in whatever a rider in data/riders.js leaves out: any of the fields above. */
export function normalizeLook(raw) {
  if (raw._norm) return raw;
  return {
    frame: raw.frame || 'a',
    shell: raw.shell || SHELLS[0],
    build: raw.build || [1, 1],
    brolly: raw.brolly || BROLLIES[0],
    // what a rider has on their knees
    cake: !!raw.cake,
    _norm: true,
  };
}
