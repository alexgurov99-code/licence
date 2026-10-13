import { CONFIG, type WorldParams } from '../config';
import { normalizeAngle } from '../util/math';
import { createRandom, type Random } from '../util/random';
import {
  dirHeading,
  dirVector,
  generateLayout,
  isJunctionKind,
  leftTurnOf,
  opposite,
  rightTurnOf,
  tileCentre,
  type Control,
  type Dir,
  type Layout,
  type RoadClass,
  type Street,
} from './layout';
import {
  add,
  arc,
  arcFrom,
  distance,
  forward,
  leftOf,
  line,
  makePath,
  offsetPath,
  pathEnd,
  pathStart,
  pointAt,
  reversePath,
  samplePath,
  type Path,
  type PathPiece,
  type Pose,
  type Vec2,
} from './path';

// The road network as exact geometry, built from the town plan (layout.ts): roads and their
// lanes, the paths a car follows through each junction, limit lines, signs, road markings,
// and the start position (houses and the rest of the scenery: scenery.ts). Pure data, no Three.js: the route (stage 4) and the rules
// engine (stage 5) read it, and worldMesh.ts draws it.

export type JunctionKind = 'tee' | 'cross' | 'roundabout';

export interface JunctionArm {
  dir: Dir;
  roadId: number;
  /** Class of the road right at the junction. */
  roadClass: RoadClass;
  /** The lane arriving at the junction along this arm, and the lane leaving along it. */
  inLane: number;
  outLane: number;
  /** What traffic arriving along this arm must do. */
  control: Control;
}

export interface Junction {
  id: number;
  tile: number;
  kind: JunctionKind;
  centre: Vec2;
  /** Lanes end this far from the centre: half the side of the square for T and cross junctions, a radius for roundabouts. */
  size: number;
  arms: readonly JunctionArm[];
}

export interface Road {
  id: number;
  roadClass: RoadClass;
  /** km/h. */
  speedLimit: number;
  /** The middle of the road (the centre line), from the start junction to the end junction. */
  centreline: Path;
  /** The lane driven along the centreline's direction, and the one driven the other way. */
  forwardLane: number;
  backwardLane: number;
  startJunction: number;
  endJunction: number;
}

export interface Lane {
  id: number;
  roadId: number;
  forward: boolean;
  /** Middle of the lane in the direction of travel. */
  path: Path;
  speedLimit: number;
  fromJunction: number;
  toJunction: number;
  /** What the driver must do at the junction at the end of the lane. */
  control: Control;
}

export type Turn = 'left' | 'straight' | 'right' | 'uTurn';

/** A path through a junction from the end of one lane to the start of another. */
export interface Connector {
  id: number;
  junctionId: number;
  fromLane: number;
  toLane: number;
  turn: Turn;
  /** Roundabouts only: 1 = first exit, 2 = second, ...; the last one is a U-turn. */
  exit: number | null;
  path: Path;
}

/** The line drivers stop behind at a Stop or Give Way. */
export interface LimitLine {
  laneId: number;
  junctionId: number;
  kind: 'stop' | 'giveWay';
  /** Ends of the line's front edge (the edge nearest the junction), across the lane. */
  a: Vec2;
  b: Vec2;
  /** Direction of travel of the drivers it is for. */
  heading: number;
  /** Distance from the start of the lane to the front edge, following the lane and then the junction path. */
  s: number;
}

export type SignKind = 'stop' | 'giveWay' | 'roundaboutGiveWay' | 'speedLimit';

export interface Sign {
  kind: SignKind;
  /** Speed limit signs: km/h. */
  speedLimit: number | null;
  /** Foot of the post. */
  x: number;
  z: number;
  /** Direction the face looks: towards the drivers it is for (their heading + PI). */
  facing: number;
  /** The lane whose drivers the sign is for, and which side of their road it stands on. */
  laneId: number;
  side: 'left' | 'right';
}

export type MarkingColour = 'white' | 'yellow';

/** A flat painted patch on the road (one piece of a line). */
export interface Marking {
  colour: MarkingColour;
  corners: readonly [Vec2, Vec2, Vec2, Vec2];
}

