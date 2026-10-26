// The street: road, markings, curbs, sidewalks, buildings, trees, poles, car, cones, crate.
// Everything is built from `hello.world`, in metres, and baked into few merged meshes.
import * as THREE from 'three';
import {
  TAU,
  boxBetween,
  colorize,
  disposeTree,
  groundQuad,
  mergeGeometries,
  metricBox,
  mulberry32,
  noise3,
  placed,
} from './geometry.js';
import * as textures from './textures.js';

const std = (options) => new THREE.MeshStandardMaterial(options);
const vertexColored = (options = {}) => std({ vertexColors: true, roughness: 0.9, ...options });

function mesh(geometry, material, { cast = false, receive = false, name } = {}) {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = cast;
  result.receiveShadow = receive;
  if (name) result.name = name;
  return result;
}

const decalMaterial = (map, extra = {}) =>
  std({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...extra,
  });

// ------------------------------------------------------------------------ ground
function buildGround() {
  const geometry = new THREE.PlaneGeometry(900, 900);
  geometry.rotateX(-Math.PI / 2);
  const ground = mesh(geometry, std({ color: 0x8a8472, roughness: 1 }), { name: 'far-ground' });
  ground.position.y = -0.05;
  return ground;
}

function buildRoad(road) {
  const w = road.x_max - road.x_min;
  const d = road.z_max - road.z_min;
  const map = textures.asphaltTexture();
  map.repeat.set(w / 4, d / 4);
  const geometry = new THREE.PlaneGeometry(w, d);
  geometry.rotateX(-Math.PI / 2);
  const asphalt = mesh(
    geometry,
    std({ map, bumpMap: map, bumpScale: 0.7, roughness: 0.93, metalness: 0 }),
    { receive: true, name: 'road' },
  );
  asphalt.position.set((road.x_min + road.x_max) / 2, 0, (road.z_min + road.z_max) / 2);
  return asphalt;
}

// -------------------------------------------------------------- curbs & sidewalks
function buildSidewalks(world) {
  const { road, sidewalk_width: sw, curb_height: h } = world;
  const curb = 0.14;
  const group = new THREE.Group();
  group.name = 'sidewalks';

  const slabs = [
    boxBetween(road.x_min - sw, 0, road.z_max + curb, road.x_max + sw, h, road.z_max + sw),
    boxBetween(road.x_min - sw, 0, road.z_min - sw, road.x_max + sw, h, road.z_min - curb),
    boxBetween(road.x_max + curb, 0, road.z_min, road.x_max + sw, h, road.z_max),
    boxBetween(road.x_min - sw, 0, road.z_min, road.x_min - curb, h, road.z_max),
  ];
  const curbs = [
    boxBetween(road.x_min - curb, 0, road.z_max, road.x_max + curb, h, road.z_max + curb),
    boxBetween(road.x_min - curb, 0, road.z_min - curb, road.x_max + curb, h, road.z_min),
    boxBetween(road.x_max, 0, road.z_min, road.x_max + curb, h, road.z_max),
    boxBetween(road.x_min - curb, 0, road.z_min, road.x_min, h, road.z_max),
  ];

  const pavingMap = textures.sidewalkTexture();
  group.add(
    mesh(mergeGeometries(slabs), std({ map: pavingMap, roughness: 0.92 }), {
      receive: true,
      cast: true,
      name: 'sidewalk-slabs',
    }),
  );
  group.add(
    mesh(
      mergeGeometries(curbs),
      std({ map: textures.concreteTexture('#9C978C'), roughness: 0.9 }),
      { receive: true, cast: true, name: 'curbs' },
    ),
  );
  return group;
}

