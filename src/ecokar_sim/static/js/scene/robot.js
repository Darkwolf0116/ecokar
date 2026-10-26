// Procedural model of the real EcoKar prototype: acrylic plate, 4 TT motors, Arduino Mega,
// L298N, HC-05, LiPo pack and the EEZYbotARM MK3 arm with an SG90 gripper.
//
// Frames (metres, Y up): the robot group sits at (x, 0, z) with rotation.y = yaw and its
// forward axis is local +X. The arm chain mirrors the backend kinematics exactly:
//   turret (at arm_mount)      rotation.y = base_deg
//   shoulder (turret + (0, shoulder_height, 0)) rotation.z = shoulder_deg, link along +X (l1)
//   elbow (shoulder + (l1, 0, 0))               rotation.z = elbow_deg - shoulder_deg
//   wrist (elbow + (l2, 0, 0))                  rotation.z = -elbow_deg   (gripper stays level)
//   grasp point = wrist + (grasp_offset[0], grasp_offset[1], 0)
import * as THREE from 'three';
import {
  TAU,
  capsuleShape,
  colorize,
  disposeTree,
  mergeGeometries,
  placed,
  rad,
  roundedRectShape,
} from './geometry.js';
import * as textures from './textures.js';

const std = (options) => new THREE.MeshStandardMaterial(options);

function makeMaterials() {
  const tread = textures.treadTexture();
  tread.repeat.set(20, 1);
  return {
    acrylic: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0e, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.12 }),
    yellow: std({ color: 0xf5c400, roughness: 0.48 }),
    rubber: std({ color: 0x1a1a1d, roughness: 0.95, bumpMap: tread, bumpScale: 1.5 }),
    black: std({ color: 0x16171a, roughness: 0.62 }),
    sidewall: std({ color: 0x121214, roughness: 0.9, side: THREE.DoubleSide }),
    blue: std({ color: 0x1f5fa8, roughness: 0.5 }),
    red: std({ color: 0xc8232c, roughness: 0.5 }),
    silver: std({ color: 0xb8bcc2, roughness: 0.32, metalness: 0.8 }),
    terminal: std({ color: 0x1b73c9, roughness: 0.5 }),
    pla: std({ color: 0xf2f2ee, roughness: 0.6 }),
    servo: std({ color: 0x2a5bd7, roughness: 0.25, transparent: true, opacity: 0.78 }),
    stepperCap: std({ color: 0x2b5fb4, roughness: 0.5 }),
    gold: std({ color: 0xc7a24a, roughness: 0.35, metalness: 0.8 }),
    wire: std({ vertexColors: true, roughness: 0.55 }),
    led: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a12, emissiveIntensity: 0.1, roughness: 0.3 }),
  };
}

/** Collects static geometry per material and flushes it as one merged mesh per material. */
class Batch {
  constructor(parent) {
    this.parent = parent;
    this.lists = new Map();
  }

  add(material, geometry, transform) {
    if (transform) placed(geometry, transform);
    if (!this.lists.has(material)) this.lists.set(material, []);
    this.lists.get(material).push(geometry);
    return this;
  }

