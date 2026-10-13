import { CONFIG, type WorldParams } from '../config';
import { normalizeAngle } from '../util/math';
import { createRandom, type Random } from '../util/random';
import type { Vec2 } from './path';

// The plan of the town on a square grid of tiles, before any exact geometry: which tiles are
// linked by a road, what each tile is (straight, bend, T, cross, roundabout), which roads are main
// roads, who gives way at each junction and the speed limit of each street. Pure data, no Three.js.

/**
 * Grid directions, in the order of left turns: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X.
 * Travelling along `d`, a left turn leads to d + 1 and a right turn to d + 3 (mod 4).
 */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly Dir[] = [0, 1, 2, 3];

const DIR_X = [0, 1, 0, -1] as const;
const DIR_Z = [1, 0, -1, 0] as const;

export function dirVector(d: Dir): Vec2 {
  return { x: DIR_X[d], z: DIR_Z[d] };
}

/** Heading of travel along a grid direction (same convention as the car). */
export function dirHeading(d: Dir): number {
  return normalizeAngle((d * Math.PI) / 2);
}

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

export function leftTurnOf(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}

export function rightTurnOf(d: Dir): Dir {
  return ((d + 3) % 4) as Dir;
}

export type TileKind = 'straight' | 'bend' | 'tee' | 'cross' | 'roundabout';
export type RoadClass = 'main' | 'minor';
/** What traffic arriving at a junction along an arm must do. */
export type Control = 'none' | 'stop' | 'giveWay' | 'roundabout';

export function isJunctionKind(kind: TileKind): boolean {
  return kind === 'tee' || kind === 'cross' || kind === 'roundabout';
}

export interface LayoutTile {
  index: number;
  col: number;
  row: number;
  /** Which sides have a road, by direction. */
  arms: readonly boolean[];
  kind: TileKind;
  /** Junctions only: what traffic arriving along each arm must do ('none' = it has priority, or no arm). */
  controls: readonly Control[];
}

/** A road between two neighbouring tiles. */
export interface LayoutLink {
  /** Tile indices; `dir` leads from `a` to `b`. */
  a: number;
  b: number;
  dir: Dir;
  roadClass: RoadClass;
  /** Index into `mainRoads`, or null for a side street. */
  mainRoad: number | null;
}

/** A main road runs straight across the whole town along one row or column of tiles. */
export interface MainRoad {
  axis: 'row' | 'col';
  index: number;
}

/** A stretch of road from one junction to the next, through any straights and bends between. */
export interface Street {
  /** Tile indices from junction to junction. Both ends are junctions (possibly the same one). */
  tiles: readonly number[];
  /** Direction of travel from each tile to the next (one fewer than tiles). */
  dirs: readonly Dir[];
  /** Indices into `links`, in order. */
  links: readonly number[];
  roadClass: RoadClass;
  /** km/h. */
  speedLimit: number;
}

export interface Layout {
  seed: string;
  /** 0 when the seed worked first time; otherwise how many times it was retried (see generateLayout). */
  attempt: number;
  tilesPerSide: number;
  tileSize: number;
  tiles: readonly LayoutTile[];
  links: readonly LayoutLink[];
  mainRoads: readonly MainRoad[];
  streets: readonly Street[];
}

/** Middle of a tile in world coordinates. The town is centred on the origin. */
export function tileCentre(layout: Pick<Layout, 'tilesPerSide' | 'tileSize'>, tile: number): Vec2 {
  const n = layout.tilesPerSide;
  const col = tile % n;
  const row = Math.floor(tile / n);
  return { x: (col - (n - 1) / 2) * layout.tileSize, z: (row - (n - 1) / 2) * layout.tileSize };
}