// ---------------------------------------------------------------------- markings
function buildMarkings(road) {
  const group = new THREE.Group();
  group.name = 'markings';
  const y = 0.003;
  const lineW = 0.1;
  const inset = 0.14;

  const white = [
    groundQuad(road.x_min + inset, road.z_max - inset - lineW, road.x_max - inset, road.z_max - inset, y),
    groundQuad(road.x_min + inset, road.z_min + inset, road.x_max - inset, road.z_min + inset + lineW, y),
    groundQuad(road.x_max - inset - lineW, road.z_min + inset, road.x_max - inset, road.z_max - inset, y),
    groundQuad(road.x_min + inset, road.z_min + inset, road.x_min + inset + lineW, road.z_max - inset, y),
  ];

  // zebra crosswalk, bars parallel to the road axis
  const crossX = road.x_min + 0.8;
  const barLength = 0.84;
  const barWidth = 0.28;
  const pitch = 0.5;
  for (let z = road.z_min + 0.4; z + barWidth <= road.z_max - 0.4 + 1e-6; z += pitch) {
    white.push(groundQuad(crossX - barLength / 2, z, crossX + barLength / 2, z + barWidth, y));
  }
  group.add(
    mesh(mergeGeometries(white), decalMaterial(textures.paintTexture('#F2F0E8')), {
      receive: true,
      name: 'white-paint',
    }),
  );

  const yellow = [];
  const dash = 0.7;
  const centerZ = (road.z_min + road.z_max) / 2;
  for (let x = crossX + barLength / 2 + 0.5; x + dash <= road.x_max - 0.4; x += dash * 2) {
    yellow.push(groundQuad(x, centerZ - 0.05, x + dash, centerZ + 0.05, y));
  }
  if (yellow.length) {
    group.add(
      mesh(mergeGeometries(yellow), decalMaterial(textures.paintTexture('#E8C547')), {
        receive: true,
        name: 'yellow-paint',
      }),
    );
  }
  return group;
}

