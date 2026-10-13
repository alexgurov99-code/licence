import { CONFIG, type WorldParams } from '../config';
import { normalizeAngle } from '../util/math';
import { createRandom, type Random } from '../util/random';
import { dirHeading, dirVector, opposite } from './layout';
import { CAR_SIZES, PALETTE, SECTION_DEPTH, SECTION_WIDTH, SHOP_BACK, SHOP_FRONT, SHOP_WIDTH, type CarType } from './models/catalogue';
import type { CornerShopOptions } from './models/houses';
import type { HouseType, SectionFence, SectionOptions } from './models/section';
import type { TreeKind } from './models/trees';
import type { Junction, Road, RoadNetwork } from './network';
import { add, distance, forward, leftOf, pointAt, project, type Vec2 } from './path';
import { outlinePoints, placedRect, pointInPolygon, polygonsOverlap } from './polygon';

// Where the scenery goes: sections with houses facing the roads, a corner shop at some junctions,
// trees, street lights, power poles, bus stops and bins on the grass verge, cars parked by the
// kerb and shrubs on roundabout islands. Pure data, no Three.js: sceneryMesh.ts builds the models
// from design/nz-suburb-kit.html. The same seed always gives the same scenery.
//
// Kept clear: the roads and junctions, the start and finish of the route, the view in front of
// every sign, and the sight triangles at junctions (nothing taller than a letterbox).

interface Placement {
  x: number;
  z: number;
  /** Height above the road of the model's ground (only roundabout islands are raised). */
  y: number;
  /** The way the model's face (+Z) points; same convention as the car. */
  heading: number;
  /** Ground outline, a convex polygon. */
  footprint: readonly Vec2[];
  /** Outline of the crown for trees, which reaches further than the trunk. */
  canopy?: readonly Vec2[];
  /** Top of the model above the ground. */
  height: number;
}

export type DrivewayParking = { kind: 'car'; car: CarType; color: number } | { kind: 'trailer' } | null;

export type SceneryItem = Placement &
  (
    | { kind: 'section'; options: SectionOptions; driveway: DrivewayParking }
    | { kind: 'cornerShop'; options: CornerShopOptions }
    | { kind: 'tree'; tree: TreeKind; treeHeight: number }
    | { kind: 'shrub'; size: number }
    | { kind: 'streetLight' }
    | { kind: 'powerPole' }
    | { kind: 'busStop' }
    | { kind: 'bench' }
    | { kind: 'bin' }
    | { kind: 'wheelieBins'; count: 1 | 2 }
    | { kind: 'hydrant' }
    | { kind: 'car'; car: CarType; color: number }
    /** Concrete driveway crossing over the verge. */
    | { kind: 'crossing'; width: number; length: number }
  );

export type SceneryKind = SceneryItem['kind'];

export interface Scenery {
  items: readonly SceneryItem[];
  /** Kept free of anything taller than `lowHeight`. */
  sightTriangles: readonly (readonly Vec2[])[];
  signCorridors: readonly (readonly Vec2[])[];
}

export interface SceneryAvoid {
  /** Roads the route uses: no cars are parked along them. */
  routeRoads: ReadonlySet<number>;
  /** Where the car starts and stops at the end. */
  keepClear: readonly Vec2[];
}

const HOUSE_TYPES: readonly [HouseType, number][] = [
  ['bungalow', 0.35],
  ['villa', 0.25],
  ['twoStorey', 0.25],
  ['unitBlock', 0.15],
];
const FENCES: readonly [SectionFence, number][] = [
  ['picket', 0.3],
  ['paling', 0.2],
  ['hedge', 0.3],
  ['none', 0.2],
];
const GARDEN_TREES: readonly TreeKind[] = ['deciduous', 'cabbage', 'pohutukawa', 'conifer', 'shrub'];
const VERGE_TREES: readonly [TreeKind, number][] = [
  ['deciduous', 0.45],
  ['cabbage', 0.3],
  ['pohutukawa', 0.25],
];
const CAR_TYPES: readonly [CarType, number][] = [
  ['hatchback', 0.3],
  ['sedan', 0.25],
  ['wagon', 0.2],
  ['ute', 0.15],
  ['van', 0.1],
];
const LETTERBOX_COLOURS = [0x9c3b32, 0x2f4560, 0xe8e4da, 0x45634a, 0x3a3d40];
const SHOP_SIGNS = [0x2f5f8a, 0x9c3b32, 0x45634a, 0x3a3d40];