  flush() {
    for (const [material, list] of this.lists) {
      const merged = new THREE.Mesh(mergeGeometries(list), material);
      merged.castShadow = true;
      merged.receiveShadow = true;
      this.parent.add(merged);
      for (const geometry of list) geometry.dispose();
    }
    this.lists.clear();
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Cylinder whose axis points along 'x', 'y' or 'z'. */
function cylinder(radius, length, axis = 'y', segments = 18, radiusBottom = radius) {
  const geometry = new THREE.CylinderGeometry(radius, radiusBottom, length, segments);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  if (axis === 'x') geometry.rotateZ(-Math.PI / 2);
  return geometry;
}

function labelPlane(texture, width, depth, x, y, z) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const plane = new THREE.Mesh(
    geometry,
    std({ map: texture, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  plane.position.set(x, y, z);
  plane.receiveShadow = true;
  return plane;
}

// ------------------------------------------------------------------------- plate
function buildPlate(spec, M) {
  const L = spec.plate_length;
  const W = spec.plate_width;
  const thickness = 0.004;
  const bevel = 0.0008;
  const shape = roundedRectShape(L, W, 0.014);
  const addHole = (x, y, r) => {
    const hole = new THREE.Path();
    hole.absarc(x, y, r, 0, TAU, true);
    shape.holes.push(hole);
  };
  for (let i = -6; i <= 6; i++) {
    addHole(i * 0.0185, 0.063, 0.0028);
    addHole(i * 0.0185, -0.063, 0.0028);
    if (i % 2 === 0 && Math.abs(i) <= 4) {
      addHole(i * 0.0185, 0.042, 0.0028);
      addHole(i * 0.0185, -0.042, 0.0028);
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, spec.plate_y - (thickness - bevel), 0);
  const plate = new THREE.Mesh(geometry, M.acrylic);
  plate.castShadow = true;
  plate.receiveShadow = true;
  plate.name = 'plate';
  return plate;
}

// ------------------------------------------------------------------------ wheels
function buildWheels(chassis, spec, M) {
  const R = spec.wheel_radius;
  const w = spec.wheel_width;

  const treadGeometry = new THREE.CylinderGeometry(R, R, w, 44, 1, true);
  treadGeometry.rotateX(Math.PI / 2);

  const rimOuter = R * 0.72;
  const rimShape = new THREE.Shape();
  rimShape.absarc(0, 0, rimOuter, 0, TAU, false);
  for (let k = 0; k < 5; k++) {
    const a0 = (k * TAU) / 5 + rad(11);
    const a1 = ((k + 1) * TAU) / 5 - rad(11);
    const hole = new THREE.Path();
    hole.absarc(0, 0, rimOuter * 0.86, a0, a1, false);
    hole.absarc(0, 0, rimOuter * 0.36, a1, a0, true);
    hole.closePath();
    rimShape.holes.push(hole);
  }
  const rimGeometry = new THREE.ExtrudeGeometry(rimShape, { depth: w * 1.04, bevelEnabled: false, curveSegments: 10 });
  rimGeometry.translate(0, 0, -w * 0.52);

  const hubBatch = [];
  hubBatch.push(cylinder(R * 0.2, w * 1.12, 'z', 14));
  const hub = mergeGeometries(hubBatch);

  const sidewallGeometries = [];
  for (const side of [-1, 1]) {
    const ring = new THREE.RingGeometry(rimOuter * 0.6, R * 0.995, 40);
    if (side < 0) ring.rotateY(Math.PI);
    ring.translate(0, 0, side * (w / 2 + 0.0002));
    sidewallGeometries.push(ring);
  }
  const sidewall = mergeGeometries(sidewallGeometries);

  const wheels = [];
  const positions = [
    [spec.wheelbase / 2, spec.track / 2, 'R'],
    [spec.wheelbase / 2, -spec.track / 2, 'L'],
    [-spec.wheelbase / 2, spec.track / 2, 'R'],
    [-spec.wheelbase / 2, -spec.track / 2, 'L'],
  ];
  for (const [x, z, side] of positions) {
    const wheel = new THREE.Group();
    wheel.position.set(x, R, z);
    const tire = new THREE.Mesh(treadGeometry, M.rubber);
    const walls = new THREE.Mesh(sidewall, M.sidewall);
    const rim = new THREE.Mesh(rimGeometry, M.yellow);
    const cap = new THREE.Mesh(hub, M.silver);
    for (const part of [tire, walls, rim, cap]) {
      part.castShadow = true;
      part.receiveShadow = true;
      wheel.add(part);
    }
    chassis.add(wheel);
    wheels.push({ group: wheel, side });
  }
  return { wheels, shared: [treadGeometry, rimGeometry, hub, sidewall] };
}

// ------------------------------------------------------------------------ motors
function buildMotors(chassis, spec, M) {
  const batch = new Batch(chassis);
  const R = spec.wheel_radius;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = (sx * spec.wheelbase) / 2;
      const zInner = sz * 0.034;
      // gearbox between the wheel and the plate, plus the motor can and a bracket up to the plate
      batch.add(M.yellow, box(0.024, 0.024, 0.036), { x, y: R, z: sz * 0.052 });
      batch.add(M.silver, cylinder(0.0095, 0.026, 'z', 14), { x, y: R, z: zInner * 0.72 });
      batch.add(M.yellow, box(0.022, spec.plate_y - 0.004 - (R + 0.012), 0.02), {
        x,
        y: (spec.plate_y - 0.004 + R + 0.012) / 2,
        z: sz * 0.05,
      });
      batch.add(M.silver, cylinder(0.0022, 0.03, 'z', 8), { x, y: R, z: sz * 0.07 });
    }
  }
  batch.flush();
}

// ----------------------------------------------------------------- electronics
function wireGeometry(points, color, radius = 0.0007) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return colorize(new THREE.TubeGeometry(curve, 18, radius, 5, false), color);
}

function buildElectronics(chassis, spec, M) {
  const py = spec.plate_y;
  const stand = 0.005;
  const batch = new Batch(chassis);
  const extras = [];

  // ---- Arduino Mega 2560 (rear right)
  const mega = { x: -0.078, z: 0.03 };
  const megaY = py + stand + 0.0008;
  batch.add(M.blue, box(0.1016, 0.0016, 0.0533), { x: mega.x, y: megaY, z: mega.z });
  for (const dz of [-0.0235, 0.0235]) {
    batch.add(M.black, box(0.088, 0.0085, 0.0026), { x: mega.x + 0.002, y: megaY + 0.0055, z: mega.z + dz });
  }
  batch.add(M.black, box(0.032, 0.0085, 0.0026), { x: mega.x + 0.034, y: megaY + 0.0055, z: mega.z + 0.0105 });
  batch.add(M.silver, box(0.016, 0.011, 0.012), { x: mega.x - 0.0508 + 0.005, y: megaY + 0.0063, z: mega.z + 0.012 });
  batch.add(M.black, box(0.0135, 0.0105, 0.0095), { x: mega.x - 0.0508 + 0.005, y: megaY + 0.006, z: mega.z - 0.013 });
  batch.add(M.black, box(0.0145, 0.002, 0.0145), { x: mega.x + 0.014, y: megaY + 0.0018, z: mega.z });
  batch.add(M.silver, cylinder(0.0035, 0.0032, 'y', 10), { x: mega.x - 0.005, y: megaY + 0.0024, z: mega.z + 0.004 });
  for (const sx of [-0.045, 0.045]) {
    for (const sz of [-0.02, 0.02]) {
      batch.add(M.silver, cylinder(0.0025, stand, 'y', 8), { x: mega.x + sx, y: py + stand / 2, z: mega.z + sz });
    }
  }
  extras.push(
    labelPlane(
      textures.labelTexture(['ARDUINO', 'MEGA 2560'], { width: 256, height: 128, bg: '#1F5FA8', fg: '#DCE9FA', size: 30 }),
      0.04,
      0.02,
      mega.x + 0.004,
      megaY + 0.0011,
      mega.z - 0.0005,
    ),
  );

  // ---- L298N motor driver (front left of the electronics)
  const drv = { x: 0.004, z: -0.03 };
  const drvY = py + stand + 0.0008;
  batch.add(M.red, box(0.043, 0.0016, 0.043), { x: drv.x, y: drvY, z: drv.z });
  const sinkBase = box(0.026, 0.003, 0.02);
  batch.add(M.black, sinkBase, { x: drv.x, y: drvY + 0.0023, z: drv.z - 0.004 });
  for (let i = 0; i < 8; i++) {
    batch.add(M.black, box(0.0016, 0.016, 0.02), { x: drv.x - 0.011 + i * 0.0031, y: drvY + 0.011, z: drv.z - 0.004 });
  }
  for (const [tx, tz] of [[-0.016, 0.0145], [0, 0.0145], [0.016, 0.0145]]) {
    batch.add(M.terminal, box(0.0105, 0.0095, 0.0105), { x: drv.x + tx, y: drvY + 0.0055, z: drv.z + tz });
  }
  batch.add(M.black, box(0.022, 0.0085, 0.0026), { x: drv.x, y: drvY + 0.0055, z: drv.z - 0.0195 });
  batch.add(M.yellow, box(0.007, 0.004, 0.004), { x: drv.x + 0.0205, y: drvY + 0.0028, z: drv.z - 0.012 });
  for (const sx of [-0.017, 0.017]) {
    for (const sz of [-0.017, 0.017]) {
      batch.add(M.silver, cylinder(0.0022, stand, 'y', 8), { x: drv.x + sx, y: py + stand / 2, z: drv.z + sz });
    }
  }
  extras.push(
    labelPlane(
      textures.labelTexture(['L298N'], { width: 128, height: 64, bg: '#C8232C', fg: '#FFFFFF', size: 26 }),
      0.014,
      0.007,
      drv.x - 0.012,
      drvY + 0.0011,
      drv.z + 0.0185,
    ),
  );

  // ---- HC-05 Bluetooth module
  const hc = { x: -0.01, z: 0.066 };
  const hcY = py + 0.003 + 0.0008;
  batch.add(M.blue, box(0.0375, 0.0016, 0.0165), { x: hc.x, y: hcY, z: hc.z });
  batch.add(M.silver, box(0.0268, 0.0028, 0.0135), { x: hc.x + 0.003, y: hcY + 0.0022, z: hc.z });
  batch.add(M.black, box(0.0026, 0.0085, 0.0145), { x: hc.x - 0.0175, y: hcY + 0.005, z: hc.z });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 10, 8), M.led);
  led.position.set(hc.x + 0.0135, hcY + 0.0032, hc.z + 0.005);
  extras.push(led);

