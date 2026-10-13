import * as THREE from 'three';
import {
  addBox,
  addCyl,
  addDoor,
  addMesh,
  addPanel,
  addWindow,
  gableRoofPts,
  gableWallPts,
  hipRoofGeo,
  prismGeo,
  roofMat,
  shadeHex,
} from './helpers';
import { MATERIALS } from './materials';

// Houses of the NZ suburb kit (design/nz-suburb-kit.html), ported as they are.
// Front of every house faces +Z; origin on the ground under the middle of the house.

export interface HouseUserData {
  /** Door centre X and the front edge of the entry steps (used by createSection). */
  doorX: number;
  frontZ: number;
  /** Unit blocks: both doors. */
  doorXs?: readonly number[];
  /** Two-storey houses: their attached garage. */
  garageX?: number;
  garageFrontZ?: number;
}

export interface BungalowOptions {
  wallColor?: number;
  roofColor?: number;
  doorColor?: number;
  hasChimney?: boolean;
  /** false: bay on the left as seen from the street (-X), entry on the right (+X). */
  mirrored?: boolean;
  plinth?: 'concrete' | 'brick';
}

/**
 * createHouseBungalow — single-storey NZ bungalow, gable end facing the street, bay window and covered entry.
 * Size (W × D × H): 10 × 12 × 5.5 m to the ridge (chimney tops out at 5.75 m). Meshes: 42 (40 without chimney).
 */
export function createHouseBungalow(o: BungalowOptions = {}): THREE.Group {
  const p = { wallColor: 0xf2efe6, roofColor: 0x4a4f55, doorColor: 0x2f4560, hasChimney: true, mirrored: false, plinth: 'concrete', ...o };
  const g = new THREE.Group();
  g.name = 'HouseBungalow';
  const sx = p.mirrored ? -1 : 1;
  const wall = MATERIALS.byColor(p.wallColor);
  const roof = roofMat(p.roofColor);
  const door = MATERIALS.byColor(p.doorColor, 0.6);
  const batten = MATERIALS.byColor(shadeHex(p.wallColor, 0.86));
  const base = p.plinth === 'brick' ? MATERIALS.brick : MATERIALS.concrete;
  const HW = 4.65, ZF = 4.3, ZB = -5.7, PL = 0.5, EAVE = 3.2, S = 0.445, OH = 0.35, T = 0.15;
  const D = ZF - ZB, ZC = (ZF + ZB) / 2;

  addBox(g, 2 * HW + 0.1, PL, D + 0.1, base, 0, PL / 2, ZC, 3); // plinth
  addMesh(g, prismGeo(gableWallPts(HW, PL, EAVE, S), D), wall, 0, 0, ZC, 3); // walls + gables
  const r = gableRoofPts(HW, EAVE, S, OH, T);
  addMesh(g, prismGeo(r.pts, D + 2 * OH), roof, 0, 0, ZC, 3); // roof
  addBox(g, 0.3, 0.1, D + 2 * OH - 0.04, roof, 0, r.apex, ZC, 1); // ridge cap
  // barge boards on the street gable
  const bl = (HW + OH) * Math.sqrt(1 + S * S), ang = Math.atan(S);
  for (const k of [-1, 1]) {
    const b = addBox(g, bl, 0.24, 0.05, MATERIALS.trim, (k * (HW + OH)) / 2, (r.apex + r.eaveTop) / 2 - 0.12, ZF + OH + 0.03);
    b.rotation.z = -k * ang;
  }
  if (p.hasChimney) {
    addBox(g, 0.6, 1.85, 0.6, MATERIALS.brick, -sx * 2.3, 4.82, ZC - 1.6, 1);
    addBox(g, 0.75, 0.1, 0.75, MATERIALS.concrete, -sx * 2.3, 5.8, ZC - 1.6);
  }
  for (const y of [1.25, 1.95, 2.65]) addPanel(g, 'f', 0, y, 2 * HW, 0.05, 0.06, 0.025, batten, ZF); // weatherboard lines

  // bay window (viewer's left)
  const bx = -sx * 3.0;
  addBox(g, 3.3, PL, 0.7, base, bx, PL / 2, ZF + 0.3, 1);
  addBox(g, 3.2, 2.25, 0.65, wall, bx, PL + 1.125, ZF + 0.275, 3);
  addBox(g, 3.5, 0.12, 0.95, roof, bx, 2.88, ZF + 0.35, 1).rotation.x = 0.25;
  addWindow(g, 'f', bx, 1.68, 2.4, 1.4, ZF + 0.6);
  // front window, gable vent window, side windows
  addWindow(g, 'f', sx * 0.25, 1.95, 1.3, 1.4, ZF);
  addWindow(g, 'f', 0, 4.15, 0.9, 0.55, ZF, false);
  for (const z of [2.0, -2.6]) {
    addWindow(g, 'l', z, 1.95, 1.4, 1.35, HW);
    addWindow(g, 'r', z, 1.95, 1.4, 1.35, -HW);
  }
  // entry: door, landing, steps, canopy on two posts
  const dx = sx * 2.9;
  addDoor(g, 'f', dx, 0.9, 2.05, PL, ZF, door);
  addBox(g, 2.0, PL, 1.1, MATERIALS.concrete, dx, PL / 2, ZF + 0.55, 3);
  addBox(g, 1.4, 0.33, 0.28, MATERIALS.concrete, dx, 0.165, ZF + 1.24, 2);
  addBox(g, 1.4, 0.17, 0.28, MATERIALS.concrete, dx, 0.085, ZF + 1.52, 2);
  addBox(g, 2.1, 0.1, 1.3, roof, dx, 2.86, ZF + 0.6, 1).rotation.x = 0.12;
  for (const k of [-1, 1]) addBox(g, 0.1, 2.3, 0.1, MATERIALS.trim, dx + k * 0.95, PL + 1.15, ZF + 1.0, 1);

  g.userData = { doorX: dx, frontZ: ZF + 1.66 } satisfies HouseUserData;
  return g;
}