/** The tile next to `tile` in direction `d`, or null at the edge of the town. */
export function neighbour(tilesPerSide: number, tile: number, d: Dir): number | null {
  const col = (tile % tilesPerSide) + DIR_X[d];
  const row = Math.floor(tile / tilesPerSide) + DIR_Z[d];
  if (col < 0 || row < 0 || col >= tilesPerSide || row >= tilesPerSide) return null;
  return row * tilesPerSide + col;
}

/**
 * Builds the town plan for a seed. If the result misses the minimums (enough T and cross
 * junctions, at least one Stop and one Give Way), it tries again with "seed#1", "seed#2", ...
 * so the same seed always ends with the same town.
 */
export function generateLayout(seed: string, params: WorldParams = CONFIG.world): Layout {
  for (let attempt = 0; attempt < params.generation.maxAttempts; attempt++) {
    const random = createRandom(attempt === 0 ? seed : `${seed}#${attempt}`);
    const layout = tryLayout(seed, attempt, random, params);
    if (layout) return layout;
  }
  throw new Error(`No usable town for seed "${seed}"`);
}

interface Draft {
  n: number;
  /** arms[tile][dir] */
  arms: boolean[][];
}

function tryLayout(seed: string, attempt: number, random: Random, params: WorldParams): Layout | null {
  const n = params.tilesPerSide;
  const gen = params.generation;
  const tileCount = n * n;

  // 1. Main roads: one row and one column across the town, sometimes a third road parallel to one of them.
  const interior = Array.from({ length: n - 2 }, (_, i) => i + 1);
  const mainRoads: MainRoad[] = [
    { axis: 'row', index: random.pick(interior) },
    { axis: 'col', index: random.pick(interior) },
  ];
  if (random.chance(gen.extraMainRoadChance)) {
    const options: MainRoad[] = [];
    for (const axis of ['row', 'col'] as const) {
      for (const index of interior) {
        const farEnough = mainRoads.every((road) => road.axis !== axis || Math.abs(road.index - index) >= 2);
        if (farEnough) options.push({ axis, index });
      }
    }
    if (options.length > 0) mainRoads.push(random.pick(options));
  }

  // 2. Start with every possible link, then remove side-street links at random while the town
  //    stays connected and no tile is left with a single road (a dead end).
  const draft: Draft = {
    n,
    arms: Array.from({ length: tileCount }, (_, tile) => DIRS.map((d) => neighbour(n, tile, d) !== null)),
  };
  const mainRoadOfLink = (a: number, d: Dir): number | null => {
    const index = mainRoads.findIndex((road) =>
      road.axis === 'row'
        ? (d === 1 || d === 3) && Math.floor(a / n) === road.index
        : (d === 0 || d === 2) && a % n === road.index,
    );
    return index >= 0 ? index : null;
  };
  const minorLinks: { a: number; d: Dir }[] = [];
  for (let tile = 0; tile < tileCount; tile++) {
    for (const d of [0, 1] as const) {
      if (draft.arms[tile]?.[d] && mainRoadOfLink(tile, d) === null) minorLinks.push({ a: tile, d });
    }
  }
  const toRemove = Math.round(minorLinks.length * random.range(gen.minRemovedShare, gen.maxRemovedShare));
  let removed = 0;
  for (const { a, d } of random.shuffle(minorLinks)) {
    if (removed >= toRemove) break;
    const b = neighbour(n, a, d);
    if (b === null || degree(draft, a) < 3 || degree(draft, b) < 3) continue;
    setLink(draft, a, d, false);
    if (isConnected(draft)) removed += 1;
    else setLink(draft, a, d, true);
  }

  // 3. What each tile is.
  const kinds: TileKind[] = [];
  for (let tile = 0; tile < tileCount; tile++) {
    const arms = draft.arms[tile] ?? [];
    const count = arms.filter(Boolean).length;
    if (count === 2) kinds.push(arms[0] === arms[2] ? 'straight' : 'bend');
    else if (count === 3) kinds.push('tee');
    else if (count === 4) kinds.push('cross');
    else return null; // cannot happen: no tile ever drops below two roads
  }
  // Where two main roads cross there is always a roundabout; sometimes a side-street crossing gets one too.
  for (const row of mainRoads.filter((road) => road.axis === 'row')) {
    for (const col of mainRoads.filter((road) => road.axis === 'col')) kinds[row.index * n + col.index] = 'roundabout';
  }
  const isMainArm = (tile: number, d: Dir): boolean => {
    const other = neighbour(n, tile, d);
    if (other === null || !draft.arms[tile]?.[d]) return false;
    return d === 0 || d === 1 ? mainRoadOfLink(tile, d) !== null : mainRoadOfLink(other, opposite(d)) !== null;
  };
  const quietCrosses = kinds
    .map((kind, tile) => ({ kind, tile }))
    .filter(({ kind, tile }) => kind === 'cross' && DIRS.every((d) => !isMainArm(tile, d)));
  if (quietCrosses.length > 0 && random.chance(gen.extraRoundaboutChance)) {
    kinds[random.pick(quietCrosses).tile] = 'roundabout';
  }

  // 4. Who gives way. The main road always has priority; at a T the stem gives way; where two
  //    side streets cross, one of them is picked as the priority road.
  const controls: Control[][] = kinds.map(() => ['none', 'none', 'none', 'none']);
  const controlled: number[] = [];
  for (let tile = 0; tile < tileCount; tile++) {
    const arms = draft.arms[tile] ?? [];
    const tileControls = controls[tile] ?? [];
    const kind = kinds[tile];
    const signType = (): Control => (random.chance(gen.stopChance) ? 'stop' : 'giveWay');
    if (kind === 'roundabout') {
      for (const d of DIRS) if (arms[d]) tileControls[d] = 'roundabout';
    } else if (kind === 'tee') {
      const stem = DIRS.find((d) => arms[d] && !arms[opposite(d)]);
      if (stem === undefined) return null;
      tileControls[stem] = signType();
      controlled.push(tile);
    } else if (kind === 'cross') {
      const pairIsMain = (d: Dir): boolean => isMainArm(tile, d) || isMainArm(tile, opposite(d));
      const yielding: Dir = pairIsMain(0) ? 1 : pairIsMain(1) ? 0 : random.pick([0, 1] as const);
      const control = signType();
      tileControls[yielding] = control;
      tileControls[opposite(yielding)] = control;
      controlled.push(tile);
    }
  }
  // Every map has at least one Stop and at least one Give Way junction.
  const hasControl = (tile: number, control: Control): boolean => (controls[tile] ?? []).includes(control);
  const switchJunction = (tile: number, to: Control): void => {
    const tileControls = controls[tile] ?? [];
    for (const d of DIRS) if (tileControls[d] !== 'none') tileControls[d] = to;
  };
  if (controlled.length < 2) return null;
  if (!controlled.some((tile) => hasControl(tile, 'stop'))) switchJunction(random.pick(controlled), 'stop');
  if (!controlled.some((tile) => hasControl(tile, 'giveWay'))) switchJunction(random.pick(controlled), 'giveWay');

  const tiles: LayoutTile[] = kinds.map((kind, index) => ({
    index,
    col: index % n,
    row: Math.floor(index / n),
    arms: [...(draft.arms[index] ?? [])],
    kind,
    controls: [...(controls[index] ?? [])],
  }));

  const tees = tiles.filter((tile) => tile.kind === 'tee').length;
  const crosses = tiles.filter((tile) => tile.kind === 'cross').length;
  if (tees < gen.minTees || crosses < gen.minCrosses) return null;

  // 5. Links and streets.
  const links: LayoutLink[] = [];
  const linkIndex = new Map<string, number>();
  for (let tile = 0; tile < tileCount; tile++) {
    for (const d of [0, 1] as const) {
      const other = neighbour(n, tile, d);
      if (other === null || !draft.arms[tile]?.[d]) continue;
      const mainRoad = mainRoadOfLink(tile, d);
      linkIndex.set(linkKey(tile, other), links.length);
      links.push({ a: tile, b: other, dir: d, roadClass: mainRoad === null ? 'minor' : 'main', mainRoad });
    }
  }
  const streets = traceStreets(tiles, links, linkIndex, n);

  // 6. Speed limits: usually the normal limit; sometimes one main road is faster and one side street slower.
  const limits = streets.map(() => params.speedLimits.normal);
  if (random.chance(gen.fastMainRoadChance)) {
    const fast = random.int(0, mainRoads.length - 1);
    streets.forEach((street, i) => {
      if (street.links.some((link) => links[link]?.mainRoad === fast)) limits[i] = params.speedLimits.fastMainRoad;
    });
  }
  if (random.chance(gen.slowStreetChance)) {
    const quiet = streets
      .map((street, i) => ({ street, i }))
      .filter(({ street, i }) => street.roadClass === 'minor' && limits[i] === params.speedLimits.normal);
    if (quiet.length > 0) limits[random.pick(quiet).i] = params.speedLimits.slowStreet;
  }

  return {
    seed,
    attempt,
    tilesPerSide: n,
    tileSize: params.tileSize,
    tiles,
    links,
    mainRoads,
    streets: streets.map((street, i) => ({ ...street, speedLimit: limits[i] ?? params.speedLimits.normal })),
  };
}

