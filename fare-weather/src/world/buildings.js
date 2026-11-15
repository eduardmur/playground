// Buildings are plain boxes; everything that makes them read as architecture
// (window grids, brick, shop fronts, lit rooms at night) is drawn by one shader
// from facade coordinates in metres. That keeps the whole skyline in one draw call.
import * as THREE from 'three';
import { env, patchMaterial, GLSL_HASH, GeoBuilder, makeCanvas, canvasTexture } from './shared.js';
import { SIDEWALK_W, CURB_H } from './city.js';
import { mulberry32, randRange, pick, lerp } from '../core/utils.js';

const BRICK = [
  [0.27, 0.085, 0.055], [0.33, 0.15, 0.09], [0.4, 0.25, 0.16], [0.19, 0.09, 0.07],
  [0.48, 0.4, 0.31], [0.56, 0.53, 0.46], [0.24, 0.13, 0.1], [0.36, 0.2, 0.14],
];
const STONE = [
  [0.43, 0.42, 0.4], [0.52, 0.49, 0.43], [0.29, 0.3, 0.32], [0.58, 0.56, 0.53],
  [0.2, 0.2, 0.22], [0.47, 0.45, 0.4], [0.36, 0.35, 0.34], [0.62, 0.6, 0.55],
];
const FRAME = [
  [0.07, 0.08, 0.09], [0.22, 0.24, 0.27], [0.45, 0.47, 0.5], [0.12, 0.13, 0.15], [0.3, 0.27, 0.22],
];
const PLASTER = [
  [0.6, 0.55, 0.46], [0.5, 0.52, 0.5], [0.62, 0.48, 0.38], [0.42, 0.47, 0.5], [0.66, 0.63, 0.57], [0.5, 0.4, 0.36],
];

const STRIP_DEPTH = 22;

// styles understood by the facade shader
const ST = { GLASS: 0, GRID: 1, BRICK: 2, HOME: 3, RIBBON: 4, CIVIC: 5 };

// What the street sells: this is a city of robots, and so are its shops.
const SHOPS = [
  'BATTERY SWAP', 'Nut & Bolt', 'ROBOT REPAIR', 'CHARGE BAR', 'Ohm Sweet Ohm', 'SPARE PARTS', 'FIRMWARE CLINIC', 'Joint & Gasket',
  'OIL CHANGE', 'Blue Spark Charge', "Sal's Servos", 'ACTUATORS', 'Golden Gear', 'RE-SHELL', 'Big Sky Batteries', 'HARDWARE',
  'SENSOR OPTICS', 'Lucky Cog Lube Bar', 'CHARGE', 'Night Heron Oil Bar', 'COOLANT & SPIRITS', 'Corner Cell Shop', 'OPTICS', 'CALIBRATION',
  'Halcyon Tune-Up', 'Ink & Anchor Decals', 'CAMERAS', 'PAINT SHOP', 'Fern & Moss Polish', 'USED PARTS', 'CHROME', 'KARAOKE',
  'ARCADE', 'HOT SWAP', 'FAST CHARGE', "Dot's Oil Diner", 'SERVOS', 'COOLANT', 'Grease House', 'MANUALS',
  'Iron Works Garage', 'CELLS 88', 'Current House', 'BODEGA', 'DEGREASERS', 'FINGERS', 'Foot Repair', 'ANTENNAS',
  'Moth & Flame Welding', 'Second Story Manuals', 'Amp Amp', 'Velvet Lounge', 'Tiny Giant Bots', 'SOFT RESET', 'Copper Coil', 'CAPACITORS',
  'Slow Sunday Charge', 'Field Notes', 'BEARINGS', 'Honey & Rust', 'The Daily Grind', 'Wild Wire', 'OPEN 24 HRS', 'Parkside Dog Repair',
  'MINI MART', 'Juniper & Co', 'Tandem Charge', 'Marigold Paint', 'Little Wrench', 'Atlas Upgrades', 'Brass Monkey', 'Good Neighbor Cells',
  'NOODLE WIRE', 'Solder', 'The Annex', 'Postmark Parcels', 'Olive Drab Paint', 'North Star Oil Bar', 'Pearl Polish', 'Sourcecode Co',
];
const BLADES = ['OIL', 'CHARGE', 'OPEN', 'SWAP', 'HOTEL', 'LUBE', 'PARTS', 'FIX', 'RX', 'CELLS', '24H', 'JAZZ', 'INK', 'WELD', 'ATM', 'BOLT'];
const SIGN_FONTS = [
  '700 44px "Helvetica Neue", Arial, sans-serif',
  '600 46px Georgia, "Times New Roman", serif',
  '800 40px "Avenir Next Condensed", "Arial Narrow", sans-serif',
  '500 44px Futura, "Trebuchet MS", sans-serif',
  'italic 600 46px Georgia, serif',
  '700 38px "Courier New", monospace',
  '400 50px "Snell Roundhand", "Brush Script MT", cursive',
];
const SIGN_SCHEMES = [
  ['#15171a', '#f4efe3'], ['#f1ece0', '#1c1c1c'], ['#0f2a22', '#f2e6c8'], ['#5c1313', '#ffe9c9'], ['#10203a', '#ffd27a'],
  ['#1a1a1a', '#ff5a5a'], ['#111318', '#6fe3ff'], ['#f5f0e6', '#b3261e'], ['#2b2118', '#ffb347'], ['#0e1512', '#8dffb0'],
  ['#231a2e', '#ff9be0'], ['#e9e4d8', '#1f3a5f'],
];

const ATLAS = 2048;
const FLAT_W = 256, FLAT_H = 64, FLAT_COLS = 8, FLAT_ROWS = 16;
const POI_W = 512, POI_H = 128, POI_Y = 1024, POI_COLS = 4;
const BLADE_W = 128, BLADE_H = 192, BLADE_Y = 1664;

