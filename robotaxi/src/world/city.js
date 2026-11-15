// The city as data: a grid of named roads, the blocks between them, the lanes
// cars follow, the turns through each intersection, traffic-signal timing and
// the kerbside zones where riders get in and out. Nothing here touches three.js.
import { mulberry32, randRange, hash2 } from '../core/utils.js';

export const LANE_W = 3.5;
export const PARK_W = 2.5;
export const SIDEWALK_W = 4.6;
export const CURB_H = 0.15;
export const CORNER_R = 4.5;
export const XW_SETBACK = 1.0; // gap between the cross street's kerb line and the crosswalk
export const XW_LEN = 3.2; // crosswalk depth along the direction of travel
export const STOP_GAP = 1.0; // crosswalk to stop bar
export const STRIP_D = 34; // depth of the row of buildings beyond the outer roads
export const PROM_W = 11; // waterfront promenade
export const ZONE_HALF = 8.5; // half length of a pick-up zone (no parking inside)

// Compass directions as indices: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
export const DIRS = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];
export const opp = (d) => (d + 2) % 4;
export const rightOf = (d) => (d + 1) % 4;
export const leftOf = (d) => (d + 3) % 4;
/** Rotation about Y for an object whose local forward is -Z. */
export const yawOfDir = (d) => [0, -Math.PI / 2, Math.PI, Math.PI / 2][d];
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

export const SIG = { G: 0, Y: 1, R: 2 };
const YELLOW = 3.2, ALL_RED = 1.6;

const ROAD_TYPES = {
  street: { lanes: 1, median: 0, speed: 10.4, green: 17 },
  avenue: { lanes: 2, median: 0, speed: 12.4, green: 23 },
  boulevard: { lanes: 2, median: 3.4, speed: 13.2, green: 26 },
};

const V_ROADS = [
  ['Ocean Dr', 'street'],
  ['2nd Ave', 'street'],
  ['3rd Ave', 'avenue'],
  ['4th Ave', 'street'],
  ['Grand Blvd', 'boulevard'],
  ['6th Ave', 'street'],
  ['7th Ave', 'avenue'],
  ['8th Ave', 'street'],
  ['9th Ave', 'street'],
];
const H_ROADS = [
  ['Alder St', 'street'],
  ['Birch St', 'street'],
  ['Cedar St', 'avenue'],
  ['Dogwood St', 'street'],
  ['Elm St', 'street'],
  ['Fir St', 'avenue'],
  ['Ginkgo St', 'street'],
  ['Hazel St', 'street'],
  ['Juniper St', 'street'],
];

// What stands on each block, north row first: Tower, Midrise, Lowrise, Park.
const BLOCK_MAP = [
  'LLMMMMLL',
  'LMMTTMML',
  'MMTTTTML',
  'MTTTTTMM',
  'MMTTTMML',
  'LMMPMMLL',
  'LLMMMLLL',
  'LLLMLLLL',
];

/** Named places riders travel between: [id, name, block i, block j, side, kind]. */
export const POIS = [
  ['cafe', 'Juniper Charge Café', 1, 6, 0, 'cafe'],
  ['station', 'Central Station', 4, 3, 3, 'station'],
  ['hospital', 'Mercy Repair Clinic', 6, 1, 2, 'hospital'],
  ['theater', 'The Orpheum', 5, 4, 0, 'theater'],
  ['park', 'Linden Park', 3, 5, 0, 'park'],
  ['tower', 'Meridian Tower', 3, 3, 1, 'office'],
  ['hotel', 'Hotel Alto', 4, 1, 2, 'hotel'],
  ['diner', 'Night Owl Diner', 6, 6, 3, 'diner'],
  ['market', 'Cog & Coil Market', 1, 2, 1, 'market'],
  ['cobalt', 'The Cobalt', 6, 3, 0, 'home'],
  ['library', 'City Library', 2, 1, 2, 'library'],
  ['foundry', 'The Foundry', 5, 6, 1, 'venue'],
  ['hall', 'Northgate Hall', 2, 0, 2, 'school'],
  ['lofts', 'Harbor Lofts', 0, 5, 3, 'home'],
  ['records', 'Bluebird Records', 5, 0, 2, 'shop'],
  ['bakery', 'Sunrise Cell Bakery', 0, 1, 1, 'cafe'],
  ['studio', 'Kiln Studios', 7, 5, 3, 'office'],
  ['terrace', 'Marlowe Terrace', 1, 4, 2, 'home'],
];