/** A straight stretch of one side of a road: centreline distances [from, to]. */
interface Stretch {
  road: Road;
  /** +1: the left of the centreline's direction, -1: the right. */
  side: 1 | -1;
  from: number;
  to: number;
}

export function placeScenery(network: RoadNetwork, avoid: SceneryAvoid, params: WorldParams = CONFIG.world): Scenery {
  const p = params.scenery;
  const random = createRandom(`${network.seed}/scenery`);
  const roadHalf = params.laneWidth + params.shoulderWidth;
  const items: SceneryItem[] = [];
  const sightTriangles = buildSightTriangles(network, p.sightLeg);
  const signCorridors = network.signs.map((sign) =>
    placedRect(sign, sign.facing, -p.signCorridorHalfWidth, p.signCorridorHalfWidth, -0.5, p.signCorridorLength),
  );
  const signFeet = network.signs.map((sign) => placedRect(sign, sign.facing, -p.signClearance, p.signClearance, -p.signClearance, p.signClearance));
  const roadBoxes = network.roads.map((road) => pathBox(road, roadHalf + 20));

  /** Closest any point of the polygon comes to the middle of any road. */
  const roadDistance = (poly: readonly Vec2[]): number => {
    const box = polyBox(poly);
    let nearest = Infinity;
    const points = outlinePoints(poly, 2);
    network.roads.forEach((road, i) => {
      const rb = roadBoxes[i] as Box;
      if (rb.maxX < box.minX || rb.minX > box.maxX || rb.maxZ < box.minZ || rb.minZ > box.maxZ) return;
      for (const q of points) nearest = Math.min(nearest, project(road.centreline, q).distance);
    });
    return nearest;
  };
  const inJunction = (poly: readonly Vec2[]): boolean =>
    network.junctions.some((j) =>
      outlinePoints(poly, 2).some((q) =>
        j.kind === 'roundabout'
          ? distance(q, j.centre) < j.size + 1
          : Math.abs(q.x - j.centre.x) < j.size + 1 && Math.abs(q.z - j.centre.z) < j.size + 1,
      ),
    );
  const overlapsItems = (poly: readonly Vec2[]): boolean => {
    const box = polyBox(poly);
    return items.some((item) => {
      const ib = polyBox(item.footprint);
      if (ib.maxX < box.minX || ib.minX > box.maxX || ib.maxZ < box.minZ || ib.minZ > box.maxZ) return false;
      return polygonsOverlap(poly, item.footprint);
    });
  };
  const blocksView = (reach: readonly Vec2[], height: number): boolean =>
    height > p.lowHeight &&
    (sightTriangles.some((t) => polygonsOverlap(reach, t)) || signCorridors.some((c) => polygonsOverlap(reach, c)));
  const nearKeepClear = (poly: readonly Vec2[]): boolean =>
    avoid.keepClear.some((c) => pointInPolygon(c, poly) || outlinePoints(poly, 1).some((q) => distance(q, c) < p.startClearance));
  const nearSign = (poly: readonly Vec2[]): boolean => signFeet.some((f) => polygonsOverlap(poly, f));

  /** Roadside items and parked cars: clear of everything. */
  const fitsSmall = (item: Placement, roadClearance: number | null): boolean => {
    if (roadClearance !== null && roadDistance(item.footprint) < roadClearance) return false;
    return (
      !inJunction(item.footprint) &&
      !blocksView(item.canopy ?? item.footprint, item.height) &&
      !nearSign(item.footprint) &&
      !nearKeepClear(item.footprint) &&
      !overlapsItems(item.footprint)
    );
  };

  const stretches = straightStretches(network);
  // Where a pose `offset` metres out from the centreline on a stretch's side is, and the heading
  // that faces the road from there.
  const at = (st: Stretch, s: number, offset: number): { point: Vec2; facing: number; along: number } => {
    const c = pointAt(st.road.centreline, s);
    return { point: add(c, leftOf(c.heading), st.side * offset), facing: normalizeAngle(c.heading - (st.side * Math.PI) / 2), along: c.heading };
  };

  // 1. Corner shops, a little way along one arm of some junctions, just outside the sight triangle.
  const shopFrontOffset = roadHalf + 1.5;
  const shopsAt = (junction: Junction): SceneryItem[] =>
    adjacentArms(junction).map(([a, b]) => {
      const along = p.sightLeg - shopFrontOffset + SHOP_WIDTH / 2 + 0.5;
      const centre = add(add(junction.centre, dirVector(a), along), dirVector(b), shopFrontOffset + SHOP_FRONT);
      const heading = dirHeading(opposite(b));
      return {
        kind: 'cornerShop',
        options: { signColor: random.pick(SHOP_SIGNS), wallColor: random.pick(Object.values(PALETTE.wall)) },
        x: centre.x,
        z: centre.z,
        y: 0,
        heading,
        footprint: placedRect(centre, heading, -SHOP_WIDTH / 2, SHOP_WIDTH / 2, SHOP_BACK, SHOP_FRONT),
        height: 5.7,
      };
    });
  const shopFits = (shop: SceneryItem): boolean =>
    roadDistance(shop.footprint) >= roadHalf + 1.4 &&
    !inJunction(shop.footprint) &&
    !blocksView(shop.footprint, shop.height) &&
    !overlapsItems(shop.footprint);
  const shopJunctions = network.junctions.filter((j) => j.kind !== 'roundabout');
  for (const junction of shopJunctions) {
    if (!random.chance(p.cornerShopChance)) continue;
    const shop = random.shuffle(shopsAt(junction)).find(shopFits);
    if (shop) items.push(shop);
  }
  if (!items.some((i) => i.kind === 'cornerShop')) {
    const first = shopJunctions.flatMap(shopsAt).find(shopFits);
    if (first) items.push(first);
  }

  // 2. Bus stops on the longest straight stretches.
  const longest = [...stretches].sort((a, b) => b.to - b.from - (a.to - a.from) || a.road.id - b.road.id);
  let stops = 0;
  for (const st of longest) {
    if (stops >= p.busStops) break;
    if (items.some((i) => i.kind === 'busStop' && distance(i, pointAt(st.road.centreline, (st.from + st.to) / 2)) < 150)) continue;
    const { point, facing } = at(st, (st.from + st.to) / 2, roadHalf + 1.9);
    const stop: SceneryItem = { kind: 'busStop', x: point.x, z: point.z, y: 0, heading: facing, footprint: placedRect(point, facing, -1.6, 2.1, -0.8, 0.8), height: 2.85 };
    const bin = offsetItem(stop, -2.4, 0.2, { kind: 'bin' }, 0.35, 0.95);
    if (!fitsSmall(stop, roadHalf + 0.3)) continue;
    items.push(stop);
    if (fitsSmall(bin, roadHalf + 0.3)) items.push(bin);
    stops += 1;
  }

  // 3. Sections, side by side along every straight stretch.
  const sectionOffset = roadHalf + p.vergeWidth + SECTION_DEPTH / 2;
  for (const st of stretches) {
    for (let s = st.from + SECTION_WIDTH / 2; s <= st.to - SECTION_WIDTH / 2; ) {
      const { point, facing } = at(st, s, sectionOffset);
      const footprint = placedRect(point, facing, -SECTION_WIDTH / 2, SECTION_WIDTH / 2, -SECTION_DEPTH / 2, SECTION_DEPTH / 2);
      const fits =
        roadDistance(footprint) >= roadHalf + p.vergeWidth - 0.6 &&
        !inJunction(footprint) &&
        !blocksView(footprint, 10) &&
        !overlapsItems(footprint);
      if (!fits) {
        s += 1;
        continue;
      }
      s += SECTION_WIDTH;
      if (random.chance(p.emptyLotChance)) continue;
      const options = sectionOptions(random);
      const driveway: DrivewayParking = random.chance(p.driveCarChance)
        ? { kind: 'car', car: weighted(random, CAR_TYPES), color: random.pick(Object.values(PALETTE.car)) }
        : random.chance(p.trailerChance)
          ? { kind: 'trailer' }
          : null;
      // The driveway crosses the verge to the road: on the side where the crossing is clear of
      // bus stops and sign posts (if neither is, the driveway just ends at the fence).
      const front = SECTION_DEPTH / 2;
      const crossingAt = (sx: number): SceneryItem =>
        offsetItem({ x: point.x, z: point.z, y: 0, heading: facing, footprint, height: 0 }, sx * 7, front + p.vergeWidth / 2, { kind: 'crossing', width: 3, length: p.vergeWidth }, 1.5, 0.05, p.vergeWidth / 2);
      const crossingFits = (c: SceneryItem): boolean => !overlapsItems(c.footprint) && !nearSign(c.footprint);
      const preferred = options.driveSide === 'left' ? -1 : 1;
      const sx = crossingFits(crossingAt(preferred)) ? preferred : crossingFits(crossingAt(-preferred)) ? -preferred : null;
      if (sx !== null) options.driveSide = sx < 0 ? 'left' : 'right';
      const section: SceneryItem = { kind: 'section', options, driveway, x: point.x, z: point.z, y: 0, heading: facing, footprint, height: 9 };
      items.push(section);
      if (sx === null) continue;
      items.push(crossingAt(sx));
      // Wheelie bins put out by the driveway now and then.
      if (random.chance(p.wheelieBinChance)) {
        const bins = offsetItem(section, sx * 4.4, front + 0.9, { kind: 'wheelieBins', count: random.chance(0.6) ? 2 : 1 }, 0.75, 1.06, 0.4);
        if (!overlapsItems(bins.footprint) && !nearSign(bins.footprint) && !nearKeepClear(bins.footprint)) items.push(bins);
      }
    }
  }

  // 4. Street lights on one side of each road, power poles on the other, trees and hydrants.
  const lightSide = new Map<number, 1 | -1>();
  for (const road of network.roads) lightSide.set(road.id, random.chance(0.5) ? 1 : -1);
  const tryPlace = (item: SceneryItem): boolean => {
    if (!fitsSmall(item, roadHalf + 0.25)) return false;
    items.push(item);
    return true;
  };
  for (const st of stretches) {
    const lights = lightSide.get(st.road.id) === st.side;
    const spacing = lights ? p.streetLightSpacing : p.powerPoleSpacing;
    for (let s = st.from + random.range(2, spacing); s < st.to - 2; s += spacing) {
      for (const shift of [0, 3, -3, 6]) {
        const { point, facing } = at(st, s + shift, roadHalf + 0.9);
        const base = { x: point.x, z: point.z, y: 0, heading: facing, footprint: placedRect(point, facing, -0.25, 0.25, -0.25, 0.25) };
        const item: SceneryItem = lights ? { ...base, kind: 'streetLight', height: 8 } : { ...base, kind: 'powerPole', height: 10 };
        if (tryPlace(item)) break;
      }
    }
    for (let s = st.from + random.range(4, p.vergeTreeSpacing); s < st.to - 4; s += p.vergeTreeSpacing) {
      if (!random.chance(p.vergeTreeChance)) continue;
      const tree = weighted(random, VERGE_TREES);
      const treeHeight = tree === 'deciduous' ? random.range(6, 8) : tree === 'cabbage' ? random.range(4.5, 6) : random.range(5.5, 7);
      const crown = tree === 'pohutukawa' ? 0.7 * treeHeight : tree === 'deciduous' ? 0.4 * treeHeight : 1.3;
      const { point, facing } = at(st, s, roadHalf + p.vergeWidth / 2);
      tryPlace({
        kind: 'tree',
        tree,
        treeHeight,
        x: point.x,
        z: point.z,
        y: 0,
        heading: random.range(-Math.PI, Math.PI),
        footprint: placedRect(point, facing, -0.6, 0.6, -0.6, 0.6),
        canopy: placedRect(point, facing, -crown, crown, -crown, crown),
        height: treeHeight,
      });
    }
    for (let s = st.from + random.range(5, p.hydrantSpacing); s < st.to - 5; s += p.hydrantSpacing) {
      const { point, facing } = at(st, s, roadHalf + 0.5);
      tryPlace({ kind: 'hydrant', x: point.x, z: point.z, y: 0, heading: facing, footprint: placedRect(point, facing, -0.15, 0.15, -0.15, 0.15), height: 0.66 });
    }
  }

  // 5. Cars parked by the kerb on some streets the route does not use.
  for (const road of network.roads) {
    if (avoid.routeRoads.has(road.id) || !random.chance(p.parkedStreetChance)) continue;
    for (const laneId of [road.forwardLane, road.backwardLane]) {
      const lane = network.lanes[laneId];
      if (!lane) continue;
      const count = random.int(0, p.maxParkedPerStreet);
      for (let n = 0; n < count; n++) {
        const car = weighted(random, CAR_TYPES);
        const size = CAR_SIZES[car];
        const s = random.range(p.parkedFromJunction, lane.path.length - p.parkedFromJunction);
        if (s <= p.parkedFromJunction) continue;
        const pose = pointAt(lane.path, s);
        const sideways = params.laneWidth / 2 + params.shoulderWidth - params.start.kerbGap - size.width / 2;
        const centre = add(pose, leftOf(pose.heading), sideways);
        const item: SceneryItem = {
          kind: 'car',
          car,
          color: random.pick(Object.values(PALETTE.car)),
          x: centre.x,
          z: centre.z,
          y: 0,
          heading: pose.heading,
          footprint: placedRect(centre, pose.heading, -size.width / 2, size.width / 2, -size.length / 2 - 0.6, size.length / 2 + 0.6),
          height: 1.5,
        };
        // The kerb must run straight here (not a bend), and the car stays clear of driveways too.
        const straight = Math.abs(normalizeAngle(pointAt(lane.path, s + 3).heading - pointAt(lane.path, s - 3).heading)) < 1e-6;
        if (straight && fitsSmall(item, null)) items.push(item);
      }
    }
  }

  // 6. Low shrubs on roundabout islands.
  for (const junction of network.junctions) {
    if (junction.kind !== 'roundabout') continue;
    const start = random.range(0, Math.PI * 2);
    for (let i = 0; i < p.islandShrubs; i++) {
      const angle = start + (i / p.islandShrubs) * Math.PI * 2;
      const r = params.roundabout.islandRadius * 0.55;
      const point = add(junction.centre, { x: Math.sin(angle), z: Math.cos(angle) }, r);
      const size = random.range(0.7, 1.0);
      items.push({ kind: 'shrub', size, x: point.x, z: point.z, y: 0.18, heading: random.range(-Math.PI, Math.PI), footprint: placedRect(point, 0, -0.8, 0.8, -0.8, 0.8), height: size + 0.18 });
    }
  }

  return { items, sightTriangles, signCorridors };
}

