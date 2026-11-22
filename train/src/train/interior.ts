// The inside of the carriage as a lit scene of its own. It is drawn over the landscape (which is
// always further away than anything in the car), in the car's own coordinates.
//
// Light comes from three places:
//   the sun or the moon, as a directional light with a shadow map, dimmed by what the train is
//     passing (a mountain's shadow, trees, a tunnel);
//   everything that glows (the windows, the ceiling lines, the table lamps), gathered into an
//     environment map a few times a second and used as image-based light;
//   a few small lights at the nearest table lamps.
import * as THREE from 'three';
import { Cabin, CAR, bayCentre } from './cabin';

const GLASS_VERT = /* glsl */ `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GLASS_FRAG = /* glsl */ `
uniform sampler2D tRefl;
uniform sampler2D tNoise;
uniform mat4 uReflVP;
uniform float uReflK;       // how much of the mirrored cabin to show (less when the face is at the glass)
uniform vec3 uSunDir;       // car axes
uniform vec3 uSunCol;       // already exposed
uniform vec3 uAmbient;      // light inside the car, exposed: lifts the dust a little
uniform vec3 uNormal;
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vec3 V = normalize(vPos - cameraPosition);
  float c = abs(dot(V, uNormal));
  // two panes, four faces
  float f1 = 0.04 + 0.96 * pow(1.0 - c, 5.0);
  float F = 2.0 * f1 / (1.0 + f1);
  vec3 refl = vec3(0.0);
#ifdef MIRROR
  vec4 q = uReflVP * vec4(vPos, 1.0);
  vec2 uv = q.xy / q.w * 0.5 + 0.5;
  // the second pane throws a fainter image a little to one side
  vec2 off = vec2(0.006, 0.002) * (1.0 - c);
  refl = texture(tRefl, uv).rgb * 0.62 + texture(tRefl, uv + off).rgb * 0.38;