/** The word STOP or a give-way triangle painted on a lane before the limit line. */
export interface RoadSymbol {
  kind: 'stopText' | 'giveWayTriangle';
  x: number;
  z: number;
  /** Direction of travel of the drivers who read it. */
  heading: number;
  /** Size along and across the lane. */
  length: number;
  width: number;
  laneId: number;
}

export interface StartPosition extends Pose {
  laneId: number;
}

export interface RoadNetwork {
  seed: string;
  layout: Layout;
  /** The town is a square of this side, centred on the origin. */
  size: number;
  junctions: readonly Junction[];
  roads: readonly Road[];
  lanes: readonly Lane[];
  connectors: readonly Connector[];
  limitLines: readonly LimitLine[];
  signs: readonly Sign[];
  markings: readonly Marking[];
  symbols: readonly RoadSymbol[];
  start: StartPosition;
}

/** Everything about the town for a seed. The same seed always gives the same network. */
export function buildNetwork(
  seed: string,
  params: WorldParams = CONFIG.world,
  carWidth: number = CONFIG.vehicle.width,
): RoadNetwork {
  const layout = generateLayout(seed, params);
  const random = createRandom(`${seed}/details`);
  const half = params.laneWidth / 2;

  // Junctions first, so roads can say where they start and end.
  const junctionOfTile = new Map<number, number>();
  const junctionDrafts: { id: number; tile: number; kind: JunctionKind; centre: Vec2; size: number }[] = [];
  for (const tile of layout.tiles) {
    if (!isJunctionKind(tile.kind)) continue;
    const kind = tile.kind as JunctionKind;
    junctionOfTile.set(tile.index, junctionDrafts.length);
    junctionDrafts.push({
      id: junctionDrafts.length,
      tile: tile.index,
      kind,
      centre: tileCentre(layout, tile.index),
      size: kind === 'roundabout' ? params.roundabout.approachRadius : params.junctionHalfSize,
    });
  }
  const junctionAt = (tile: number): (typeof junctionDrafts)[number] => {
    const id = junctionOfTile.get(tile);
    const junction = id === undefined ? undefined : junctionDrafts[id];
    if (!junction) throw new Error(`Tile ${tile} is not a junction`);
    return junction;
  };

  // Roads and lanes. The forward lane drives along the centreline, the backward lane the other
  // way; each lane is half a lane width to the left of the centre line in its own direction.
  const roads: Road[] = [];
  const lanes: Lane[] = [];
  const arms = new Map<number, JunctionArm[]>();
  const addArm = (junctionId: number, arm: JunctionArm): void => {
    const list = arms.get(junctionId) ?? [];
    list.push(arm);
    arms.set(junctionId, list);
  };
  layout.streets.forEach((street, id) => {
    const first = street.tiles[0] as number;
    const last = street.tiles[street.tiles.length - 1] as number;
    const startJunction = junctionAt(first);
    const endJunction = junctionAt(last);
    const startArm = street.dirs[0] as Dir;
    const endArm = opposite(street.dirs[street.dirs.length - 1] as Dir);
    const centreline = streetCentreline(street, layout, startJunction.size, endJunction.size, params.bendRadius);
    const controlAt = (tile: number, d: Dir): Control => layout.tiles[tile]?.controls[d] ?? 'none';
    const forwardLane = lanes.length;
    const backwardLane = forwardLane + 1;
    lanes.push({
      id: forwardLane,
      roadId: id,
      forward: true,
      path: offsetPath(centreline, half),
      speedLimit: street.speedLimit,
      fromJunction: startJunction.id,
      toJunction: endJunction.id,
      control: controlAt(last, endArm),
    });
    lanes.push({
      id: backwardLane,
      roadId: id,
      forward: false,
      path: offsetPath(reversePath(centreline), half),
      speedLimit: street.speedLimit,
      fromJunction: endJunction.id,
      toJunction: startJunction.id,
      control: controlAt(first, startArm),
    });
    roads.push({
      id,
      roadClass: street.roadClass,
      speedLimit: street.speedLimit,
      centreline,
      forwardLane,
      backwardLane,
      startJunction: startJunction.id,
      endJunction: endJunction.id,
    });
    const linkClass = (link: number | undefined): RoadClass =>
      (link === undefined ? undefined : layout.links[link]?.roadClass) ?? street.roadClass;
    addArm(startJunction.id, {
      dir: startArm,
      roadId: id,
      roadClass: linkClass(street.links[0]),
      inLane: backwardLane,
      outLane: forwardLane,
      control: controlAt(first, startArm),
    });
    addArm(endJunction.id, {
      dir: endArm,
      roadId: id,
      roadClass: linkClass(street.links[street.links.length - 1]),
      inLane: forwardLane,
      outLane: backwardLane,
      control: controlAt(last, endArm),
    });
  });
  const junctions: Junction[] = junctionDrafts.map((draft) => ({
    ...draft,
    arms: (arms.get(draft.id) ?? []).sort((a, b) => a.dir - b.dir),
  }));

  const lane = (id: number): Lane => {
    const found = lanes[id];
    if (!found) throw new Error(`No lane ${id}`);
    return found;
  };

  // Paths through junctions.
  const connectors: Connector[] = [];
  for (const junction of junctions) {
    for (const from of junction.arms) {
      for (const to of junction.arms) {
        const turn = turnBetween(from.dir, to.dir);
        if (turn === 'uTurn' && junction.kind !== 'roundabout') continue;
        const path =
          junction.kind === 'roundabout'
            ? roundaboutPath(junction, from.dir, to.dir, lane(from.inLane).path, lane(to.outLane).path, params)
            : junctionPath(lane(from.inLane).path, turn, junction.size, half);
        const gap = distance(pathEnd(path), pathStart(lane(to.outLane).path));
        if (gap > 1e-6) throw new Error(`Junction path does not meet its lane (gap ${gap} m)`);
        connectors.push({
          id: connectors.length,
          junctionId: junction.id,
          fromLane: from.inLane,
          toLane: to.outLane,
          turn,
          exit: junction.kind === 'roundabout' ? roundaboutExit(junction, from.dir, to.dir) : null,
          path,
        });
      }
    }
  }

  // Limit lines, Stop / Give Way signs and the painted symbols before them.
  const roadHalfWidth = params.laneWidth + params.shoulderWidth;
  const limitLines: LimitLine[] = [];
  const signs: Sign[] = [];
  const symbols: RoadSymbol[] = [];
  const signAt = (laneId: number, s: number, side: 'left' | 'right', kind: SignKind, speedLimit: number | null): Sign => {
    const pose = pointAt(lane(laneId).path, s);
    // Sideways from the middle of the lane: the left verge is just past this lane's shoulder; the
    // right verge is across the other lane and its shoulder.
    const sideways = side === 'left' ? roadHalfWidth - half + params.signs.verge : -(roadHalfWidth + half + params.signs.verge);
    const foot = add(pose, leftOf(pose.heading), sideways);
    return { kind, speedLimit, x: foot.x, z: foot.z, facing: normalizeAngle(pose.heading + Math.PI), laneId, side };
  };
  for (const junction of junctions) {
    for (const arm of junction.arms) {
      if (arm.control === 'none') continue;
      const approach = lane(arm.inLane);
      const kind = arm.control === 'stop' ? 'stop' : 'giveWay';
      const limitLine =
        junction.kind === 'roundabout'
          ? roundaboutLimitLine(junction, approach, connectors, params)
          : laneEndLimitLine(junction, approach, half);
      limitLines.push({ ...limitLine, kind });
      const signKind: SignKind =
        arm.control === 'roundabout' ? 'roundaboutGiveWay' : arm.control === 'stop' ? 'stop' : 'giveWay';
      const signS = Math.min(approach.path.length, limitLine.s - params.signs.beforeLimitLine);
      signs.push(signAt(approach.id, signS, 'left', signKind, null));
      const symbolS = limitLine.s - params.markings.symbolBeforeLimitLine;
      const pose = pointAt(approach.path, symbolS);
      const stop = kind === 'stop';
      symbols.push({
        kind: stop ? 'stopText' : 'giveWayTriangle',
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        length: stop ? params.markings.stopTextLength : params.markings.triangleLength,
        width: stop ? params.markings.stopTextWidth : params.markings.triangleWidth,
        laneId: approach.id,
      });
    }
  }

  // Speed limit signs just after a junction, wherever the limit differs from a road that leads into it.
  for (const junction of junctions) {
    for (const exit of junction.arms) {
      const out = lane(exit.outLane);
      const changes = connectors.some(
        (c) => c.junctionId === junction.id && c.toLane === out.id && lane(c.fromLane).speedLimit !== out.speedLimit,
      );
      if (!changes) continue;
      const s = params.signs.speedSignAfterJunction;
      signs.push(signAt(out.id, s, 'left', 'speedLimit', out.speedLimit));
      // Busier roads get a second sign on the right (NZ: both sides where traffic is heavier).
      if (exit.roadClass === 'main') signs.push(signAt(out.id, s, 'right', 'speedLimit', out.speedLimit));
    }
  }

  const markings = roadMarkings(roads, junctions, limitLines, params);
  const start = startPosition(roads, lanes, random, params, carWidth);

  return {
    seed,
    layout,
    size: layout.tilesPerSide * layout.tileSize,
    junctions,
    roads,
    lanes,
    connectors,
    limitLines,
    signs,
    markings,
    symbols,
    start,
  };
}