function buildDecor(decor) {
  const group = new THREE.Group();
  group.name = 'decor';
  const lidMap = textures.manholeTexture();
  for (const item of decor) {
    if (item.kind !== 'manhole') continue;
    const lidGeometry = new THREE.CircleGeometry(item.radius, 48);
    lidGeometry.rotateX(-Math.PI / 2);
    const lid = mesh(
      lidGeometry,
      std({
        map: lidMap,
        roughness: 0.6,
        metalness: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
      { receive: true },
    );
    lid.position.set(item.x, 0.006, item.z);
    const ringGeometry = new THREE.RingGeometry(item.radius, item.radius + 0.04, 48);
    ringGeometry.rotateX(-Math.PI / 2);
    const ring = mesh(
      ringGeometry,
      std({ color: 0x2a2b2e, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      { receive: true },
    );
    ring.position.set(item.x, 0.005, item.z);
    group.add(lid, ring);
  }
  return group;
}

// --------------------------------------------------------------------- buildings
const FLOOR_H = 3.2;

function splitSpan(length, rnd) {
  const widths = [];
  let remaining = length;
  const options = [4, 4, 5, 6, 8];
  while (remaining > 0.1) {
    let width = options[Math.floor(rnd() * options.length)];
    if (remaining - width < 3) width = remaining;
    widths.push(width);
    remaining -= width;
  }
  return widths;
}

function buildBuildings(world) {
  const { road, sidewalk_width: sw } = world;
  const rnd = mulberry32(2024);
  const group = new THREE.Group();
  group.name = 'buildings';

  const bodies = [];
  const details = [];
  const roofSheets = [];
  const doors = [];
  const shutters = [];
  const facades = textures.FACADE_VARIANTS.map(() => []);

  const lengthX = road.x_max - road.x_min + 2 * sw;
  const lengthZ = road.z_max - road.z_min + 2 * sw;
  const spans = [
    { length: lengthX, origin: [road.x_max + sw, road.z_max + sw], yaw: Math.PI },
    { length: lengthX, origin: [road.x_min - sw, road.z_min - sw], yaw: 0 },
    { length: lengthZ, origin: [road.x_max + sw, road.z_min - sw], yaw: -Math.PI / 2 },
    { length: lengthZ, origin: [road.x_min - sw, road.z_max + sw], yaw: Math.PI / 2 },
  ];

  let previousVariant = -1;
  const wallColor = (index) => new THREE.Color(textures.FACADE_VARIANTS[index].wall);

  for (const span of spans) {
    const frame = new THREE.Matrix4().compose(
      new THREE.Vector3(span.origin[0], 0, span.origin[1]),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), span.yaw),
      new THREE.Vector3(1, 1, 1),
    );
    const toWorld = (geometry) => geometry.applyMatrix4(frame);
    let cursor = 0;
    for (const width of splitSpan(span.length, rnd)) {
      const x0 = cursor;
      cursor += width;
      const floors = rnd() < 0.5 ? 2 : 1;
      const height = floors * FLOOR_H;
      const depth = 7 + rnd() * 2.5;
      let variant = (previousVariant + 1 + Math.floor(rnd() * 5)) % textures.FACADE_VARIANTS.length;
      if (previousVariant < 0) variant = Math.floor(rnd() * textures.FACADE_VARIANTS.length);
      previousVariant = variant;
      const style = textures.FACADE_VARIANTS[variant];
      const trim = new THREE.Color(style.trim);
      const wall = wallColor(variant).multiplyScalar(0.8);

      bodies.push(
        toWorld(
          colorize(placed(new THREE.BoxGeometry(width, height, depth), { x: x0 + width / 2, y: height / 2, z: -depth / 2 }), wall),
        ),
        toWorld(
          colorize(
            placed(new THREE.BoxGeometry(width - 0.1, 0.14, depth - 0.1), { x: x0 + width / 2, y: height + 0.07, z: -depth / 2 }),
            0x6c6a64,
          ),
        ),
      );

      for (let floor = 0; floor < floors; floor++) {
        const plane = new THREE.PlaneGeometry(width, FLOOR_H);
        const uv = plane.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, (x0 + uv.getX(i) * width) / 4, (floor === 0 ? 0 : 0.5) + uv.getY(i) * 0.5);
        }
        placed(plane, { x: x0 + width / 2, y: floor * FLOOR_H + FLOOR_H / 2, z: 0.012 });
        facades[variant].push(toWorld(plane));
      }

      // ground-floor features: a door and/or a roll-up shutter on some bays
      const bays = Math.max(1, Math.floor(width / 4));
      const doorBay = rnd() < 0.7 ? Math.floor(rnd() * bays) : -1;
      const shutterBay = rnd() < 0.4 ? Math.floor(rnd() * bays) : -1;
      if (doorBay >= 0) {
        doors.push(toWorld(placed(new THREE.PlaneGeometry(1.4, 2.6), { x: x0 + doorBay * 4 + 2, y: 1.3, z: 0.03 })));
      } else if (shutterBay >= 0) {
        shutters.push(toWorld(placed(new THREE.PlaneGeometry(3, 2.6), { x: x0 + shutterBay * 4 + 2, y: 1.3, z: 0.03 })));
      }

      details.push(
        toWorld(colorize(placed(new THREE.BoxGeometry(width + 0.2, 0.18, 0.32), { x: x0 + width / 2, y: height - 0.02, z: 0.12 }), trim)),
      );
      if (floors === 2) {
        details.push(
          toWorld(colorize(placed(new THREE.BoxGeometry(width + 0.06, 0.1, 0.16), { x: x0 + width / 2, y: FLOOR_H, z: 0.06 }), trim)),
        );
        if (rnd() < 0.55 && width >= 4) {
          const bx = x0 + Math.floor(rnd() * bays) * 4 + 2;
          const iron = new THREE.Color(0x18181a);
          details.push(
            toWorld(colorize(placed(new THREE.BoxGeometry(2, 0.08, 0.75), { x: bx, y: FLOOR_H + 0.04, z: 0.375 }), trim)),
            toWorld(colorize(placed(new THREE.BoxGeometry(2, 0.04, 0.04), { x: bx, y: FLOOR_H + 1.08, z: 0.74 }), iron)),
            toWorld(colorize(placed(new THREE.BoxGeometry(0.04, 1.0, 0.7), { x: bx - 0.98, y: FLOOR_H + 0.58, z: 0.4 }), iron)),
            toWorld(colorize(placed(new THREE.BoxGeometry(0.04, 1.0, 0.7), { x: bx + 0.98, y: FLOOR_H + 0.58, z: 0.4 }), iron)),
          );
          for (let k = 0; k < 9; k++) {
            details.push(
              toWorld(colorize(placed(new THREE.BoxGeometry(0.02, 1.0, 0.02), { x: bx - 0.9 + k * 0.225, y: FLOOR_H + 0.58, z: 0.74 }), iron)),
            );
          }
        }
      }

      // corrugated metal roof overhanging the street
      if (rnd() < 0.6) {
        const tilt = 0.2;
        const sheet = metricBox(width + 0.5, 0.04, 3.2, 1);
        placed(sheet, { x: x0 + width / 2, y: height + 0.7, z: -0.9, rx: tilt });
        roofSheets.push(toWorld(sheet));
        const post = new THREE.Color(0x2b2a28);
        for (const px of [x0 + 0.15, x0 + width - 0.15]) {
          details.push(
            toWorld(colorize(placed(new THREE.BoxGeometry(0.06, 0.9, 0.06), { x: px, y: height + 0.45, z: -2.4 }), post)),
            toWorld(colorize(placed(new THREE.BoxGeometry(0.06, 0.6, 0.06), { x: px, y: height + 0.3, z: -1.0 }), post)),
          );
        }
      }
    }
  }

  // plain corner blocks close the four corners of the ring
  const corner = (x0, z0, x1, z1, h, colorIndex) =>
    colorize(boxBetween(x0, 0, z0, x1, h, z1), wallColor(colorIndex).multiplyScalar(0.8));
  const ex = road.x_max + sw;
  const wx = road.x_min - sw;
  const nz = road.z_max + sw;
  const sz = road.z_min - sw;
  bodies.push(
    corner(ex, nz, ex + 9, nz + 9, 6.4, 1),
    corner(ex, sz - 9, ex + 9, sz, 3.4, 4),
    corner(wx - 9, nz, wx, nz + 9, 3.4, 0),
    corner(wx - 9, sz - 9, wx, sz, 6.4, 3),
  );

  group.add(mesh(mergeGeometries(bodies), vertexColored(), { cast: true, receive: true, name: 'building-bodies' }));
  group.add(mesh(mergeGeometries(details), vertexColored({ roughness: 0.75 }), { cast: true, receive: true, name: 'building-details' }));
  facades.forEach((list, index) => {
    if (!list.length) return;
    group.add(
      mesh(mergeGeometries(list), std({ map: textures.facadeTexture(index), roughness: 0.9 }), {
        receive: true,
        name: `facade-${textures.FACADE_VARIANTS[index].name}`,
      }),
    );
  });
  if (doors.length) {
    group.add(mesh(mergeGeometries(doors), std({ map: textures.doorTexture(), roughness: 0.8 }), { receive: true, name: 'doors' }));
  }
  if (shutters.length) {
    group.add(mesh(mergeGeometries(shutters), std({ map: textures.shutterTexture(), roughness: 0.55, metalness: 0.4 }), { receive: true, name: 'shutters' }));
  }
  if (roofSheets.length) {
    group.add(
      mesh(mergeGeometries(roofSheets), std({ map: textures.corrugatedTexture('#8c9298'), roughness: 0.5, metalness: 0.5 }), {
        cast: true,
        receive: true,
        name: 'roof-sheets',
      }),
    );
  }
  return group;
}

