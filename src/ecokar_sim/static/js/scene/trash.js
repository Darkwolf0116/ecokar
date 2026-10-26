// Trash meshes keyed by id: PET bottle, crushed can and a crumpled paper ball.
import * as THREE from 'three';
import { noise3 } from './geometry.js';
import * as textures from './textures.js';

/** Width of each kind across the gripper fingers (metres); matches the backend table. */
export const TRASH_WIDTH = { bottle: 0.04, can: 0.034, paper: 0.036 };

const MINT = new THREE.Color(0x8df18d);

function heldVariant(material) {
  const held = material.clone();
  held.emissive = MINT.clone();
  held.emissiveIntensity = 0.12;
  return held;
}

/** A shared set of geometries and materials; every item is a light Group of meshes. */
function createKit() {
  const disposables = [];
  const track = (resource) => {
    disposables.push(resource);
    return resource;
  };
  const alongX = (geometry, length) => {
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(-length / 2, 0, 0);
    return geometry;
  };

  // --- bottle (lying along local +X, 0.11 m long, 0.04 m wide)
  const bottleProfile = [
    [0, 0], [0.016, 0], [0.0192, 0.004], [0.02, 0.012], [0.02, 0.06],
    [0.0178, 0.072], [0.0115, 0.084], [0.0098, 0.089], [0.0098, 0.097], [0, 0.097],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bottleBody = track(alongX(new THREE.LatheGeometry(bottleProfile, 24), 0.11));
  const bottleCap = track(alongX(new THREE.CylinderGeometry(0.0108, 0.0108, 0.016, 16).translate(0, 0.102, 0), 0.11));
  const bottleLabel = track(
    alongX(new THREE.CylinderGeometry(0.0204, 0.0204, 0.034, 24, 1, true).translate(0, 0.04, 0), 0.11),
  );
  const labelMap = track(textures.bottleLabelTexture());
  const plastic = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xbfe3f5,
      transparent: true,
      opacity: 0.42,
      roughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      clearcoat: 1,
      envMapIntensity: 1.6,
    }),
  );
  const capMaterial = track(new THREE.MeshStandardMaterial({ color: 0x1e5bc6, roughness: 0.45 }));
  const labelMaterial = track(new THREE.MeshStandardMaterial({ map: labelMap, roughness: 0.6, side: THREE.DoubleSide }));

  // --- can (0.07 m long, 0.034 m wide, dented and bent)
  const canProfile = [
    [0, 0], [0.0125, 0], [0.0145, 0.0035], [0.017, 0.009], [0.017, 0.0585],
    [0.0145, 0.0645], [0.0125, 0.0672], [0.0125, 0.07], [0, 0.07],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const canLathe = new THREE.LatheGeometry(canProfile, 28);
  {
    const position = canLathe.attributes.position;
    const red = new THREE.Color('#C23A32');
    const silver = new THREE.Color('#CBCFD4');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const t = y / 0.07;
      const bell = Math.max(0, Math.sin(Math.PI * t));
      const wrinkle = noise3(x * 140 + 3.1, y * 110, z * 140) - 0.5;
      const radial = 1 + wrinkle * 0.5 * bell;
      position.setXYZ(i, x * radial + 0.006 * bell, y, z * radial * (1 - 0.3 * Math.pow(bell, 1.2)));
      const color = y > 0.011 && y < 0.059 ? red : silver;
      const shade = 0.9 + wrinkle * 0.35;
      colors[i * 3] = color.r * shade;
      colors[i * 3 + 1] = color.g * shade;
      colors[i * 3 + 2] = color.b * shade;
    }
    canLathe.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    canLathe.computeVertexNormals();
  }
  const canGeometry = track(alongX(canLathe, 0.07));
  const canMaterial = track(
    new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.4, flatShading: true }),
  );

  // --- paper ball (about 0.036 m across)
  const paperGeometry = new THREE.IcosahedronGeometry(0.018, 3);
  {
    const position = paperGeometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const base = new THREE.Color('#ECE7DA');
    for (let i = 0; i < position.count; i++) {
      const nx = position.getX(i) / 0.018;
      const ny = position.getY(i) / 0.018;
      const nz = position.getZ(i) / 0.018;
      const big = noise3(nx * 2.2 + 5, ny * 2.2, nz * 2.2);
      const small = noise3(nx * 6.5, ny * 6.5 + 3, nz * 6.5);
      const radius = 0.018 * (0.8 + 0.3 * big + 0.14 * small);
      position.setXYZ(i, nx * radius, ny * radius, nz * radius);
      const shade = 0.78 + 0.3 * small + 0.1 * big;
      colors[i * 3] = base.r * shade;
      colors[i * 3 + 1] = base.g * shade;
      colors[i * 3 + 2] = base.b * shade;
    }
    paperGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    paperGeometry.computeVertexNormals();
  }
  track(paperGeometry);
  const paperMaterial = track(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
  );

  const parts = {
    bottle: [
      [bottleBody, plastic, 1],
      [bottleCap, capMaterial, 0],
      [bottleLabel, labelMaterial, 0],
    ],
    can: [[canGeometry, canMaterial, 0]],
    paper: [[paperGeometry, paperMaterial, 0]],
  };
  const heldMaterials = new Map();
  for (const list of Object.values(parts)) {
    for (const [, material] of list) {
      if (!heldMaterials.has(material)) heldMaterials.set(material, track(heldVariant(material)));
    }
  }

  return {
    create(kind) {
      const group = new THREE.Group();
      group.name = `trash-${kind}`;
      const entries = [];
      for (const [geometry, material, renderOrder] of parts[kind] ?? parts.paper) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = material !== plastic;
        mesh.receiveShadow = true;
        mesh.renderOrder = renderOrder;
        group.add(mesh);
        entries.push({ mesh, normal: material, held: heldMaterials.get(material) });
      }
      group.userData.entries = entries;
      return group;
    },
    dispose() {
      for (const resource of disposables) resource.dispose();
    },
  };
}

export class TrashLayer {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'trash';
    parent.add(this.group);
    this.kit = createKit();
    this.items = new Map();
  }

  /** Create, move and remove meshes so they mirror the given state list. */
  apply(list) {
    const seen = new Set();
    for (const item of list) {
      seen.add(item.id);
      let entry = this.items.get(item.id);
      if (entry && entry.kind !== item.kind) {
        this.group.remove(entry.group);
        this.items.delete(item.id);
        entry = undefined;
      }
      if (!entry) {
        entry = { kind: item.kind, group: this.kit.create(item.kind), held: false };
        this.group.add(entry.group);
        this.items.set(item.id, entry);
      }
      entry.group.position.set(item.x, item.y, item.z);
      entry.group.rotation.y = item.yaw;
      const held = item.state === 'held';
      if (held !== entry.held) {
        entry.held = held;
        for (const part of entry.group.userData.entries) {
          part.mesh.material = held ? part.held : part.normal;
        }
      }
    }
    for (const [id, entry] of this.items) {
      if (!seen.has(id)) {
        this.group.remove(entry.group);
        this.items.delete(id);
      }
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.items.clear();
    this.kit.dispose();
  }
}
