// Small drawn textures for the inside of the carriage: cloth, carpet, wood, brushed metal.
import * as THREE from 'three';
import { mulberry } from '../world/noisetex';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat: number, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A height field (0..1 in a Float32Array) to a tangent-space normal map. */
function normalFrom(height: Float32Array, n: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(n, n);
  const img = ctx.createImageData(n, n);
  const at = (x: number, y: number) => height[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
      img.data[i] = (-dx / l) * 127.5 + 127.5;
      img.data[i + 1] = (dy / l) * 127.5 + 127.5;
      img.data[i + 2] = (1 / l) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Woven cloth: a plain weave seen close, as colour variation and as relief. */
export function cloth(base: [number, number, number], seed: number, repeat: number) {
  const n = 128, rand = mulberry(seed);
  const [c, ctx] = canvas(n, n);
  const img = ctx.createImageData(n, n);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tx = x % 4, ty = y % 4;
      // over-under: warp shows on even cells, weft on odd
      const over = ((x >> 2) + (y >> 2)) & 1;
      const bump = over ? Math.sin(((tx + 0.5) / 4) * Math.PI) : Math.sin(((ty + 0.5) / 4) * Math.PI);
      const fleck = rand();
      h[y * n + x] = bump * 0.8 + fleck * 0.2;
      const v = 0.82 + 0.22 * bump + (fleck - 0.5) * 0.16 + (over ? 0.03 : -0.03);
      const i = (y * n + x) * 4;
      img.data[i] = Math.min(255, base[0] * v);
      img.data[i + 1] = Math.min(255, base[1] * v);
      img.data[i + 2] = Math.min(255, base[2] * v);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, repeat, true), normalMap: finish(normalFrom(h, n, 1.6), repeat, false) };
}

/** Short-pile carpet: dense speckle. */
export function carpet(base: [number, number, number], seed: number, repeat: number) {
  const n = 256, rand = mulberry(seed);
  const [c, ctx] = canvas(n, n);
  const img = ctx.createImageData(n, n);
  const h = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const r = rand(), r2 = rand();
    h[i] = r;
    const v = 0.72 + 0.4 * r + (r2 > 0.93 ? 0.25 : 0);
    img.data[i * 4] = Math.min(255, base[0] * v);
    img.data[i * 4 + 1] = Math.min(255, base[1] * v);
    img.data[i * 4 + 2] = Math.min(255, base[2] * v);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c, repeat, true), normalMap: finish(normalFrom(h, n, 1.2), repeat, false) };
}

/** Pale wood veneer, grain running along u. */
export function wood(seed: number) {
  const w = 512, h = 256, rand = mulberry(seed);
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#b89872';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const y = rand() * h, len = 80 + rand() * 400, x = rand() * w - 100;
    const light = rand() > 0.5;
    ctx.strokeStyle = light ? `rgba(226,200,160,${0.05 + rand() * 0.12})` : `rgba(96,66,38,${0.05 + rand() * 0.14})`;
    ctx.lineWidth = 0.5 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 5, x + len * 0.7, y + (rand() - 0.5) * 5, x + len, y + (rand() - 0.5) * 3);
    ctx.stroke();
  }
  const t = finish(c, 1, true);
  return { map: t };
}

/** Brushed metal: fine streaks as roughness variation. */
export function brushed(seed: number) {
  const n = 256, rand = mulberry(seed);
  const [c, ctx] = canvas(n, n);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 1400; i++) {
    const y = rand() * n, x = rand() * n, len = 20 + rand() * 120, v = Math.round(96 + rand() * 80);
    ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  return { roughnessMap: finish(c, 2, false) };
}

/** A soft round shadow for under the furniture. */
export function blob(): THREE.CanvasTexture {
  const n = 128;
  const [c, ctx] = canvas(n, n);
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