export interface VillaOptions {
  wallColor?: number;
  roofColor?: number;
  doorColor?: number;
  /** Railing between the veranda posts. */
  verandaRailing?: boolean;
}

/**
 * createHouseVilla — villa with a hipped roof and a full-width front veranda.
 * Size (W × D × H): 12 × 11 × 5.9 m. Meshes: 41 (31 without railing).
 */
export function createHouseVilla(o: VillaOptions = {}): THREE.Group {
  const p = { wallColor: 0xf2efe6, roofColor: 0x7a3b33, doorColor: 0x9c3b32, verandaRailing: true, ...o };
  const g = new THREE.Group();
  g.name = 'HouseVilla';
  const wall = MATERIALS.byColor(p.wallColor);
  const roof = roofMat(p.roofColor);
  const door = MATERIALS.byColor(p.doorColor, 0.6);
  const batten = MATERIALS.byColor(shadeHex(p.wallColor, 0.86));
  const HW = 5.6, ZF = 2.7, ZB = -5.14, PL = 0.55, TOP = 3.5, OH = 0.4, S = 0.5;
  const D = ZF - ZB, ZC = (ZF + ZB) / 2, VD = 2.2;

  addBox(g, 2 * HW + 0.1, PL, D + 0.1, MATERIALS.concrete, 0, PL / 2, ZC, 3);
  addBox(g, 2 * HW, TOP - PL, D, wall, 0, (TOP + PL) / 2, ZC, 3);
  const rw = 2 * HW + 2 * OH, rd = D + 2 * OH, rise = (rd / 2) * S;
  addMesh(g, hipRoofGeo(rw, rd, rise), roof, 0, TOP + OH * S, ZC, 3);
  addBox(g, rw - rd + 0.1, 0.08, 0.22, roof, 0, TOP + OH * S + rise, ZC, 1);
  for (const y of [1.4, 2.2, 3.0]) addPanel(g, 'f', 0, y, 2 * HW, 0.05, 0.06, 0.025, batten, ZF);

  // veranda: skirt, deck, lean-to roof, frieze, posts
  addBox(g, 2 * HW, 0.45, VD, MATERIALS.timberDark, 0, 0.225, ZF + VD / 2, 2);
  addBox(g, 2 * HW + 0.1, 0.1, VD + 0.05, MATERIALS.timberLight, 0, 0.5, ZF + VD / 2, 3);
  const vr = addBox(g, 2 * HW + 0.3, 0.08, 2.4, roof, 0, 3.13, ZF + 1.18, 3);
  vr.rotation.x = Math.atan(0.35 / 2.35);
  addBox(g, 2 * HW + 0.3, 0.2, 0.05, MATERIALS.trim, 0, 2.86, ZF + 2.34);
  const postX = [-5.45, -1.6, 1.6, 5.45], pz = ZF + 2.05;
  for (const x of postX) addBox(g, 0.12, 2.35, 0.12, MATERIALS.trim, x, PL + 1.175, pz, 1);
  if (p.verandaRailing) {
    for (const k of [-1, 1]) {
      const a = k * 1.66, b = k * 5.39, cx = (a + b) / 2, len = Math.abs(b - a);
      addBox(g, len, 0.06, 0.08, MATERIALS.trim, cx, PL + 0.9, pz);
      addBox(g, len, 0.05, 0.06, MATERIALS.trim, cx, PL + 0.12, pz);
      for (const t of [-1, 0, 1]) addBox(g, 0.05, 0.75, 0.05, MATERIALS.trim, cx + t * len * 0.25, PL + 0.5, pz);
    }
  }
  // steps to the veranda
  addBox(g, 2.4, 0.37, 0.28, MATERIALS.timberLight, 0, 0.185, ZF + VD + 0.14, 2);
  addBox(g, 2.4, 0.18, 0.28, MATERIALS.timberLight, 0, 0.09, ZF + VD + 0.42, 2);
  // door, tall front windows, one window each side
  addDoor(g, 'f', 0, 0.95, 2.2, PL, ZF, door);
  for (const k of [-1, 1]) addWindow(g, 'f', k * 3.3, 2.25, 1.1, 1.9, ZF);
  addWindow(g, 'l', ZC, 2.2, 1.1, 1.7, HW);
  addWindow(g, 'r', ZC, 2.2, 1.1, 1.7, -HW);

  g.userData = { doorX: 0, frontZ: ZF + VD + 0.56 } satisfies HouseUserData;
  return g;
}

