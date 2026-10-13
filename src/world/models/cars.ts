import * as THREE from 'three';
import { addBox, addMesh, prismGeo, type Pt } from './helpers';
import { MATERIALS } from './materials';
import type { CarType } from './catalogue';

// Cars of the NZ suburb kit (design/nz-suburb-kit.html), ported as they are.
// Front +Z, left side +X, right-hand drive (driver sits on the -X side).
// Named parts: wheelFL, wheelFR, wheelRL, wheelRR (groups, pivot at the wheel centre, spin about X,
// rotation.order 'YXZ' so rotation.y steers and rotation.x spins); headlights, brakeLights,
// indicatorLeft, indicatorRight (groups). Light materials are per car (not shared), also listed in
// userData.lightMaterials { head, brake, left, right }: raise emissiveIntensity to switch them on.

export type { CarType } from './catalogue';

export const WHEEL_NAMES = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'] as const;
export const LIGHT_NAMES = ['headlights', 'brakeLights', 'indicatorLeft', 'indicatorRight'] as const;

export interface CarUserData {
  lightMaterials: Record<'head' | 'brake' | 'left' | 'right', THREE.MeshStandardMaterial>;
  wheelRadius: number;
  wheelbase: number;
  length: number;
  width: number;
}

/** Profile points are [z, y] (along the car, height). */
interface CarSpec {
  L: number;
  W: number;
  /** Wheel radius, front axle z, wheelbase, sill height. */
  r: number;
  fz: number;
  wb: number;
  sill: number;
  /** Side profile from the rear bottom, over the roof, to the front bottom. */
  upper: readonly Pt[];
  /** Side windows. */
  side: readonly (readonly Pt[])[];
  screen: readonly [Pt, Pt];
  rear: readonly [Pt, Pt];
  /** [centre y, height]. */
  bumpF: Pt;
  bumpR: Pt;
  /** [y, width, height, z]. */
  grille: readonly [number, number, number, number];
  plateF: number;
  /** [y, z]. */
  plateR: Pt;
  /** [z, y]. */
  mirror: Pt;
  /** [x, y, z, width, height]. */
  head: readonly [number, number, number, number, number];
  tail: readonly [number, number, number, number, number];
  /** [x, y, z]. */
  indF: readonly [number, number, number];
  indR: readonly [number, number, number];
  extras?: (g: THREE.Group, paint: THREE.Material) => void;
}

/** Side profile with wheel arches. upper runs from the rear bottom, over the roof, to the front bottom. */
function carProfile(upper: readonly Pt[], axles: readonly number[], r: number, sill: number): Pt[] {
  const ra = r + 0.06;
  const pts: Pt[] = upper.map(([z, y]) => [z, y]);
  const t0 = Math.asin(Math.max(-1, Math.min(1, (sill - r) / ra)));
  for (const az of [...axles].sort((a, b) => b - a)) {
    for (let i = 0; i <= 6; i++) {
      const t = t0 + (i / 6) * (Math.PI - 2 * t0);
      pts.push([az + ra * Math.cos(t), r + ra * Math.sin(t)]);
    }
  }
  return pts;
}

/** Thin glass box laid along a profile segment a -> b ([z, y]), pushed 12 mm out of the body. */
function addSlopedGlass(g: THREE.Group, a: Pt, b: Pt, width: number, isFront: boolean): THREE.Mesh {
  const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy);
  let nz = dy / len, ny = -dz / len;
  if ((isFront && nz < 0) || (!isFront && nz > 0)) {
    nz = -nz;
    ny = -ny;
  }
  const m = addBox(g, width, 0.02, len - 0.04, MATERIALS.carGlass, 0, (a[1] + b[1]) / 2 + ny * 0.012, (a[0] + b[0]) / 2 + nz * 0.012);
  m.rotation.x = Math.atan2(-dy, dz);
  return m;
}

