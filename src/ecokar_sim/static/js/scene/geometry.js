// Small geometry toolbox: merging, vertex colours, metric UVs, shapes, noise, disposal.
// three r170 ships BufferGeometryUtils as an addon that is not vendored, so the few helpers
// the scene needs live here.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const rad = THREE.MathUtils.degToRad;
export const deg = THREE.MathUtils.radToDeg;

/** Deterministic PRNG so the street looks the same on every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Merge geometries that share the same attribute set into one draw call. */
export function mergeGeometries(list) {
  if (list.length === 0) return new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  const chunks = Object.fromEntries(names.map((name) => [name, []]));
  const itemSize = {};
  const indices = [];
  let vertexOffset = 0;
  for (const geometry of list) {
    for (const name of names) {
      const attribute = geometry.attributes[name];
      if (!attribute) throw new Error(`mergeGeometries: missing attribute "${name}"`);
      itemSize[name] = attribute.itemSize;
      chunks[name].push(attribute.array);
    }
    const count = geometry.attributes.position.count;
    if (geometry.index) {
      const source = geometry.index.array;
      for (let i = 0; i < source.length; i++) indices.push(source[i] + vertexOffset);
    } else {
      for (let i = 0; i < count; i++) indices.push(vertexOffset + i);
    }
    vertexOffset += count;
  }
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const total = chunks[name].reduce((sum, array) => sum + array.length, 0);
    const out = new Float32Array(total);
    let cursor = 0;
    for (const array of chunks[name]) {
      out.set(array, cursor);
      cursor += array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize[name]));
  }
  merged.setIndex(
    vertexOffset > 65535
      ? new THREE.Uint32BufferAttribute(indices, 1)
      : new THREE.Uint16BufferAttribute(indices, 1),
  );
  return merged;
}

/** Add a constant vertex colour (linear working space) to a geometry. */
export function colorize(geometry, color) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = c.r;
    array[i * 3 + 1] = c.g;
    array[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/** Bake a transform into a geometry (position, Euler rotation, scale). */
export function placed(geometry, t = {}) {
  _position.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  _euler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  _quaternion.setFromEuler(_euler);
  _scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  _matrix.compose(_position, _quaternion, _scale);
  geometry.applyMatrix4(_matrix);
  return geometry;
}

/** Box whose UVs are expressed in metres / tile, so textures keep their real-world size. */
export function metricBox(w, h, d, tile = 1) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  const faceSizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) {
      const index = face * 4 + i;
      uv.setXY(
        index,
        (uv.getX(index) * faceSizes[face][0]) / tile,
        (uv.getY(index) * faceSizes[face][1]) / tile,
      );
    }
  }
  return geometry;
}

/** Axis-aligned box between two corners. */
export function boxBetween(x0, y0, z0, x1, y1, z1, tile = 1) {
  const geometry = metricBox(x1 - x0, y1 - y0, z1 - z0, tile);
  return placed(geometry, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });
}

/** Flat quad lying on the ground (XZ plane) with metric UVs. */
export function groundQuad(x0, z0, x1, z1, y = 0, tile = 1) {
  const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * (x1 - x0)) / tile, (uv.getY(i) * (z1 - z0)) / tile);
  }
  return placed(geometry, { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 });
}

export function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + h - r);
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + h);
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/** Capsule outline between the pivots (0,0) and (length,0). */
export function capsuleShape(length, radius, pivotHoleRadius = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -radius);
  shape.lineTo(length, -radius);
  shape.absarc(length, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(0, radius);
  shape.absarc(0, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
  if (pivotHoleRadius > 0) {
    for (const px of [0, length]) {
      const hole = new THREE.Path();
      hole.absarc(px, 0, pivotHoleRadius, 0, TAU, true);
      shape.holes.push(hole);
    }
  }
  return shape;
}

/** Smooth 3D value noise in [0, 1]; deterministic, no allocations. */
function hash3(ix, iy, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz);
  const c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz);
  const c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1);
  const c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1);
  const c111 = hash3(ix + 1, iy + 1, iz + 1);
  return lerp(
    lerp(lerp(c000, c100, sx), lerp(c010, c110, sx), sy),
    lerp(lerp(c001, c101, sx), lerp(c011, c111, sx), sy),
    sz,
  );
}

const TEXTURE_SLOTS = [
  'map', 'bumpMap', 'alphaMap', 'normalMap', 'roughnessMap', 'emissiveMap', 'metalnessMap',
];

/** Dispose geometries, materials and textures below an object (skips `userData.shared`). */
export function disposeTree(root) {
  root.traverse((object) => {
    if (object.userData?.shared) return;
    if (object.geometry && !object.geometry.userData?.shared) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || material.userData?.shared) continue;
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (texture && !texture.userData?.shared) texture.dispose();
      }
      material.dispose();
    }
  });
}

export function enableShadows(root, { cast = true, receive = true } = {}) {
  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = cast;
      object.receiveShadow = receive;
    }
  });
  return root;
}
