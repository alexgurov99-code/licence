import * as THREE from 'three';
import { addBox, addCyl, addMesh, addStrut, prismGeo, shadeHex, type Pt } from './helpers';
import { MATERIALS } from './materials';

// Roadside items of the NZ suburb kit (design/nz-suburb-kit.html), ported as they are.
// The face of each item (letterbox slot, lamp arm, shelter opening) points to +Z: towards the road.

export interface LetterboxOptions {
  /** box: box with a sloping lid; house: little gabled house; drum: horizontal cylinder. */
  style?: 'box' | 'house' | 'drum';
  color?: number;
}

/**
 * createLetterbox — letterbox on a 1 m post, front (slot) facing +Z.
 * Size (W × D × H): 0.35 × 0.45 × 1.3 m. Meshes: 4.
 */
export function createLetterbox(o: LetterboxOptions = {}): THREE.Group {
  const p = { style: 'box', color: 0x9c3b32, ...o };
  const g = new THREE.Group();
  g.name = 'Letterbox';
  const mat = MATERIALS.byColor(p.color, 0.6);
  addBox(g, 0.09, 1.0, 0.09, MATERIALS.timberLight, 0, 0.5, 0, 1);
  if (p.style === 'drum') {
    addBox(g, 0.2, 0.03, 0.4, MATERIALS.timberLight, 0, 1.015, 0);
    const d = new THREE.CylinderGeometry(0.15, 0.15, 0.45, 10);
    d.rotateX(Math.PI / 2);
    addMesh(g, d, mat, 0, 1.18, 0, 1);
    const c = new THREE.CylinderGeometry(0.155, 0.155, 0.02, 10);
    c.rotateX(Math.PI / 2);
    addMesh(g, c, MATERIALS.byColor(shadeHex(p.color, 0.7), 0.6), 0, 1.18, 0.23);
  } else if (p.style === 'house') {
    addBox(g, 0.35, 0.22, 0.45, mat, 0, 1.11, 0, 1);
    addMesh(g, prismGeo([[-0.23, 1.22], [0.23, 1.22], [0, 1.34]], 0.52), MATERIALS.byColor(shadeHex(p.color, 0.6), 0.6), 0, 0, 0, 1);
    addBox(g, 0.2, 0.035, 0.02, MATERIALS.metalDark, 0, 1.15, 0.23);
  } else {
    addBox(g, 0.35, 0.26, 0.45, mat, 0, 1.13, 0, 1);
    addBox(g, 0.39, 0.04, 0.5, MATERIALS.byColor(shadeHex(p.color, 0.8), 0.6), 0, 1.28, 0).rotation.x = -0.1;
    addBox(g, 0.22, 0.035, 0.02, MATERIALS.metalDark, 0, 1.18, 0.23);
  }
  return g;
}

export type FenceType = 'picket' | 'paling' | 'post';

export interface FenceOptions {
  type?: FenceType;
  length?: number;
  /** Picket colour. */
  color?: number;
  /** End posts (false for a gate leaf). */
  posts?: boolean;
}

/**
 * createFence — one fence section running along X, street face +Z, posts at both ends.
 * Size (W × D × H): length × 0.1 × (1.0 picket | 1.8 paling | 0.9 post).
 * The picket comb (pickets + both rails) is one Shape+Extrude mesh, so length does not add meshes.
 * Meshes: picket 3, paling 5, post 3-5 (one fewer pair without posts).
 */