export class City {
  constructor(seed = 20261114) {
    const rnd = mulberry32(seed);
    this.seed = seed;
    this.NX = 8;
    this.NZ = 8;

    const mkRoad = (axis, index, [name, type]) => {
      const t = ROAD_TYPES[type];
      return {
        axis, index, name, type,
        lanes: t.lanes, median: t.median, speed: t.speed, green: t.green,
        hw: t.median / 2 + t.lanes * LANE_W + PARK_W,
        pos: 0,
      };
    };
    this.vRoads = V_ROADS.map((d, i) => mkRoad('v', i, d));
    this.hRoads = H_ROADS.map((d, j) => mkRoad('h', j, d));

    // block sizes between kerb lines
    const bw = [], bd = [];
    for (let i = 0; i < this.NX; i++) bw.push(Math.round(randRange(rnd, 82, 112)));
    for (let j = 0; j < this.NZ; j++) bd.push(Math.round(randRange(rnd, 74, 104)));
    let x = 0;
    this.vRoads[0].pos = 0;
    for (let i = 0; i < this.NX; i++) {
      x += this.vRoads[i].hw + bw[i] + this.vRoads[i + 1].hw;
      this.vRoads[i + 1].pos = x;
    }
    let z = 0;
    for (let j = 0; j < this.NZ; j++) {
      z += this.hRoads[j].hw + bd[j] + this.hRoads[j + 1].hw;
      this.hRoads[j + 1].pos = z;
    }
    const cx = x / 2, cz = z / 2;
    for (const r of this.vRoads) r.pos -= cx;
    for (const r of this.hRoads) r.pos -= cz;

    this.minX = this.vRoads[0].pos - this.vRoads[0].hw;
    this.maxX = this.vRoads[this.NX].pos + this.vRoads[this.NX].hw;
    this.minZ = this.hRoads[0].pos - this.hRoads[0].hw;
    this.maxZ = this.hRoads[this.NZ].pos + this.hRoads[this.NZ].hw;
    this.shoreX = this.minX - PROM_W; // the sea wall

    this._buildNodes(rnd);
    this._buildBlocks(rnd);
    this._buildLanes();
    this._buildConnectors();
    this._buildZones(rnd);
  }

  // ---------------------------------------------------------------- nodes

  _buildNodes(rnd) {
    this.nodes = [];
    this.nodeList = [];
    for (let i = 0; i <= this.NX; i++) {
      this.nodes.push([]);
      for (let j = 0; j <= this.NZ; j++) {
        const v = this.vRoads[i], h = this.hRoads[j];
        const legs = [j > 0, i < this.NX, j < this.NZ, i > 0];
        const n = {
          id: i * 16 + j, i, j,
          x: v.pos, z: h.pos,
          hwV: v.hw, hwH: h.hw,
          legs,
          free: legs.filter(Boolean).length <= 2, // the four outer corners just bend
          gNS: v.green, gEW: h.green,
          cycle: v.green + h.green + 2 * (YELLOW + ALL_RED),
          offset: rnd() * 60,
          sig: [SIG.G, SIG.R], // [north-south, east-west]
          rem: [0, 0], // seconds of green left on each axis
          in: [[], [], [], []], // lanes arriving, by the leg they come down
          out: [[], [], [], []],
          conns: [],
          xwalkPeds: [0, 0, 0, 0],
          xwalkCars: [0, 0, 0, 0],
        };
        this.nodes[i].push(n);
        this.nodeList.push(n);
      }
    }
  }

  /** How far the kerb line of the road being crossed is from the node centre, along leg d. */
  crossHalf(node, d) {
    return d % 2 === 0 ? node.hwH : node.hwV;
  }

  /** Distance from the node centre to the near edge of the stop bar on leg d. */
  stopDist(node, d) {
    return this.crossHalf(node, d) + XW_SETBACK + XW_LEN + STOP_GAP;
  }

