import * as THREE from 'three';
import { addBox, addCyl, addMesh, addStrut, shadeHex, type Vec3Tuple } from './helpers';
import { MATERIALS } from './materials';

// Trees and greenery of the NZ suburb kit (design/nz-suburb-kit.html), ported as they are.
// `height` scales the whole tree uniformly. Origin at the foot of the trunk.

export type TreeKind = 'deciduous' | 'pohutukawa' | 'cabbage' | 'conifer' | 'shrub';

export interface TreeDeciduousOptions {
  /** Metres, 6–12. */
  height?: number;
  foliageColor?: number;
}

/**
 * createTreeDeciduous — generic broadleaf street tree (oak / plane / maple type).
 * Size (W × D × H): about 0.8·H × 0.7·H × H; default H = 9 m. Meshes: 4.
 */
export function createTreeDeciduous(o: TreeDeciduousOptions = {}): THREE.Group {
  const p = { height: 9, foliageColor: 0x5a8a45, ...o };
  const g = new THREE.Group();
  g.name = 'TreeDeciduous';
  const s = p.height / 9;
  const leaf = MATERIALS.byColor(p.foliageColor, 0.95, 0, true);
  const leaf2 = MATERIALS.byColor(shadeHex(p.foliageColor, 0.88), 0.95, 0, true);
  addCyl(g, 0.16 * s, 0.25 * s, 4.4 * s, 8, MATERIALS.trunk, 0, 2.2 * s, 0, 1);
  const crown: [number, number, number, number, THREE.Material][] = [
    [0, 6.45, 0, 2.7, leaf],
    [1.7, 5.1, 0.8, 2.05, leaf2],
    [-1.55, 5.35, -0.7, 1.95, leaf],
  ];
  for (const [x, y, z, r, m] of crown) {
    const c = addMesh(g, new THREE.IcosahedronGeometry(r * s, 1), m, x * s, y * s, z * s, 1);
    c.scale.y = 0.9;
  }
  return g;
}

export interface TreePohutukawaOptions {
  /** Metres, 5–8. */
  height?: number;
  /** Red blossom patches. */
  flowering?: boolean;
}

/**
 * createTreePohutukawa — pōhutukawa: low, wide, several leaning trunks, flat spreading crown.
 * Size (W × D × H): about 1.5·H × 1.3·H × H; default H = 6.5 m. Meshes: 7 (10 flowering).
 */
export function createTreePohutukawa(o: TreePohutukawaOptions = {}): THREE.Group {
  const p = { height: 6.5, flowering: false, ...o };
  const g = new THREE.Group();
  g.name = 'TreePohutukawa';
  const s = p.height / 6.5;
  for (const a of [0.3, 2.4, 4.4]) {
    const tip: Vec3Tuple = [Math.cos(a) * 1.9 * s, 3.4 * s, Math.sin(a) * 1.9 * s];
    addStrut(g, [0, 0.13 * s, 0], tip, 0.13 * s, 0.22 * s, 8, MATERIALS.trunk, 1);
  }
  const crown = [
    [0, 5.0, 0, 3.1],
    [2.6, 4.1, 1.3, 2.4],
    [-2.5, 4.2, 1.4, 2.3],
    [0.1, 4.0, -2.3, 2.4],
  ] as const;
  for (const [x, y, z, r] of crown) {
    const c = addMesh(g, new THREE.IcosahedronGeometry(r * s, 1), MATERIALS.leafDark, x * s, y * s, z * s, 1);
    c.scale.y = 0.48;
  }
  if (p.flowering) {
    const blossom = [
      [2.6, 5.0, 1.3, 1.0],
      [-2.5, 5.1, 1.4, 0.95],
      [0.5, 6.15, 0.2, 1.15],
    ] as const;
    for (const [x, y, z, r] of blossom) {
      const f = addMesh(g, new THREE.IcosahedronGeometry(r * s, 1), MATERIALS.blossom, x * s, y * s, z * s);
      f.scale.y = 0.42;
    }
  }
  return g;
}

export interface CabbageTreeOptions {
  /** Metres, 4–7. */
  height?: number;
  branches?: 2 | 3;
}

/**
 * createCabbageTree — tī kōuka: slim trunk that forks near the top, a spiky tuft of leaves on each branch.
 * Size (W × D × H): about 2.6 × 2.6 × H m; default H = 5.5 m. Meshes: 10 (7 with two branches).
 * Each tuft is two crossed star-shaped extrusions.
 */