export function createFence(o: FenceOptions = {}): THREE.Group {
  const p = { type: 'picket', length: 2.5, color: 0xf7f7f2, posts: true, ...o };
  const g = new THREE.Group();
  g.name = 'Fence';
  const L = p.length, h2 = L / 2;
  if (p.type === 'paling') {
    if (p.posts) for (const k of [-1, 1]) addBox(g, 0.1, 1.9, 0.1, MATERIALS.timberDark, k * (h2 - 0.05), 0.95, -0.07, 1);
    addBox(g, L, 1.75, 0.025, MATERIALS.timberLight, 0, 0.95, 0, 3);
    for (const y of [0.4, 1.5]) addBox(g, L, 0.1, 0.045, MATERIALS.timberDark, 0, y, -0.035);
    return g;
  }
  if (p.type === 'post') {
    const n = Math.min(4, Math.max(2, Math.round(L / 2.5) + 1));
    if (p.posts) {
      for (let i = 0; i < n; i++) addBox(g, 0.12, 0.9, 0.12, MATERIALS.timberDark, -h2 + 0.06 + (i * (L - 0.12)) / (n - 1), 0.45, 0, 1);
    }
    addBox(g, L, 0.1, 0.05, MATERIALS.timberDark, 0, 0.75, 0.08);
    return g;
  }
  // picket: one comb shape, pickets with pointed tops, two rails in the same plane
  const mat = MATERIALS.byColor(p.color, 0.8);
  const inset = p.posts ? 0.11 : 0.02, x0 = -h2 + inset, span = L - 2 * inset;
  const pw = 0.08, H = 1.0, tip = 0.05, yb = 0.06, r1 = [0.22, 0.29] as const, r2 = [0.72, 0.79] as const;
  const n = Math.max(2, Math.round(span / 0.15));
  const step = (span - pw) / (n - 1);
  const xs = Array.from({ length: n }, (_, i) => x0 + i * step);
  const at = (i: number): number => xs[i] as number;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    // bottom edge, left to right
    pts.push([at(i), yb], [at(i) + pw, yb]);
    if (i < n - 1) pts.push([at(i) + pw, r1[0]], [at(i + 1), r1[0]]);
  }
  for (let i = n - 1; i >= 0; i--) {
    // top edge, right to left
    pts.push([at(i) + pw, H - tip], [at(i) + pw / 2, H], [at(i), H - tip]);
    if (i > 0) pts.push([at(i), r2[1]], [at(i - 1) + pw, r2[1]]);
  }
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (let i = 0; i < n - 1; i++) {
    // gaps between the rails
    const a = at(i) + pw, b = at(i + 1);
    shape.holes.push(
      new THREE.Path([new THREE.Vector2(a, r1[1]), new THREE.Vector2(a, r2[0]), new THREE.Vector2(b, r2[0]), new THREE.Vector2(b, r1[1])]),
    );
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  geo.translate(0, 0, -0.0125);
  addMesh(g, geo, mat, 0, 0, 0, 1);
  if (p.posts) for (const k of [-1, 1]) addBox(g, 0.1, 1.08, 0.1, mat, k * (h2 - 0.05), 0.54, -0.01, 1);
  return g;
}

/**
 * createStreetLight — 8 m street light; the arm reaches 1.5 m toward +Z (the road).
 * Origin at the pole base. Size (W × D × H): 0.35 × 1.9 × 8.0 m. Meshes: 5.
 */
export function createStreetLight(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'StreetLight';
  addBox(g, 0.35, 0.12, 0.35, MATERIALS.concrete, 0, 0.06, 0, 2);
  addCyl(g, 0.07, 0.11, 7.6, 8, MATERIALS.metal, 0, 3.8, 0, 1);
  addStrut(g, [0, 7.5, 0], [0, 7.92, 0.55], 0.045, 0.05, 8, MATERIALS.metal, 1);
  addBox(g, 0.32, 0.14, 1.25, MATERIALS.metalDark, 0, 7.93, 1.12, 1);
  addBox(g, 0.24, 0.03, 0.6, MATERIALS.lampLens, 0, 7.85, 1.42);
  return g;
}

/**
 * createPowerPole — timber power pole with a crossarm (along Z, across the road) and 3 insulators. No wires.
 * Origin at the pole base. Size (W × D × H): 0.34 × 2.2 × 10 m. Meshes: 6.
 */
