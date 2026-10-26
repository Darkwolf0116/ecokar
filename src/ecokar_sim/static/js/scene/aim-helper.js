// Grasp aid: a dashed plumb line and a ring under the grasp point, plus a mint ring under the
// item that the gripper could close on right now.
import * as THREE from 'three';
import { TRASH_WIDTH } from './trash.js';

/** Closest item centre (m) at which closing the gripper grasps it; matches the backend. */
export const GRASP_RADIUS = 0.03;
const MINT = 0x8df18d;

function flatRing(inner, outer, segments, opacity) {
  const geometry = new THREE.RingGeometry(inner, outer, segments);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: MINT,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  return new THREE.Mesh(geometry, material);
}

export class AimHelper {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'aim-helper';
    parent.add(this.group);

    this.positions = new Float32Array(6);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(
      lineGeometry,
      new THREE.LineDashedMaterial({ color: MINT, dashSize: 0.01, gapSize: 0.007, transparent: true, opacity: 0.8 }),
    );
    this.line.frustumCulled = false;
    this.footprint = flatRing(0.012, 0.017, 32, 0.8);
    this.target = flatRing(0.027, 0.034, 40, 0.95);
    this.target.visible = false;
    this.group.add(this.line, this.footprint, this.target);
  }

  /**
   * Update from the rendered grasp point and trash list.
   * Returns the id of the item ready to be gripped, or null.
   */
  update(grasp, items, openingM) {
    const p = this.positions;
    p[0] = grasp.x;
    p[1] = grasp.y;
    p[2] = grasp.z;
    p[3] = grasp.x;
    p[4] = 0.003;
    p[5] = grasp.z;
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.computeLineDistances();
    this.line.visible = grasp.y > 0.008;
    this.footprint.position.set(grasp.x, 0.004, grasp.z);

    let best = null;
    let bestDistance = Infinity;
    for (const item of items) {
      if (item.state !== 'ground') continue;
      if ((TRASH_WIDTH[item.kind] ?? 0.04) > openingM + 0.0005) continue;
      const distance = Math.hypot(item.x - grasp.x, item.y - grasp.y, item.z - grasp.z);
      if (distance <= GRASP_RADIUS && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    this.target.visible = best !== null;
    if (best) this.target.position.set(best.x, 0.005, best.z);
    return best ? best.id : null;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const child of this.group.children) {
      child.geometry.dispose();
      child.material.dispose();
    }
  }
}