/** The centre line of a street: straight across straight tiles, a quarter circle on bend tiles. */
function streetCentreline(
  street: Street,
  layout: Layout,
  startSize: number,
  endSize: number,
  bendRadius: number,
): Path {
  const centre = (tile: number | undefined): Vec2 => tileCentre(layout, tile ?? 0);
  const firstDir = street.dirs[0] as Dir;
  const lastDir = street.dirs[street.dirs.length - 1] as Dir;
  let point = add(centre(street.tiles[0]), dirVector(firstDir), startSize);
  const pieces: PathPiece[] = [];
  for (let i = 1; i < street.tiles.length - 1; i++) {
    const tile = centre(street.tiles[i]);
    const dirIn = street.dirs[i - 1] as Dir;
    const dirOut = street.dirs[i] as Dir;
    if (dirIn === dirOut) continue;
    const bendStart = add(tile, dirVector(dirIn), -bendRadius);
    pieces.push(line(point, bendStart));
    const sweep = dirOut === leftTurnOf(dirIn) ? Math.PI / 2 : -Math.PI / 2;
    pieces.push(arcFrom(bendStart, dirHeading(dirIn), bendRadius, sweep));
    point = add(tile, dirVector(dirOut), bendRadius);
  }
  pieces.push(line(point, add(centre(street.tiles[street.tiles.length - 1]), dirVector(lastDir), -endSize)));
  return makePath(pieces);
}