function buildSignAtlas(city) {
  const c = makeCanvas(ATLAS, ATLAS);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, ATLAS, ATLAS);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rnd = mulberry32(99);
  for (let i = 0; i < FLAT_COLS * FLAT_ROWS; i++) {
    const x = (i % FLAT_COLS) * FLAT_W, y = Math.floor(i / FLAT_COLS) * FLAT_H;
    const name = SHOPS[i % SHOPS.length];
    const [bg, fg] = SIGN_SCHEMES[Math.floor(rnd() * SIGN_SCHEMES.length)];
    g.fillStyle = bg;
    g.fillRect(x, y, FLAT_W, FLAT_H);
    if (rnd() < 0.4) {
      g.strokeStyle = fg;
      g.globalAlpha = 0.55;
      g.lineWidth = 2;
      g.strokeRect(x + 5, y + 5, FLAT_W - 10, FLAT_H - 10);
      g.globalAlpha = 1;
    }
    g.fillStyle = fg;
    g.font = SIGN_FONTS[Math.floor(rnd() * SIGN_FONTS.length)];
    const w = g.measureText(name).width;
    const s = Math.min(1, (FLAT_W - 26) / w);
    g.save();
    g.translate(x + FLAT_W / 2, y + FLAT_H / 2 + 2);
    g.scale(s, s);
    g.fillText(name, 0, 0);
    g.restore();
  }
  // named places
  const pois = Object.values(city.poi).map((z) => z.poi);
  const POI_STYLE = {
    cafe: ['#1d2a22', '#f6e7c4', 'italic 600 78px Georgia, serif'],
    station: ['#16181c', '#f4f1e8', '600 70px "Helvetica Neue", Arial, sans-serif'],
    hospital: ['#f4f6f8', '#b3202a', '700 70px "Helvetica Neue", Arial, sans-serif'],
    theater: ['#2a0808', '#ffd98a', '700 82px Georgia, serif'],
    park: ['#12301f', '#e9f3d8', '500 74px Futura, "Trebuchet MS", sans-serif'],
    office: ['#101216', '#dfe6ee', '300 74px "Helvetica Neue", Arial, sans-serif'],
    hotel: ['#141018', '#f0d9a0', '400 84px Didot, Georgia, serif'],
    diner: ['#12161c', '#ff6a5c', '700 76px Futura, "Trebuchet MS", sans-serif'],
    market: ['#f3ecda', '#2f5a34', '600 70px Georgia, serif'],
    home: ['#1a1c20', '#e8e2d4', '400 72px Georgia, serif'],
    library: ['#e8e3d6', '#252525', '600 72px Georgia, serif'],
    venue: ['#0c0c10', '#ff8ad8', '800 80px "Avenir Next Condensed", "Arial Narrow", sans-serif'],
    school: ['#1b2433', '#f2e9d0', '600 70px Georgia, serif'],
    shop: ['#15233b', '#ffd27a', '700 70px "Helvetica Neue", Arial, sans-serif'],
    pier: ['#0e2a3a', '#f4f1e8', '700 84px Futura, "Trebuchet MS", sans-serif'],
  };
  const poiCell = {};
  pois.forEach((p, i) => {
    const x = (i % POI_COLS) * POI_W, y = POI_Y + Math.floor(i / POI_COLS) * POI_H;
    const [bg, fg, font] = POI_STYLE[p.kind] || POI_STYLE.home;
    g.fillStyle = bg;
    g.fillRect(x, y, POI_W, POI_H);
    g.fillStyle = fg;
    g.font = font;
    const label = p.kind === 'hospital' ? `✚ ${p.name}` : p.name;
    const w = g.measureText(label).width;
    const s = Math.min(1, (POI_W - 44) / w);
    g.save();
    g.translate(x + POI_W / 2, y + POI_H / 2 + 3);
    g.scale(s, s);
    g.fillText(label, 0, 0);
    g.restore();
    if (p.kind === 'theater' || p.kind === 'diner' || p.kind === 'venue') {
      g.fillStyle = fg;
      for (let k = 0; k < 30; k++) {
        g.beginPath();
        g.arc(x + 14 + (k * (POI_W - 28)) / 29, y + 9, 3.2, 0, 7);
        g.arc(x + 14 + (k * (POI_W - 28)) / 29, y + POI_H - 9, 3.2, 0, 7);
        g.fill();
      }
    }
    poiCell[p.id] = [x / ATLAS, y / ATLAS, POI_W / ATLAS, POI_H / ATLAS];
  });
  // small signs that hang out over the pavement
  for (let i = 0; i < 16; i++) {
    const x = i * BLADE_W, y = BLADE_Y;
    const [bg, fg] = SIGN_SCHEMES[(i * 5 + 3) % SIGN_SCHEMES.length];
    g.fillStyle = bg;
    g.fillRect(x, y, BLADE_W, BLADE_H);
    g.strokeStyle = fg;
    g.lineWidth = 5;
    g.strokeRect(x + 9, y + 9, BLADE_W - 18, BLADE_H - 18);
    g.fillStyle = fg;
    g.font = '800 52px "Avenir Next Condensed", "Arial Narrow", sans-serif';
    const word = BLADES[i];
    const w = g.measureText(word).width;
    const s = Math.min(1, (BLADE_W - 30) / w);
    g.save();
    g.translate(x + BLADE_W / 2, y + BLADE_H / 2 + 3);
    g.scale(s, s);
    g.fillText(word, 0, 0);
    g.restore();
  }
  const tex = canvasTexture(c, { aniso: 8 });
  tex.flipY = false;
  return { tex, poiCell };
}

export class Buildings {
  constructor(city) {
    this.city = city;
    this.boxes = []; // {x0,z0,x1,z1,h} for working out when the cab is in shade
    this.beacons = []; // aircraft warning lights
    this.entrances = []; // where a canopy stands, for props
    this.gb = new GeoBuilder({ uv: 2, color: 3, aInfo: 4, aInfo2: 4 });
    this.sg = new GeoBuilder({ uv: 2, color: 3 }); // signs
    this.ag = new GeoBuilder({ color: 3 }); // awnings, canopies
    const { tex, poiCell } = buildSignAtlas(city);
    this.signTex = tex;
    this.poiCell = poiCell;

    for (const b of city.blocks) {
      const rnd = mulberry32(b.seed);
      if (b.kind === 'tower') this._towerBlock(b, rnd);
      else if (b.kind === 'park') continue;
      else this._rowBlock(b, rnd);
    }
    for (const s of city.strips) this._strip(s, mulberry32(s.x0 * 13 + s.z0));
    this._skyline(mulberry32(4242));

    this.material = this._facadeMaterial();
    this.mesh = new THREE.Mesh(this.gb.build(), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.signMat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.55, metalness: 0, vertexColors: true,
    });
    this.signs = new THREE.Mesh(this.sg.build(), this.signMat);
    this.signs.frustumCulled = false;