  updateSignals(t) {
    for (const n of this.nodeList) {
      if (n.free) {
        n.sig[0] = n.sig[1] = SIG.G;
        n.rem[0] = n.rem[1] = 99;
        continue;
      }
      let tau = (t + n.offset) % n.cycle;
      let ns = SIG.R, ew = SIG.R, remNS = 0, remEW = 0;
      if (tau < n.gNS) {
        ns = SIG.G;
        remNS = n.gNS - tau;
      } else if ((tau -= n.gNS) < YELLOW) ns = SIG.Y;
      else if ((tau -= YELLOW) < ALL_RED) {
        /* all red */
      } else if ((tau -= ALL_RED) < n.gEW) {
        ew = SIG.G;
        remEW = n.gEW - tau;
      } else if ((tau -= n.gEW) < YELLOW) ew = SIG.Y;
      n.sig[0] = ns;
      n.sig[1] = ew;
      n.rem[0] = remNS;
      n.rem[1] = remEW;
    }
  }

  // ---------------------------------------------------------------- blocks

  _buildBlocks(rnd) {
    this.blocks = [];
    this.blockGrid = [];
    for (let i = 0; i < this.NX; i++) {
      this.blockGrid.push([]);
      for (let j = 0; j < this.NZ; j++) {
        const ch = BLOCK_MAP[j][i];
        const b = {
          i, j,
          kind: { T: 'tower', M: 'midrise', L: 'lowrise', P: 'park' }[ch],
          x0: this.vRoads[i].pos + this.vRoads[i].hw,
          x1: this.vRoads[i + 1].pos - this.vRoads[i + 1].hw,
          z0: this.hRoads[j].pos + this.hRoads[j].hw,
          z1: this.hRoads[j + 1].pos - this.hRoads[j + 1].hw,
          seed: Math.floor(rnd() * 1e9),
          zones: [null, null, null, null],
          pois: [null, null, null, null],
        };
        this.blocks.push(b);
        this.blockGrid[i].push(b);
      }
    }
    // rows of buildings on the far side of the outer roads, so every street ends in a facade
    const D = STRIP_D;
    this.strips = [
      { side: 'N', x0: this.shoreX, x1: this.maxX + D, z0: this.minZ - D, z1: this.minZ, face: 2 },
      { side: 'S', x0: this.shoreX, x1: this.maxX + D, z0: this.maxZ, z1: this.maxZ + D, face: 0 },
      { side: 'E', x0: this.maxX, x1: this.maxX + D, z0: this.minZ, z1: this.maxZ, face: 3 },
    ];
    this.promenade = { x0: this.shoreX, x1: this.minX, z0: this.minZ, z1: this.maxZ };
  }

  // ---------------------------------------------------------------- lanes

  _buildLanes() {
    this.lanes = [];
    this.laneIndex = new Map();
    const add = (road, from, to, dir) => {
      const t = DIRS[dir];
      const rx = -t.z, rz = t.x; // right-hand side of travel
      const group = [];
      for (let k = 0; k < road.lanes; k++) {
        const off = road.median / 2 + (road.lanes - 1 - k) * LANE_W + LANE_W / 2;
        const dExit = this.crossHalf(from, dir) + XW_SETBACK + XW_LEN + 0.6;
        const dStop = this.stopDist(to, opp(dir)) + 0.9; // front bumper stops just short of the bar
        const ax = from.x + t.x * dExit + rx * off, az = from.z + t.z * dExit + rz * off;
        const bx = to.x - t.x * dStop + rx * off, bz = to.z - t.z * dStop + rz * off;
        const lane = {
          id: this.lanes.length, isLane: true,
          road, dir, k, nLanes: road.lanes,
          from, to,
          ax, az, bx, bz,
          tx: t.x, tz: t.z, rx, rz,
          len: Math.hypot(bx - ax, bz - az),
          speed: road.speed,
          cars: [], conns: [], siblings: group,
          zones: [],
          curbOff: LANE_W / 2 + PARK_W / 2 + 0.05, // from the lane centre to the middle of the parking lane
        };
        this.lanes.push(lane);
        group.push(lane);
        from.out[dir].push(lane);
        to.in[opp(dir)].push(lane);
        this.laneIndex.set(`${from.id}>${to.id}:${k}`, lane);
      }
    };
    for (let j = 0; j <= this.NZ; j++) {
      for (let i = 0; i < this.NX; i++) {
        add(this.hRoads[j], this.nodes[i][j], this.nodes[i + 1][j], 1);
        add(this.hRoads[j], this.nodes[i + 1][j], this.nodes[i][j], 3);
      }
    }
    for (let i = 0; i <= this.NX; i++) {
      for (let j = 0; j < this.NZ; j++) {
        add(this.vRoads[i], this.nodes[i][j], this.nodes[i][j + 1], 2);
        add(this.vRoads[i], this.nodes[i][j + 1], this.nodes[i][j], 0);
      }
    }
  }