export interface TwoStoreyOptions {
  wallColor?: number;
  roofColor?: number;
  /** gable: ridge along X; mono: high side at the street. */
  roofType?: 'gable' | 'mono';
  /** Ground floor (and garage) in brick. */
  brickLower?: boolean;
  /** false: garage on +X (street view right). */
  mirrored?: boolean;
  doorColor?: number;
}

/**
 * createHouseTwoStorey — modern two-storey house with an attached single garage on one side.
 * Size (W × D × H): 10 × 9.6 × 7.5 m (garage included in the width). Meshes: 36.
 */
export function createHouseTwoStorey(o: TwoStoreyOptions = {}): THREE.Group {
  const p = { wallColor: 0xc9ccc8, roofColor: 0x2b2d30, roofType: 'gable', brickLower: false, mirrored: false, doorColor: 0x2f4560, ...o };
  const g = new THREE.Group();
  g.name = 'HouseTwoStorey';
  const sx = p.mirrored ? -1 : 1;
  const wall = MATERIALS.byColor(p.wallColor);
  const roof = roofMat(p.roofColor);
  const lowerMat = p.brickLower ? MATERIALS.brick : wall;
  const batten = MATERIALS.byColor(shadeHex(p.wallColor, 0.86));
  const X0 = -4.7, X1 = 1.4, MW = X1 - X0, MX = (sx * (X0 + X1)) / 2;
  const ZF = 4.0, ZB = -4.5, D = ZF - ZB, ZC = (ZF + ZB) / 2, HZ = D / 2;
  const PL = 0.4, F1 = 3.1, TOP = 5.9;

  addBox(g, MW + 0.1, PL, D + 0.1, MATERIALS.concrete, MX, PL / 2, ZC, 3);
  addBox(g, MW, F1 - PL, D, lowerMat, MX, (F1 + PL) / 2, ZC, 3);
  if (p.roofType === 'mono') {
    const hiY = 7.0, k = (hiY - TOP) / D;
    addMesh(g, prismGeo([[-HZ, F1], [HZ, F1], [HZ, hiY], [-HZ, TOP]], MW, 'x'), wall, MX, 0, ZC, 3);
    const rl = (D + 0.6) * Math.sqrt(1 + k * k);
    const rf = addBox(g, MW + 0.5, 0.14, rl, roof, MX, (TOP + hiY) / 2 + 0.08, ZC, 3);
    rf.rotation.x = -Math.atan(k);
    addBox(g, MW + 0.5, 0.3, 0.05, MATERIALS.trim, MX, hiY + 0.06, ZF + 0.33); // fascia on the high edge
  } else {
    const S = 0.31;
    addMesh(g, prismGeo(gableWallPts(HZ, F1, TOP, S), MW, 'x'), wall, MX, 0, ZC, 3);
    const r = gableRoofPts(HZ, TOP, S, 0.3, 0.15);
    addMesh(g, prismGeo(r.pts, MW + 0.6, 'x'), roof, MX, 0, ZC, 3);
    addBox(g, MW + 0.62, 0.1, 0.3, roof, MX, r.apex, ZC, 1);
  }
  addPanel(g, 'f', MX, F1, MW + 0.04, 0.14, 0.06, 0.035, MATERIALS.trim, ZF); // floor band
  for (const y of [4.0, 5.0]) addPanel(g, 'f', MX, y, MW, 0.05, 0.06, 0.025, batten, ZF);

  // attached garage
  const GX = sx * 3.15, GW = 3.5, GZF = 4.6, GZB = -2.5, GD = GZF - GZB, GZC = (GZF + GZB) / 2;
  addBox(g, GW, 2.9, GD, lowerMat, GX, 1.45, GZC, 3);
  addBox(g, GW + 0.3, 0.12, GD + 0.4, roof, GX, 2.98, GZC + 0.1, 3).rotation.x = 0.03;
  addBox(g, GW + 0.3, 0.25, 0.05, MATERIALS.trim, GX, 2.86, GZF + 0.32);
  addPanel(g, 'f', GX, 1.14, 2.9, 2.28, 0.1, 0.02, MATERIALS.trim, GZF);
  addPanel(g, 'f', GX, 1.08, 2.7, 2.16, 0.1, 0.035, MATERIALS.garageDoor, GZF);
  for (const y of [0.55, 1.1, 1.65]) addPanel(g, 'f', GX, y, 2.6, 0.03, 0.04, 0.045, MATERIALS.groove, GZF);

  // windows: wide ground-floor window, two upstairs, two on the outer gable end
  addWindow(g, 'f', sx * -2.6, 2.0, 3.0, 1.6, ZF);
  addWindow(g, 'f', sx * -2.6, 4.5, 2.0, 1.4, ZF);
  addWindow(g, 'f', sx * 0.35, 4.5, 1.3, 1.4, ZF);
  const side = sx > 0 ? 'r' : 'l', sideX = sx * X0;
  addWindow(g, side, 1.0, 2.0, 1.4, 1.3, sideX);
  addWindow(g, side, -1.5, 4.5, 1.4, 1.3, sideX);
  // entry
  const dx = sx * 0.3;
  addDoor(g, 'f', dx, 1.0, 2.1, PL, ZF, MATERIALS.byColor(p.doorColor, 0.6));
  addBox(g, 1.7, 0.08, 1.1, roof, dx, 2.78, ZF + 0.55, 1);
  addBox(g, 1.4, 0.27, 0.3, MATERIALS.concrete, dx, 0.135, ZF + 0.15, 2);
  addBox(g, 1.4, 0.13, 0.3, MATERIALS.concrete, dx, 0.065, ZF + 0.45, 2);

  g.userData = { doorX: dx, frontZ: ZF + 0.6, garageX: GX, garageFrontZ: GZF } satisfies HouseUserData;
  return g;
}