    this.awningMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.awnings = new THREE.Mesh(this.ag.build(), this.awningMat);
    this.awnings.castShadow = true;
    this.awnings.receiveShadow = true;
    this.awnings.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.mesh, this.signs, this.awnings);
    this.gb = this.sg = this.ag = null;
  }

  // ------------------------------------------------------------ primitives

  /**
   * A box of facade. P: { style, seed, floorH, bay, groundH, color, lit, tint, v0, roof, plain, faces }
   * `faces` is a 4-bit mask (N,E,S,W) of walls worth drawing.
   */
  _box(x0, z0, x1, z1, y0, y1, P) {
    const gb = this.gb;
    const kind = P.plain ? 2 : 0;
    const v0 = P.v0 ?? 0, H = y1 - y0;
    const wall = (ax, az, bx, bz, nx, nz) => {
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(L / P.bay));
      const info = [P.style, P.seed, P.floorH, L / n];
      const info2 = [kind, P.groundH || 0, P.lit || 0, P.tint || 0];
      const a = gb.vert(ax, y0, az, nx, 0, nz, { uv: [0, v0], color: P.color, aInfo: info, aInfo2: info2 });
      const b = gb.vert(bx, y0, bz, nx, 0, nz, { uv: [L, v0], color: P.color, aInfo: info, aInfo2: info2 });
      const c = gb.vert(bx, y1, bz, nx, 0, nz, { uv: [L, v0 + H], color: P.color, aInfo: info, aInfo2: info2 });
      const d = gb.vert(ax, y1, az, nx, 0, nz, { uv: [0, v0 + H], color: P.color, aInfo: info, aInfo2: info2 });
      gb.quadIdx(a, b, c, d);
    };
    const f = P.faces ?? 15;
    if (f & 1) wall(x1, z0, x0, z0, 0, -1); // north
    if (f & 2) wall(x1, z1, x1, z0, 1, 0); // east
    if (f & 4) wall(x0, z1, x1, z1, 0, 1); // south
    if (f & 8) wall(x0, z0, x0, z1, -1, 0); // west
    if (P.roof !== false) {
      const info = [0, P.seed, 1, 1], info2 = [1, 0, 0, 0];
      const col = [0.2, 0.2, 0.21];
      const a = gb.vert(x0, y1, z0, 0, 1, 0, { uv: [x0, z0], color: col, aInfo: info, aInfo2: info2 });
      const b = gb.vert(x0, y1, z1, 0, 1, 0, { uv: [x0, z1], color: col, aInfo: info, aInfo2: info2 });
      const c = gb.vert(x1, y1, z1, 0, 1, 0, { uv: [x1, z1], color: col, aInfo: info, aInfo2: info2 });
      const d = gb.vert(x1, y1, z0, 0, 1, 0, { uv: [x1, z0], color: col, aInfo: info, aInfo2: info2 });
      gb.quadIdx(a, b, c, d);
    }
    if (!P.noShade) this.boxes.push({ x0, z0, x1, z1, h: y1 });
  }

  /** A sign quad on a wall. (px,pz) is its centre on the wall, (nx,nz) the wall normal. */
  _sign(px, py, pz, nx, nz, w, h, cell, bright = 1) {
    const sg = this.sg;
    const tx = nz, tz = -nx; // left-to-right as seen from the street
    const ox = nx * 0.14, oz = nz * 0.14;
    const [u, v, uw, vh] = cell;
    const col = [bright, bright, bright];
    const a = sg.vert(px - tx * w / 2 + ox, py - h / 2, pz - tz * w / 2 + oz, nx, 0, nz, { uv: [u, v + vh], color: col });
    const b = sg.vert(px + tx * w / 2 + ox, py - h / 2, pz + tz * w / 2 + oz, nx, 0, nz, { uv: [u + uw, v + vh], color: col });
    const c = sg.vert(px + tx * w / 2 + ox, py + h / 2, pz + tz * w / 2 + oz, nx, 0, nz, { uv: [u + uw, v], color: col });
    const d = sg.vert(px - tx * w / 2 + ox, py + h / 2, pz - tz * w / 2 + oz, nx, 0, nz, { uv: [u, v], color: col });
    sg.quadIdx(a, b, c, d);
  }

  /** A sign sticking out from the wall, readable from both directions along the street. */
  _blade(px, py, pz, nx, nz, idx) {
    const sg = this.sg;
    const w = 0.85, h = 1.25, out = 0.25;
    const cell = [(idx * BLADE_W) / ATLAS, BLADE_Y / ATLAS, BLADE_W / ATLAS, BLADE_H / ATLAS];
    const tx = -nz, tz = nx;
    for (const s of [1, -1]) {
      const fx = tx * s, fz = tz * s; // facing along the street
      const x0 = px + nx * out, z0 = pz + nz * out, x1 = px + nx * (out + w), z1 = pz + nz * (out + w);
      const [u, v, uw, vh] = cell;
      const ua = s === 1 ? u : u + uw, ub = s === 1 ? u + uw : u;
      const a = sg.vert(x0 + fx * 0.03, py - h / 2, z0 + fz * 0.03, fx, 0, fz, { uv: [ua, v + vh], color: [1, 1, 1] });
      const b = sg.vert(x1 + fx * 0.03, py - h / 2, z1 + fz * 0.03, fx, 0, fz, { uv: [ub, v + vh], color: [1, 1, 1] });
      const c = sg.vert(x1 + fx * 0.03, py + h / 2, z1 + fz * 0.03, fx, 0, fz, { uv: [ub, v], color: [1, 1, 1] });
      const d = sg.vert(x0 + fx * 0.03, py + h / 2, z0 + fz * 0.03, fx, 0, fz, { uv: [ua, v], color: [1, 1, 1] });
      if (s === 1) sg.quadIdx(a, b, c, d);
      else sg.quadIdx(a, d, c, b);
    }
  }

  /** A sloped fabric awning or a flat canopy slab over the pavement. */
  _awning(px, py, pz, nx, nz, w, depth, drop, col) {
    const ag = this.ag;
    const tx = -nz, tz = nx;
    const ax = px - tx * w / 2, az = pz - tz * w / 2, bx = px + tx * w / 2, bz = pz + tz * w / 2;
    const ox = nx * depth, oz = nz * depth;
    const l = Math.hypot(depth, drop);
    const ny = depth / l, nh = drop / l;
    const a = ag.vert(ax, py, az, nx * nh, ny, nz * nh, { color: col });
    const b = ag.vert(bx, py, bz, nx * nh, ny, nz * nh, { color: col });
    const c = ag.vert(bx + ox, py - drop, bz + oz, nx * nh, ny, nz * nh, { color: col });
    const d = ag.vert(ax + ox, py - drop, az + oz, nx * nh, ny, nz * nh, { color: col });
    ag.quadIdx(a, b, c, d);
    // front valance
    const dk = col.map((v) => v * 0.8);
    const e = ag.vert(ax + ox, py - drop, az + oz, nx, 0, nz, { color: dk });
    const f = ag.vert(bx + ox, py - drop, bz + oz, nx, 0, nz, { color: dk });
    const g2 = ag.vert(bx + ox, py - drop - 0.28, bz + oz, nx, 0, nz, { color: dk });
    const h = ag.vert(ax + ox, py - drop - 0.28, az + oz, nx, 0, nz, { color: dk });
    ag.quadIdx(e, f, g2, h);
  }

  // ------------------------------------------------------------ rows of buildings

  /**
   * One row of buildings along a street frontage.
   * The frontage runs from `a` to `c` along the block side; `depth` goes inward.
   */
  _row(rnd, side, x0, z0, x1, z1, depth, kind, poiZone) {
    // frontage axis: sides 0/2 run along x, sides 1/3 along z
    const horiz = side === 0 || side === 2;
    const a = horiz ? x0 : z0, c = horiz ? x1 : z1;
    const L = c - a;
    const cuts = [];
    const wmin = kind === 'lowrise' ? 9 : 16, wmax = kind === 'lowrise' ? 24 : 40;
    if (poiZone) {
      // keep one generous building centred on the named place
      const mid = (horiz ? poiZone.cx : poiZone.cz) - a;
      const pw = Math.min(L - 4, kind === 'lowrise' ? 24 : 32);
      const p0 = Math.max(0, mid - pw / 2), p1 = Math.min(L, mid + pw / 2);
      const fill = (from, to, out) => {
        let u = from;
        while (to - u > wmin * 0.7) {
          let w = randRange(rnd, wmin, wmax);
          if (to - u - w < wmin * 0.7) w = to - u;
          out.push([u, u + w, false]);
          u += w;
        }
      };
      fill(0, p0, cuts);
      cuts.push([p0, p1, true]);
      fill(p1, L, cuts);
    } else {
      let u = 0;
      while (L - u > wmin * 0.6) {
        let w = randRange(rnd, wmin, wmax);
        if (L - u - w < wmin * 0.7) w = L - u;
        cuts.push([u, u + w, false]);
        u += w;
      }
    }
    for (const [u0, u1, isPoi] of cuts) {
      if (!isPoi && rnd() < 0.045 && u1 - u0 < 18) continue; // a gap: an alley or a little yard
      const gap = rnd() < 0.2 ? randRange(rnd, 0.3, 1.2) : 0;
      const set = isPoi ? 0 : rnd() < 0.25 ? randRange(rnd, 0.3, 1.6) : 0;
      const d = depth * randRange(rnd, 0.82, 1);
      // footprint in world space
      let bx0, bz0, bx1, bz1, nx = 0, nz = 0;
      if (side === 0) { bx0 = x0 + u0 + gap; bx1 = x0 + u1; bz0 = z0 + set; bz1 = z0 + set + d; nz = -1; }
      else if (side === 2) { bx0 = x0 + u0 + gap; bx1 = x0 + u1; bz1 = z1 - set; bz0 = z1 - set - d; nz = 1; }
      else if (side === 3) { bz0 = z0 + u0 + gap; bz1 = z0 + u1; bx0 = x0 + set; bx1 = x0 + set + d; nx = -1; }
      else { bz0 = z0 + u0 + gap; bz1 = z0 + u1; bx1 = x1 - set; bx0 = x1 - set - d; nx = 1; }
      this._building(rnd, kind, bx0, bz0, bx1, bz1, nx, nz, isPoi ? poiZone : null);
    }
  }

  _building(rnd, kind, x0, z0, x1, z1, nx, nz, poiZone) {
    const y0 = CURB_H;
    let style, color, floors, floorH, bay, groundH, lit, tint = Math.floor(rnd() * 5);
    const r = rnd();
    if (kind === 'lowrise') {
      style = r < 0.6 ? ST.BRICK : r < 0.88 ? ST.HOME : ST.GRID;
      color = style === ST.BRICK ? pick(rnd, BRICK) : style === ST.HOME ? pick(rnd, PLASTER) : pick(rnd, STONE);
      floors = 1 + Math.floor(rnd() * 4.2);
      floorH = randRange(rnd, 3.2, 3.6);
      bay = style === ST.BRICK ? randRange(rnd, 2.4, 3.2) : randRange(rnd, 3, 4);
      groundH = rnd() < 0.86 ? randRange(rnd, 4, 4.6) : 0;
      lit = 0;
    } else {
      style = r < 0.3 ? ST.GRID : r < 0.52 ? ST.BRICK : r < 0.74 ? ST.HOME : r < 0.9 ? ST.RIBBON : ST.GLASS;
      color = style === ST.BRICK ? pick(rnd, BRICK) : style === ST.HOME ? pick(rnd, PLASTER) : style === ST.GLASS ? pick(rnd, FRAME) : pick(rnd, STONE);
      floors = 4 + Math.floor(rnd() * rnd() * 13);
      floorH = style === ST.HOME || style === ST.BRICK ? randRange(rnd, 3.1, 3.4) : randRange(rnd, 3.6, 4);
      bay = style === ST.GLASS ? randRange(rnd, 1.5, 1.9) : style === ST.BRICK ? randRange(rnd, 2.6, 3.4) : randRange(rnd, 3.2, 4.6);
      groundH = rnd() < 0.9 ? randRange(rnd, 4.2, 5.2) : 0;
      lit = style === ST.HOME || style === ST.BRICK ? 0 : 1;
    }
    if (poiZone) {
      const k = poiZone.poi.kind;
      groundH = k === 'station' || k === 'theater' || k === 'library' ? 6.5 : 5;
      if (k === 'hospital') { style = ST.RIBBON; color = [0.7, 0.71, 0.72]; floors = Math.max(floors, 8); lit = 1; }
      if (k === 'station' || k === 'library' || k === 'school') { style = ST.CIVIC; color = pick(rnd, [STONE[1], STONE[3], STONE[7]]); floors = 3; floorH = 5.4; bay = 4.2; lit = 1; }
      if (k === 'hotel') { style = ST.HOME; color = [0.5, 0.44, 0.36]; floors = Math.max(floors, 12); }
      if (k === 'theater') { style = ST.BRICK; color = [0.24, 0.1, 0.08]; floors = 4; floorH = 4.4; }
      if (k === 'home') { style = ST.HOME; floors = Math.max(floors, 7); lit = 0; }
      if (k === 'diner' || k === 'cafe' || k === 'shop' || k === 'market') floors = Math.min(floors, 3);
    }
    const seed = rnd();
    const H = groundH + floors * floorH + 0.9;
    const P = { style, seed, floorH, bay, groundH, color, lit, tint };
    this._box(x0, z0, x1, z1, y0, y0 + H, P);
    // roof clutter breaks up the skyline
    if (rnd() < 0.7) {
      const w = Math.min(x1 - x0, z1 - z0);
      const mw = randRange(rnd, 3, Math.max(3.5, w * 0.4)), mh = randRange(rnd, 1.6, 3.4);
      const mx = randRange(rnd, x0 + 1, Math.max(x0 + 1.1, x1 - mw - 1)), mz = randRange(rnd, z0 + 1, Math.max(z0 + 1.1, z1 - mw - 1));
      this._box(mx, mz, mx + mw, mz + mw, y0 + H, y0 + H + mh, { ...P, plain: true, color: [0.3, 0.3, 0.31], noShade: true });
    }
    // parapet cap, a little proud of the wall
    if (style === ST.BRICK || style === ST.HOME || style === ST.CIVIC) {
      const o = 0.22;
      this._box(x0 - o, z0 - o, x1 + o, z1 + o, y0 + H - 0.45, y0 + H + 0.12, { ...P, plain: true, color: color.map((v) => v * 0.78), noShade: true });
    }

    // street level: signs, awnings, the odd blade sign
    const horiz = nz !== 0;
    const fx = horiz ? (x0 + x1) / 2 : nx < 0 ? x0 : x1, fz = horiz ? (nz < 0 ? z0 : z1) : (z0 + z1) / 2;
    const L = horiz ? x1 - x0 : z1 - z0;
    if (poiZone) {
      const cell = this.poiCell[poiZone.poi.id];
      const k = poiZone.poi.kind;
      const sw = Math.min(L - 3, k === 'theater' ? 13 : 9.5), sh = sw / 4;
      const cy = y0 + groundH + (k === 'theater' ? 1.6 : 0.2) + sh / 2 - 0.4;
      const px = horiz ? poiZone.cx : fx, pz = horiz ? fz : poiZone.cz;
      this._sign(px, cy, pz, nx, nz, sw, sh, cell, 1);
      const canopyCol = k === 'theater' ? [0.5, 0.06, 0.05] : k === 'hotel' ? [0.1, 0.09, 0.12] : k === 'hospital' ? [0.75, 0.76, 0.78] : [0.13, 0.14, 0.15];
      this._awning(px, y0 + groundH - 0.5, pz, nx, nz, Math.min(L - 2, 9), 2.6, 0.12, canopyCol);
      this.entrances.push({ x: px + nx * 1.2, z: pz + nz * 1.2, nx, nz, y: y0 + groundH - 0.75, kind: k, w: Math.min(L - 2, 9) });
    } else if (groundH > 0) {
      const n = Math.max(1, Math.round(L / randRange(rnd, 7, 12)));
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.22) continue;
        const t = (i + 0.5) / n - 0.5;
        const px = horiz ? fx + t * L : fx, pz = horiz ? fz : fz + t * L;
        const sw = Math.min(L / n - 1.2, randRange(rnd, 3.2, 5.6)), sh = sw / 4;
        const ci = Math.floor(rnd() * FLAT_COLS * FLAT_ROWS);
        const cell = [((ci % FLAT_COLS) * FLAT_W) / ATLAS, (Math.floor(ci / FLAT_COLS) * FLAT_H) / ATLAS, FLAT_W / ATLAS, FLAT_H / ATLAS];
        this._sign(px, y0 + groundH - 0.62, pz, nx, nz, sw, Math.min(sh, 1.05), cell, randRange(rnd, 0.75, 1));
        if (rnd() < 0.34) {
          const col = pick(rnd, [[0.35, 0.06, 0.05], [0.06, 0.2, 0.12], [0.07, 0.11, 0.25], [0.5, 0.42, 0.28], [0.09, 0.09, 0.1], [0.45, 0.22, 0.05], [0.4, 0.4, 0.38]]);
          this._awning(px, y0 + groundH - 1.25, pz, nx, nz, L / n - 1, randRange(rnd, 1.1, 1.7), randRange(rnd, 0.45, 0.8), col);
        }
        if (rnd() < 0.22) this._blade(px + (horiz ? L / n / 2 - 0.6 : 0), y0 + groundH + 1.2, pz + (horiz ? 0 : L / n / 2 - 0.6), nx, nz, Math.floor(rnd() * 16));
      }
    }
  }

  _rowBlock(b, rnd) {
    const ins = SIDEWALK_W;
    const x0 = b.x0 + ins, x1 = b.x1 - ins, z0 = b.z0 + ins, z1 = b.z1 - ins;
    const depth = b.kind === 'lowrise' ? randRange(rnd, 15, 20) : randRange(rnd, 20, 26);
    // north and south rows take the full width; east and west rows fill the gap between them
    this._row(rnd, 0, x0, z0, x1, z1, depth, b.kind, b.pois[0] ? b.zones[0] : null);
    this._row(rnd, 2, x0, z0, x1, z1, depth, b.kind, b.pois[2] ? b.zones[2] : null);
    this._row(rnd, 3, x0, z0 + depth + 0.5, x1, z1 - depth - 0.5, depth, b.kind, b.pois[3] ? b.zones[3] : null);
    this._row(rnd, 1, x0, z0 + depth + 0.5, x1, z1 - depth - 0.5, depth, b.kind, b.pois[1] ? b.zones[1] : null);
  }

  _strip(s, rnd) {
    const ins = SIDEWALK_W;
    const depth = STRIP_DEPTH;
    if (s.side === 'N') this._row(rnd, 2, s.x0 + 6, s.z1 - ins - depth, s.x1, s.z1 - ins, depth, 'midrise', null);
    else if (s.side === 'S') this._row(rnd, 0, s.x0 + 6, s.z0 + ins, s.x1, s.z0 + ins + depth, depth, 'midrise', null);
    else this._row(rnd, 3, s.x0 + ins, s.z0, s.x0 + ins + depth, s.z1, depth, 'midrise', null);
  }

  // ------------------------------------------------------------ towers

  _towerBlock(b, rnd) {
    const y0 = CURB_H;
    const set = randRange(rnd, 1.5, 5);
    const x0 = b.x0 + SIDEWALK_W + set, x1 = b.x1 - SIDEWALK_W - set, z0 = b.z0 + SIDEWALK_W + set, z1 = b.z1 - SIDEWALK_W - set;
    const W = x1 - x0, D = z1 - z0;
    const two = W > 78 && rnd() < 0.55;
    const lots = two ? [[x0, z0, x0 + W / 2 - 3, z1], [x0 + W / 2 + 3, z0, x1, z1]] : [[x0, z0, x1, z1]];
    lots.forEach(([lx0, lz0, lx1, lz1], li) => {
      const glassy = rnd() < 0.72;
      const style = glassy ? ST.GLASS : rnd() < 0.5 ? ST.GRID : ST.RIBBON;
      const color = glassy ? pick(rnd, FRAME) : pick(rnd, STONE);
      const tint = Math.floor(rnd() * 5);
      const seed = rnd();
      const floorH = randRange(rnd, 3.8, 4.1);
      const bay = glassy ? randRange(rnd, 1.5, 1.8) : randRange(rnd, 3, 4.2);
      const lobby = randRange(rnd, 6, 8);
      const podF = 2 + Math.floor(rnd() * 3);
      const podH = lobby + podF * 4.4;
      const P = { style, seed, floorH: 4.4, bay, groundH: lobby, color, lit: 1, tint };
      this._box(lx0, lz0, lx1, lz1, y0, y0 + podH, P);
      // the shaft
      const lw = lx1 - lx0, ld = lz1 - lz0;
      const tw = lw * randRange(rnd, 0.6, 0.86), td = ld * randRange(rnd, 0.55, 0.8);
      const tx = lx0 + (lw - tw) * rnd(), tz = lz0 + (ld - td) * rnd();
      const centrality = 1 - Math.min(1, Math.hypot(b.i - 3.5, b.j - 3) / 3.2);
      const floors = Math.round(lerp(22, 58, centrality * 0.6 + rnd() * 0.4));
      let top = y0 + podH + floors * floorH;
      const PT = { style, seed: seed + 0.13, floorH, bay, groundH: 0, color, lit: 1, tint, v0: 0 };
      this._box(tx, tz, tx + tw, tz + td, y0 + podH, top, PT);
      // stepped crown
      let cx0 = tx, cz0 = tz, cx1 = tx + tw, cz1 = tz + td;
      const steps = Math.floor(rnd() * 3);
      for (let s = 0; s < steps; s++) {
        const k = randRange(rnd, 0.1, 0.2);
        const dx = (cx1 - cx0) * k, dz = (cz1 - cz0) * k;
        cx0 += dx; cx1 -= dx; cz0 += dz; cz1 -= dz;
        const h = Math.round(randRange(rnd, 2, 6)) * floorH;
        this._box(cx0, cz0, cx1, cz1, top, top + h, { ...PT, seed: seed + 0.2 + s * 0.1 });
        top += h;
      }
      const mh = randRange(rnd, 3, 7);
      const mx = (cx0 + cx1) / 2, mz = (cz0 + cz1) / 2, ms = Math.min(cx1 - cx0, cz1 - cz0) * 0.3;
      this._box(mx - ms, mz - ms, mx + ms, mz + ms, top, top + mh, { ...PT, plain: true, color: [0.16, 0.17, 0.18], noShade: true });
      top += mh;
      if (rnd() < 0.6) {
        const sh = randRange(rnd, 12, 34);
        this._box(mx - 0.3, mz - 0.3, mx + 0.3, mz + 0.3, top, top + sh, { ...PT, plain: true, color: [0.3, 0.3, 0.32], roof: false, noShade: true });
        top += sh;
      }
      this.beacons.push({ x: mx, y: top + 0.6, z: mz, phase: rnd() });
      // lobby entrances for named places
      for (let side = 0; side < 4; side++) {
        const zone = b.zones[side];
        if (!zone || !b.pois[side] || li !== 0) continue;
        const cell = this.poiCell[zone.poi.id];
        const nx = -zone.nx, nz = -zone.nz;
        // the wall of this lot that faces the zone
        const px = nx !== 0 ? (nx < 0 ? lots[0][0] : lots[lots.length - 1][2]) : Math.min(Math.max(zone.cx, lx0 + 6), lx1 - 6);
        const pz = nz !== 0 ? (nz < 0 ? lz0 : lz1) : Math.min(Math.max(zone.cz, lz0 + 6), lz1 - 6);
        this._sign(px, y0 + lobby + 1.4, pz, nx, nz, 10, 2.5, cell, 1);
        this._awning(px, y0 + lobby - 1.6, pz, nx, nz, 10, 3, 0.1, [0.1, 0.11, 0.12]);
        this.entrances.push({ x: px + nx * 1.4, z: pz + nz * 1.4, nx, nz, y: y0 + lobby - 1.85, kind: zone.poi.kind, w: 10 });
      }
    });
  }

  /** Far towers beyond the drivable city, so the horizon is never empty. */
  _skyline(rnd) {
    const c = this.city;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    for (let i = 0; i < 90; i++) {
      const ang = rnd() * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      if (dx < -0.25) continue; // the sea
      const r = randRange(rnd, 640, 1500);
      const x = cx + dx * r, z = cz + dz * r;
      if (x < c.maxX + 50 && x > c.minX - 50 && z > c.minZ - 50 && z < c.maxZ + 50) continue;
      const w = randRange(rnd, 26, 60), d = randRange(rnd, 26, 60);
      const h = randRange(rnd, 30, 150) * (r < 900 ? 1.25 : 1);
      const glassy = rnd() < 0.5;
      this._box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h, {
        style: glassy ? ST.GLASS : ST.GRID, seed: rnd(), floorH: 4, bay: glassy ? 1.7 : 3.6, groundH: 0,
        color: glassy ? pick(rnd, FRAME) : pick(rnd, STONE), lit: 1, tint: Math.floor(rnd() * 5), noShade: true,
      });
      if (h > 110 && rnd() < 0.5) this.beacons.push({ x, y: h + 2, z, phase: rnd() });
    }
  }

  // ------------------------------------------------------------ the facade shader

  _facadeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true });
    patchMaterial(
      mat,
      {
        vertexPars: /* glsl */ `
          attribute vec4 aInfo; attribute vec4 aInfo2;
          varying vec2 vFuv; varying vec4 vInfo; varying vec4 vInfo2;
        `,
        vertex: 'vFuv = uv; vInfo = aInfo; vInfo2 = aInfo2;',
        fragPars: /* glsl */ `
          uniform sampler2D uNoise;
          uniform float uNight, uLamp, uShop, uLate, uWet, uSnow, uTime;
          varying vec2 vFuv; varying vec4 vInfo; varying vec4 vInfo2;
          ${GLSL_HASH}
          float gWin; float gBlind; vec3 gEmis; float gRough; float gMetal; vec2 gTilt;
        `,
        fragColor: /* glsl */ `
          float fKind = vInfo2.x;
          gWin = 0.0; gBlind = 0.0; gEmis = vec3(0.0); gRough = 0.86; gMetal = 0.0; gTilt = vec2(0.0);
          vec3 wall = diffuseColor.rgb;
          float wn = texture2D(uNoise, vFuv * 0.019 + vInfo.y * 7.0).r;
          float wf = texture2D(uNoise, vFuv * 0.41).b;
          if (fKind < 0.5) {
            float style = vInfo.x, seed = vInfo.y, fh = vInfo.z, bw = vInfo.w;
            float gh = vInfo2.y, litc = vInfo2.z, tint = vInfo2.w;
            vec3 tintCol = tint < 0.5 ? vec3(0.4, 0.53, 0.62) : tint < 1.5 ? vec3(0.33, 0.5, 0.46) : tint < 2.5 ? vec3(0.56, 0.46, 0.33) : tint < 3.5 ? vec3(0.24, 0.27, 0.31) : vec3(0.6, 0.65, 0.7);
            // weathering
            wall *= 0.8 + 0.34 * wn;
            wall *= 1.0 - 0.14 * smoothstep(0.55, 0.9, texture2D(uNoise, vec2(vFuv.x * 0.37, vFuv.y * 0.016) + seed).g);
            wall *= 0.84 + 0.16 * smoothstep(0.0, 2.6, vFuv.y);
            if (style > 1.5 && style < 2.5) {
              vec2 bk = vFuv / vec2(0.23, 0.076);
              bk.x += 0.5 * mod(floor(bk.y), 2.0);
              float fadeB = 1.0 - smoothstep(0.12, 0.5, fwidth(bk.y));
              float mortar = max(smoothstep(0.43, 0.5, abs(fract(bk.x) - 0.5)), smoothstep(0.36, 0.5, abs(fract(bk.y) - 0.5)));
              wall *= 1.0 - 0.3 * mortar * fadeB;
              wall *= 1.0 + (hash21(floor(bk)) - 0.5) * 0.3 * fadeB;
            }
            float y = vFuv.y - gh;
            if (y >= 0.0) {
              vec2 cell = vec2(floor(vFuv.x / bw), floor(y / fh));
              vec2 f = vec2(fract(vFuv.x / bw), fract(y / fh));
              vec2 aa = vec2(fwidth(vFuv.x) / bw, fwidth(vFuv.y) / fh) * 0.8 + 1e-4;
              float mx, sill, head, sub;
              if (style < 0.5) { mx = 0.03; sill = 0.05; head = 0.8; sub = 0.0; }
              else if (style < 1.5) { mx = 0.12; sill = 0.27; head = 0.87; sub = 2.0; }
              else if (style < 2.5) { mx = 0.25; sill = 0.27; head = 0.8; sub = 0.0; }
              else if (style < 3.5) { mx = 0.16; sill = 0.2; head = 0.85; sub = 2.0; }
              else if (style < 4.5) { mx = 0.0; sill = 0.35; head = 0.83; sub = 3.0; }
              else { mx = 0.22; sill = 0.12; head = 0.9; sub = 0.0; }
              float wu = mx < 0.001 ? 1.0 : smoothstep(mx - aa.x, mx + aa.x, f.x) * (1.0 - smoothstep(1.0 - mx - aa.x, 1.0 - mx + aa.x, f.x));
              float wv = smoothstep(sill - aa.y, sill + aa.y, f.y) * (1.0 - smoothstep(head - aa.y, head + aa.y, f.y));
              float win = wu * wv;
              if (sub > 0.5) {
                float dm = abs(fract(f.x * sub + 0.5) - 0.5) / sub;
                win *= 1.0 - 0.9 * (1.0 - smoothstep(0.006, 0.006 + aa.x, dm)) * step(aa.x, 0.08);
              }
              // stone sill under the window, a thin shadow line above it
              float sillBand = wu * smoothstep(sill - 0.05 - aa.y, sill - 0.05 + aa.y, f.y) * (1.0 - smoothstep(sill - aa.y, sill + aa.y, f.y));
              wall = mix(wall, wall * 1.3 + 0.03, sillBand * step(1.5, style) * 0.7);
              // floor line
              float fl = 1.0 - smoothstep(0.0, 0.014 + aa.y, min(f.y, 1.0 - f.y));
              wall *= 1.0 - 0.25 * fl * (style < 0.5 ? 0.0 : 1.0);
              // far away a window is smaller than a pixel: settle on the average instead of shimmering
              float cov = (1.0 - 2.0 * mx) * (head - sill);
              win = mix(win, cov, smoothstep(0.22, 0.6, max(aa.x, aa.y)));
              gWin = win;
              float h1 = hash21(cell + seed * 113.0), h2 = hash21(cell * 1.7 + seed * 57.0 + 3.1);
              float rowH = hash11(cell.y * 7.3 + seed * 91.0);
              // blinds pulled part of the way down
              float bl = step(0.58, h2) * (litc > 0.5 ? 0.6 : 1.0);
              float blindEdge = head - (0.2 + 0.7 * h1) * (head - sill);
              gBlind = bl * smoothstep(blindEdge - aa.y, blindEdge + aa.y, f.y) * win;
              vec3 glass = tintCol * (0.72 + 0.3 * h1);
              gMetal = (style < 0.5 ? 0.93 : style > 3.5 && style < 4.5 ? 0.85 : 0.72) * win * (1.0 - gBlind);
              gRough = mix(0.86, 0.06 + 0.07 * h2, win * (1.0 - gBlind));
              gTilt = (hash22(cell + seed * 31.0) - 0.5) * 0.07 * win;
              vec3 blindCol = mix(vec3(0.62, 0.6, 0.55), vec3(0.4, 0.42, 0.45), h1);
              diffuseColor.rgb = mix(mix(wall, glass, win), blindCol, gBlind);
              // rooms at night
              float litFrac = mix(0.5, 0.14, uLate) * (litc > 0.5 ? 0.8 : 0.85);
              float pickv = litc > 0.5 ? mix(h1, rowH, 0.6) : h1;
              float on = step(1.0 - litFrac, pickv) * smoothstep(h2 * 0.7, h2 * 0.7 + 0.22, uNight);
              vec3 lc = litc > 0.5 ? mix(vec3(0.82, 0.9, 1.0), vec3(1.0, 0.86, 0.66), h2 * 0.6) : mix(vec3(1.0, 0.66, 0.36), vec3(1.0, 0.84, 0.62), h2);
              float tv = step(0.93, h1) * (1.0 - step(0.5, litc));
              lc = mix(lc, vec3(0.45, 0.6, 1.0) * (0.6 + 0.4 * sin(uTime * (3.0 + h2 * 5.0) + h1 * 40.0)), tv);
              // what you see of a lit room from the street: a bright ceiling with its row of fittings,
              // a dimmer back wall, furniture as dark shapes along the bottom, now and then a drawn curtain
              float wy = clamp((f.y - sill) / (head - sill), 0.0, 1.0);
              float wx = clamp((f.x - mx) / max(1.0 - 2.0 * mx, 0.01), 0.0, 1.0);
              float fittings = 0.72 + 0.28 * step(0.5, fract(wx * (2.0 + floor(h1 * 3.0)) + h2));
              float furn = step(0.35, hash11(floor(wx * 5.0 + h1 * 9.0) + cell.x * 3.1 + cell.y * 7.7)) * (1.0 - smoothstep(0.16, 0.24 + 0.22 * h2, wy));
              float room = mix(0.3, 1.0, smoothstep(0.6, 0.78, wy) * fittings) * (1.0 - 0.75 * furn);
              room = mix(room, 0.42 + 0.08 * sin(wx * 40.0), step(0.8, h2));
              gEmis = lc * on * win * room * (0.3 + 0.7 * h1) * mix(1.0, 0.45, gBlind) * 0.9;
            } else {
              // street level: shop fronts and lobbies
              float m = max(1.0, floor(4.7 / bw + 0.5));
              float sbw = bw * m;
              vec2 cell = vec2(floor(vFuv.x / sbw), -1.0);
              float fx = fract(vFuv.x / sbw);
              float aax = fwidth(vFuv.x) / sbw + 1e-4, aay = fwidth(vFuv.y) + 1e-4;
              float pier = 0.07;
              float gTop = litc > 0.5 ? gh - 0.7 : gh - 1.25, gBot = litc > 0.5 ? 0.25 : 0.55;
              float wu = smoothstep(pier - aax, pier + aax, fx) * (1.0 - smoothstep(1.0 - pier - aax, 1.0 - pier + aax, fx));
              float wv = smoothstep(gBot - aay, gBot + aay, vFuv.y) * (1.0 - smoothstep(gTop - aay, gTop + aay, vFuv.y));
              float win = wu * wv;
              float h1 = hash21(cell + seed * 71.0), h2 = hash21(cell * 2.3 + seed * 19.0);
              // door: a slimmer, darker panel
              float door = step(0.66, fx) * step(fx, 0.9) * (1.0 - step(0.5, litc));
              // mullions
              float dm = abs(fract(fx * 3.0 + 0.5) - 0.5) / 3.0;
              win *= 1.0 - 0.9 * (1.0 - smoothstep(0.008, 0.008 + aax, dm)) * step(aax, 0.05);
              gWin = win;
              // fascia above the glass, sometimes painted
              float fascia = step(gTop, vFuv.y);
              vec3 paint = mix(wall * 0.55, hash32(cell + seed * 5.0) * 0.35 + 0.04, step(0.55, h2) * (1.0 - step(0.5, litc)));
              wall = mix(wall, paint, fascia);
              vec3 glass = mix(vec3(0.05, 0.06, 0.07), tintCol * 0.5, 0.3) * (1.0 - 0.4 * door);
              gMetal = 0.6 * win;
              gRough = mix(0.86, 0.08, win);
              diffuseColor.rgb = mix(wall, glass, win);
              float open_ = litc > 0.5 ? 1.0 : step(0.26, h1);
              float amt = litc > 0.5 ? max(uShop, uNight * 0.8) : uShop * open_;
              vec3 lc = mix(vec3(1.0, 0.8, 0.56), vec3(0.9, 0.95, 1.0), step(0.6, h2));
              // whatever is in the window: shelves, displays, plants, people; seen only as dark shapes against the light
              float sx = vFuv.x / 0.62 + seed * 9.0;
              float sh = hash11(floor(sx) * 1.37 + cell.x * 7.1);
              float stockH = gBot + 0.35 + 1.5 * sh * sh;
              float sEdge = abs(fract(sx) - 0.5);
              float stock = step(0.3, sh) * (1.0 - smoothstep(stockH - 0.04, stockH + 0.04, vFuv.y)) * (1.0 - smoothstep(0.36, 0.46, sEdge)) * (litc > 0.5 ? 0.45 : 1.0);
              float up_ = 0.45 + 0.55 * smoothstep(gBot, gTop, vFuv.y);
              gEmis = lc * amt * win * up_ * (1.0 - 0.6 * stock) * (0.4 + 0.55 * h1) * (1.0 - 0.3 * door) * (litc > 0.5 ? 0.32 : 1.0);
            }
            // light from the street lamps washing up the lower walls
            gEmis += diffuseColor.rgb * vec3(1.0, 0.74, 0.46) * uLamp * 0.14 * exp(-vFuv.y / 6.0) * (0.55 + 0.45 * sin(vFuv.x * 0.2 + seed * 40.0)) * (1.0 - gWin * 0.7);
            diffuseColor.rgb *= mix(1.0, 0.84, uWet * (1.0 - gWin));
            gRough = mix(gRough, gRough * 0.72, uWet);
          } else if (fKind < 1.5) {
            float rn = texture2D(uNoise, vFuv * 0.05).g;
            diffuseColor.rgb = vec3(0.19, 0.19, 0.2) * (0.7 + 0.6 * rn) * (0.85 + 0.3 * wf);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.76, 0.8, 0.86), smoothstep(0.1, 0.5, uSnow + rn * 0.3 - 0.15) * step(0.01, uSnow));
          } else {
            diffuseColor.rgb = wall * (0.82 + 0.3 * wn);
          }
        `,
        fragSurface: 'roughnessFactor = gRough; metalnessFactor = gMetal;',
        fragNormal: /* glsl */ `
          if (gWin > 0.01) {
            // every pane of glass sits at its own slight angle, so reflections break into a patchwork
            vec3 tn = normalize(cross(vWNormal, vec3(0.0, 1.0, 0.0)));
            vec3 wn_ = normalize(vWNormal + tn * gTilt.x + vec3(0.0, gTilt.y, 0.0));
            normal = normalize((viewMatrix * vec4(wn_, 0.0)).xyz);
          }
        `,
        fragEmissive: 'totalEmissiveRadiance += gEmis;',
      },
      {
        uNoise: env.uNoise, uNight: env.uNight, uLamp: env.uLamp, uShop: env.uShop, uLate: env.uLate,
        uWet: env.uWet, uSnow: env.uSnow, uTime: env.uTime,
      },
    );
    return mat;
  }

  update() {
    this.signMat.emissiveIntensity = 0.1 + env.uShop.value * 1.25;
  }
}