  // ---- LiPo 2S pack
  const lipo = { x: -0.07, z: -0.045 };
  batch.add(M.black, box(0.105, 0.018, 0.035), { x: lipo.x, y: py + 0.009, z: lipo.z });
  batch.add(M.yellow, box(0.013, 0.01, 0.016), { x: lipo.x + 0.059, y: py + 0.007, z: lipo.z });
  extras.push(
    labelPlane(
      textures.labelTexture(['LiPo 2S 7,4 V', '2200 mAh'], { width: 384, height: 128, bg: '#b11f26', fg: '#FFFFFF', size: 32 }),
      0.07,
      0.024,
      lipo.x - 0.005,
      py + 0.0182,
      lipo.z,
    ),
  );

  batch.flush();
  for (const item of extras) chassis.add(item);

  // ---- jumper wires
  const top = py + 0.02;
  const wires = [
    wireGeometry([[-0.04, py + 0.0105, 0.0065], [-0.03, top, -0.002], [-0.012, top + 0.003, -0.008], [-0.006, py + 0.0105, -0.0105]], '#F2C400'),
    wireGeometry([[-0.044, py + 0.0105, 0.0065], [-0.032, top + 0.004, -0.004], [-0.008, top + 0.006, -0.012], [0.0, py + 0.0105, -0.0105]], '#2E9E48'),
    wireGeometry([[-0.048, py + 0.0105, 0.0065], [-0.034, top + 0.007, -0.006], [-0.004, top + 0.009, -0.014], [0.006, py + 0.0105, -0.0105]], '#EEEEEE'),
    wireGeometry([[-0.052, py + 0.0105, 0.0065], [-0.036, top + 0.01, -0.008], [0.0, top + 0.012, -0.016], [0.012, py + 0.0105, -0.0105]], '#F28C1B'),
    wireGeometry([[-0.03, py + 0.0105, 0.0535], [-0.03, top + 0.004, 0.06], [-0.026, top, 0.065], [-0.0285, py + 0.005, 0.0665]], '#2A66D6'),
    wireGeometry([[-0.034, py + 0.0105, 0.0535], [-0.034, top + 0.007, 0.06], [-0.03, top + 0.002, 0.068], [-0.0285, py + 0.005, 0.0645]], '#6B3E26'),
    wireGeometry([[lipo.x + 0.052, py + 0.012, lipo.z - 0.004], [-0.01, top + 0.002, -0.05], [-0.014, top, -0.056], [drv.x - 0.012, drvY + 0.012, drv.z + 0.0145]], '#C8232C', 0.0009),
    wireGeometry([[lipo.x + 0.052, py + 0.012, lipo.z + 0.004], [-0.008, top + 0.004, -0.046], [-0.002, top + 0.002, -0.044], [drv.x, drvY + 0.012, drv.z + 0.0145]], '#1a1a1a', 0.0009),
  ];
  for (const sx of [-1, 1]) {
    const x = (sx * spec.wheelbase) / 2;
    wires.push(
      wireGeometry([[drv.x + sx * 0.012, drvY + 0.011, drv.z - 0.0185], [x * 0.5, py + 0.012, -0.066], [x, py + 0.002, -0.0775], [x, py - 0.016, -0.0775], [x, py - 0.024, -0.062]], '#C8232C', 0.0009),
      wireGeometry([[drv.x + sx * 0.008, drvY + 0.011, drv.z - 0.0185], [x * 0.5, py + 0.014, -0.068], [x, py + 0.004, -0.0775], [x, py - 0.014, -0.0775], [x, py - 0.022, -0.066]], '#1a1a1a', 0.0009),
      wireGeometry([[drv.x + sx * 0.01, drvY + 0.011, drv.z + 0.0185], [x * 0.3, top + 0.016, 0.03], [x * 0.5, top + 0.014, 0.075], [x, py + 0.004, 0.0775], [x, py - 0.016, 0.0775], [x, py - 0.024, 0.062]], '#F2C400', 0.0009),
    );
  }
  const wireMesh = new THREE.Mesh(mergeGeometries(wires), M.wire);
  wireMesh.castShadow = true;
  chassis.add(wireMesh);
  return { led };
}

