/**
 * Dog breeds: proportions (metres, before `scale`), coat length and pattern, and voice.
 * The rig builder in dogRig.js turns one of these into a dog.
 */
export const BREEDS = {
  shiba: {
    id: 'shiba', name: 'Shiba Inu', blurb: 'Bright-eyed, fox-faced and a little bit stubborn.',
    scale: 1.0,
    fur: 0.016, // longest fur, metres
    body: { len: 0.5, r: 0.125, chest: 1.1, hips: 0.94, tuck: 0.8 },
    leg: { len: 0.27, r: 0.04 },
    neck: { len: 0.12, r: 0.082, angle: 0.8 },
    head: { r: 0.108, snoutLen: 0.082, snoutR: 0.05, cheeks: 1.0 },
    ears: { type: 'pointy', size: 0.088 },
    tail: { type: 'curl', len: 0.27, r: 0.045 },
    colors: { coat: '#d98a3c', under: '#fff2de', dark: '#b96f2b', earInner: '#f3c9a8', nose: '#2a1c19', eye: '#1f1512', collar: '#c9413b' },
    marks: { belly: true, muzzle: true, cheeks: true, brows: true, socks: true, tailTip: true },
    voice: { pitch: 1.05 }, pace: 1.0,
  },
  golden: {
    id: 'golden', name: 'Golden Retriever', blurb: 'Loves everyone. Loves water even more.',
    scale: 1.24,
    fur: 0.026, // longest fur, metres
    body: { len: 0.56, r: 0.135, chest: 1.12, hips: 0.95, tuck: 0.84 },
    leg: { len: 0.3, r: 0.043 },
    neck: { len: 0.13, r: 0.09, angle: 0.82 },
    head: { r: 0.11, snoutLen: 0.105, snoutR: 0.055, cheeks: 0.6 },
    ears: { type: 'floppy', size: 0.12 },
    tail: { type: 'feather', len: 0.36, r: 0.036 },
    colors: { coat: '#e3ae5a', under: '#f6d9a2', dark: '#c98f3f', earInner: '#c98f3f', nose: '#2d201c', eye: '#241813', collar: '#3f7fbf' },
    marks: { belly: true, fluff: true },
    voice: { pitch: 0.78 }, pace: 1.06,
  },
  corgi: {
    id: 'corgi', name: 'Corgi', blurb: 'Short legs, big ears, bigger opinions.',
    scale: 0.98,
    fur: 0.016, // longest fur, metres
    body: { len: 0.58, r: 0.132, chest: 1.06, hips: 1.02, tuck: 0.95 },
    leg: { len: 0.15, r: 0.04 },
    neck: { len: 0.1, r: 0.085, angle: 0.72 },
    head: { r: 0.11, snoutLen: 0.085, snoutR: 0.048, cheeks: 0.9 },
    ears: { type: 'pointy', size: 0.115 },
    tail: { type: 'stub', len: 0.05, r: 0.05 },
    colors: { coat: '#e09a4c', under: '#fff6ea', dark: '#c47f35', earInner: '#f2c4a6', nose: '#2a1c19', eye: '#1f1512', collar: '#3e9b7a' },
    marks: { belly: true, muzzle: true, blaze: true, socks: true, chest: true },
    voice: { pitch: 1.2 }, pace: 0.9,
  },
  dalmatian: {
    id: 'dalmatian', name: 'Dalmatian', blurb: 'One hundred and one percent energy.',
    scale: 1.2,
    fur: 0.005, // longest fur, metres
    body: { len: 0.56, r: 0.12, chest: 1.14, hips: 0.9, tuck: 0.7 },
    leg: { len: 0.33, r: 0.036 },
    neck: { len: 0.15, r: 0.072, angle: 0.74 },
    head: { r: 0.102, snoutLen: 0.105, snoutR: 0.05, cheeks: 0.3 },
    ears: { type: 'floppy', size: 0.1 },
    tail: { type: 'long', len: 0.36, r: 0.028 },
    colors: { coat: '#f6f3ee', under: '#ffffff', dark: '#26221f', earInner: '#26221f', nose: '#1d1917', eye: '#1b1412', collar: '#d9483f' },
    marks: { spots: 26, darkEars: true },
    voice: { pitch: 0.9 }, pace: 1.12,
  },
  husky: {
    id: 'husky', name: 'Husky', blurb: 'Talkative. Dramatic. Sings at the moon.',
    scale: 1.2,
    fur: 0.022, // longest fur, metres
    body: { len: 0.55, r: 0.134, chest: 1.1, hips: 0.95, tuck: 0.82 },
    leg: { len: 0.3, r: 0.042 },
    neck: { len: 0.13, r: 0.092, angle: 0.8 },
    head: { r: 0.11, snoutLen: 0.095, snoutR: 0.052, cheeks: 0.9 },
    ears: { type: 'pointy', size: 0.095 },
    tail: { type: 'bushy', len: 0.33, r: 0.058 },
    colors: { coat: '#6f7885', under: '#fbfbf8', dark: '#4a515c', earInner: '#e9d9d2', nose: '#221c1c', eye: '#7fc4e8', collar: '#7a52b8' },
    marks: { belly: true, muzzle: true, cheeks: true, mask: 'husky', socks: true, tailTip: true, brows: true },
    voice: { pitch: 0.84 }, pace: 1.08,
  },
  pug: {
    id: 'pug', name: 'Pug', blurb: 'Snores while awake. Professional napper.',
    scale: 0.82,
    fur: 0.005, // longest fur, metres
    body: { len: 0.44, r: 0.14, chest: 1.08, hips: 1.0, tuck: 0.96 },
    leg: { len: 0.2, r: 0.042 },
    neck: { len: 0.07, r: 0.1, angle: 0.7 },
    head: { r: 0.125, snoutLen: 0.03, snoutR: 0.062, cheeks: 0.7 },
    ears: { type: 'button', size: 0.07 },
    tail: { type: 'pigcurl', len: 0.11, r: 0.03 },
    colors: { coat: '#dcc091', under: '#ecd7b0', dark: '#3a2f2b', earInner: '#3a2f2b', nose: '#1d1716', eye: '#1b1412', collar: '#e06a8c' },
    marks: { mask: 'pug', darkEars: true },
    voice: { pitch: 1.35 }, pace: 0.82,
  },
  dachshund: {
    id: 'dachshund', name: 'Dachshund', blurb: 'Half a dog tall, a dog and a half long.',
    scale: 0.86,
    fur: 0.006, // longest fur, metres
    body: { len: 0.66, r: 0.108, chest: 1.1, hips: 0.95, tuck: 0.9 },
    leg: { len: 0.125, r: 0.036 },
    neck: { len: 0.11, r: 0.07, angle: 0.72 },
    head: { r: 0.092, snoutLen: 0.11, snoutR: 0.042, cheeks: 0.2 },
    ears: { type: 'long', size: 0.115 },
    tail: { type: 'long', len: 0.28, r: 0.024 },
    colors: { coat: '#8a4a2a', under: '#b9713f', dark: '#5f2f1a', earInner: '#5f2f1a', nose: '#1f1514', eye: '#1b1210', collar: '#e0b23c' },
    marks: { muzzle: true, brows: true, socks: true, darkEars: true },
    voice: { pitch: 1.28 }, pace: 0.86,
  },
  samoyed: {
    id: 'samoyed', name: 'Samoyed', blurb: 'A cloud with a smile.',
    scale: 1.1,
    fur: 0.034, // longest fur, metres
    body: { len: 0.52, r: 0.152, chest: 1.1, hips: 1.0, tuck: 0.95 },
    leg: { len: 0.27, r: 0.05 },
    neck: { len: 0.11, r: 0.115, angle: 0.8 },
    head: { r: 0.118, snoutLen: 0.078, snoutR: 0.052, cheeks: 1.25 },
    ears: { type: 'pointy', size: 0.075 },
    tail: { type: 'bushy', len: 0.3, r: 0.07, curl: 0.62 },
    colors: { coat: '#fbf8f1', under: '#ffffff', dark: '#ece4d6', earInner: '#f1d9d2', nose: '#231c1b', eye: '#1f1614', collar: '#4fa3d8' },
    marks: { fluff: true },
    voice: { pitch: 1.0 }, pace: 0.98,
  },
  blacklab: {
    id: 'blacklab', name: 'Black Labrador', blurb: 'Will fetch until the sun goes down. Then some more.',
    scale: 1.22,
    fur: 0.008, // longest fur, metres
    body: { len: 0.56, r: 0.136, chest: 1.12, hips: 0.96, tuck: 0.84 },
    leg: { len: 0.3, r: 0.044 },
    neck: { len: 0.13, r: 0.09, angle: 0.8 },
    head: { r: 0.112, snoutLen: 0.105, snoutR: 0.056, cheeks: 0.4 },
    ears: { type: 'floppy', size: 0.105 },
    tail: { type: 'long', len: 0.36, r: 0.036 },
    colors: { coat: '#2b2a2d', under: '#34333a', dark: '#1e1d20', earInner: '#1e1d20', nose: '#151416', eye: '#5a3a22', collar: '#e8a23a' },
    marks: {},
    voice: { pitch: 0.74 }, pace: 1.08,
  },
};

export const PLAYER_BREEDS = ['shiba', 'corgi', 'golden', 'husky', 'dalmatian', 'dachshund', 'samoyed', 'pug', 'blacklab'];

/** The regulars at the park. */
export const NPC_CAST = [
  { name: 'Biscuit', breed: 'golden', home: [14, -8], traits: { swimmer: true, fetcher: 1, energy: 0.6 } },
  { name: 'Pepper', breed: 'dalmatian', home: [-12, -24], traits: { energy: 1.0, zoomies: 1 } },
  { name: 'Dumpling', breed: 'corgi', home: [8, 20], traits: { hungry: true, energy: 0.55 } },
  { name: 'Luna', breed: 'husky', home: [-30, 10], traits: { howler: true, energy: 0.7 } },
  { name: 'Olive', breed: 'pug', home: [-4, 6], traits: { sleepy: true, energy: 0.3 }, collar: '#8ccf6a' },
  { name: 'Miso', breed: 'samoyed', home: [26, 30], scale: 0.72, traits: { shy: true, energy: 0.5 }, collar: '#f0a23c' },
];