function buildFarCity() {
  const rnd = mulberry32(7);
  const palette = ['#B7A58A', '#A9B3B7', '#C2A27C', '#9DAAB0', '#BFAE9A', '#A5967F', '#8FA3A8'];
  const boxes = [];
  for (let i = 0; i < 70; i++) {
    const angle = rnd() * TAU;
    const distance = 36 + rnd() * 55;
    const width = 6 + rnd() * 12;
    const depth = 6 + rnd() * 12;
    const height = 5 + rnd() * rnd() * 28;
    boxes.push(
      colorize(
        placed(new THREE.BoxGeometry(width, height, depth), {
          x: Math.cos(angle) * distance,
          y: height / 2,
          z: Math.sin(angle) * distance,
          ry: rnd() * Math.PI,
        }),
        palette[Math.floor(rnd() * palette.length)],
      ),
    );
  }
  const hills = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * TAU + 0.4;
    const distance = 150 + rnd() * 25;
    const radius = 55 + rnd() * 35;
    const height = 36 + rnd() * 34;
    hills.push(
      colorize(
        placed(new THREE.ConeGeometry(radius, height, 7), {
          x: Math.cos(angle) * distance,
          y: height / 2 - 1,
          z: Math.sin(angle) * distance,
          ry: rnd() * TAU,
        }),
        i % 2 ? '#4C6B66' : '#58746B',
      ),
    );
  }
  const group = new THREE.Group();
  group.name = 'far-city';
  group.add(mesh(mergeGeometries(boxes), vertexColored({ roughness: 1 }), { name: 'far-buildings' }));
  group.add(mesh(mergeGeometries(hills), vertexColored({ roughness: 1, flatShading: true }), { name: 'far-hills' }));
  return group;
}