export interface UnitBlockOptions {
  wallColor?: number;
  roofColor?: number;
  doorColor?: number;
}

/**
 * createUnitBlock — pair of identical two-storey townhouses under one gable roof (ridge along X).
 * Size (W × D × H): 14 × 8.6 × 6.0 m. Meshes: 43.
 */
export function createUnitBlock(o: UnitBlockOptions = {}): THREE.Group {
  const p = { wallColor: 0xe8dcc0, roofColor: 0x4a4f55, doorColor: 0x45634a, ...o };
  const g = new THREE.Group();
  g.name = 'UnitBlock';
  const wall = MATERIALS.byColor(p.wallColor);
  const roof = roofMat(p.roofColor);
  const door = MATERIALS.byColor(p.doorColor, 0.6);
  const batten = MATERIALS.byColor(shadeHex(p.wallColor, 0.86));
  const HW = 6.6, ZF = 3.4, ZB = -4.2, D = ZF - ZB, ZC = (ZF + ZB) / 2, HZ = D / 2;
  const PL = 0.3, TOP = 5.1, S = 0.19;

  addBox(g, 2 * HW + 0.1, PL, D + 0.1, MATERIALS.concrete, 0, PL / 2, ZC, 3);
  addMesh(g, prismGeo(gableWallPts(HZ, PL, TOP, S), 2 * HW, 'x'), wall, 0, 0, ZC, 3);
  const r = gableRoofPts(HZ, TOP, S, 0.4, 0.13);
  addMesh(g, prismGeo(r.pts, 2 * HW + 0.8, 'x'), roof, 0, 0, ZC, 3);
  addBox(g, 2 * HW + 0.82, 0.08, 0.3, roof, 0, r.apex, ZC, 1);
  addPanel(g, 'f', 0, (TOP + PL) / 2, 0.14, TOP - PL, 0.06, 0.04, MATERIALS.trim, ZF); // party wall line
  for (const y of [3.3, 4.6]) addPanel(g, 'f', 0, y, 2 * HW, 0.05, 0.06, 0.025, batten, ZF);

  for (const k of [-1, 1]) {
    const bx = k * 4.7, dx = k * 1.5;
    // ground-floor bay window
    addBox(g, 2.3, 2.45, 0.65, wall, bx, 1.225, ZF + 0.275, 3);
    addBox(g, 2.6, 0.1, 0.85, roof, bx, 2.55, ZF + 0.35, 1).rotation.x = 0.2;
    addWindow(g, 'f', bx, 1.45, 1.8, 1.3, ZF + 0.6);
    // door, canopy, two steps
    addDoor(g, 'f', dx, 0.9, 2.05, PL, ZF, door);
    addBox(g, 1.5, 0.08, 0.9, roof, dx, 2.58, ZF + 0.45, 1).rotation.x = 0.12;
    addBox(g, 1.2, 0.2, 0.28, MATERIALS.concrete, dx, 0.1, ZF + 0.14, 2);
    addBox(g, 1.2, 0.1, 0.28, MATERIALS.concrete, dx, 0.05, ZF + 0.42, 2);
    // upstairs
    addWindow(g, 'f', bx, 3.9, 1.6, 1.2, ZF);
    addWindow(g, 'f', dx, 4.0, 0.8, 0.9, ZF);
    // end wall window
    addWindow(g, k > 0 ? 'l' : 'r', -1.2, 3.9, 1.2, 1.1, k * HW, false);
  }

  g.userData = { doorX: 1.5, doorXs: [-1.5, 1.5], frontZ: ZF + 0.56 } satisfies HouseUserData;
  return g;
}

