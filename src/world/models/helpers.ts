import * as THREE from 'three';
import { MATERIALS } from './materials';

// Shared helpers of the NZ suburb kit (design/nz-suburb-kit.html), ported as they are.
// Units: metres. Origin on the ground under the model centre, +Y up, the model's face points to +Z.

/** A 2D point of a profile: [u, y]. */
export type Pt = readonly [number, number];
export type Vec3Tuple = readonly [number, number, number];
/** Shadow flags: 0 none, 1 cast, 2 receive, 3 both. */
export type Shadow = 0 | 1 | 2 | 3;
/** Wall of a box-shaped building: 'f' (+Z face), 'b' (-Z), 'l' (+X), 'r' (-X). */
export type Side = 'f' | 'b' | 'l' | 'r';

export function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow: Shadow = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = (shadow & 1) === 1;
  m.receiveShadow = (shadow & 2) === 2;
  parent.add(m);
  return m;
}

/** Box by its centre. */
export function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow: Shadow = 0,
): THREE.Mesh {
  return addMesh(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z, shadow);
}

/** Vertical cylinder by its centre. */
export function addCyl(
  parent: THREE.Object3D,
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow: Shadow = 0,
): THREE.Mesh {
  return addMesh(parent, new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, x, y, z, shadow);
}

/** Cylinder spanning two points [x, y, z] (trunks, arms, braces). */
export function addStrut(
  parent: THREE.Object3D,
  a: Vec3Tuple,
  b: Vec3Tuple,
  rTop: number,
  rBot: number,
  seg: number,
  mat: THREE.Material,
  shadow: Shadow = 0,
): THREE.Mesh {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const m = addMesh(parent, new THREE.CylinderGeometry(rTop, rBot, dir.length(), seg), mat, 0, 0, 0, shadow);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function isProfileList(profiles: readonly Pt[] | readonly (readonly Pt[])[]): profiles is readonly (readonly Pt[])[] {
  return Array.isArray(profiles[0]?.[0]);
}

/**
 * Extruded prism from a 2D profile [[u, y], ...] (or several profiles), centred on the extrusion axis.
 * axis 'z': u -> world X, extruded along Z. axis 'x': u -> world Z, extruded along X.
 */
export function prismGeo(
  profiles: readonly Pt[] | readonly (readonly Pt[])[],
  length: number,
  axis: 'x' | 'z' = 'z',
): THREE.BufferGeometry {
  const list = isProfileList(profiles) ? profiles : [profiles as readonly Pt[]];
  const shapes = list.map((pts) => new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))));
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: length, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geo.translate(0, 0, -length / 2);
  if (axis === 'x') geo.rotateY(-Math.PI / 2);
  return geo;
}

/** Pentagon wall profile for a gable house: base y0, wall top yW, half-width hw, roof slope s. */
export function gableWallPts(hw: number, y0: number, yW: number, s: number): Pt[] {
  return [
    [-hw, y0],
    [hw, y0],
    [hw, yW],
    [0, yW + hw * s],
    [-hw, yW],
  ];
}

/** Chevron roof profile sitting on gableWallPts: overhang o, vertical thickness t. apex = top y. */
export function gableRoofPts(
  hw: number,
  yW: number,
  s: number,
  o: number,
  t: number,
): { pts: Pt[]; apex: number; eaveTop: number } {
  const e = hw + o;
  const yE = yW - o * s;
  const yA = yW + hw * s;
  return {
    pts: [
      [-e, yE],
      [0, yA],
      [e, yE],
      [e, yE + t],
      [0, yA + t],
      [-e, yE + t],
    ],
    apex: yA + t,
    eaveTop: yE + t,
  };
}

/**
 * Hip roof, ridge along X. Footprint w (x) by d (z), w >= d, rise h; widest section (eaves) at y = 0.
 * Built with Extrude + a one-segment bevel: the lower half is a mirror that hides inside the walls
 * and reads as the sloped soffit under the overhang.
 */
export function hipRoofGeo(w: number, d: number, h: number): THREE.BufferGeometry {
  const e = 0.02;
  const rx = Math.max(w - d, 0.01) / 2;
  const shape = new THREE.Shape([
    new THREE.Vector2(-rx, -e / 2),
    new THREE.Vector2(rx, -e / 2),
    new THREE.Vector2(rx, e / 2),
    new THREE.Vector2(-rx, e / 2),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.002,
    bevelEnabled: true,
    bevelThickness: h,
    bevelSize: (d - e) / 2,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Flat element on a wall. along = position along the wall, y = centre height, wallPos = signed
 * coordinate of the wall plane, protrude = how far the front of the panel stands out of the wall.
 */
export function addPanel(
  parent: THREE.Object3D,
  side: Side,
  along: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  protrude: number,
  mat: THREE.Material,
  wallPos: number,
  shadow: Shadow = 0,
): THREE.Mesh {
  const n = side === 'f' || side === 'l' ? 1 : -1;
  const c = wallPos + n * (protrude - depth / 2);
  if (side === 'f' || side === 'b') return addBox(parent, w, h, depth, mat, along, y, c, shadow);
  return addBox(parent, depth, h, w, mat, c, y, along, shadow);
}

/** Window: white frame (proud 4 cm), dark glass, optional sill. 2-3 meshes. */
export function addWindow(
  parent: THREE.Object3D,
  side: Side,
  along: number,
  y: number,
  w: number,
  h: number,
  wallPos: number,
  sill = true,
  frameMat: THREE.Material = MATERIALS.trim,
): void {
  addPanel(parent, side, along, y, w + 0.14, h + 0.14, 0.12, 0.04, frameMat, wallPos);
  addPanel(parent, side, along, y, w, h, 0.12, 0.05, MATERIALS.glass, wallPos);
  if (sill) addPanel(parent, side, along, y - h / 2 - 0.1, w + 0.3, 0.06, 0.2, 0.13, MATERIALS.trim, wallPos);
}

/** Door with a white frame. yBottom = threshold height. 2 meshes. */
export function addDoor(
  parent: THREE.Object3D,
  side: Side,
  along: number,
  w: number,
  h: number,
  yBottom: number,
  wallPos: number,
  mat: THREE.Material,
): void {
  addPanel(parent, side, along, yBottom + h / 2 + 0.04, w + 0.16, h + 0.08, 0.12, 0.03, MATERIALS.trim, wallPos);
  addPanel(parent, side, along, yBottom + h / 2, w, h, 0.12, 0.045, mat, wallPos);
}

/** Darken/lighten a hex colour (f < 1 darker). */
export function shadeHex(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Roof material: Colorsteel, slightly satin. */
export function roofMat(hex: number): THREE.MeshStandardMaterial {
  return MATERIALS.byColor(hex, 0.7, 0.1);
}