// ------------------------------------------------------------------------- trees
function canopyBlob(radius, x, y, z, color, rnd) {
  const geometry = new THREE.IcosahedronGeometry(radius, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const k = 0.82 + noise3(px * 3 + x * 5, py * 3 + y * 5, pz * 3 + z * 5) * 0.4;
    position.setXYZ(i, px * k, py * k * 0.85, pz * k);
  }
  placed(geometry, { x, y, z });
  const base = new THREE.Color(color);
  const count = position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    const shade = 0.88 + rnd() * 0.24;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = base.r * shade;
      colors[(i + k) * 3 + 1] = base.g * shade;
      colors[(i + k) * 3 + 2] = base.b * shade;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function buildTrees(world) {
  const { road, sidewalk_width: sw, curb_height: h } = world;
  const rnd = mulberry32(99);
  const spots = [
    [-5.2, road.z_max + 1.1, '#3F7D3A'],
    [-0.4, road.z_max + 1.1, '#4E9442'],
    [4.6, road.z_max + 1.1, '#8A6BBF'],
    [-3.0, road.z_min - 1.1, '#4E9442'],
    [2.0, road.z_min - 1.1, '#2F6B34'],
    [6.8, road.z_min - 1.1, '#3F7D3A'],
    [road.x_max + sw * 0.5, -1.6, '#2F6B34'],
    [road.x_min - sw * 0.5, 1.8, '#4E9442'],
  ];
  const trunks = [];
  const canopies = [];
  for (const [x, z, color] of spots) {
    const trunk = new THREE.CylinderGeometry(0.1, 0.17, 2.9, 7);
    trunks.push(colorize(placed(trunk, { x, y: h + 1.45, z }), '#6B4A32'));
    trunks.push(colorize(placed(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 16), { x, y: h + 0.011, z }), '#2B2420'));
    const blobs = [
      [1.35, 0, 3.7, 0],
      [1.0, 0.7, 3.4, 0.3],
      [1.05, -0.6, 3.5, -0.4],
      [0.95, 0.1, 4.4, 0.2],
      [0.9, -0.2, 3.3, 0.8],
    ];
    for (const [r, dx, dy, dz] of blobs) {
      canopies.push(canopyBlob(r, x + dx, h + dy, z + dz, color, rnd));
    }
  }
  const group = new THREE.Group();
  group.name = 'trees';
  group.add(mesh(mergeGeometries(trunks), vertexColored(), { cast: true, receive: true, name: 'tree-trunks' }));
  group.add(mesh(mergeGeometries(canopies), vertexColored({ flatShading: true, roughness: 0.95 }), { cast: true, receive: true, name: 'tree-canopies' }));
  return group;
}

// ------------------------------------------------------------- poles, lamps, wires
function sagging(p0, p1, sag, segments = 20) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push(
      new THREE.Vector3(
        p0.x + (p1.x - p0.x) * t,
        p0.y + (p1.y - p0.y) * t - sag * 4 * t * (1 - t),
        p0.z + (p1.z - p0.z) * t,
      ),
    );
  }
  return new THREE.CatmullRomCurve3(points);
}

function buildPolesAndLamps(world) {
  const { road, sidewalk_width: sw, curb_height: h } = world;
  const wood = new THREE.Color('#6B4F36');
  const iron = new THREE.Color('#2B2E33');
  const metal = new THREE.Color('#7A7F84');
  const parts = [];
  const wires = [];

  const poleZ = road.z_max + sw - 0.45;
  const poleXs = [-7.5, -2.0, 3.5, 8.0];
  const armY = h + 7.1;
  const offsets = [-0.7, 0, 0.7];
  for (const x of poleXs) {
    parts.push(colorize(placed(new THREE.CylinderGeometry(0.1, 0.15, 7.4, 8), { x, y: h + 3.7, z: poleZ }), wood));
    parts.push(colorize(placed(new THREE.BoxGeometry(0.1, 0.1, 1.7), { x, y: armY, z: poleZ }), wood));
    for (const dz of offsets) {
      parts.push(colorize(placed(new THREE.CylinderGeometry(0.025, 0.04, 0.14, 6), { x, y: armY + 0.12, z: poleZ + dz }), '#9c8f6e'));
    }
  }
  parts.push(colorize(placed(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 12), { x: poleXs[1], y: h + 6.2, z: poleZ - 0.4 }), metal));
  for (let i = 0; i < poleXs.length - 1; i++) {
    for (const dz of offsets) {
      const curve = sagging(
        new THREE.Vector3(poleXs[i], armY + 0.2, poleZ + dz),
        new THREE.Vector3(poleXs[i + 1], armY + 0.2, poleZ + dz),
        0.45,
      );
      wires.push(colorize(new THREE.TubeGeometry(curve, 24, 0.009, 5, false), '#1a1a1c'));
    }
  }

  const lamps = [
    [-3.0, road.z_max + 0.7, -1],
    [2.2, road.z_max + 0.7, -1],
    [7.0, road.z_max + 0.7, -1],
    [-5.5, road.z_min - 0.7, 1],
    [-0.5, road.z_min - 0.7, 1],
    [4.2, road.z_min - 0.7, 1],
  ];
  for (const [x, z, toward] of lamps) {
    parts.push(colorize(placed(new THREE.CylinderGeometry(0.035, 0.06, 4.4, 8), { x, y: h + 2.2, z }), iron));
    parts.push(colorize(placed(new THREE.BoxGeometry(0.05, 0.05, 1.3), { x, y: h + 4.4, z: z + toward * 0.6 }), iron));
    parts.push(colorize(placed(new THREE.BoxGeometry(0.2, 0.08, 0.5), { x, y: h + 4.36, z: z + toward * 1.2 }), '#C9CDD0'));
    parts.push(colorize(placed(new THREE.BoxGeometry(0.16, 0.02, 0.4), { x, y: h + 4.31, z: z + toward * 1.2 }), '#FFF3C4'));
  }

  const group = new THREE.Group();
  group.name = 'poles';
  group.add(mesh(mergeGeometries(parts), vertexColored(), { cast: true, receive: true, name: 'poles-and-lamps' }));
  group.add(mesh(mergeGeometries(wires), vertexColored({ roughness: 0.6 }), { cast: true, name: 'power-lines' }));
  return group;
}

