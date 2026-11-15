// Window glass. Each pane is drawn after the outside world has been rendered to
// a texture, and shows that texture through whatever is on the glass: beads of
// rain that each act as a tiny lens, runs of water pushed along by the airflow,
// a film of mist, and the clean arc the wiper leaves behind.
import * as THREE from 'three';

export const WIPE_BINS = 48;
export const WIPE_MAX = 1.47; // the wiper sweeps between -WIPE_MAX and +WIPE_MAX radians from upright

const VERT = /* glsl */ `
  attribute vec2 aGlass;
  varying vec2 vG;
  varying vec3 vNormalV;
  varying vec3 vPosV;
  void main() {
    vG = aGlass;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosV = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tWorld;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uWetGlass;   // how much water is on the glass at all
  uniform float uRainRate;   // how fast new drops arrive
  uniform float uFlow;       // integrated travel of the running drops, metres
  uniform vec2 uFan;         // the point the runs appear to radiate from
  uniform float uLanes;      // runs per radian around that point
  uniform float uFlowSign;   // +1 when the runs travel away from it, -1 toward it
  uniform float uTrailAmt;   // trails only form when the water is actually moving
  uniform float uWipe[${WIPE_BINS}]; // when each direction from the pivot was last wiped
  uniform vec4 uWiper;       // pivot x, pivot y, inner radius, outer radius
  uniform float uWiperAng;   // where the blade is now
  uniform float uWiperOn;    // 1 on the windscreen, 0 on panes with no wiper
  uniform float uSnow;       // flakes rather than drops
  uniform vec3 uTint;
  uniform vec3 uVeil;        // light scattered in the glass (low sun, oncoming lamps)
  uniform vec3 uDash;        // the dashboard's ghost in the screen
  uniform vec2 uSpan;        // glass height range, for the dashboard reflection
  uniform vec3 uSky;         // what a bead's rim picks up
  varying vec2 vG;
  varying vec3 vNormalV;
  varying vec3 vPosV;

  vec3 h3(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yxz + 33.33);
    return fract((q.xxy + q.yzz) * q.zyx);
  }
  float h1(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

  // seconds since the blade last passed over this point (large where it never reaches)
  float sinceWipe(vec2 g) {
    if (uWiperOn < 0.5) return 1000.0;
    vec2 d = g - uWiper.xy;
    float r = length(d);
    if (r < uWiper.z || r > uWiper.w) return 1000.0;
    float a = atan(d.x, d.y);
    float f = (a / ${WIPE_MAX.toFixed(4)} * 0.5 + 0.5) * float(${WIPE_BINS - 1});
    if (f < 0.0 || f > float(${WIPE_BINS - 1})) return 1000.0;
    int i = int(floor(f));
    int j = min(i + 1, ${WIPE_BINS - 1});
    float t = mix(uWipe[i], uWipe[j], fract(f));
    return uTime - t;
  }

  // One layer of beads on a grid. Returns xy = lens offset direction (scaled), z = coverage, w = rim.
  vec4 beads(vec2 g, float cell, float density, float fill, float rate) {
    vec2 q = g / cell;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    vec3 rnd = h3(id);
    // each cell keeps re-rolling: a bead lands, sits, and is eventually replaced
    float cyc = uTime * rate * (0.5 + rnd.z) + rnd.x * 17.0;
    float gen = floor(cyc);
    float life = fract(cyc);
    vec3 r2 = h3(id + gen * 7.31);
    if (r2.z > density) return vec4(0.0);
    // has enough rain fallen since the wiper passed for this one to exist yet?
    if (fill < r2.x * 0.9 + 0.05) return vec4(0.0);
    vec2 c = (r2.xy - 0.5) * 0.56;
    float rad = (0.15 + 0.27 * r2.y * r2.y) * smoothstep(0.0, 0.04, life) * (1.0 - 0.3 * smoothstep(0.7, 1.0, life));
    vec2 d = f - c;
    d.y *= 0.88; // gravity pulls a bead slightly oval
    float l = length(d) / rad;
    if (l >= 1.0) return vec4(0.0);
    float cov = smoothstep(1.0, 0.82, l);
    // the surface gets steeper toward the rim, so the view through it bends more there
    vec2 n = d / rad * (0.35 + 0.65 * l * l);
    return vec4(n, cov, smoothstep(0.55, 1.0, l));
  }

  // Runs of water travelling along lines that fan out from uFan.
  // Returns x = lens offset across the run, y = coverage of the head, z = wet trail.
  vec3 runs(vec2 g, float lanes, float period, float speedK, float fill, float seed) {
    vec2 d = g - uFan;
    float ang = atan(d.x, d.y);
    float r = length(d);
    float la = ang * lanes;
    float id = floor(la);
    float across = fract(la) - 0.5;
    float rn = h1(id * 3.17 + seed), rn2 = h1(id * 9.73 + seed * 2.0);
    if (rn > 0.55 + 0.3 * fill) return vec3(0.0);
    // wander a little from side to side on the way
    float wob = sin(r * 23.0 + rn * 40.0) * 0.16 + sin(r * 61.0 + rn2 * 11.0) * 0.06;
    float x = across - (rn2 - 0.5) * 0.35 - wob;
    float along = r / period - uFlow * speedK * (0.6 + 0.8 * rn) / period + rn2 * 9.0;
    float cell = floor(along);
    float t = fract(along);
    float alive = step(h1(cell * 1.31 + id * 0.77 + seed), 0.6);
    float widthM = r / lanes; // metres per lane at this radius
    float xm = x * widthM;
    float headR = 0.0045 + 0.004 * rn;
    // the head sits mid-cell; the trail lies on whichever side it has just come from
    float dt = (t - 0.5) * period;
    float bd = -dt * uFlowSign;
    float head = smoothstep(headR, headR * 0.45, length(vec2(xm, dt * 0.7)));
    float behind = smoothstep(0.0, 0.004, bd) * (1.0 - smoothstep(0.02, period * 0.44, bd));
    float trail = behind * smoothstep(headR * 0.75, headR * 0.2, abs(xm)) * uTrailAmt;
    return vec3(xm / headR, head, trail) * alive;
  }

  void main() {
    vec2 suv = gl_FragCoord.xy / uRes;
    vec3 base = texture2D(tWorld, suv).rgb;
    vec3 col = base;
    float wet = uWetGlass;

    if (wet > 0.003) {
      float tw = sinceWipe(vG);
      float fill = clamp(tw * (0.25 + 1.6 * uRainRate), 0.0, 1.0);
      fill = min(fill, wet * 1.25);
      float fresh = 1.0 - smoothstep(0.0, 0.5, tw);

      vec4 b1 = beads(vG, 0.021, 0.5 + 0.4 * wet, fill, 0.1 + 0.5 * uRainRate);
      vec4 b2 = beads(vG + 3.7, 0.046, 0.22 + 0.4 * wet, fill - 0.15, 0.06 + 0.3 * uRainRate);
      vec4 b3 = beads(vG + 9.1, 0.0085, 0.6, fill, 0.2 + 0.6 * uRainRate);
      vec3 r1 = runs(vG, uLanes, 0.34, 1.0, fill, 1.0);
      vec3 r2 = runs(vG + 0.013, uLanes * 1.55, 0.21, 1.55, fill, 5.0);
      float trail = max(r1.z, r2.z);

      // water running through washes the beads in its path away
      float keep = 1.0 - trail;
      vec2 lens = (b1.xy * b1.z * 1.0 + b2.xy * b2.z * 1.5 + b3.xy * b3.z * 0.5) * keep;
      float cov = max(max(b1.z, b2.z), b3.z * 0.8) * keep;
      float rim = max(b1.w * b1.z, b2.w * b2.z) * keep;
      lens.x += (r1.x * r1.y + r2.x * r2.y) * 0.7 + (r1.x * r1.z + r2.x * r2.z) * 0.25;
      float head = max(r1.y, r2.y);
      cov = max(cov, max(head, trail * 0.55));
      rim = max(rim, head * 0.5);

      // mist: where the wiper does not reach, the whole view softens a little
      float film = wet * fill * (0.3 + 0.7 * uRainRate) * (1.0 - trail);
      vec3 soft = texture2D(tWorld, suv, 2.6).rgb;
      col = mix(base, soft, clamp(film * 0.5, 0.0, 0.6));

      if (cov > 0.001) {
        // a bead is a fisheye lens: it shows the scene upside down and much reduced
        vec2 ruv = clamp(suv - lens * vec2(0.085, 0.085 * uRes.x / uRes.y), 0.002, 0.998);
        vec3 through = texture2D(tWorld, ruv, 1.6).rgb;
        through *= 1.0 - 0.45 * rim;
        through += uSky * rim * 0.12 * max(0.0, 0.4 + lens.y);
        through = mix(through, vec3(0.75, 0.8, 0.86) * (0.2 + uSky), uSnow * 0.38); // a flake, half melted
        col = mix(col, through, cov);
      }
      // the wet edge the blade leaves just behind it
      col = mix(col, soft, fresh * 0.35 * wet);
    }

    // the blade and its arm
    if (uWiperOn > 0.5) {
      vec2 d = vG - uWiper.xy;
      vec2 dir = vec2(sin(uWiperAng), cos(uWiperAng));
      float along = dot(d, dir);
      float perp = abs(dot(d, vec2(dir.y, -dir.x)));
      float blade = (1.0 - smoothstep(0.009, 0.013, perp)) * step(uWiper.z, along) * step(along, uWiper.w);
      float arm = (1.0 - smoothstep(0.011, 0.015, abs(dot(d, vec2(dir.y, -dir.x)) - 0.018 * (1.0 - along / uWiper.w)))) * step(0.0, along) * step(along, uWiper.w * 0.62);
      col = mix(col, vec3(0.012), max(blade, arm));
    }

    // the glass itself: a faint tint, light caught in it, the dashboard's reflection near the bottom
    col *= uTint;
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(-vPosV))), 3.0);
    float low = 1.0 - smoothstep(uSpan.x, uSpan.y, vG.y);
    col += uDash * (low * low * 0.9 + fres * 0.35);
    col += uVeil * (0.6 + 0.4 * fres);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function makeGlassMaterial(pipeline, { wiper = false, fan = new THREE.Vector2(0, -1.4), lanes = 46, span = new THREE.Vector2(0, 1) } = {}) {
  const wipe = new Float32Array(WIPE_BINS).fill(-1000);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tWorld: { value: pipeline.rtWorld.texture },
      uRes: { value: pipeline.resolution },
      uTime: { value: 0 },
      uWetGlass: { value: 0 },
      uRainRate: { value: 0 },
      uFlow: { value: 0 },
      uFan: { value: fan },
      uLanes: { value: lanes },
      uFlowSign: { value: 1 },
      uTrailAmt: { value: 0 },
      uWipe: { value: wipe },
      uWiper: { value: new THREE.Vector4(0, -0.05, 0.14, 0.98) },
      uWiperAng: { value: -WIPE_MAX },
      uWiperOn: { value: wiper ? 1 : 0 },
      uSnow: { value: 0 },
      uTint: { value: new THREE.Color(0.93, 0.95, 0.94) },
      uVeil: { value: new THREE.Color(0, 0, 0) },
      uDash: { value: new THREE.Color(0, 0, 0) },
      uSpan: { value: span },
      uSky: { value: new THREE.Color(0.5, 0.5, 0.5) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.userData.wipe = wipe;
  return mat;
}