  lane(from, to, k = 0) {
    return this.laneIndex.get(`${from.id}>${to.id}:${k}`);
  }

  // ---------------------------------------------------------------- turns

  _buildConnectors() {
    this.conns = [];
    const mk = (node, from, to, turn) => {
      const p0 = { x: from.bx, z: from.bz }, p3 = { x: to.ax, z: to.az };
      const pts = [];
      const N = turn === 'S' ? 2 : 16;
      if (turn === 'S') pts.push(p0.x, p0.z, p3.x, p3.z);
      else {
        // corner where the two lane lines would meet; pull both handles toward it
        const c = from.tx !== 0 ? { x: p3.x, z: p0.z } : { x: p0.x, z: p3.z };
        const k = 0.6;
        const p1 = { x: p0.x + (c.x - p0.x) * k, z: p0.z + (c.z - p0.z) * k };
        const p2 = { x: p3.x + (c.x - p3.x) * k, z: p3.z + (c.z - p3.z) * k };
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1), v = 1 - u;
          pts.push(
            v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
            v * v * v * p0.z + 3 * v * v * u * p1.z + 3 * v * u * u * p2.z + u * u * u * p3.z,
          );
        }
      }
      const cum = [0];
      for (let i = 1; i < pts.length / 2; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
      const conn = {
        id: this.conns.length, isConn: true,
        node, from, to, turn,
        entryLeg: opp(from.dir), exitLeg: to.dir,
        pts, cum, len: cum[cum.length - 1],
        speed: turn === 'S' ? Math.min(from.speed, to.speed) : turn === 'R' ? 4.4 : 5.6,
        cars: [], occ: 0, conflicts: [], oncoming: [],
      };
      this.conns.push(conn);
      node.conns.push(conn);
      from.conns.push(conn);
    };