// ---------------------------------------------------------------------------- car
function profileShape(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

function extrudedProfile(points, depth, bevel) {
  const geometry = new THREE.ExtrudeGeometry(profileShape(points), {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1,
  });
  geometry.translate(0, 0, -(depth - 2 * bevel) / 2);
  return geometry;
}

const CAR = { w: 4.2, d: 1.8, h: 1.45 };

function buildCar(obstacle) {
  const paint = [];
  const glass = [];
  const trim = [];
  const lights = [];
  const redLights = [];
  const metal = [];

  paint.push(
    extrudedProfile(
      [[-2.08, 0.26], [2.08, 0.26], [2.1, 0.46], [2.1, 0.7], [1.55, 0.8], [0.9, 0.86], [-1.3, 0.86], [-1.95, 0.82], [-2.1, 0.74], [-2.1, 0.46]],
      CAR.d,
      0.06,
    ),
  );
  glass.push(extrudedProfile([[0.98, 0.86], [0.28, 1.4], [-0.8, 1.4], [-1.42, 0.86]], 1.5, 0.02));
  paint.push(placed(new THREE.BoxGeometry(1.16, 0.07, 1.56), { x: -0.26, y: 1.415 }));
  const pillar = (x0, y0, x1, y1) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    for (const z of [-0.765, 0.765]) {
      paint.push(
        placed(new THREE.BoxGeometry(length, 0.08, 0.07), {
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          z,
          rz: Math.atan2(y1 - y0, x1 - x0),
        }),
      );
    }
  };
  pillar(0.98, 0.86, 0.28, 1.4);
  pillar(-1.42, 0.86, -0.8, 1.4);
  pillar(-0.25, 0.86, -0.25, 1.4);
  for (const z of [-0.93, 0.93]) {
    paint.push(placed(new THREE.BoxGeometry(0.1, 0.08, 0.14), { x: 0.55, y: 1.0, z }));
  }

  trim.push(
    placed(new THREE.BoxGeometry(0.14, 0.2, 1.7), { x: 2.08, y: 0.38 }),
    placed(new THREE.BoxGeometry(0.14, 0.2, 1.7), { x: -2.08, y: 0.38 }),
    placed(new THREE.BoxGeometry(4.0, 0.12, 1.5), { y: 0.2 }),
    placed(new THREE.BoxGeometry(0.03, 0.14, 0.8), { x: 2.12, y: 0.56 }),
  );
  const tire = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 20);
  tire.rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.19, 0.19, 0.235, 14);
  rim.rotateX(Math.PI / 2);
  for (const x of [-1.3, 1.3]) {
    for (const z of [-0.84, 0.84]) {
      trim.push(placed(tire.clone(), { x, y: 0.31, z }));
      metal.push(placed(rim.clone(), { x, y: 0.31, z }));
      const arch = new THREE.CircleGeometry(0.37, 20);
      if (z < 0) arch.rotateY(Math.PI);
      trim.push(placed(arch, { x, y: 0.31, z: z < 0 ? -0.906 : 0.906 }));
    }
  }
  for (const z of [-0.6, 0.6]) {
    lights.push(placed(new THREE.BoxGeometry(0.05, 0.12, 0.32), { x: 2.09, y: 0.62, z }));
    redLights.push(placed(new THREE.BoxGeometry(0.05, 0.12, 0.34), { x: -2.09, y: 0.66, z }));
  }
  lights.push(placed(new THREE.BoxGeometry(0.02, 0.12, 0.38), { x: 2.115, y: 0.42 }));
  lights.push(placed(new THREE.BoxGeometry(0.02, 0.12, 0.38), { x: -2.115, y: 0.5 }));

  const group = new THREE.Group();
  group.name = obstacle.id;
  const parts = [
    [paint, std({ color: 0xa8302c, roughness: 0.32, metalness: 0.35 })],
    [glass, std({ color: 0x15222e, roughness: 0.22, metalness: 0.3, envMapIntensity: 0.6 })],
    [trim, std({ color: 0x17181b, roughness: 0.85 })],
    [metal, std({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 })],
    [lights, std({ color: 0xfff1c9, emissive: 0xfff1c9, emissiveIntensity: 0.4, roughness: 0.3 })],
    [redLights, std({ color: 0xc2201b, emissive: 0x7a0f0c, emissiveIntensity: 0.6, roughness: 0.3 })],
  ];
  for (const [list, material] of parts) {
    for (const geometry of list) {
      if (!geometry.attributes.uv) throw new Error('car geometry without uv');
    }
    group.add(mesh(mergeGeometries(list), material, { cast: true, receive: true }));
  }
  group.scale.set(obstacle.w / CAR.w, obstacle.h / CAR.h, obstacle.d / CAR.d);
  group.position.set(obstacle.x, 0, obstacle.z);
  group.rotation.y = obstacle.yaw;
  return group;
}

