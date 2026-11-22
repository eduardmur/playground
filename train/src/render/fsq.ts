import * as THREE from 'three';

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FSQ_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** One shader drawn over a whole render target (or the part of it inside the given rectangle). */
export class Pass {
  readonly material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private scene = new THREE.Scene();

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FSQ_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      ...opts,
    });
    this.mesh = new THREE.Mesh(tri, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get u() {
    return this.material.uniforms;
  }

  /** rect is [x, y, width, height] in pixels of the target; the whole target if left out. */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, rect?: [number, number, number, number], viewport?: [number, number, number, number]) {
    if (target) {
      const v = viewport ?? [0, 0, target.width, target.height];
      target.viewport.set(v[0], v[1], v[2], v[3]);
      if (rect) {
        target.scissor.set(rect[0], rect[1], rect[2], rect[3]);
        target.scissorTest = true;
      } else {
        target.scissorTest = false;
      }
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
    renderer.autoClear = auto;
  }
}
