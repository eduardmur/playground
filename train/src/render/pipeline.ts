// From the two scenes to the screen. Everything is drawn in linear light into floating-point
// targets: first the landscape, then the carriage over it (nothing outside is ever nearer than
// anything inside), then exposure is measured and the picture is tone-mapped.
import * as THREE from 'three';
import { Pass } from './fsq';

// The landscape, smeared the way a camera with its shutter open for a moment would smear it: things
// near the line streak past, far ridges stay sharp. Each pixel is put back where it was a moment ago.
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform vec3 uTravel;     // how far the train goes while the shutter is open
uniform float uTime;
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float d = texture(tDepth, vUv).r;
  vec3 c = texture(tColor, vUv).rgb;
  if (d < 0.999999 && dot(uTravel, uTravel) > 1e-8) {
    vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec3 p = w.xyz / w.w;
    vec4 q = uVP * vec4(p + uTravel, 1.0);
    vec2 v = (q.xy / max(q.w, 1e-3)) * 0.5 + 0.5 - vUv;
    float len = length(v);
    if (q.w > 0.0 && len > 0.0007) {
      v *= min(1.0, 0.09 / len);
      const int N = 11;
      float j = ign(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5;
      vec3 sum = vec3(0.0); float wt = 0.0;
      for (int i = 0; i < N; i++) {
        float t = (float(i) + 0.5 + j) / float(N) - 0.5;
        vec2 uv = vUv + v * t;
        // do not drag the sky across things, nor things from beyond the edge
        float ds = texture(tDepth, uv).r;
        float k = (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? 1.0 : 0.0;
        k *= ds < 0.999999 ? 1.0 : 0.25;
        sum += texture(tColor, uv).rgb * k; wt += k;
      }
      c = wt > 0.0 ? sum / wt : c;
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// bloom: the picture is halved again and again (each step a soft 13-tap average), then built back up
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uFirst;
varying vec2 vUv;
vec3 tap(vec2 o) { vec3 c = texture(tColor, vUv + o * uTexel).rgb; return uFirst > 0.5 ? min(c, vec3(60.0)) : c; }
void main() {
  vec3 a = tap(vec2(-2, 2)), b = tap(vec2(0, 2)), c = tap(vec2(2, 2));
  vec3 d = tap(vec2(-2, 0)), e = tap(vec2(0, 0)), f = tap(vec2(2, 0));
  vec3 g = tap(vec2(-2, -2)), h = tap(vec2(0, -2)), i = tap(vec2(2, -2));
  vec3 j = tap(vec2(-1, 1)), k = tap(vec2(1, 1)), l = tap(vec2(-1, -1)), m = tap(vec2(1, -1));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(max(o, vec3(0.0)), 1.0);
}`;
const UP_FRAG = /* glsl */ `
uniform sampler2D tColor;   // this size
uniform sampler2D tLow;     // the next one down, already built up
uniform vec2 uTexel;        // of tLow
uniform float uSpread;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  s += texture(tLow, vUv + vec2(-1, 1) * uTexel).rgb + texture(tLow, vUv + vec2(1, 1) * uTexel).rgb + texture(tLow, vUv + vec2(-1, -1) * uTexel).rgb + texture(tLow, vUv + vec2(1, -1) * uTexel).rgb;
  s += 2.0 * (texture(tLow, vUv + vec2(0, 1) * uTexel).rgb + texture(tLow, vUv + vec2(0, -1) * uTexel).rgb + texture(tLow, vUv + vec2(1, 0) * uTexel).rgb + texture(tLow, vUv + vec2(-1, 0) * uTexel).rgb);
  s += 4.0 * texture(tLow, vUv).rgb;
  gl_FragColor = vec4(mix(texture(tColor, vUv).rgb, s / 16.0, uSpread), 1.0);
}`;

// brightness, as the eye judges it: the mean of the logarithm, the middle of the picture counting most
const METER_FRAG = /* glsl */ `
uniform sampler2D tColor;
varying vec2 vUv;
void main() {
  float sum = 0.0, lin = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec2 uv = vUv + (vec2(float(i), float(j)) - 1.5) * vec2(1.0 / 128.0, 1.0 / 72.0);
    float l = min(dot(texture(tColor, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 40.0);
    sum += log(max(l, 1e-5));
    lin += l;
  }
  vec2 c = vUv - 0.5;
  gl_FragColor = vec4(sum / 16.0, 1.0 - 0.75 * smoothstep(0.1, 0.6, length(c * vec2(1.0, 1.2))), lin / 16.0, 1.0);
}`;

const OUTPUT_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec3 uBalance;
uniform float uGrain;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;

// AgX, after Blender and Filament (as in three.js), with a little more contrast and colour put back
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 toSrgb = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = inset * (toRec2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(color, vec3(1.18));
  color = luma + 1.22 * (color - luma) + (pow(luma, 1.18) - luma);
  color = outset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(toSrgb * color, 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(tColor, vUv).rgb;
  c = mix(c, texture(tBloom, vUv).rgb, uBloom) * uBalance;
  // the corners fall off a little, as through any lens
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.22 * smoothstep(0.25, 0.85, dot(q, q) * 2.0);
  c = agx(c);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  c += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * uGrain;
  gl_FragColor = vec4(c * uFade, 1.0);
}`;

export interface Frame {
  land: THREE.Scene;
  landCamera: THREE.PerspectiveCamera;
  /** metres the train covers while the shutter is open, in the landscape's axes */
  travel: THREE.Vector3;
  cabin: THREE.Scene | null;
  cabinCamera: THREE.Camera;
  time: number;
  exposure: number;
  /** called between the landscape and the cabin, for the cabin's own extra views */
  beforeCabin?: () => void;
}

export class Pipeline {
  readonly land: THREE.WebGLRenderTarget;
  readonly final: THREE.WebGLRenderTarget;
  private meter: THREE.WebGLRenderTarget;
  private copy: Pass;
  private measure: Pass;
  private out: Pass;
  private down: Pass;
  private upP: Pass;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private vp = new THREE.Matrix4();
  bloom = 0.055;
  /** white balance: a gain for each of red, green and blue */
  readonly balance = new THREE.Vector3(1, 1, 1);
  private meterPixels = new Float32Array(32 * 18 * 4);
  private meterBusy = false;
  /** mean log luminance of the last measured frame, as drawn (exposure included), and the exposure it was drawn with */
  logLum = Math.log(0.18);
  meteredAt = 1;
  /** counts measurements, so a reader can tell a new one from one it has used */
  metered = 0;
  width = 1;
  height = 1;
  fade = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.land = this.makeTarget(true);
    this.final = this.makeTarget(false);
    this.meter = new THREE.WebGLRenderTarget(32, 18, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.copy = new Pass(BLUR_FRAG, {
      tColor: { value: this.land.texture }, tDepth: { value: this.land.depthTexture },
      uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uTravel: { value: new THREE.Vector3() }, uTime: { value: 0 },
    });
    this.measure = new Pass(METER_FRAG, { tColor: { value: this.final.texture } });
    const small = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    for (let i = 0; i < 6; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(2, 2, small));
      this.ups.push(new THREE.WebGLRenderTarget(2, 2, small));
    }
    this.down = new Pass(DOWN_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
    this.upP = new Pass(UP_FRAG, { tColor: { value: null }, tLow: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 0.72 } });
    this.out = new Pass(OUTPUT_FRAG, { tColor: { value: this.final.texture }, tBloom: { value: this.ups[0].texture }, uBloom: { value: this.bloom }, uBalance: { value: this.balance }, uGrain: { value: 0.012 }, uTime: { value: 0 }, uFade: { value: 1 } });
  }

  private makeTarget(depthTexture: boolean) {
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: 4,
      generateMipmaps: false,
    });
    if (depthTexture) {
      rt.depthTexture = new THREE.DepthTexture(1, 1);
      rt.depthTexture.type = THREE.UnsignedIntType;
    }
    return rt;
  }

  setSize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.land.setSize(w, h);
    this.final.setSize(w, h);
    for (let i = 0; i < this.mips.length; i++) {
      const mw = Math.max(2, w >> (i + 1)), mh = Math.max(2, h >> (i + 1));
      this.mips[i].setSize(mw, mh);
      this.ups[i].setSize(mw, mh);
    }
  }

  render(f: Frame) {
    const r = this.renderer;
    r.setRenderTarget(this.land);
    r.clear();
    r.render(f.land, f.landCamera);

    f.beforeCabin?.();

    r.setRenderTarget(this.final);
    r.clear();
    const cu = this.copy.u;
    this.vp.multiplyMatrices(f.landCamera.projectionMatrix, f.landCamera.matrixWorldInverse);
    (cu.uVP.value as THREE.Matrix4).copy(this.vp);
    (cu.uInvVP.value as THREE.Matrix4).copy(this.vp).invert();
    (cu.uTravel.value as THREE.Vector3).copy(f.travel);
    cu.uTime.value = f.time;
    this.copy.render(r, this.final);
    if (f.cabin) {
      r.setRenderTarget(this.final);
      r.render(f.cabin, f.cabinCamera);
    }

    if (!this.meterBusy) {
      this.measure.render(r, this.meter);
      this.meterBusy = true;
      const drawnAt = f.exposure;
      r.readRenderTargetPixelsAsync(this.meter, 0, 0, 32, 18, this.meterPixels)
        .then(() => {
          let s = 0, w = 0, l = 0;
          const p = this.meterPixels;
          for (let i = 0; i < p.length; i += 4) {
            s += p[i] * p[i + 1];
            l += p[i + 2] * p[i + 1];
            w += p[i + 1];
          }
          // half-way between the eye's average (the mean of the logarithm) and the plain mean, which the
          // bright window dominates: so the view outside is not burnt out for the sake of the seats
          if (w > 0 && Number.isFinite(s) && l > 0) {
            this.logLum = 0.5 * (s / w) + 0.5 * Math.log(l / w);
            this.meteredAt = drawnAt;
            this.metered++;
          }
        })
        .catch(() => {})
        .finally(() => (this.meterBusy = false));
    }

    // bloom
    const n = this.mips.length;
    for (let i = 0; i < n; i++) {
      const src = i === 0 ? this.final : this.mips[i - 1];
      this.down.u.tColor.value = src.texture;
      (this.down.u.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.down.u.uFirst.value = i === 0 ? 1 : 0;
      this.down.render(r, this.mips[i]);
    }
    for (let i = n - 2; i >= 0; i--) {
      const low = i === n - 2 ? this.mips[n - 1] : this.ups[i + 1];
      this.upP.u.tColor.value = this.mips[i].texture;
      this.upP.u.tLow.value = low.texture;
      (this.upP.u.uTexel.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
      this.upP.render(r, this.ups[i]);
    }
    this.out.u.uBloom.value = this.bloom;
    this.out.u.uTime.value = f.time;
    this.out.u.uFade.value = this.fade;
    this.out.render(r, null);
  }
}