// -------------------------------------------------------------------------- cones
const CONE_PROFILE = [
  [0.115, 0.03],
  [0.095, 0.12],
  [0.062, 0.3],
  [0.032, 0.44],
  [0.022, 0.49],
  [0.0, 0.5],
];

function coneRadiusAt(y) {
  for (let i = 0; i < CONE_PROFILE.length - 1; i++) {
    const [r0, y0] = CONE_PROFILE[i];
    const [r1, y1] = CONE_PROFILE[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

function buildCones(cones) {
  const group = new THREE.Group();
  group.name = 'cones';
  if (!cones.length) return group;
  const body = new THREE.LatheGeometry(CONE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  const bandPoints = [0.2, 0.25, 0.3].map((y) => new THREE.Vector2(coneRadiusAt(y) + 0.003, y));
  const band = new THREE.LatheGeometry(bandPoints, 20);
  const base = new THREE.BoxGeometry(0.3, 0.03, 0.3);
  base.translate(0, 0.015, 0);
  const specs = [
    [body, std({ color: 0xf26a1b, roughness: 0.55, side: THREE.DoubleSide })],
    [band, std({ color: 0xf3f3ee, roughness: 0.35, emissive: 0x555555, emissiveIntensity: 0.3, side: THREE.DoubleSide })],
    [base, std({ color: 0x1b1c1e, roughness: 0.9 })],
  ];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [geometry, material] of specs) {
    const instanced = new THREE.InstancedMesh(geometry, material, cones.length);
    cones.forEach((cone, i) => {
      quaternion.setFromAxisAngle(up, cone.yaw);
      matrix.compose(
        new THREE.Vector3(cone.x, 0, cone.z),
        quaternion,
        new THREE.Vector3(cone.w / 0.3, cone.h / 0.5, cone.d / 0.3),
      );
      instanced.setMatrixAt(i, matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.frustumCulled = false;
    group.add(instanced);
  }
  return group;
}

// -------------------------------------------------------------------------- crate
function buildCrate(crate) {
  const { w, d, h, wall } = crate;
  const floor = 0.01;
  const parts = [
    boxBetween(-w / 2, 0, -d / 2, w / 2, floor, d / 2),
    boxBetween(-w / 2, 0, -d / 2, -w / 2 + wall, h, d / 2),
    boxBetween(w / 2 - wall, 0, -d / 2, w / 2, h, d / 2),
    boxBetween(-w / 2 + wall, 0, -d / 2, w / 2 - wall, h, -d / 2 + wall),
    boxBetween(-w / 2 + wall, 0, d / 2 - wall, w / 2 - wall, h, d / 2),
    boxBetween(-w / 2 - 0.004, h - 0.006, -d / 2 - 0.004, w / 2 + 0.004, h, -d / 2 + wall + 0.002),
    boxBetween(-w / 2 - 0.004, h - 0.006, d / 2 - wall - 0.002, w / 2 + 0.004, h, d / 2 + 0.004),
    boxBetween(-w / 2 - 0.004, h - 0.006, -d / 2 + wall, -w / 2 + wall + 0.002, h, d / 2 - wall),
    boxBetween(w / 2 - wall - 0.002, h - 0.006, -d / 2 + wall, w / 2 + 0.004, h, d / 2 - wall),
  ];
  const group = new THREE.Group();
  group.name = 'crate';
  group.add(
    mesh(
      mergeGeometries(parts),
      new THREE.MeshPhysicalMaterial({ color: 0x38a438, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
      { cast: true, receive: true },
    ),
  );
  const decal = textures.crateDecalTexture();
  const decalHeight = Math.min(h * 0.7, 0.07);
  const decalWidth = decalHeight * (640 / 200);
  const sides = [
    [0, 0, d / 2 + 0.0015, 0, Math.min(decalWidth, w * 0.85)],
    [0, 0, -d / 2 - 0.0015, Math.PI, Math.min(decalWidth, w * 0.85)],
    [w / 2 + 0.0015, 0, 0, Math.PI / 2, Math.min(decalWidth, d * 0.85)],
    [-w / 2 - 0.0015, 0, 0, -Math.PI / 2, Math.min(decalWidth, d * 0.85)],
  ];
  for (const [x, , z, yaw, width] of sides) {
    const plane = mesh(
      new THREE.PlaneGeometry(width, width / (640 / 200)),
      decalMaterial(decal, { roughness: 0.5 }),
      { receive: true },
    );
    plane.position.set(x, h * 0.5, z);
    plane.rotation.y = yaw;
    group.add(plane);
  }
  group.position.set(crate.x, 0, crate.z);
  group.rotation.y = crate.yaw;
  return group;
}

// ------------------------------------------------------------- contact shadows
function buildContactShadows(world) {
  const blobs = [];
  const add = (x, z, yaw, w, d) => {
    const geometry = new THREE.PlaneGeometry(w, d);
    geometry.rotateX(-Math.PI / 2);
    blobs.push(placed(geometry, { x, y: 0.0025, z, ry: yaw }));
  };
  for (const obstacle of world.obstacles ?? []) {
    if (obstacle.kind === 'car') add(obstacle.x, obstacle.z, obstacle.yaw, obstacle.w + 0.6, obstacle.d + 0.6);
    else add(obstacle.x, obstacle.z, obstacle.yaw, obstacle.w * 2, obstacle.d * 2);
  }
  if (world.crate) add(world.crate.x, world.crate.z, world.crate.yaw, world.crate.w + 0.16, world.crate.d + 0.16);
  const group = new THREE.Group();
  group.name = 'contact-shadows';
  if (blobs.length === 0) return group;
  const material = new THREE.MeshBasicMaterial({
    map: textures.contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  group.add(mesh(mergeGeometries(blobs), material, { name: 'contact-blobs' }));
  return group;
}

// -------------------------------------------------------------------------- entry
/** Build the whole street from `hello.world`. Call `dispose()` before rebuilding. */
export function buildStreet(world) {
  const group = new THREE.Group();
  group.name = 'street';
  group.add(buildGround(), buildRoad(world.road), buildSidewalks(world), buildMarkings(world.road));
  group.add(buildDecor(world.decor ?? []), buildContactShadows(world));
  group.add(buildBuildings(world), buildFarCity(), buildTrees(world), buildPolesAndLamps(world));
  for (const obstacle of world.obstacles ?? []) {
    if (obstacle.kind === 'car') group.add(buildCar(obstacle));
  }
  group.add(buildCones((world.obstacles ?? []).filter((o) => o.kind === 'cone')));
  if (world.crate) group.add(buildCrate(world.crate));

  // The sun's shadow window is only +-2.5 m wide and follows the robot, so only objects the
  // robot can reach cast shadows; casting from the far scenery would be cut at the window edge.
  const casters = new Set(['cones', 'crate', ...(world.obstacles ?? []).map((o) => o.id)]);
  group.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });
  for (const child of group.children) {
    if (casters.has(child.name)) child.traverse((object) => object.isMesh && (object.castShadow = true));
  }
  return {
    group,
    dispose() {
      disposeTree(group);
    },
  };
}