#endif
  // dust and smears: they light up when the sun is in front of the glass
  vec2 g = vPos.xy * vec2(0.9, 1.3) + vUv * 0.0;
  float dust = texture(tNoise, g * 0.35).b * 0.6 + texture(tNoise, g * 2.3 + 0.37).a * 0.4;
  float smear = smoothstep(0.52, 0.8, texture(tNoise, vec2(g.x * 0.12 + g.y * 0.05, g.y * 0.7)).a);
  float dirty = 0.01 + 0.03 * dust * dust + 0.004 * smear;
  float sunIn = max(dot(V, uSunDir), 0.0);
  float fwd = pow(sunIn, 8.0) * 1.2 + pow(sunIn, 90.0) * 10.0 + 0.06;
  float facing = smoothstep(-0.05, 0.25, -dot(uSunDir, uNormal));
  vec3 haze = uSunCol * dirty * fwd * facing * 0.035 + uAmbient * dirty * 0.25;
  float T = (1.0 - F) * 0.93 * (1.0 - dirty * 0.6);
  gl_FragColor = vec4(refl * F * uReflK * 0.75 + haze, 1.0 - T);
}`;

// what is outside, for the environment map: the sky's smooth light above, the lit ground below
const OUTSIDE_FRAG = /* glsl */ `
uniform vec3 uSH[9];
uniform mat3 uCarToWorld;
uniform vec3 uGround;
uniform float uOutside;
uniform float uExposure;
varying vec3 vDir;
void main() {
  vec3 n = normalize(uCarToWorld * normalize(vDir));
  vec3 sky = 0.282095 * uSH[0]
    + 0.488603 * (uSH[1] * n.y + uSH[2] * n.z + uSH[3] * n.x)
    + 1.092548 * (uSH[4] * n.x * n.y + uSH[5] * n.y * n.z + uSH[7] * n.x * n.z)
    + 0.315392 * uSH[6] * (3.0 * n.z * n.z - 1.0)
    + 0.546274 * uSH[8] * (n.x * n.x - n.y * n.y);
  sky = max(sky, vec3(0.0));
  // the blue of the sky is strong stuff indoors: what comes in is mixed with light off everything else
  sky = mix(vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), sky, 0.42);
  vec3 c = mix(uGround, sky, smoothstep(-0.12, 0.1, n.y));
  gl_FragColor = vec4(c * uOutside * uExposure, 1.0);
}`;
const OUTSIDE_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SHADE_GLSL = /* glsl */ `
varying float vAo;
varying vec3 vCarPos;
uniform vec4 uShade;       // reach of the sun, trees, metres travelled, -
uniform vec3 uSunDirCar;
float shHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float shNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(shHash(i), shHash(i + vec2(1.0, 0.0)), f.x), mix(shHash(i + vec2(0.0, 1.0)), shHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// trees beside the line throw shadows that sweep back through the car: a pattern fixed to the ground
float sunThroughTrees(vec3 p) {
  float level = max(length(uSunDirCar.xz), 0.08);
  float away = 14.0 / max(abs(uSunDirCar.z), 0.15);                 // metres along the ray to the tree line
  float xw = p.x + uShade.z + uSunDirCar.x * away;                  // where along the line that is
  float h = p.y + 2.4 + uSunDirCar.y / level * 14.0;                // and how high up the trees
  float trunks = shNoise(vec2(xw * 0.19, 3.7)) * 0.65 + shNoise(vec2(xw * 0.53, h * 0.22)) * 0.35;
  float tall = 16.0 + 14.0 * shNoise(vec2(xw * 0.07, 9.1));
  float gap = smoothstep(0.42, 0.62, trunks + smoothstep(tall * 0.7, tall, h) * 0.6);
  return mix(1.0, gap, uShade.y);
}`;

/** Sunlight (or moonlight) after the air, on the CPU: good enough to colour a lamp. */
export function lightThroughAir(dirY: number, altKm: number, haze: number, out: THREE.Vector3): THREE.Vector3 {
  const elev = (Math.asin(THREE.MathUtils.clamp(dirY, -1, 1)) * 180) / Math.PI;
  if (elev < -0.6) return out.set(0, 0, 0);
  const e = Math.max(elev, 0);
  const mass = 1 / (Math.sin((e * Math.PI) / 180) + 0.50572 * (e + 6.07995) ** -1.6364);
  const dr = Math.exp(-altKm / 8), dm = Math.exp(-altKm / 1.2) * haze;
  const tau = [5.802e-3 * 8 * dr + 8.4e-3 * 1.2 * dm + 0.65e-3 * 15, 13.558e-3 * 8 * dr + 8.4e-3 * 1.2 * dm + 1.881e-3 * 15, 33.1e-3 * 8 * dr + 8.4e-3 * 1.2 * dm + 0.085e-3 * 15];
  const rise = THREE.MathUtils.smoothstep(elev, -0.6, 0.3);
  return out.set(Math.exp(-tau[0] * mass) * rise, Math.exp(-tau[1] * mass) * rise, Math.exp(-tau[2] * mass) * rise);
}

export interface InteriorLight {
  /** towards the light that casts shadows, car axes */
  dir: THREE.Vector3;
  /** its colour and strength where the train is, scene units, before exposure */
  colour: THREE.Vector3;
  /** 0..1 how much of it reaches the train past the mountains */
  reach: number;
  /** 0..1 how wooded the line-side is on the light's side: dapples the light */
  trees: number;
  /** 0 in the open .. 1 in a tunnel */
  tunnel: number;
  /** 0..1 cabin lights */
  lamps: number;
  exposure: number;
  /** metres travelled, to keep the dapple fixed to the ground */
  travelled: number;
  speed: number;
}

export class Interior {
  readonly scene = new THREE.Scene();
  readonly cabin: Cabin;
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  private fill = new THREE.AmbientLight(0xffffff, 0);
  private lampLights: THREE.PointLight[] = [];
  private cube: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private env: THREE.WebGLRenderTarget | null = null;
  private outside: THREE.Mesh;
  private envExposure = 1;
  private envAge = 1e9;
  private envKey = '';
  private envFace = -1; // which face of the cube is drawn next: -1 when no capture is under way
  private envStartExposure = 1;
  private cubeReady = false;
  readonly glass = new THREE.Group();
  private glassMats: THREE.ShaderMaterial[] = [];
  /** mirrored views of the cabin, one per side: [left, right] */
  readonly mirrors: THREE.WebGLRenderTarget[];
  private mirrorCam = new THREE.PerspectiveCamera();
  private mirrorVP = [new THREE.Matrix4(), new THREE.Matrix4()];
  private clip = [new THREE.Plane(new THREE.Vector3(0, 0, 1), CAR.halfWidth - 0.03), new THREE.Plane(new THREE.Vector3(0, 0, -1), CAR.halfWidth - 0.03)];
  private shared = {
    uShade: { value: new THREE.Vector4(1, 0, 0, 0) },
    uSunDirCar: { value: new THREE.Vector3(0, 1, 0) },
  };
  private outsideCol = new THREE.Color();
  private fillBoost = 1;
  /** by day the mirrored cabin is played down: it is the view that matters */
  private mirrorGain = 1;

  constructor(private renderer: THREE.WebGLRenderer, noise: THREE.Texture, sh: Float32Array) {
    this.cabin = new Cabin((m) => this.patch(m));
    this.scene.add(this.cabin.group);

    // the sun
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -10.5; sc.right = 10.5; sc.top = 3.4; sc.bottom = -3.4; sc.near = 1; sc.far = 50;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.radius = 3;
    this.sun.target.position.set(0, 1.1, 0);
    this.scene.add(this.sun, this.sun.target, this.fill);

    for (let i = 0; i < 3; i++) {
      const p = new THREE.PointLight(0xffc98a, 0, 2.6, 2);
      this.lampLights.push(p);
      this.scene.add(p);
    }
    // the lamps nearest the passenger: on their own table, across the aisle, and the next bay ahead
    const k = Math.round((CAR.bayX + 8) / CAR.pitch);
    this.lampLights[0].position.set(bayCentre(k), 0.93, -(CAR.halfWidth - 0.085));
    this.lampLights[1].position.set(bayCentre(k), 0.93, CAR.halfWidth - 0.085);
    this.lampLights[2].position.set(bayCentre(k + 1), 0.93, -(CAR.halfWidth - 0.085));

    // what the environment map sees through the windows
    this.outside = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: OUTSIDE_VERT,
        fragmentShader: OUTSIDE_FRAG,
        side: THREE.BackSide,
        uniforms: { uSH: { value: sh }, uCarToWorld: { value: new THREE.Matrix3() }, uGround: { value: new THREE.Vector3() }, uOutside: { value: 1 }, uExposure: { value: 1 } },
      }),
    );
    this.outside.layers.set(1);
    this.scene.add(this.outside);
    this.cube = new THREE.WebGLCubeRenderTarget(96, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.05, 60, this.cube);
    this.cubeCam.position.set(CAR.bayX + 1, 1.25, 0);
    for (const c of this.cubeCam.children) c.layers.enable(1);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // glass
    const opt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, samples: 2 };
    this.mirrors = [new THREE.WebGLRenderTarget(4, 4, opt), new THREE.WebGLRenderTarget(4, 4, opt)];
    const glassMat = (mirror: number | null, normal: THREE.Vector3) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        defines: mirror === null ? {} : { MIRROR: '1' },
        uniforms: {
          tRefl: { value: mirror === null ? null : this.mirrors[mirror].texture },
          tNoise: { value: noise },
          uReflVP: { value: mirror === null ? new THREE.Matrix4() : this.mirrorVP[mirror] },
          uReflK: { value: 1 },
          uSunDir: this.shared.uSunDirCar,
          uSunCol: { value: new THREE.Vector3() },
          uAmbient: { value: new THREE.Vector3() },
          uNormal: { value: normal },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
      });
      this.glassMats.push(m);
      return m;
    };
    const quads = (pts: number[]) => {
      const g = new THREE.BufferGeometry();
      const n = pts.length / 12;
      const uv: number[] = [], idx: number[] = [];
      for (let i = 0; i < n; i++) {
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    };
    for (const s of [-1, 1]) {
      const side: number[] = [], sky: number[] = [];
      const dz = CAR.halfWidth - CAR.coveZ, dy = CAR.ceil - CAR.coveBase;
      for (let b = 0; b < CAR.bays; b++) {
        const cx = bayCentre(b), z = s * CAR.glassZ;
        side.push(cx - CAR.winHalf, CAR.sill, z, cx + CAR.winHalf, CAR.sill, z, cx + CAR.winHalf, CAR.head, z, cx - CAR.winHalf, CAR.head, z);
        // skylight: the opening in the cove, a little outside its surface
        const x0 = cx - CAR.pitch / 2 + 0.22, x1 = cx + CAR.pitch / 2 - 0.22;
        const at = (v: number): [number, number] => [CAR.coveBase + dy * v + 0.03, s * (CAR.halfWidth - dz * v + 0.02)];
        const [ya, za] = at(0.16), [yb, zb] = at(0.84);
        sky.push(x0, ya, za, x1, ya, za, x1, yb, zb, x0, yb, zb);
      }
      const mesh = new THREE.Mesh(quads(side), glassMat(s === -1 ? 0 : 1, new THREE.Vector3(0, 0, -s)));
      const top = new THREE.Mesh(quads(sky), glassMat(null, new THREE.Vector3(0, -dz, -s * dy).normalize()));
      mesh.frustumCulled = top.frustumCulled = false;
      mesh.renderOrder = top.renderOrder = 10;
      this.glass.add(mesh, top);
    }
    this.scene.add(this.glass);
  }

  /** Teach a three.js material two things: shading baked into the vertices, and a sun that flickers through trees. */
  private patch(m: THREE.MeshStandardMaterial) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uShade = this.shared.uShade;
      shader.uniforms.uSunDirCar = this.shared.uSunDirCar;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAo;\nvarying float vAo;\nvarying vec3 vCarPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = aAo;\n{ vec4 cp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ncp = instanceMatrix * cp;\n#endif\nvCarPos = (modelMatrix * cp).xyz; }');
      const before = shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader
        // the light loop is an include: open it up so the sun's line can be reached
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
        .replace('#include <common>', `#include <common>\n${SHADE_GLSL}`)
        .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uShade.x * sunThroughTrees( vCarPos ) * mix( 1.0, vAo, 0.35 );')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAo;\nreflectedLight.indirectSpecular *= mix( 1.0, vAo, 0.7 );');
      if (!shader.fragmentShader.includes('sunThroughTrees( vCarPos )') || shader.fragmentShader === before) console.warn('cabin material: the shader patch did not take');
    };
    m.customProgramCacheKey = () => 'cabin';
  }

  setSize(w: number, h: number) {
    for (const m of this.mirrors) m.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  }

  /** Light the car for this frame. */
  update(L: InteriorLight, carToWorld: THREE.Matrix3, dt: number) {
    const ex = L.exposure;
    const open = 1 - L.tunnel;
    this.shared.uSunDirCar.value.copy(L.dir);
    this.shared.uShade.value.set(L.reach * open, L.trees, L.travelled, 0);
    this.sun.position.copy(L.dir).multiplyScalar(25).add(this.sun.target.position);
    const lum = Math.max(L.colour.x, L.colour.y, L.colour.z, 1e-9);
    this.sun.color.setRGB(L.colour.x / lum, L.colour.y / lum, L.colour.z / lum);
    this.sun.intensity = lum * ex;
    this.sun.visible = lum * L.reach * open > 1e-6 && L.dir.y > 0.01;

    // things that glow
    const M = this.cabin.materials;
    M.led.emissiveIntensity = (0.07 + 0.5 * L.lamps) * ex;
    M.shade.emissiveIntensity = (0.02 + 0.5 * L.lamps) * ex;
    (M.shadeCap as THREE.MeshStandardMaterial).emissiveIntensity = (0.01 + 0.3 * L.lamps) * ex;
    M.door.emissiveIntensity = (0.004 + 0.02 * L.lamps) * ex;
    for (const p of this.lampLights) p.intensity = 0.012 * L.lamps * ex;

    // outside, as the environment map sees it
    const u = (this.outside.material as THREE.ShaderMaterial).uniforms;
    (u.uCarToWorld.value as THREE.Matrix3).copy(carToWorld);
    const sunOnGround = Math.max(L.dir.y, 0) * L.reach;
    (u.uGround.value as THREE.Vector3).set(0.13, 0.14, 0.09).multiply(L.colour).multiplyScalar(sunOnGround / Math.PI).addScalar(0);
    u.uOutside.value = open + L.tunnel * 0.0;
    u.uExposure.value = ex;
    this.outsideCol.setRGB(0, 0, 0);

    // the environment map: again when the light has changed, and now and then anyway. One face of the
    // cube a frame, then the blurring, so no frame carries the whole job.
    this.envAge += dt;
    const key = `${Math.round(L.tunnel * 12)}|${Math.round(L.lamps * 10)}|${Math.round(Math.log2(Math.max(lum * L.reach, 1e-6)) * 2)}|${Math.round(L.dir.x * 6)},${Math.round(L.dir.y * 6)},${Math.round(L.dir.z * 6)}`;
    if (this.envFace < 0 && (!this.env || this.envAge > 4 || key !== this.envKey)) {
      this.envKey = key;
      this.envAge = 0;
      this.envFace = 0;
      this.envStartExposure = ex;
    }
    if (this.envFace >= 0) this.captureEnv(ex, !this.env);
    // a camera set for the view outside leaves the car dark; the eye does better. Lift the indirect light by day.
    this.fillBoost = THREE.MathUtils.lerp(2.8, 1.25, L.lamps);
    this.mirrorGain = THREE.MathUtils.lerp(0.5, 1, Math.max(L.lamps, L.tunnel));
    this.scene.environmentIntensity = (ex / this.envExposure) * this.fillBoost;

    for (const g of this.glassMats) {
      (g.uniforms.uSunCol.value as THREE.Vector3).copy(L.colour).multiplyScalar(L.reach * open * ex);
      (g.uniforms.uAmbient.value as THREE.Vector3).setScalar((0.02 * L.lamps + 0.004) * ex);
    }
  }

  private captureEnv(exposure: number, allAtOnce: boolean) {
    const r = this.renderer;
    this.glass.visible = false;
    // the cabin lights itself over a few captures: each one sees the last one's light on the walls
    this.scene.environmentIntensity = exposure / this.envExposure;
    if (!this.cubeReady) {
      // the first time, let three.js point the six cameras the right way
      this.cubeCam.update(r, this.scene);
      this.cubeReady = true;
      this.envFace = 6;
    }
    const cams = this.cubeCam.children as THREE.Camera[];
    const auto = r.autoClear;
    r.autoClear = true;
    while (this.envFace < 6) {
      r.setRenderTarget(this.cube, this.envFace);
      r.render(this.scene, cams[this.envFace]);
      this.envFace++;
      if (!allAtOnce) break;
    }
    r.autoClear = auto;
    r.setRenderTarget(null);
    if (this.envFace >= 6 && (allAtOnce || this.envFace++ > 6)) {
      this.env = this.pmrem.fromCubemap(this.cube.texture, this.env ?? undefined);
      this.scene.environment = this.env.texture;
      this.envExposure = this.envStartExposure;
      this.envFace = -1;
    }
    this.scene.environmentIntensity = (exposure / this.envExposure) * this.fillBoost;
    this.glass.visible = true;
  }

  /**
   * Draw the cabin as the windows of one side mirror it. `camera` is the passenger's camera, in car axes.
   * side 0 is the left wall, 1 the right.
   */
  renderMirror(side: number, camera: THREE.PerspectiveCamera, strength: number) {
    const r = this.renderer;
    const z0 = (side === 0 ? -1 : 1) * CAR.glassZ;
    const mc = this.mirrorCam;
    mc.fov = camera.fov; mc.aspect = camera.aspect; mc.near = 0.05; mc.far = 60;
    mc.updateProjectionMatrix();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    mc.position.set(camera.position.x, camera.position.y, 2 * z0 - camera.position.z);
    mc.up.set(up.x, up.y, -up.z);
    mc.lookAt(mc.position.x + fwd.x, mc.position.y + fwd.y, mc.position.z - fwd.z);
    mc.updateMatrixWorld(true);
    this.mirrorVP[side].multiplyMatrices(mc.projectionMatrix, mc.matrixWorldInverse);
    this.glass.visible = false;
    r.clippingPlanes = [this.clip[side]];
    r.setRenderTarget(this.mirrors[side]);
    r.setClearColor(this.outsideCol, 1);
    r.clear();
    r.render(this.scene, mc);
    r.clippingPlanes = [];
    this.glass.visible = true;
    for (const g of this.glassMats) g.uniforms.uReflK.value = strength * this.mirrorGain;
  }
}

