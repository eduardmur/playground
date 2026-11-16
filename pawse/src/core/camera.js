import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, smoothstep } from './utils.js';

/**
 * Third-person camera that orbits the dog. Drag to look around, scroll to zoom.
 * It drifts round as the dog turns, and when nothing is happening it settles
 * into a slow cinematic orbit.
 */
export class CameraRig {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = Math.PI;
    this.pitch = 0.3;
    this.dist = 3.6;
    this.userDist = 3.6;
    this.userPitch = 0.3;
    this.target = new THREE.Vector3();
    this.anchor = null; // { x, y, z } to look at instead of the dog, on the title screen
    this.mode = 'title';
    this.baseFov = 50;
    this.fov = 50;
    this.lastDrag = -10;
    this.cine = 0;
    this.time = 0;
    this.shoulder = 0;
  }

  snapTo(dog) {
    this.target.set(dog.pos.x, dog.pos.y + 0.5 * dog.scale, dog.pos.z);
    this.yaw = dog.heading + Math.PI;
  }

  update(dt, input, dog, opts = {}) {
    this.time += dt;
    const sc = dog.scale;
    const moving = dog.speed > 0.3;

    if (this.mode === 'title') {
      this.yaw += dt * 0.085;
      this.pitch = damp(this.pitch, 0.13, 2, dt);
      this.dist = damp(this.dist, 2.7 * lerp(0.85, 1.15, sc - 0.3), 2, dt);
      this.cine = 0;
    } else {
      if (input.dragX || input.dragY) {
        this.yaw -= input.dragX * 0.0052;
        this.userPitch = clamp(this.userPitch + input.dragY * 0.0042, 0.04, 1.25);
        this.lastDrag = this.time;
      }
      if (input.wheel) this.userDist = clamp(this.userDist * Math.exp(input.wheel * 0.0011), 1.8, 12);

      // swing round with sideways movement, like a friend walking beside you
      const sinceDrag = this.time - this.lastDrag;
      if (moving && sinceDrag > 0.6) this.yaw -= input.move.x * 0.95 * dt * clamp(dog.speed / 2.5, 0.4, 1.3);

      // nothing happening: drift into a slow orbit and pull back a little
      const idle = input.idleSeconds() > 9 && !moving ? 1 : 0;
      this.cine = damp(this.cine, idle || opts.restful ? 1 : 0, idle ? 0.5 : 2.5, dt);
      if (this.cine > 0.01) this.yaw += dt * 0.05 * this.cine;

      const wantDist = this.userDist * lerp(0.8, 1.2, clamp(sc - 0.3, 0, 1)) * (1 + this.cine * 0.28) * (1 + smoothstep(3, 6.5, dog.speed) * 0.12);
      this.dist = damp(this.dist, wantDist, 4, dt);
      this.pitch = damp(this.pitch, lerp(this.userPitch, Math.min(this.userPitch, 0.24), this.cine * 0.7), 5, dt);
    }

    // follow the dog; on the title screen, keep to the spot it stands on while dogs run in and out
    const focus = this.mode === 'title' && this.anchor ? this.anchor : dog.pos;
    const tx = focus.x, tz = focus.z;
    const ty = focus.y + (this.mode === 'title' ? 0.62 : 0.52) * sc + 0.08;
    const k = this.mode === 'title' ? 6 : 11;
    this.target.x = damp(this.target.x, tx, k, dt);
    this.target.z = damp(this.target.z, tz, k, dt);
    this.target.y = damp(this.target.y, ty, dog.grounded ? 7 : 3.5, dt);

    const cp = Math.cos(this.pitch);
    let x = this.target.x + Math.sin(this.yaw) * cp * this.dist;
    let z = this.target.z + Math.cos(this.yaw) * cp * this.dist;
    let y = this.target.y + Math.sin(this.pitch) * this.dist;
    // stay above the ground (and out of the pond)
    const floor = Math.max(this.terrain.heightAt(x, z), -0.42) + 0.3;
    if (y < floor) y = floor;
    this.camera.position.set(x, y, z);
    this.titleDrop = damp(this.titleDrop ?? 0.42, this.mode === 'title' ? 0.42 : -0.12, 2.2, dt);
    this.camera.lookAt(this.target.x, this.target.y - this.titleDrop * sc, this.target.z);

    const fov = this.baseFov + smoothstep(3.2, 6.5, dog.speed) * 6 + (this.mode === 'title' ? -8 : 0);
    this.fov = damp(this.fov, fov, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Unit vectors on the ground plane for camera-relative movement. */
  basis(outForward, outRight) {
    outForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    outRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}