/** The turn from arriving along arm `from` to leaving along arm `to`. */
export function turnBetween(from: Dir, to: Dir): Turn {
  const travel = opposite(from);
  if (to === travel) return 'straight';
  if (to === leftTurnOf(travel)) return 'left';
  if (to === rightTurnOf(travel)) return 'right';
  return 'uTurn';
}

/** T and cross junctions: a straight line, or a quarter circle that meets both lanes at the edge of the junction square. */
function junctionPath(inLane: Path, turn: Turn, size: number, halfLane: number): Path {
  const end = pathEnd(inLane);
  if (turn === 'straight') return makePath([line(end, add(end, forward(end.heading), size * 2))]);
  if (turn === 'left') return makePath([arcFrom(end, end.heading, size - halfLane, Math.PI / 2)]);
  if (turn === 'right') return makePath([arcFrom(end, end.heading, size + halfLane, -Math.PI / 2)]);
  throw new Error('No U-turns at T and cross junctions');
}

/**
 * Roundabout paths. An entry runs from the end of the approach lane straight on to where a curve
 * to the left starts, and along that curve until it touches the circulating lane; it then goes
 * round clockwise (the island on the driver's right) and leaves along the mirror image of the
 * entry curve onto the exit lane.
 */
function roundaboutPath(junction: Junction, from: Dir, to: Dir, inLane: Path, outLane: Path, params: WorldParams): Path {
  const { laneRadius, entryCurveRadius } = params.roundabout;
  const half = params.laneWidth / 2;
  const along = curveStartDistance(params);
  const angleOf = (p: Vec2): number => Math.atan2(p.x - junction.centre.x, p.z - junction.centre.z);
  // Clockwise travel along the circle at angle `a` heads this way.
  const ringHeading = (a: number): number => a - Math.PI / 2;

  const travelIn = dirHeading(opposite(from));
  const entryStart = add(add(junction.centre, dirVector(from), along), leftOf(travelIn), half);
  const entryCentre = add(entryStart, leftOf(travelIn), entryCurveRadius);
  const entryAngle = angleOf(entryCentre);
  const entryCurve = arcFrom(entryStart, travelIn, entryCurveRadius, normalizeAngle(ringHeading(entryAngle) - travelIn));

  const travelOut = dirHeading(to);
  const exitEnd = add(add(junction.centre, dirVector(to), along), leftOf(travelOut), half);
  const exitAngle = angleOf(add(exitEnd, leftOf(travelOut), entryCurveRadius));
  const exitStart = add(junction.centre, { x: Math.sin(exitAngle), z: Math.cos(exitAngle) }, laneRadius);
  const exitCurve = arcFrom(
    exitStart,
    ringHeading(exitAngle),
    entryCurveRadius,
    normalizeAngle(travelOut - ringHeading(exitAngle)),
  );

  // Clockwise means the angle decreases; a U-turn goes almost all the way round.
  const turned = mod(entryAngle - exitAngle, Math.PI * 2);
  return makePath([
    line(pathEnd(inLane), entryStart),
    entryCurve,
    arc(junction.centre, laneRadius, entryAngle, -turned),
    exitCurve,
    line(exitEnd, pathStart(outLane)),
  ]);
}