// --------------------------------------------------------------------------- arm
const FINGER_T = 0.006;
const CRANK = 0.03;
const LINKAGE_Z = -0.031;

function linkPlates(batch, M, length, radius, zCenter, holeRadius) {
  const make = (zc) => {
    const geometry = new THREE.ExtrudeGeometry(capsuleShape(length, radius, holeRadius), {
      depth: 0.003,
      bevelEnabled: true,
      bevelThickness: 0.0005,
      bevelSize: 0.0005,
      bevelSegments: 1,
      curveSegments: 10,
    });
    geometry.translate(0, 0, zc - 0.0015);
    return geometry;
  };
  batch.add(M.pla, make(zCenter));
  batch.add(M.pla, make(-zCenter));
}

function buildArm(chassis, spec, M) {
  const [mx, my, mz] = spec.arm_mount;
  const { l1, l2 } = spec;
  const [gx, gy] = spec.grasp_offset;

  // static dome under the turret
  const baseGroup = new THREE.Group();
  baseGroup.position.set(mx, my, mz);
  const dome = new THREE.LatheGeometry(
    [[0.0, 0.0], [0.042, 0.0], [0.042, 0.004], [0.038, 0.008], [0.031, 0.013], [0.027, 0.0155], [0.0, 0.0155]].map(
      ([r, y]) => new THREE.Vector2(r, y),
    ),
    32,
  );
  const baseBatch = new Batch(baseGroup);
  baseBatch.add(M.pla, dome);
  for (let k = 0; k < 6; k++) {
    const a = (k * TAU) / 6;
    baseBatch.add(M.silver, cylinder(0.0022, 0.003, 'y', 8), { x: Math.cos(a) * 0.036, y: 0.0055, z: Math.sin(a) * 0.036 });
  }
  baseBatch.flush();
  chassis.add(baseGroup);

  // turret: rotates with base_deg
  const turret = new THREE.Group();
  turret.position.set(mx, my, mz);
  chassis.add(turret);
  const turretBatch = new Batch(turret);
  turretBatch.add(M.pla, cylinder(0.034, 0.006, 'y', 28), { y: 0.018 });
  const plateShape = roundedRectShape(0.058, 0.09, 0.012);
  const pivotHole = new THREE.Path();
  pivotHole.absarc(-0.001, 0.03, 0.0045, 0, TAU, true);
  plateShape.holes.push(pivotHole);
  for (const side of [-1, 1]) {
    const geometry = new THREE.ExtrudeGeometry(plateShape, { depth: 0.004, bevelEnabled: false, curveSegments: 10 });
    geometry.translate(0.001, 0.055, side * 0.0245 - 0.002);
    turretBatch.add(M.pla, geometry);
  }
  for (const [sx, sy] of [[-0.02, 0.035], [0.022, 0.03]]) {
    turretBatch.add(M.silver, cylinder(0.0025, 0.049, 'z', 8), { x: sx, y: sy });
  }
  // 28BYJ-48 steppers on the sides of the turret, blue cap facing outwards
  for (const side of [-1, 1]) {
    turretBatch.add(M.silver, cylinder(0.014, 0.019, 'z', 24), { x: -0.016, y: 0.046, z: side * 0.0365 });
    turretBatch.add(M.stepperCap, cylinder(0.0128, 0.003, 'z', 24), { x: -0.016, y: 0.046, z: side * 0.0472 });
    turretBatch.add(M.silver, cylinder(0.0025, 0.009, 'z', 8), { x: -0.016, y: 0.046, z: side * 0.0525 });
    turretBatch.add(M.stepperCap, box(0.012, 0.01, 0.009), { x: -0.016, y: 0.028, z: side * 0.0365 });
    turretBatch.add(M.silver, box(0.008, 0.002, 0.036), { x: -0.016, y: 0.0315, z: side * 0.0365 });
  }
  // shaft + boss that carries the linkage crank on the -Z side
  turretBatch.add(M.silver, cylinder(0.0032, 0.009, 'z', 10), { y: spec.shoulder_height, z: -0.0295 });
  turretBatch.add(M.silver, cylinder(0.0042, 0.05, 'z', 12), { y: spec.shoulder_height });
  turretBatch.flush();

  // shoulder: main arm
  const shoulder = new THREE.Group();
  shoulder.position.set(0, spec.shoulder_height, 0);
  turret.add(shoulder);
  const mainBatch = new Batch(shoulder);
  linkPlates(mainBatch, M, l1, 0.011, 0.0125, 0.0036);
  mainBatch.add(M.silver, cylinder(0.003, 0.025, 'z', 8), { x: l1 * 0.45 });
  mainBatch.add(M.silver, cylinder(0.003, 0.025, 'z', 8), { x: l1 * 0.75 });
  mainBatch.flush();

  // parallelogram: crank at the shoulder (driven by the elbow stepper), rod, crank on the forearm
  const crank = new THREE.Group();
  crank.position.set(0, 0, LINKAGE_Z);
  shoulder.add(crank);
  const crankBatch = new Batch(crank);
  crankBatch.add(M.silver, box(CRANK, 0.007, 0.003), { x: CRANK / 2 });
  crankBatch.add(M.silver, cylinder(0.0055, 0.004, 'z', 12), { x: CRANK });
  crankBatch.add(M.silver, cylinder(0.0055, 0.004, 'z', 12));
  crankBatch.flush();

  const rod = new THREE.Group();
  shoulder.add(rod);
  const rodBatch = new Batch(rod);
  rodBatch.add(M.silver, cylinder(0.0022, l1, 'x', 8), { x: l1 / 2 });
  rodBatch.add(M.black, cylinder(0.0045, 0.005, 'z', 10));
  rodBatch.add(M.black, cylinder(0.0045, 0.005, 'z', 10), { x: l1 });
  rodBatch.flush();

  // elbow / forearm
  const elbow = new THREE.Group();
  elbow.position.set(l1, 0, 0);
  shoulder.add(elbow);
  const forearmBatch = new Batch(elbow);
  linkPlates(forearmBatch, M, l2, 0.0095, 0.0185, 0.0036);
  forearmBatch.add(M.silver, cylinder(0.0075, 0.043, 'z', 14));
  for (const side of [-1, 1]) {
    forearmBatch.add(M.silver, cylinder(0.0052, 0.003, 'z', 12), { z: side * 0.0225 });
  }
  forearmBatch.add(M.silver, box(CRANK, 0.007, 0.003), { x: -CRANK / 2, z: LINKAGE_Z });
  forearmBatch.add(M.silver, cylinder(0.0055, 0.004, 'z', 12), { x: -CRANK, z: LINKAGE_Z });
  forearmBatch.add(M.silver, cylinder(0.0062, 0.0135, 'z', 12), { z: (LINKAGE_Z - 0.0185) / 2 - 0.0005 });
  forearmBatch.add(M.silver, cylinder(0.0018, l2 * 0.92, 'x', 6), { x: l2 * 0.5, y: 0.0165, z: 0.0225 });
  forearmBatch.add(M.silver, box(0.004, 0.012, 0.004), { x: l2 * 0.04, y: 0.0105, z: 0.0225 });
  forearmBatch.add(M.silver, box(0.004, 0.012, 0.004), { x: l2 * 0.96, y: 0.0105, z: 0.0225 });
  forearmBatch.flush();

  // wrist + gripper (stays level)
  const wrist = new THREE.Group();
  wrist.position.set(l2, 0, 0);
  elbow.add(wrist);
  const handBatch = new Batch(wrist);
  handBatch.add(M.silver, cylinder(0.0072, 0.04, 'z', 12));
  handBatch.add(M.pla, box(0.034, 0.02, 0.028), { x: 0.021, y: -0.004 });
  handBatch.add(M.pla, box(0.006, 0.006, 0.07), { x: 0.036, y: 0.002 });
  handBatch.add(M.pla, box(0.0325, 0.0025, 0.0185), { x: 0.016, y: 0.0065 });
  handBatch.add(M.black, cylinder(0.003, 0.004, 'y', 10), { x: 0.027, y: 0.0295, z: 0 });
  handBatch.flush();

  const servo = new THREE.Mesh(box(0.0225, 0.0227, 0.012), M.servo);
  servo.position.set(0.016, 0.0185, 0);
  servo.castShadow = true;
  wrist.add(servo);

  const fingerGeometry = box(0.05, 0.02, FINGER_T);
  const fingerLeft = new THREE.Mesh(fingerGeometry, M.pla);
  const fingerRight = new THREE.Mesh(fingerGeometry, M.pla);
  const padGeometry = box(0.012, 0.012, 0.002);
  for (const [finger, dir] of [[fingerLeft, 1], [fingerRight, -1]]) {
    finger.castShadow = true;
    finger.receiveShadow = true;
    finger.position.set(gx, gy + 0.002, 0);
    const pad = new THREE.Mesh(padGeometry, M.rubber);
    pad.position.set(0.012, -0.002, dir * (FINGER_T / 2 + 0.001));
    finger.add(pad);
    wrist.add(finger);
  }

  const graspMarker = new THREE.Object3D();
  graspMarker.name = 'grasp-point';
  graspMarker.position.set(gx, gy, 0);
  wrist.add(graspMarker);

  // first-person camera: sits above the hand, looks forward and 35 degrees down
  const cameraMount = new THREE.Group();
  cameraMount.position.set(0.03, 0.036, 0);
  cameraMount.rotation.y = -Math.PI / 2;
  wrist.add(cameraMount);
  const wristCamera = new THREE.PerspectiveCamera(62, 1, 0.005, 400);
  wristCamera.rotation.x = -rad(35);
  cameraMount.add(wristCamera);

  return {
    turret,
    shoulder,
    elbow,
    wrist,
    crank,
    rod,
    fingerLeft,
    fingerRight,
    graspMarker,
    wristCamera,
    shared: [fingerGeometry, padGeometry],
  };
}