/** Shared car builder. c = car spec (see the five create functions), color = body colour. */
function buildCar(name: string, c: CarSpec, color: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const paint = MATERIALS.byColor(color, 0.42, 0.3);
  const hw = c.W / 2, zf = c.L / 2, zr = -c.L / 2, fa = c.fz, ra = c.fz - c.wb;

  addMesh(g, prismGeo(carProfile(c.upper, [fa, ra], c.r, c.sill), c.W, 'x'), paint, 0, 0, 0, 3);
  addMesh(g, prismGeo(c.side, c.W + 0.02, 'x'), MATERIALS.carGlass, 0, 0, 0);
  addSlopedGlass(g, c.screen[0], c.screen[1], c.W - 0.24, true);
  addSlopedGlass(g, c.rear[0], c.rear[1], c.W - 0.3, false);
  addBox(g, c.W + 0.02, c.bumpF[1], 0.16, MATERIALS.bumper, 0, c.bumpF[0], zf - 0.05, 1);
  addBox(g, c.W + 0.02, c.bumpR[1], 0.16, MATERIALS.bumper, 0, c.bumpR[0], zr + 0.05, 1);
  addBox(g, c.grille[1], c.grille[2], 0.04, MATERIALS.metalDark, 0, c.grille[0], c.grille[3]);
  addBox(g, 0.37, 0.13, 0.02, MATERIALS.plate, 0, c.plateF, zf + 0.04);
  addBox(g, 0.37, 0.13, 0.02, MATERIALS.plate, 0, c.plateR[0], c.plateR[1]);
  for (const k of [-1, 1]) addBox(g, 0.1, 0.12, 0.2, paint, k * (hw + 0.06), c.mirror[1], c.mirror[0]);

  const mk = (col: number, em: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, emissive: em, emissiveIntensity: 0 });
  const mats = { head: mk(0xf2f0e6, 0xfff4dc), brake: mk(0x7c1616, 0xff2a1a), left: mk(0xd38420, 0xff9a1a), right: mk(0xd38420, 0xff9a1a) };
  const lights = (nm: string, mat: THREE.Material, list: readonly (readonly number[])[]): void => {
    const grp = new THREE.Group();
    grp.name = nm;
    for (const [x = 0, y = 0, z = 0, w = 0, h = 0] of list) addBox(grp, w, h, 0.05, mat, x, y, z);
    g.add(grp);
  };
  const [hx, hy, hz, hW, hH] = c.head, [tx, ty, tz, tW, tH] = c.tail, [fx, fy, fz] = c.indF, [rx, ry, rz] = c.indR;
  lights('headlights', mats.head, [[hx, hy, hz, hW, hH], [-hx, hy, hz, hW, hH]]);
  lights('brakeLights', mats.brake, [[tx, ty, tz, tW, tH], [-tx, ty, tz, tW, tH]]);
  lights('indicatorLeft', mats.left, [[fx, fy, fz, 0.1, 0.06], [rx, ry, rz, 0.1, 0.07]]);
  lights('indicatorRight', mats.right, [[-fx, fy, fz, 0.1, 0.06], [-rx, ry, rz, 0.1, 0.07]]);

  const tyre = new THREE.CylinderGeometry(c.r, c.r, 0.21, 12);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(c.r * 0.6, c.r * 0.6, 0.02, 8);
  hub.rotateZ(Math.PI / 2);
  const wx = hw - 0.13;
  const wheels = [
    ['wheelFL', wx, fa],
    ['wheelFR', -wx, fa],
    ['wheelRL', wx, ra],
    ['wheelRR', -wx, ra],
  ] as const;
  for (const [nm, x, z] of wheels) {
    const w = new THREE.Group();
    w.name = nm;
    w.rotation.order = 'YXZ';
    w.position.set(x, c.r, z);
    addMesh(w, tyre, MATERIALS.rubber, 0, 0, 0, 1);
    addMesh(w, hub, MATERIALS.hubcap, Math.sign(x) * 0.11, 0, 0);
    g.add(w);
  }
  if (c.extras) c.extras(g, paint);
  g.userData = { lightMaterials: mats, wheelRadius: c.r, wheelbase: c.wb, length: c.L, width: c.W } satisfies CarUserData;
  return g;
}

export interface CarOptions {
  color?: number;
}

/**
 * createCarHatchback — small hatchback (Yaris / Mazda 2 type).
 * Size (W × D × H): 1.75 × 4.0 × 1.5 m; wheelbase 2.55 m, wheel radius 0.31 m. Meshes: 27.
 */