/** Distance from the middle of a roundabout, along an arm, to where the curves onto and off the circle begin. */
function curveStartDistance(params: WorldParams): number {
  const { laneRadius, entryCurveRadius, approachRadius } = params.roundabout;
  const half = params.laneWidth / 2;
  const along = Math.sqrt((laneRadius + entryCurveRadius) ** 2 - (half + entryCurveRadius) ** 2);
  if (!(along < approachRadius)) throw new Error('Roundabout approach is too short for its entry curves');
  return along;
}

function roundaboutExit(junction: Junction, from: Dir, to: Dir): number {
  // Clockwise means decreasing direction numbers: the first arm clockwise from `from` is from - 1.
  const steps = (d: Dir): number => (from - d + 4) % 4 || 4;
  return junction.arms.filter((arm) => steps(arm.dir) <= steps(to)).length;
}

function laneEndLimitLine(junction: Junction, approach: Lane, halfLane: number): Omit<LimitLine, 'kind'> {
  const end = pathEnd(approach.path);
  const left = leftOf(end.heading);
  return {
    laneId: approach.id,
    junctionId: junction.id,
    a: add(end, left, halfLane),
    b: add(end, left, -halfLane),
    heading: end.heading,
    s: approach.path.length,
  };
}

/** At a roundabout the give-way line is where the entry curve reaches the edge of the circulating road. */
function roundaboutLimitLine(
  junction: Junction,
  approach: Lane,
  connectors: readonly Connector[],
  params: WorldParams,
): Omit<LimitLine, 'kind'> {
  const path = connectors.find((c) => c.fromLane === approach.id)?.path;
  if (!path) throw new Error('Roundabout entry without a path');
  const radius = params.roundabout.outerRadius + params.markings.lineWidth;
  // The entry gets steadily closer to the middle until it joins the circle: halve the interval.
  let lo = 0;
  let hi = path.length;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (distance(pointAt(path, mid), junction.centre) > radius) lo = mid;
    else hi = mid;
  }
  const pose = pointAt(path, lo);
  const left = leftOf(pose.heading);
  const half = params.laneWidth / 2;
  return {
    laneId: approach.id,
    junctionId: junction.id,
    a: add(pose, left, half),
    b: add(pose, left, -half),
    heading: pose.heading,
    s: approach.path.length + lo,
  };
}