// ----------------------------------------------------------------------- public
/**
 * Build the robot from `hello.robot`.
 * `apply(renderState, dt, time)` poses it; `getGraspWorld(target)` reads the rendered grasp point.
 */
export function createRobot(spec) {
  const M = makeMaterials();
  const root = new THREE.Group();
  root.name = 'ecokar-robot';
  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  root.add(chassis);

  chassis.add(buildPlate(spec, M));
  const wheelSet = buildWheels(chassis, spec, M);
  buildMotors(chassis, spec, M);
  const { led } = buildElectronics(chassis, spec, M);
  const arm = buildArm(chassis, spec, M);

  let bluetoothOn = false;
  const maxHalf = spec.gripper_max_opening / 2;

  function apply(renderState, dt, time) {
    const { robot, arm: a, drive } = renderState;
    root.position.set(robot.x, 0, robot.z);
    root.rotation.y = robot.yaw;

    arm.turret.rotation.y = rad(a.base_deg);
    arm.shoulder.rotation.z = rad(a.shoulder_deg);
    arm.elbow.rotation.z = rad(a.elbow_deg - a.shoulder_deg);
    arm.wrist.rotation.z = -rad(a.elbow_deg);

    // parallelogram linkage: the rod is the main arm translated by the crank vector
    const alpha = Math.PI + rad(a.elbow_deg - a.shoulder_deg);
    arm.crank.rotation.z = alpha;
    arm.rod.position.set(CRANK * Math.cos(alpha), CRANK * Math.sin(alpha), LINKAGE_Z);

    const half = Math.min(maxHalf, Math.max(0, a.opening_m) / 2);
    arm.fingerLeft.position.z = half + FINGER_T / 2;
    arm.fingerRight.position.z = -(half + FINGER_T / 2);

    for (const wheel of wheelSet.wheels) {
      const pwm = wheel.side === 'L' ? drive.left_pwm : drive.right_pwm;
      wheel.group.rotation.z -= ((pwm / 255) * spec.v_max * dt) / spec.wheel_radius;
    }

    const period = bluetoothOn ? 2 : 0.3;
    const on = (time % period) < (bluetoothOn ? 0.12 : 0.14);
    led.material.emissiveIntensity = on ? 3.2 : 0.08;
  }

  const _scratch = new THREE.Vector3();
  function getGraspWorld(target = _scratch) {
    arm.graspMarker.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(arm.graspMarker.matrixWorld);
  }

  return {
    root,
    wristCamera: arm.wristCamera,
    joints: arm,
    apply,
    getGraspWorld,
    setBluetooth(connected) {
      bluetoothOn = connected;
    },
    dispose() {
      disposeTree(root);
      for (const geometry of [...wheelSet.shared, ...arm.shared]) geometry.dispose();
      for (const material of Object.values(M)) {
        for (const slot of ['map', 'bumpMap']) material[slot]?.dispose();
        material.dispose();
      }
    },
  };
}