export function createPowerPole(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'PowerPole';
  const wood = MATERIALS.byColor(0x5f4e3e, 0.95);
  addCyl(g, 0.13, 0.17, 10, 8, wood, 0, 5, 0, 1);
  addBox(g, 0.1, 0.12, 2.2, wood, 0, 9.4, 0.0, 1);
  addStrut(g, [0, 8.7, 0.08], [0, 9.34, 0.75], 0.025, 0.025, 6, MATERIALS.metal);
  for (const z of [-0.95, 0.35, 0.95]) addCyl(g, 0.035, 0.05, 0.18, 8, MATERIALS.porcelain, 0, 9.55, z);
  return g;
}

/**
 * createBusStop — bus shelter: glass back wall, roof on two posts, bench inside, sign pole beside it.
 * Opening faces +Z (the road). Size (W × D × H): 3.6 × 1.6 × 2.85 m (the sign pole stands at x = +1.85).
 * Meshes: 8.
 */
export function createBusStop(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'BusStop';
  addBox(g, 3.1, 0.08, 1.6, MATERIALS.metalDark, 0, 2.46, 0, 3);
  for (const x of [-1.45, 1.45]) addBox(g, 0.08, 2.42, 0.08, MATERIALS.metal, x, 1.21, -0.7, 1);
  addBox(g, 2.8, 2.0, 0.03, MATERIALS.shelterGlass, 0, 1.2, -0.7);
  addBox(g, 2.2, 0.05, 0.38, MATERIALS.timberLight, 0, 0.46, -0.42, 1);
  addBox(g, 2.0, 0.43, 0.04, MATERIALS.metal, 0, 0.215, -0.5);
  addCyl(g, 0.04, 0.04, 2.6, 8, MATERIALS.metal, 1.85, 1.3, 0.6, 1);
  addBox(g, 0.42, 0.55, 0.04, MATERIALS.signYellowGreen, 1.85, 2.45, 0.6, 1);
  return g;
}

/**
 * createBench — park bench, seat facing +Z: two extruded side frames, two seat slats, two back slats.
 * Size (W × D × H): 1.8 × 0.55 × 0.86 m. Meshes: 6.
 */
export function createBench(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Bench';
  const frame: Pt[] = [
    [0.24, 0], [0.24, 0.44], [-0.16, 0.44], [-0.24, 0.86], [-0.3, 0.86], [-0.22, 0.44],
    [-0.22, 0], [-0.16, 0], [-0.16, 0.38], [0.18, 0.38], [0.18, 0],
  ];
  const geo = prismGeo(frame, 0.05, 'x');
  for (const x of [-0.75, 0.75]) addMesh(g, geo, MATERIALS.metalDark, x, 0, 0, 1);
  for (const z of [0.12, -0.08]) addBox(g, 1.8, 0.04, 0.17, MATERIALS.timberLight, 0, 0.46, z, 1);
  const slats = [
    [0.62, -0.19],
    [0.8, -0.225],
  ] as const;
  for (const [y, z] of slats) {
    addBox(g, 1.8, 0.12, 0.03, MATERIALS.timberLight, 0, y, z, 1).rotation.x = -0.19;
  }
  return g;
}

export interface BinOptions {
  style?: 'standalone' | 'post';
  color?: number;
}

/**
 * createBin — public litter bin.
 * Size (W × D × H): standalone 0.54 × 0.54 × 0.92 m; post 0.46 × 0.6 × 1.0 m. Meshes: 3.
 */
