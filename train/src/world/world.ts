// Everything outside the train.
import * as THREE from 'three';
import { TerrainBake } from './bake';
import { Atmosphere } from './atmosphere';
import { Terrain } from './terrain';
import { Sky, ephemeris } from './sky';
import { makeNoiseTexture } from './noisetex';
import { Trees, RINGS } from './trees';
import { Trackside } from './trackside';
import { Villages } from './villages';
import { cloudUniform, updateClouds, cloudAtCPU } from './clouds';

const ORIGIN_STEP = 4096;

export class World {
  readonly scene = new THREE.Scene();
  readonly bake: TerrainBake;
  readonly atmos: Atmosphere;
  readonly terrain: Terrain;
  readonly sky: Sky;
  readonly trees: Trees;
  readonly trackside: Trackside;
  readonly villages: Villages;
  readonly noise: THREE.DataTexture;
  /** uniforms every material of the landscape shares */
  readonly shared: Record<string, THREE.IUniform>;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** the light that casts shadows now: the sun, or the moon once the sun is down */
  readonly lightDir = new THREE.Vector3();
  /** how much of the sky is cloud, 0..1 */
  coverage = 0.42;
  /** Sunlight left by the clouds at a world position, 0..1. */
  cloudShade(x: number, y: number, z: number): number {
    const L = this.lightDir;
    if (L.y < 0.03) return 1;
    const k = (5300 - y) / L.y;
    const d = cloudAtCPU(this.noise, this.shared.uCloud.value as THREE.Vector4, x - this.bake.originX + L.x * k, z - this.bake.originZ + L.z * k);
    return 1 - 0.8 * d * THREE.MathUtils.smoothstep(L.y, 0.03, 0.2);
  }
  private lastX = NaN;
  private lastZ = NaN;
  private ambientAt = -1;
  private ambientBusy = false;
  private skyHour = -99;
  private skyAlt = -99;

  constructor(private renderer: THREE.WebGLRenderer, tileN: number, blocks: number) {
    this.noise = makeNoiseTexture();
    this.bake = new TerrainBake(renderer, tileN);
    this.atmos = new Atmosphere(renderer);
    this.shared = {
      tNoise: { value: this.noise },
      uCam: { value: new THREE.Vector3() },
      uSH: { value: this.atmos.ambient.sh },
      uSunPrimary: { value: 1 },
      uTreeFar: { value: RINGS[2].far },
      uTime: { value: 0 },
      uCloud: cloudUniform(),
    };
    this.terrain = new Terrain(this.bake, this.atmos, this.shared, blocks);
    this.sky = new Sky(this.atmos, this.noise, this.shared);
    this.trees = new Trees(this.bake, this.atmos, this.shared);
    this.trackside = new Trackside(this.bake, this.atmos, this.shared);
    this.villages = new Villages(this.bake, this.atmos, this.shared);
    this.scene.add(this.sky.mesh, this.terrain.mesh, this.trees.group, this.trackside.group, this.villages.group);
  }

  get originX() { return this.bake.originX; }
  get originZ() { return this.bake.originZ; }

  /** Where the lights are at this hour. */
  setHour(hour: number) {
    ephemeris(hour, this.sunDir, this.moonDir);
    this.atmos.sunDir.copy(this.sunDir);
    this.atmos.moonDir.copy(this.moonDir);
    const sunUp = this.sunDir.y > -0.035;
    this.shared.uSunPrimary.value = sunUp ? 1 : 0;
    this.lightDir.copy(sunUp ? this.sunDir : this.moonDir);
    this.bake.setSun(this.lightDir);
  }

  /** First frame: everything at once. */
  async init(camX: number, camY: number, camZ: number, hour: number) {
    this.bake.setOrigin(Math.round(camX / ORIGIN_STEP) * ORIGIN_STEP, Math.round(camZ / ORIGIN_STEP) * ORIGIN_STEP);
    this.setHour(hour);
    this.atmos.update(camY);
    this.skyHour = hour;
    this.skyAlt = camY;
    await this.atmos.updateAmbient();
    this.bake.bakeAll(camX, camZ);
    this.lastX = camX;
    this.lastZ = camZ;
  }

  /** Move the origin of local coordinates if the camera has gone far from it. Call before placing the camera. */
  prepare(camX: number, camZ: number) {
    // only when well past the middle of a step, so standing on a boundary does not flip it
    if (Math.abs(camX - this.bake.originX) > ORIGIN_STEP * 0.75 || Math.abs(camZ - this.bake.originZ) > ORIGIN_STEP * 0.75) {
      this.bake.setOrigin(Math.round(camX / ORIGIN_STEP) * ORIGIN_STEP, Math.round(camZ / ORIGIN_STEP) * ORIGIN_STEP);
    }
  }

  /** cam* are world coordinates; `camera` must already be placed in local ones. */
  update(camX: number, camY: number, camZ: number, camera: THREE.PerspectiveCamera, hour: number, time: number, pixelsHigh: number) {
    this.setHour(hour);
    if (Math.abs(hour - this.skyHour) > 0.0005 || Math.abs(camY - this.skyAlt) > 15) {
      this.atmos.update(camY);
      this.skyHour = hour;
      this.skyAlt = camY;
      this.ambientAt = -1;
    }
    if (this.ambientAt < 0 && !this.ambientBusy) {
      this.ambientBusy = true;
      this.ambientAt = time;
      this.atmos.updateAmbient().finally(() => (this.ambientBusy = false));
    }
    updateClouds(this.shared.uCloud.value as THREE.Vector4, this.bake.originX, this.bake.originZ, time, this.coverage);
    if (Math.abs(camX - this.lastX) > 250 || Math.abs(camZ - this.lastZ) > 250) {
      // a jump, not a journey: the land is drawn again at once, and the trees stood on it again
      this.bake.bakeAll(camX, camZ);
      this.trees.reset();
    }
    this.lastX = camX;
    this.lastZ = camZ;
    this.bake.update(camX, camZ);
    (this.shared.uCam.value as THREE.Vector3).set(camX - this.bake.originX, camY, camZ - this.bake.originZ);
    this.shared.uTime.value = time;
    this.terrain.update(camX, camZ, camera);
    this.trees.update(camX, camZ, camera, this.renderer);
    this.trackside.update(camX);
    const sunElev = (Math.asin(THREE.MathUtils.clamp(this.sunDir.y, -1, 1)) * 180) / Math.PI;
    this.villages.update(camX, 1 - THREE.MathUtils.smoothstep(sunElev, -5, 4), (camera.fov * Math.PI) / 180 / pixelsHigh);
    this.sky.update(camera, pixelsHigh, hour, time);
  }
}