/** The triangle between each two neighbouring arms of a junction, `leg` metres along each from the middle. */
export function buildSightTriangles(network: RoadNetwork, leg: number): Vec2[][] {
  const triangles: Vec2[][] = [];
  for (const junction of network.junctions) {
    for (const [a, b] of adjacentArms(junction)) {
      triangles.push([junction.centre, add(junction.centre, dirVector(a), leg), add(junction.centre, dirVector(b), leg)]);
    }
  }
  return triangles;
}

/** Pairs of arms at right angles to each other. */
function adjacentArms(junction: Junction): [0 | 1 | 2 | 3, 0 | 1 | 2 | 3][] {
  const dirs = junction.arms.map((arm) => arm.dir);
  const pairs: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3][] = [];
  for (const a of dirs) {
    const b = ((a + 1) % 4) as 0 | 1 | 2 | 3;
    if (dirs.includes(b)) pairs.push([a, b]);
  }
  return pairs;
}

/** Straight pieces of every road, each side separately. */
function straightStretches(network: RoadNetwork): Stretch[] {
  const list: Stretch[] = [];
  for (const road of network.roads) {
    let s = 0;
    for (const piece of road.centreline.pieces) {
      if (piece.kind === 'line') {
        for (const side of [1, -1] as const) list.push({ road, side, from: s, to: s + piece.length });
      }
      s += piece.length;
    }
  }
  return list;
}