export interface CornerShopOptions {
  wallColor?: number;
  signColor?: number;
  awningColor?: number;
}

/**
 * createCornerShop — corner dairy / cafe: flat roof behind a parapet, veranda over the footpath on three posts,
 * big shopfront, glass door, sign board, two outdoor tables with two chairs each, A-frame board.
 * Size (W × D × H): 12 × 10 × 5.0 m (building 12 × 7.5, veranda adds 2.5 m in front). Meshes: 36.
 * userData: { doorX, frontZ (outer edge of the veranda), facadeZ }.
 */
export function createCornerShop(o: CornerShopOptions = {}): THREE.Group {
  const p = { wallColor: 0xe8dcc0, signColor: 0x2f5f8a, awningColor: 0x7a3b33, ...o };
  const g = new THREE.Group();
  g.name = 'CornerShop';
  const wall = MATERIALS.byColor(p.wallColor);
  const awn = MATERIALS.byColor(p.awningColor, 0.6, 0.2);
  const ZF = 2.5, ZB = -5.0, D = ZF - ZB, ZC = (ZF + ZB) / 2, HW = 6.0;

  addBox(g, 2 * HW, 5.0, D, wall, 0, 2.5, ZC, 3);
  addBox(g, 2 * HW - 0.4, 0.06, D - 0.4, roofMat(0x4a4f55), 0, 5.0, ZC, 2); // roof inside the parapet
  addBox(g, 1.2, 0.6, 0.8, MATERIALS.metal, 3.0, 5.33, ZC - 1.8, 1); // rooftop AC unit
  // shopfront
  for (const k of [-1, 1]) {
    addPanel(g, 'f', k * 3.45, 1.75, 4.22, 2.42, 0.12, 0.04, MATERIALS.aluminium, ZF);
    addPanel(g, 'f', k * 3.45, 1.75, 4.1, 2.3, 0.12, 0.05, MATERIALS.glass, ZF);
  }
  addPanel(g, 'f', 0, 1.27, 1.5, 2.54, 0.12, 0.04, MATERIALS.aluminium, ZF);
  addPanel(g, 'f', 0, 1.2, 1.3, 2.36, 0.12, 0.05, MATERIALS.glass, ZF);
  // veranda over the footpath
  addBox(g, 2 * HW + 0.2, 0.15, 2.5, awn, 0, 3.15, ZF + 1.25, 3);
  addBox(g, 2 * HW + 0.2, 0.4, 0.08, awn, 0, 3.05, ZF + 2.5, 1);
  for (const x of [-5.9, 0, 5.9]) addCyl(g, 0.05, 0.05, 3.0, 8, MATERIALS.metal, x, 1.5, ZF + 2.35, 1);
  // sign board with a white border
  addPanel(g, 'f', 0, 4.15, 9.3, 1.25, 0.08, 0.05, MATERIALS.trim, ZF);
  addPanel(g, 'f', 0, 4.15, 9.0, 1.0, 0.1, 0.09, MATERIALS.byColor(p.signColor, 0.6), ZF);
  // side window on the -X wall (faces the side street on a corner)
  addWindow(g, 'r', -1.0, 1.9, 2.5, 1.6, -HW, false, MATERIALS.aluminium);
  // two tables, two chairs each
  for (const tx of [-3.4, 3.4]) {
    const tz = ZF + 1.3;
    addCyl(g, 0.04, 0.05, 0.72, 8, MATERIALS.metalDark, tx, 0.36, tz);
    addCyl(g, 0.36, 0.36, 0.04, 12, MATERIALS.timberLight, tx, 0.74, tz, 1);
    for (const k of [-1, 1]) {
      const cx = tx + k * 0.62;
      addBox(g, 0.42, 0.04, 0.42, MATERIALS.metalDark, cx, 0.45, tz);
      addBox(g, 0.04, 0.42, 0.42, MATERIALS.metalDark, cx + k * 0.21, 0.68, tz);
      addBox(g, 0.06, 0.43, 0.06, MATERIALS.metalDark, cx, 0.215, tz);
    }
  }
  // A-frame sandwich board
  for (const k of [-1, 1]) {
    const b = addBox(g, 0.6, 0.9, 0.03, MATERIALS.metalDark, 1.6, 0.44, ZF + 1.7 + k * 0.09);
    b.rotation.x = -k * 0.2;
  }

  g.userData = { doorX: 0, frontZ: ZF + 2.5, facadeZ: ZF };
  return g;
}