function traceStreets(
  tiles: readonly LayoutTile[],
  links: readonly LayoutLink[],
  linkIndex: ReadonlyMap<string, number>,
  n: number,
): Omit<Street, 'speedLimit'>[] {
  const streets: Omit<Street, 'speedLimit'>[] = [];
  const used = new Set<number>();
  for (const start of tiles) {
    if (!isJunctionKind(start.kind)) continue;
    for (const firstDir of DIRS) {
      if (!start.arms[firstDir]) continue;
      const path: number[] = [start.index];
      const dirs: Dir[] = [];
      const streetLinks: number[] = [];
      let tile = start.index;
      let d: Dir = firstDir;
      for (;;) {
        const next = neighbour(n, tile, d);
        if (next === null) throw new Error('A road leads off the map');
        const link = linkIndex.get(linkKey(tile, next));
        if (link === undefined) throw new Error('Missing link');
        if (streetLinks.length === 0 && used.has(link)) break;
        used.add(link);
        streetLinks.push(link);
        path.push(next);
        dirs.push(d);
        const nextTile = tiles[next];
        if (!nextTile || isJunctionKind(nextTile.kind)) break;
        // Straight on, or round the bend: the one other arm of this tile.
        const back = opposite(d);
        const onward = DIRS.find((other) => other !== back && nextTile.arms[other]);
        if (onward === undefined) throw new Error('Dead end');
        tile = next;
        d = onward;
      }
      if (streetLinks.length === 0) continue;
      const roadClass = streetLinks.some((link) => links[link]?.roadClass === 'main') ? 'main' : 'minor';
      streets.push({ tiles: path, dirs, links: streetLinks, roadClass });
    }
  }
  return streets;
}

function linkKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function degree(draft: Draft, tile: number): number {
  return (draft.arms[tile] ?? []).filter(Boolean).length;
}

function setLink(draft: Draft, a: number, d: Dir, present: boolean): void {
  const b = neighbour(draft.n, a, d);
  if (b === null) return;
  const armsA = draft.arms[a];
  const armsB = draft.arms[b];
  if (armsA) armsA[d] = present;
  if (armsB) armsB[opposite(d)] = present;
}

function isConnected(draft: Draft): boolean {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const tile = queue.pop() as number;
    for (const d of DIRS) {
      if (!draft.arms[tile]?.[d]) continue;
      const other = neighbour(draft.n, tile, d);
      if (other !== null && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen.size === draft.n * draft.n;
}
