// How a frame is put together:
//   1. (when the road is wet) the world, mirrored in the road surface, at reduced size
//   2. the world, from the cab's eye, into an HDR target
//   3. that image as a backdrop, with the cabin drawn over it; the cabin's glass
//      samples the backdrop, so raindrops can bend the street behind them
//   4. bloom, tone mapping, a little lens character
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { env } from '../world/shared.js';
import { fxUniforms } from '../fx/lights.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.42 }, uGrain: { value: 0.035 }, uCA: { value: 0.012 }, uFade: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA, uFade; varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uCA;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - uVig * smoothstep(0.1, 0.9, r2 * 1.9);
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 311.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

class ScenePass extends Pass {
  constructor(pipeline) {
    super();
    this.pipeline = pipeline;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.pipeline.renderScenes(renderer, readBuffer);
  }
}

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();

export class Pipeline {
  constructor(renderer, world, cabinScene, camera, quality) {
    this.renderer = renderer;
    this.world = world;
    this.cabinScene = cabinScene;
    this.camera = camera;
    this.quality = quality;
    this.showCabin = true;
    this.reflectOn = false;
    renderer.autoClear = false;

    const hdr = { type: THREE.HalfFloatType };
    this.rtWorld = new THREE.WebGLRenderTarget(4, 4, { ...hdr, samples: quality.msaa, depthBuffer: true });
    this.rtWorld.texture.generateMipmaps = true;
    this.rtWorld.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...hdr, samples: quality.msaa, depthBuffer: true });
    this.rtReflect = new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: true });
    this.rtReflect.texture.generateMipmaps = true;
    this.rtReflect.texture.minFilter = THREE.LinearMipmapLinearFilter;
    env.uReflect.value = this.rtReflect.texture;

    this.mirror = new THREE.PerspectiveCamera(); // sees layer 0 only

    this.copy = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tMap: { value: null } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = texture2D(tMap, vUv); }',
        depthTest: false, depthWrite: false,
      }),
    );

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, hdr));
    this.composer.addPass(new ScenePass(this));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.72, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.width = 4;
    this.height = 4;
    /** Size of the scene targets in pixels, for shaders that read gl_FragCoord. */
    this.resolution = new THREE.Vector2(4, 4);
  }

  setSize(w, h, pixelRatio) {
    const pw = Math.max(2, Math.floor(w * pixelRatio)), ph = Math.max(2, Math.floor(h * pixelRatio));
    this.width = pw;
    this.height = ph;
    this.resolution.set(pw, ph);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.rtWorld.setSize(pw, ph);
    this.rtScene.setSize(pw, ph);
    const rs = this.quality.reflectScale;
    this.rtReflect.setSize(Math.max(2, Math.floor(pw * rs)), Math.max(2, Math.floor(ph * rs)));
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  _updateMirror() {
    const cam = this.camera, m = this.mirror;
    cam.updateMatrixWorld();
    _p.setFromMatrixPosition(cam.matrixWorld);
    _f.set(0, 0, -1).transformDirection(cam.matrixWorld);
    _u.set(0, 1, 0).transformDirection(cam.matrixWorld);
    m.position.set(_p.x, -_p.y, _p.z);
    m.up.set(_u.x, -_u.y, _u.z);
    m.lookAt(_p.x + _f.x, -(_p.y + _f.y), _p.z + _f.z);
    m.updateMatrixWorld();
    m.matrixWorldInverse.copy(m.matrixWorld).invert();
    m.projectionMatrix.copy(cam.projectionMatrix);
    m.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    env.uReflectMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(m.projectionMatrix)
      .multiply(m.matrixWorldInverse);
  }

  renderScenes(renderer, target) {
    const cam = this.camera;
    cam.near = 0.3;
    cam.far = 6000;
    cam.updateProjectionMatrix();

    if (this.reflectOn) {
      this._updateMirror();
      // lights are far brighter than anything else in the mirror image, as they are on a real wet road
      fxUniforms.uGlowBoost.value = 9;
      fxUniforms.uGlowSize.value = 1.7;
      renderer.setRenderTarget(this.rtReflect);
      renderer.clear();
      renderer.render(this.world, this.mirror);
      fxUniforms.uGlowBoost.value = 1;
      fxUniforms.uGlowSize.value = 1;
    }

    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(this.rtWorld);
    renderer.clear();
    renderer.render(this.world, cam);

    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    this.copy.material.uniforms.tMap.value = this.rtWorld.texture;
    this.copy.render(renderer);
    if (this.showCabin) {
      cam.near = 0.03;
      cam.far = 40;
      cam.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.shadowMap.needsUpdate = true;
      renderer.render(this.cabinScene, cam);
    }

    renderer.setRenderTarget(target);
    this.copy.material.uniforms.tMap.value = this.rtScene.texture;
    this.copy.render(renderer);
  }

  render(dt, time) {
    this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