function roadMarkings(
  roads: readonly Road[],
  junctions: readonly Junction[],
  limitLines: readonly LimitLine[],
  params: WorldParams,
): Marking[] {
  const m = params.markings;
  const markings: Marking[] = [];
  const edge = params.laneWidth + m.lineWidth / 2;
  for (const road of roads) {
    const path = road.centreline;
    // Broken white centre line.
    for (let s = m.centreLineEndGap; s < path.length - m.centreLineEndGap; s += m.centreDash + m.centreGap) {
      const end = Math.min(s + m.centreDash, path.length - m.centreLineEndGap);
      stripe(markings, path, s, end, -m.lineWidth / 2, m.lineWidth / 2, 'white');
    }
    // Solid white edge lines just outside each lane.
    for (const side of [-1, 1]) {
      stripe(markings, path, 0, path.length, side * edge - m.lineWidth / 2, side * edge + m.lineWidth / 2, 'white');
    }
  }
  for (const junction of junctions) {
    if (junction.kind === 'tee') {
      // The edge line continues along the side of a T opposite the stem.
      const stem = junction.arms.find((arm) => !junction.arms.some((other) => other.dir === opposite(arm.dir)));
      if (!stem) continue;
      const far = dirVector(opposite(stem.dir));
      const sideCentre = add(junction.centre, far, edge);
      const from = add(sideCentre, dirVector(rightTurnOf(stem.dir)), junction.size);
      const to = add(sideCentre, dirVector(leftTurnOf(stem.dir)), junction.size);
      stripe(markings, makePath([line(from, to)]), 0, junction.size * 2, -m.lineWidth / 2, m.lineWidth / 2, 'white');
    } else if (junction.kind === 'roundabout') {
      // Outer edge of the circulating road, broken where the arms join.
      const radius = params.roundabout.outerRadius - m.lineWidth / 2;
      const mouth = Math.asin(Math.min(1, (params.laneWidth + params.shoulderWidth) / radius));
      const angles = junction.arms.map((arm) => dirHeading(arm.dir)).sort((a, b) => a - b);
      angles.forEach((angle, i) => {
        const next = i + 1 < angles.length ? (angles[i + 1] as number) : (angles[0] as number) + Math.PI * 2;
        const sweep = next - angle - 2 * mouth;
        if (sweep <= 0) return;
        const ring = makePath([arc(junction.centre, radius, angle + mouth, sweep)]);
        stripe(markings, ring, 0, ring.length, -m.lineWidth / 2, m.lineWidth / 2, 'white');
      });
    }
  }
  // Limit lines: yellow at Stop, white at Give Way (NZ Road Code).
  for (const limit of limitLines) {
    const back = forward(limit.heading);
    markings.push({
      colour: limit.kind === 'stop' ? 'yellow' : 'white',
      corners: [limit.a, limit.b, add(limit.b, back, -m.limitLineWidth), add(limit.a, back, -m.limitLineWidth)],
    });
  }
  return markings;
}

/** Paints the stretch [from, to] of a path between two sideways offsets (positive = left), as flat pieces. */
function stripe(
  markings: Marking[],
  path: Path,
  from: number,
  to: number,
  rightOffset: number,
  leftOffset: number,
  colour: MarkingColour,
): void {
  const points = samplePath(path, from, to, 1.5);
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1] as Pose;
    const q = points[i] as Pose;
    const lp = leftOf(p.heading);
    const lq = leftOf(q.heading);
    markings.push({
      colour,
      corners: [add(p, lp, rightOffset), add(q, lq, rightOffset), add(q, lq, leftOffset), add(p, lp, leftOffset)],
    });
  }
}

/** Parked on the left shoulder of a straight bit of side street, with room to drive off ahead. */
function startPosition(
  roads: readonly Road[],
  lanes: readonly Lane[],
  random: Random,
  params: WorldParams,
  carWidth: number,
): StartPosition {
  const candidates: { lane: Lane; from: number; to: number }[] = [];
  const behind = 10;
  for (const preferMinor of [true, false]) {
    for (const lane of lanes) {
      if (preferMinor && roads[lane.roadId]?.roadClass !== 'minor') continue;
      let s = 0;
      for (const piece of lane.path.pieces) {
        if (piece.kind === 'line' && piece.length >= behind + params.start.minRoomAhead) {
          candidates.push({ lane, from: s + behind, to: s + piece.length - params.start.minRoomAhead });
        }
        s += piece.length;
      }
    }
    if (candidates.length > 0) break;
  }
  const choice = random.pick(candidates);
  const pose = pointAt(choice.lane.path, random.range(choice.from, choice.to));
  // From the middle of the lane to the middle of the car parked by the outer edge of the shoulder.
  const sideways = params.laneWidth / 2 + params.shoulderWidth - params.start.kerbGap - carWidth / 2;
  const spot = add(pose, leftOf(pose.heading), sideways);
  return { x: spot.x, z: spot.z, heading: pose.heading, laneId: choice.lane.id };
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