export function createCabbageTree(o: CabbageTreeOptions = {}): THREE.Group {
  const p = { height: 5.5, branches: 3, ...o };
  const g = new THREE.Group();
  g.name = 'CabbageTree';
  const s = p.height / 5.5;
  addCyl(g, 0.1 * s, 0.17 * s, 3.6 * s, 8, MATERIALS.trunk, 0, 1.8 * s, 0, 1);
  // star outline: 12 long narrow leaves
  const n = 12, R = 0.85 * s, r = 0.1 * s, pts: THREE.Vector2[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r : R * (i % 4 === 0 ? 1 : 0.85);
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const star = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.03 * s, bevelEnabled: false });
  star.translate(0, 0, -0.015 * s);
  const angles = p.branches === 2 ? [0.6, 3.7] : [0.4, 2.5, 4.6];
  for (const a of angles) {
    const tip: Vec3Tuple = [Math.cos(a) * 0.62 * s, 4.65 * s, Math.sin(a) * 0.62 * s];
    addStrut(g, [0, 3.45 * s, 0], tip, 0.07 * s, 0.1 * s, 8, MATERIALS.trunk);
    for (const ry of [a, a + Math.PI / 2]) {
      const t = addMesh(g, star, MATERIALS.leafLight, tip[0], tip[1], tip[2], 1);
      t.rotation.y = ry;
    }
  }
  return g;
}

export interface TreeConiferOptions {
  /** Metres, 6–14. */
  height?: number;
  foliageColor?: number;
}

/**
 * createTreeConifer — conifer / pine: three stacked cones.
 * Size (W × D × H): about 0.48·H × 0.48·H × H; default H = 10 m. Meshes: 4.
 */
export function createTreeConifer(o: TreeConiferOptions = {}): THREE.Group {
  const p = { height: 10, foliageColor: 0x3f6b3a, ...o };
  const g = new THREE.Group();
  g.name = 'TreeConifer';
  const s = p.height / 10;
  const leaf = MATERIALS.byColor(p.foliageColor, 0.95, 0, true);
  addCyl(g, 0.12 * s, 0.22 * s, 2.0 * s, 8, MATERIALS.trunk, 0, 1.0 * s, 0, 1);
  const cones = [
    [2.4, 4.2, 3.5],
    [1.9, 3.8, 5.4],
    [1.3, 3.2, 8.4],
  ] as const;
  for (const [r, h, y] of cones) {
    addMesh(g, new THREE.ConeGeometry(r * s, h * s, 8), leaf, 0, y * s, 0, 1);
  }
  return g;
}

export interface ShrubOptions {
  /** Metres (height), 0.6–2. */
  size?: number;
  color?: number;
  double?: boolean;
}

/**
 * createShrub — garden shrub: one or two flattened blobs.
 * Size (W × D × H): about 1.6·size × 1.3·size × size; default size = 1.4 m. Meshes: 2 (1 single).
 */
export function createShrub(o: ShrubOptions = {}): THREE.Group {
  const p = { size: 1.4, color: 0x5a8a45, double: true, ...o };
  const g = new THREE.Group();
  g.name = 'Shrub';
  const s = p.size, mat = MATERIALS.byColor(p.color, 0.95, 0, true);
  addMesh(g, new THREE.IcosahedronGeometry(0.6 * s, 1), mat, 0, 0.52 * s, 0, 1).scale.y = 0.8;
  if (p.double) {
    addMesh(
      g,
      new THREE.IcosahedronGeometry(0.42 * s, 1),
      MATERIALS.byColor(shadeHex(p.color, 1.12), 0.95, 0, true),
      0.48 * s,
      0.34 * s,
      0.18 * s,
    ).scale.y = 0.8;
  }
  return g;
}

export interface HedgeOptions {
  length?: number;
  /** Metres, 1–1.5. */
  height?: number;
  color?: number;
}

/**
 * createHedge — clipped hedge section, runs along X, rounded top.
 * Size (W × D × H): length × 0.9 × height m. Meshes: 2.
 */
export function createHedge(o: HedgeOptions = {}): THREE.Group {
  const p = { length: 3, height: 1.2, color: 0x3f6b3a, ...o };
  const g = new THREE.Group();
  g.name = 'Hedge';
  const mat = MATERIALS.byColor(p.color, 0.95, 0, true), cap = 0.32;
  addBox(g, p.length, p.height - cap, 0.9, mat, 0, (p.height - cap) / 2, 0, 3);
  const top = new THREE.CylinderGeometry(0.45, 0.45, p.length, 10);
  top.rotateZ(Math.PI / 2);
  top.scale(1, cap / 0.45, 1);
  addMesh(g, top, mat, 0, p.height - cap, 0, 1);
  return g;
}

/** Any tree of the kit by kind; `height` is the shrub size for shrubs. */
export function createTree(kind: TreeKind, height?: number): THREE.Group {
  const opts = height ? { height } : {};
  if (kind === 'deciduous') return createTreeDeciduous(opts);
  if (kind === 'pohutukawa') return createTreePohutukawa(opts);
  if (kind === 'cabbage') return createCabbageTree(opts);
  if (kind === 'conifer') return createTreeConifer(opts);
  return createShrub(height ? { size: height } : {});
}