    for (const node of this.nodeList) {
      for (let leg = 0; leg < 4; leg++) {
        for (const lin of node.in[leg]) {
          const t = lin.dir;
          for (let e = 0; e < 4; e++) {
            if (e === leg || !node.out[e].length) continue;
            const outs = node.out[e];
            const L = lin.nLanes, L2 = outs.length;
            const kOut = (k) => outs.find((o) => o.k === k);
            if (e === t) {
              mk(node, lin, kOut(Math.min(lin.k, L2 - 1)), 'S');
              if (L === 1 && L2 === 2) mk(node, lin, kOut(1), 'S');
            } else if (e === rightOf(t)) {
              if (lin.k === 0) mk(node, lin, kOut(0), 'R');
            } else if (lin.k === L - 1) {
              mk(node, lin, kOut(L2 - 1), 'L');
            }
          }
        }
      }
      // who must wait for whom
      for (const a of node.conns) {
        for (const b of node.conns) {
          if (a === b || a.from === b.from) continue;
          let clash;
          if (a.entryLeg === b.entryLeg) clash = a.to === b.to;
          else if (a.exitLeg === b.exitLeg) clash = true;
          else if (b.entryLeg === opp(a.entryLeg)) {
            if (a.turn === b.turn && a.turn !== 'R') clash = false; // straight past straight, left past left
            else if (a.turn === 'R' || b.turn === 'R') clash = false;
            else clash = true; // a left turn across oncoming traffic
          } else clash = true; // crossing streets
          if (clash) a.conflicts.push(b);
        }
        if (a.turn === 'L') a.oncoming = node.in[a.from.dir]; // lanes coming toward us down the leg ahead
      }
    }
  }

  // ---------------------------------------------------------------- kerbside zones

  /** The kerb line of one side of a block and the lane that runs along it. */
  sideInfo(b, side) {
    const N = this.nodes;
    switch (side) {
      case 0: return { horiz: true, fixed: b.z0, a: b.x0, c: b.x1, nx: 0, nz: 1, lane: this.lane(N[b.i][b.j], N[b.i + 1][b.j]), road: this.hRoads[b.j], num: b.i };
      case 2: return { horiz: true, fixed: b.z1, a: b.x0, c: b.x1, nx: 0, nz: -1, lane: this.lane(N[b.i + 1][b.j + 1], N[b.i][b.j + 1]), road: this.hRoads[b.j + 1], num: b.i };
      case 1: return { horiz: false, fixed: b.x1, a: b.z0, c: b.z1, nx: -1, nz: 0, lane: this.lane(N[b.i + 1][b.j], N[b.i + 1][b.j + 1]), road: this.vRoads[b.i + 1], num: b.j };
      default: return { horiz: false, fixed: b.x0, a: b.z0, c: b.z1, nx: 1, nz: 0, lane: this.lane(N[b.i][b.j + 1], N[b.i][b.j]), road: this.vRoads[b.i], num: b.j };
    }
  }

  _buildZones(rnd) {
    this.zones = [];
    this.poi = {};
    const mkZone = (info, f, name, poi, block, side) => {
      const along = info.a + (info.c - info.a) * f;
      const cx = info.horiz ? along : info.fixed, cz = info.horiz ? info.fixed : along;
      const lane = info.lane;
      const s = (cx - lane.ax) * lane.tx + (cz - lane.az) * lane.tz;
      const number = (info.num + 1) * 100 + 2 * Math.floor(f * 44) + (side === 0 || side === 3 ? 1 : 0);
      const zone = {
        id: this.zones.length,
        name: name || `${number} ${info.road.name}`,
        address: `${number} ${info.road.name}`,
        poi, kind: poi ? poi.kind : 'address',
        block, side,
        cx, cz, nx: info.nx, nz: info.nz,
        lane, s,
      };
      lane.zones.push(zone);
      this.zones.push(zone);
      return zone;
    };
    const poiAt = new Map();
    for (const [id, name, i, j, side, kind] of POIS) poiAt.set(`${i},${j},${side}`, { id, name, kind });
    for (const b of this.blocks) {
      for (let side = 0; side < 4; side++) {
        const info = this.sideInfo(b, side);
        const poi = poiAt.get(`${b.i},${b.j},${side}`) || null;
        const f = poi ? 0.5 : randRange(rnd, 0.32, 0.68);
        const zone = mkZone(info, f, poi ? poi.name : null, poi, b, side);
        b.zones[side] = zone;
        if (poi) {
          b.pois[side] = poi;
          this.poi[poi.id] = zone;
        }
      }
    }
    // the pier: on the water side of Ocean Dr, where no block stands
    const n3 = this.nodes[0][3], n4 = this.nodes[0][4];
    const lane = this.lane(n3, n4);
    const pier = { id: 'pier', name: 'Pier 7', kind: 'pier' };
    const info = { horiz: false, fixed: this.minX, a: n3.z + n3.hwH, c: n4.z - n4.hwH, nx: -1, nz: 0, lane, road: this.vRoads[0], num: 3 };
    this.poi.pier = mkZone(info, 0.5, pier.name, pier, null, 1);
    this.pierZone = this.poi.pier;
  }

  /** Parking-lane slots along a kerbside lane, the same every time. */
  slots(lane) {
    if (lane.slotList) return lane.slotList;
    const list = [];
    if (lane.k === 0) {
      const pitch = 6.3;
      for (let s = 13; s < lane.len - 13; s += pitch) {
        if (lane.zones.some((zn) => Math.abs(zn.s - s) < ZONE_HALF + 3.2)) continue;
        const h = hash2(lane.id * 131 + 7, Math.round(s * 10));
        if (h > 0.72) continue; // an empty space
        list.push({
          s,
          x: lane.ax + lane.tx * s + lane.rx * lane.curbOff,
          z: lane.az + lane.tz * s + lane.rz * lane.curbOff,
          dir: lane.dir,
          h: hash2(lane.id * 17 + 3, Math.round(s * 7)),
          h2: hash2(lane.id * 29 + 11, Math.round(s * 3)),
        });
      }
    }
    lane.slotList = list;
    return list;
  }

  // ---------------------------------------------------------------- routing

  /**
   * Fastest way from a point on one lane to a point on another.
   * Returns { steps: [lane | connector, ...], time } or null. Two lanes in a
   * row with no connector between them mean "change lanes on this stretch".
   */
  route(fromLane, fromS, toLane, toS, noSwitch = null) {
    if (fromLane === toLane && toS > fromS + 6) return { steps: [fromLane], time: (toS - fromS) / fromLane.speed };
    const n = this.lanes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Array(n).fill(null);
    const via = new Array(n).fill(null);
    const done = new Uint8Array(n);
    // leaving the start lane costs whatever is left of it
    const startCost = (fromLane.len - fromS) / fromLane.speed;
    dist[fromLane.id] = 0;
    for (;;) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
      if (best < 0) break;
      done[best] = 1;
      const lane = this.lanes[best];
      if (lane === toLane && best !== fromLane.id) break;
      const laneCost = lane === fromLane ? startCost : lane.len / lane.speed;
      for (const c of lane.conns) {
        const pen = c.turn === 'L' ? 9 : c.turn === 'R' ? 4 : 5; // waiting at the light, on average
        const d = bd + laneCost + c.len / c.speed + pen;
        if (d < dist[c.to.id]) {
          dist[c.to.id] = d;
          prev[c.to.id] = lane;
          via[c.to.id] = c;
        }
      }
      for (const sib of lane.siblings) {
        if (sib === lane || lane === noSwitch) continue; // too late to change lanes on this stretch
        const d = bd + 3;
        if (d < dist[sib.id]) {
          dist[sib.id] = d;
          prev[sib.id] = lane;
          via[sib.id] = null;
        }
      }
    }
    if (!Number.isFinite(dist[toLane.id]) || toLane === fromLane) {
      // same lane but the stop is behind us: go around the block
      if (toLane !== fromLane) return null;
      let bestR = null;
      for (const c of fromLane.conns) {
        const r = this.route(c.to, 0, toLane, toS, null);
        if (r && (!bestR || r.time < bestR.time)) bestR = { steps: [fromLane, c, ...r.steps], time: r.time + startCost + 6 };
      }
      return bestR;
    }
    const steps = [];
    let cur = toLane;
    while (cur) {
      steps.unshift(cur);
      if (via[cur.id]) steps.unshift(via[cur.id]);
      cur = prev[cur.id];
    }
    return { steps, time: dist[toLane.id] + toS / toLane.speed };
  }

  /** World position and heading at distance s along a lane or connector. */
  pose(piece, s, out) {
    if (piece.isLane) {
      out.x = piece.ax + piece.tx * s;
      out.z = piece.az + piece.tz * s;
      out.dx = piece.tx;
      out.dz = piece.tz;
      return out;
    }
    const { pts, cum } = piece;
    const n = cum.length;
    if (s <= 0) s = 0;
    if (s >= piece.len) s = piece.len;
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const u = (s - cum[i - 1]) / seg;
    const x0 = pts[i * 2 - 2], z0 = pts[i * 2 - 1], x1 = pts[i * 2], z1 = pts[i * 2 + 1];
    out.x = x0 + (x1 - x0) * u;
    out.z = z0 + (z1 - z0) * u;
    // blend the direction across neighbouring segments so the nose does not snap
    let dx = (x1 - x0) / seg, dz = (z1 - z0) / seg;
    if (n > 2) {
      const j = u < 0.5 ? Math.max(1, i - 1) : Math.min(n - 1, i + 1);
      const sj = cum[j] - cum[j - 1] || 1;
      const dxj = (pts[j * 2] - pts[j * 2 - 2]) / sj, dzj = (pts[j * 2 + 1] - pts[j * 2 - 1]) / sj;
      const w = Math.abs(u - 0.5);
      dx = dx * (1 - w) + dxj * w;
      dz = dz * (1 - w) + dzj * w;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
    out.dx = dx;
    out.dz = dz;
    return out;
  }
}