function sectionOptions(random: Random): SectionOptions {
  const houseType = weighted(random, HOUSE_TYPES);
  const fenceType = weighted(random, FENCES);
  const wallColor = random.pick(Object.values(PALETTE.wall));
  const roofColor = random.pick(Object.values(PALETTE.roof));
  const doorColor = random.pick(Object.values(PALETTE.door));
  const trees = random.int(0, 3);
  const treeKinds = Array.from({ length: 3 }, () => random.pick(GARDEN_TREES));
  return {
    houseType,
    house: {
      wallColor,
      roofColor,
      doorColor,
      hasChimney: random.chance(0.6),
      plinth: random.chance(0.3) ? 'brick' : 'concrete',
      verandaRailing: random.chance(0.7),
      roofType: random.chance(0.3) ? 'mono' : 'gable',
      brickLower: random.chance(0.3),
    },
    fenceType,
    fenceColor: random.chance(0.7) ? 0xf7f7f2 : wallColor,
    trees,
    treeKinds,
    clothesline: random.chance(0.6),
    garage: random.pick(['garage', 'carport', 'none'] as const),
    driveSide: random.chance(0.5) ? 'left' : 'right',
    letterbox: { style: random.pick(['box', 'house', 'drum'] as const), color: random.pick(LETTERBOX_COLOURS) },
    shrubs: random.chance(0.7),
  };
}