export interface GarageOptions {
  type?: 'garage' | 'carport';
  /** Garage only. */
  wallColor?: number;
  roofColor?: number;
}

/**
 * createGarage — detached single garage or open carport.
 * Size (W × D × H): 4 × 6.5 × 2.9 m (carport 4 × 6.5 × 2.8). Meshes: garage 11, carport 8.
 */
export function createGarage(o: GarageOptions = {}): THREE.Group {
  const p = { type: 'garage', wallColor: 0xf2efe6, roofColor: 0x4a4f55, ...o };
  const g = new THREE.Group();
  g.name = p.type === 'carport' ? 'Carport' : 'Garage';
  const roof = roofMat(p.roofColor);
  if (p.type === 'carport') {
    for (const x of [-1.85, 1.85]) {
      for (const z of [-2.95, 2.95]) addBox(g, 0.1, 2.5, 0.1, MATERIALS.timberLight, x, 1.25, z, 1);
      addBox(g, 0.12, 0.22, 6.5, MATERIALS.timberLight, x, 2.55, 0, 1);
    }
    addBox(g, 4.0, 0.08, 6.5, roof, 0, 2.72, 0, 3).rotation.x = -0.03;
    addBox(g, 3.8, 0.06, 6.3, MATERIALS.concrete, 0, 0.03, 0, 2);
    return g;
  }
  const wall = MATERIALS.byColor(p.wallColor);
  const k = 0.3 / 6.0;
  addMesh(g, prismGeo([[-3.0, 0], [3.0, 0], [3.0, 2.75], [-3.0, 2.45]], 3.6, 'x'), wall, 0, 0, 0, 3);
  const rf = addBox(g, 4.0, 0.1, 6.5 * Math.sqrt(1 + k * k), roof, 0, 2.66, 0, 3);
  rf.rotation.x = -Math.atan(k);
  addBox(g, 4.0, 0.18, 0.04, MATERIALS.trim, 0, 2.7, 3.25);
  addBox(g, 3.8, 0.06, 0.6, MATERIALS.concrete, 0, 0.03, 3.3, 2); // apron
  addPanel(g, 'f', 0, 1.14, 2.9, 2.25, 0.1, 0.02, MATERIALS.trim, 3.0);
  addPanel(g, 'f', 0, 1.08, 2.7, 2.15, 0.1, 0.035, MATERIALS.garageDoor, 3.0);
  for (const y of [0.55, 1.1, 1.65]) addPanel(g, 'f', 0, y, 2.6, 0.03, 0.04, 0.045, MATERIALS.groove, 3.0);
  addWindow(g, 'l', -1.0, 1.5, 1.0, 0.8, 1.8, false);
  return g;
}