export function createCarHatchback(o: CarOptions = {}): THREE.Group {
  const p = { color: 0x9c2a2a, ...o };
  return buildCar(
    'CarHatchback',
    {
      L: 4.0, W: 1.75, r: 0.31, fz: 1.2, wb: 2.55, sill: 0.26,
      upper: [[-2.0, 0.26], [-2.0, 0.92], [-1.93, 1.0], [-1.74, 1.44], [-1.55, 1.5], [0.35, 1.49], [1.05, 0.98],
        [1.8, 0.86], [1.98, 0.74], [2.0, 0.42], [1.97, 0.26]],
      side: [[[0.92, 1.02], [0.38, 1.42], [-0.15, 1.42], [-0.15, 1.02]], [[-0.25, 1.02], [-0.25, 1.42], [-1.5, 1.42], [-1.78, 1.02]]],
      screen: [[1.02, 1.0], [0.4, 1.46]], rear: [[-1.92, 1.03], [-1.75, 1.42]],
      bumpF: [0.4, 0.26], bumpR: [0.42, 0.28], grille: [0.6, 0.62, 0.1, 1.995],
      plateF: 0.4, plateR: [0.68, -2.01], mirror: [0.95, 1.06],
      head: [0.6, 0.66, 1.985, 0.34, 0.12], tail: [0.62, 0.86, -2.0, 0.22, 0.2],
      indF: [0.8, 0.66, 1.98], indR: [0.62, 0.7, -2.0],
    },
    p.color,
  );
}

/**
 * createCarSedan — mid-size sedan with a defined boot (Corolla / Camry type).
 * Size (W × D × H): 1.8 × 4.7 × 1.45 m; wheelbase 2.75 m, wheel radius 0.32 m. Meshes: 27.
 */
export function createCarSedan(o: CarOptions = {}): THREE.Group {
  const p = { color: 0xb8bcc0, ...o };
  return buildCar(
    'CarSedan',
    {
      L: 4.7, W: 1.8, r: 0.32, fz: 1.43, wb: 2.75, sill: 0.26,
      upper: [[-2.33, 0.26], [-2.35, 0.86], [-2.3, 0.98], [-1.55, 1.0], [-1.25, 1.06], [-0.6, 1.43], [0.35, 1.45],
        [1.15, 1.0], [2.15, 0.84], [2.33, 0.72], [2.35, 0.42], [2.3, 0.26]],
      side: [[[1.08, 1.03], [0.44, 1.39], [-0.1, 1.39], [-0.1, 1.03]], [[-0.2, 1.03], [-0.2, 1.39], [-0.64, 1.39], [-1.12, 1.07]]],
      screen: [[1.12, 1.02], [0.4, 1.43]], rear: [[-1.22, 1.08], [-0.64, 1.41]],
      bumpF: [0.42, 0.28], bumpR: [0.44, 0.28], grille: [0.6, 0.7, 0.1, 2.35],
      plateF: 0.42, plateR: [0.7, -2.36], mirror: [1.05, 1.08],
      head: [0.62, 0.66, 2.335, 0.4, 0.12], tail: [0.6, 0.8, -2.35, 0.36, 0.12],
      indF: [0.84, 0.66, 2.33], indR: [0.85, 0.8, -2.35],
    },
    p.color,
  );
}

/**
 * createCarWagon — station wagon / soft-roader (Outback type) with roof rails.
 * Size (W × D × H): 1.85 × 4.8 × 1.6 m; wheelbase 2.75 m, wheel radius 0.34 m. Meshes: 29.
 */
export function createCarWagon(o: CarOptions = {}): THREE.Group {
  const p = { color: 0x24364f, ...o };
  return buildCar(
    'CarWagon',
    {
      L: 4.8, W: 1.85, r: 0.34, fz: 1.45, wb: 2.75, sill: 0.34,
      upper: [[-2.38, 0.34], [-2.4, 0.98], [-2.33, 1.1], [-2.18, 1.48], [-1.95, 1.53], [0.35, 1.53], [1.2, 1.08],
        [2.15, 0.95], [2.35, 0.82], [2.4, 0.5], [2.36, 0.34]],
      side: [[[1.1, 1.12], [0.42, 1.48], [-0.1, 1.48], [-0.1, 1.12]], [[-0.2, 1.12], [-0.2, 1.48], [-1.3, 1.48], [-1.3, 1.12]],
        [[-1.4, 1.12], [-1.4, 1.48], [-2.08, 1.48], [-2.24, 1.12]]],
      screen: [[1.16, 1.1], [0.4, 1.51]], rear: [[-2.32, 1.12], [-2.19, 1.46]],
      bumpF: [0.5, 0.32], bumpR: [0.5, 0.32], grille: [0.72, 0.72, 0.12, 2.385],
      plateF: 0.5, plateR: [0.76, -2.41], mirror: [1.1, 1.17],
      head: [0.64, 0.75, 2.36, 0.4, 0.13], tail: [0.66, 0.9, -2.4, 0.3, 0.16],
      indF: [0.86, 0.75, 2.355], indR: [0.86, 0.74, -2.4],
      extras: (g) => {
        for (const k of [-1, 1]) addBox(g, 0.05, 0.06, 2.1, MATERIALS.bumper, k * 0.72, 1.56, -0.8);
      },
    },
    p.color,
  );
}