/** An item placed in another one's own coordinates (x across, z towards the road), facing the same way. */
function offsetItem(
  parent: Placement,
  x: number,
  z: number,
  model: { kind: 'bin' } | { kind: 'crossing'; width: number; length: number } | { kind: 'wheelieBins'; count: 1 | 2 },
  halfWidth: number,
  height: number,
  halfDepth = halfWidth,
): SceneryItem {
  const centre = add(add(parent, leftOf(parent.heading), x), forward(parent.heading), z);
  return {
    ...model,
    x: centre.x,
    z: centre.z,
    y: 0,
    heading: parent.heading,
    footprint: placedRect(centre, parent.heading, -halfWidth, halfWidth, -halfDepth, halfDepth),
    height,
  } as SceneryItem;
}

function weighted<T>(random: Random, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let r = random.next() * total;
  for (const [value, w] of options) {
    r -= w;
    if (r < 0) return value;
  }
  return (options[options.length - 1] as readonly [T, number])[0];
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function polyBox(poly: readonly Vec2[]): Box {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function pathBox(road: Road, margin: number): Box {
  const points = [];
  for (let s = 0; s <= road.centreline.length; s += 5) points.push(pointAt(road.centreline, s));
  points.push(pointAt(road.centreline, road.centreline.length));
  const box = polyBox(points);
  return { minX: box.minX - margin, maxX: box.maxX + margin, minZ: box.minZ - margin, maxZ: box.maxZ + margin };
}
