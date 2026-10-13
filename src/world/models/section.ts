import * as THREE from 'three';
import { addBox, addCyl, addMesh } from './helpers';
import {
  createGarage,
  createHouseBungalow,
  createHouseTwoStorey,
  createHouseVilla,
  createUnitBlock,
  type BungalowOptions,
  type HouseUserData,
  type TwoStoreyOptions,
  type VillaOptions,
} from './houses';
import { MATERIALS } from './materials';
import { createFence, createLetterbox, type LetterboxOptions } from './street';
import { createShrub, createTree, createHedge, type TreeKind } from './trees';

// The residential section (lot) of the NZ suburb kit (design/nz-suburb-kit.html), ported as it is.

export type HouseType = 'bungalow' | 'villa' | 'twoStorey' | 'unitBlock';
export type SectionFence = 'picket' | 'paling' | 'hedge' | 'none';
export type GarageKind = 'garage' | 'carport' | 'none';

/** Parameters for whichever house the section gets (each house takes the ones it knows). */
export type HouseOptions = BungalowOptions & VillaOptions & TwoStoreyOptions;

export interface SectionOptions {
  houseType?: HouseType;
  house?: HouseOptions;
  fenceType?: SectionFence;
  /** Picket colour. */
  fenceColor?: number;
  /** Trees/shrubs in fixed slots, 0..3. */
  trees?: number;
  /** One per slot. Slot 0: front yard far corner, slot 1: by the front fence, slot 2: back yard. */
  treeKinds?: readonly TreeKind[];
  /** Per slot; missing = the model's default. */
  treeHeights?: readonly (number | undefined)[];
  /** Rotary clothesline in the back yard. */
  clothesline?: boolean;
  /** Ignored for twoStorey (it has its own). */
  garage?: GarageKind;
  /** Driveway side as seen from the street (+X is right). */
  driveSide?: 'right' | 'left';
  letterbox?: LetterboxOptions;
  /** Two shrubs by the house front. */
  shrubs?: boolean;
}

export interface SectionUserData {
  /** Local coords: driveway middle X, park spot centre Z on the driveway (car nose toward -Z), gate X. */
  drivewayX: number;
  parkZ: number;
  gateX: number;
}

/**
 * createSection — an 18 × 30 m residential section (lot) with a house, front fence, paths, garden and garage.
 * The street edge is the +Z side: the front boundary sits at z = +15, the back at z = -15.
 * Meshes: about 55-120 depending on house and fence.
 */