/**
 * createUte — double-cab ute / pickup (Hilux type): high clearance, open tray with sides and tailgate.
 * Size (W × D × H): 1.85 × 5.3 × 1.8 m; wheelbase 3.1 m, wheel radius 0.38 m. Meshes: 30.
 */
export function createUte(o: CarOptions = {}): THREE.Group {
  const p = { color: 0xf0f0ec, ...o };
  return buildCar(
    'Ute',
    {
      L: 5.3, W: 1.85, r: 0.38, fz: 1.75, wb: 3.1, sill: 0.5,
      upper: [[-2.65, 0.5], [-2.65, 1.0], [-0.92, 1.0], [-0.92, 1.78], [-0.75, 1.8], [0.75, 1.8], [1.45, 1.3],
        [2.4, 1.18], [2.6, 1.05], [2.65, 0.7], [2.6, 0.5]],
      side: [[[1.36, 1.34], [0.8, 1.73], [0.12, 1.73], [0.12, 1.34]], [[0.02, 1.34], [0.02, 1.73], [-0.8, 1.73], [-0.8, 1.34]]],
      screen: [[1.42, 1.32], [0.79, 1.77]], rear: [[-0.92, 1.36], [-0.92, 1.72]],
      bumpF: [0.66, 0.3], bumpR: [0.6, 0.2], grille: [0.92, 0.9, 0.2, 2.64],
      plateF: 0.66, plateR: [0.78, -2.66], mirror: [1.38, 1.42],
      head: [0.62, 0.99, 2.605, 0.42, 0.14], tail: [0.86, 1.02, -2.66, 0.1, 0.34],
      indF: [0.86, 0.99, 2.6], indR: [0.86, 0.77, -2.66],
      extras: (g, paint) => {
        for (const k of [-1, 1]) addBox(g, 0.06, 0.3, 1.72, paint, k * 0.895, 1.13, -1.79, 1);
        addBox(g, 1.85, 0.3, 0.06, paint, 0, 1.13, -2.62, 1);
      },
    },
    p.color,
  );
}

/**
 * createVan — van (Hiace type): short nose, tall body, solid rear sides.
 * Size (W × D × H): 1.9 × 5.0 × 2.0 m; wheelbase 2.6 m, wheel radius 0.33 m. Meshes: 27.
 */
export function createVan(o: CarOptions = {}): THREE.Group {
  const p = { color: 0xf0f0ec, ...o };
  return buildCar(
    'Van',
    {
      L: 5.0, W: 1.9, r: 0.33, fz: 1.45, wb: 2.6, sill: 0.34,
      upper: [[-2.5, 0.34], [-2.5, 1.92], [-2.42, 2.0], [0.9, 2.0], [1.85, 1.2], [2.35, 1.08], [2.48, 0.92],
        [2.5, 0.5], [2.45, 0.34]],
      side: [[[1.72, 1.26], [0.98, 1.88], [0.45, 1.88], [0.45, 1.26]]],
      screen: [[1.82, 1.23], [0.94, 1.97]], rear: [[-2.5, 1.25], [-2.5, 1.85]],
      bumpF: [0.5, 0.28], bumpR: [0.48, 0.24], grille: [0.76, 0.8, 0.14, 2.505],
      plateF: 0.5, plateR: [0.72, -2.51], mirror: [1.7, 1.4],
      head: [0.66, 0.84, 2.49, 0.36, 0.14], tail: [0.85, 0.95, -2.5, 0.12, 0.4],
      indF: [0.88, 0.84, 2.485], indR: [0.85, 0.68, -2.5],
    },
    p.color,
  );
}

/** Any car of the kit by type. */
export function createCar(type: CarType, o: CarOptions = {}): THREE.Group {
  switch (type) {
    case 'hatchback':
      return createCarHatchback(o);
    case 'sedan':
      return createCarSedan(o);
    case 'wagon':
      return createCarWagon(o);
    case 'ute':
      return createUte(o);
    case 'van':
      return createVan(o);
  }
}