export function createBin(o: BinOptions = {}): THREE.Group {
  const p = { style: 'standalone', color: 0x3f5a45, ...o };
  const g = new THREE.Group();
  g.name = 'Bin';
  const mat = MATERIALS.byColor(p.color, 0.6, 0.2);
  if (p.style === 'post') {
    addBox(g, 0.08, 1.0, 0.08, MATERIALS.metal, 0, 0.5, -0.28, 1);
    addCyl(g, 0.23, 0.2, 0.55, 10, mat, 0, 0.62, 0, 1);
    addCyl(g, 0.24, 0.24, 0.05, 10, MATERIALS.metalDark, 0, 0.9, 0);
    return g;
  }
  addCyl(g, 0.25, 0.23, 0.8, 10, mat, 0, 0.4, 0, 1);
  addCyl(g, 0.255, 0.255, 0.08, 10, MATERIALS.metalDark, 0, 0.72, 0);
  addCyl(g, 0.2, 0.27, 0.12, 10, mat, 0, 0.86, 0, 1);
  return g;
}

export interface WheelieBinsOptions {
  count?: 1 | 2;
  /** Default red rubbish, yellow recycling. */
  lidColors?: readonly number[];
  bodyColor?: number;
}

/**
 * createWheelieBins — household wheelie bins put out on the kerb: tapered body, coloured lid, wheels at the back.
 * Lid hinge and wheels are on the -Z side, so +Z faces the road as they are put out.
 * Size (W × D × H): 1.4 × 0.75 × 1.06 m for two (0.6 × 0.75 × 1.06 for one). Meshes: 3 per bin.
 */
export function createWheelieBins(o: WheelieBinsOptions = {}): THREE.Group {
  const p = { count: 2, lidColors: [0x9c2a2a, 0xd9b23a], bodyColor: 0x2e3236, ...o };
  const g = new THREE.Group();
  g.name = 'WheelieBins';
  const body = MATERIALS.byColor(p.bodyColor, 0.8, 0, true);
  const geo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.86, 0.98, 4);
  geo.rotateY(Math.PI / 4);
  geo.scale(0.58, 1, 0.68);
  const n = Math.max(1, Math.min(2, p.count));
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i - 0.5) * 0.8;
    addMesh(g, geo, body, x, 0.53, 0, 1);
    addBox(g, 0.64, 0.05, 0.74, MATERIALS.byColor(p.lidColors[i % p.lidColors.length] as number, 0.7), x, 1.04, 0, 1);
    const w = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8);
    w.rotateZ(Math.PI / 2);
    addMesh(g, w, MATERIALS.rubber, x, 0.1, -0.28);
  }
  return g;
}

/**
 * createFireHydrantMarker — small yellow concrete post marking a hydrant, blue reflector on top.
 * Size (W × D × H): 0.12 × 0.12 × 0.64 m. Meshes: 2.
 */
export function createFireHydrantMarker(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'FireHydrantMarker';
  addBox(g, 0.12, 0.6, 0.12, MATERIALS.hydrantYellow, 0, 0.3, 0, 1);
  addBox(g, 0.08, 0.04, 0.08, MATERIALS.catsEye, 0, 0.62, 0);
  return g;
}

/**
 * createParkedTrailer — small box trailer; the drawbar points to +Z.
 * Origin under the centre of the box (the drawbar adds 0.95 m forward).
 * Size (W × D × H): 1.87 × 3.35 × 0.88 m (box 1.5 × 2.4 × 0.45 m sides). Meshes: 8.
 */
export function createParkedTrailer(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ParkedTrailer';
  addBox(g, 1.44, 0.05, 2.34, MATERIALS.timberLight, 0, 0.45, 0, 3);
  for (const k of [-1, 1]) addBox(g, 0.04, 0.45, 2.4, MATERIALS.metal, k * 0.73, 0.65, 0, 1);
  for (const k of [-1, 1]) addBox(g, 1.5, 0.45, 0.04, MATERIALS.metal, 0, 0.65, k * 1.18, 1);
  const w = new THREE.CylinderGeometry(0.28, 0.28, 0.17, 10);
  w.rotateZ(Math.PI / 2);
  for (const k of [-1, 1]) addMesh(g, w, MATERIALS.rubber, k * 0.85, 0.28, -0.1, 1);
  addBox(g, 0.08, 0.08, 1.0, MATERIALS.metal, 0, 0.42, 1.65, 1);
  return g;
}