export function createSection(o: SectionOptions = {}): THREE.Group {
  const p = {
    houseType: 'bungalow' as HouseType,
    house: {} as HouseOptions,
    fenceType: 'picket' as SectionFence,
    fenceColor: 0xf7f7f2,
    trees: 2,
    treeKinds: ['deciduous', 'cabbage', 'pohutukawa'] as readonly TreeKind[],
    treeHeights: [] as readonly (number | undefined)[],
    clothesline: true,
    garage: 'garage' as GarageKind,
    driveSide: 'right' as 'right' | 'left',
    letterbox: {} as LetterboxOptions,
    shrubs: true,
    ...o,
  };
  const g = new THREE.Group();
  g.name = 'Section';
  const sx = p.driveSide === 'left' ? -1 : 1;
  const FRONT = 15, DX = sx * 7, DW = 3;

  addBox(g, 18, 0.04, 30, MATERIALS.lawn, 0, 0.02, 0, 2);

  // house
  let house: THREE.Group;
  let hx: number;
  const hp = { ...p.house };
  if (p.houseType === 'villa') {
    house = createHouseVilla(hp);
    hx = -sx * 1.0;
  } else if (p.houseType === 'unitBlock') {
    house = createUnitBlock(hp);
    hx = -sx * 2.0;
  } else if (p.houseType === 'twoStorey') {
    house = createHouseTwoStorey({ ...hp, mirrored: sx < 0 });
    hx = sx * 3.85;
  } else {
    house = createHouseBungalow(hp);
    hx = -sx * 0.3;
  }
  const ud = house.userData as HouseUserData;
  const hz = 9.5 - ud.frontZ;
  house.position.set(hx, 0, hz);
  g.add(house);

  // driveway, garage
  let driveEnd: number;
  if (p.houseType === 'twoStorey') driveEnd = hz + (ud.garageFrontZ ?? 0);
  else if (p.garage !== 'none') {
    const gz = hz - 1.0;
    const gar = createGarage({ type: p.garage, wallColor: hp.wallColor ?? 0xf2efe6, roofColor: hp.roofColor ?? 0x4a4f55 });
    gar.position.set(DX, 0, gz - 3.25);
    g.add(gar);
    driveEnd = gz;
  } else driveEnd = hz - 2;
  const dLen = FRONT - driveEnd;
  addBox(g, DW, 0.03, dLen, MATERIALS.concrete, DX, 0.055, driveEnd + dLen / 2, 2);

  // front path from the gate to the door (unit blocks get a cross path to both doors)
  const doors = (ud.doorXs ?? [ud.doorX]).map((x) => hx + x);
  const gateX = doors.reduce((a, b) => a + b, 0) / doors.length;
  const pathStart = hz + ud.frontZ - 0.05;
  addBox(g, 1.0, 0.03, FRONT - pathStart, MATERIALS.concrete, gateX, 0.055, (FRONT + pathStart) / 2, 2);
  if (doors.length > 1) {
    const w = Math.abs((doors[1] as number) - (doors[0] as number)) + 1.2;
    addBox(g, w, 0.03, 1.0, MATERIALS.concrete, gateX, 0.056, pathStart + 0.5, 2);
  }

  // front fence with gaps for the gate and the driveway
  if (p.fenceType !== 'none') {
    const gaps = [
      [gateX - 0.5, gateX + 0.5],
      [DX - 1.6, DX + 1.6],
    ].sort((a, b) => (a[0] as number) - (b[0] as number)) as [number, number][];
    let x = -9;
    const runs: [number, number][] = [];
    for (const [a, b] of gaps) {
      runs.push([x, a]);
      x = b;
    }
    runs.push([x, 9]);
    for (const [a, b] of runs) {
      const len = b - a;
      if (len < 0.4) continue;
      const f =
        p.fenceType === 'hedge'
          ? createHedge({ length: len, height: 1.1 })
          : createFence({ type: p.fenceType, length: len, color: p.fenceColor });
      f.position.set((a + b) / 2, 0, FRONT - (p.fenceType === 'hedge' ? 0.5 : 0.1));
      g.add(f);
    }
    if (p.fenceType !== 'hedge') {
      const gate = createFence({ type: p.fenceType, length: 0.96, color: p.fenceColor, posts: false });
      gate.position.set(gateX, 0, FRONT - 0.1);
      g.add(gate);
    }
  }
  const lb = createLetterbox(p.letterbox);
  const lbSide = gateX - DX < 0 ? -1 : 1;
  lb.position.set(gateX + lbSide * 0.9, 0, FRONT + 0.15);
  g.add(lb);

  // trees in fixed slots
  const slots = [
    [-sx * 6.0, 12.0],
    [gateX - sx * 2.4, 13.3],
    [-sx * 4.5, -10.5],
  ] as const;
  for (let i = 0; i < Math.min(3, p.trees); i++) {
    const kind = p.treeKinds[i] ?? 'shrub';
    const t = createTree(kind, p.treeHeights[i]);
    const slot = slots[i] as readonly [number, number];
    t.position.set(slot[0], 0, slot[1]);
    g.add(t);
  }
  if (p.shrubs) {
    const fz = pathStart + 1.8;
    const spots = [
      [gateX - 1.6, 1.1],
      [gateX + 1.5, 0.9],
    ] as const;
    for (const [x, s] of spots) {
      if (Math.abs(x - DX) < 2.2) continue;
      const sh = createShrub({ size: s });
      sh.position.set(x, 0, fz);
      g.add(sh);
    }
  }

  // rotary clothesline: pole, two crossed arms, square line ring
  if (p.clothesline) {
    const cx = sx * 1.0, cz = -9.0;
    addCyl(g, 0.035, 0.035, 2.1, 8, MATERIALS.metal, cx, 1.05, cz, 1);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const arm = addBox(g, 2.6, 0.03, 0.03, MATERIALS.metal, cx, 2.0, cz);
      arm.rotation.y = a;
    }
    const ring = addMesh(g, new THREE.TorusGeometry(1.25, 0.012, 3, 4), MATERIALS.metal, cx, 1.98, cz);
    ring.rotation.set(Math.PI / 2, 0, Math.PI / 4);
  }

  g.userData = { drivewayX: DX, parkZ: Math.min(FRONT - 3.2, driveEnd + 3.0), gateX } satisfies SectionUserData;
  return g;
}
