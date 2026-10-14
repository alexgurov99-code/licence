import { CONFIG, type TrafficParams } from '../config';
import type { Side } from '../route/route';
import { normalizeAngle } from '../util/math';
import { createRandom, type Random } from '../util/random';
import { locate } from '../world/locate';
import { CAR_SIZES, PALETTE, type CarType } from '../world/models/catalogue';
import type { Connector, RoadNetwork, Turn } from '../world/network';
import { forward, leftOf, pointAt, project, type Path, type Pose } from '../world/path';
import { bodiesOverlap, type Body } from './collision';
import { buildConflicts, type ConflictArea, type ConflictTable } from './conflicts';
import { movementOf, mustGiveWay, type Movement } from './priority';
import type { Direction, TrafficConflict, TrafficView } from './types';

// Other cars on the roads. Each one drives along the middle of its lane and through the
// junctions on their paths, picking a way at random at every junction (never a U-turn). Its speed
// follows the "intelligent driver model": it speeds up towards its cruising speed and brakes for
// the car ahead (the learner too), for curves, for a Stop line and for a give-way line when it
// has to give way (see priority.ts). Indicators go on before turns. Cars appear and disappear
// out of the learner's sight so that there is always traffic around.
//
// Pure logic, no Three.js. The same seed and the same driving give the same traffic: the random
// numbers come from the seed and are drawn in a fixed order every physics step.

export interface TrafficCar {
  id: number;
  type: CarType;
  color: number;
  length: number;
  width: number;
  /** On a lane (segment = lane id) or on a junction path (segment = connector id). */
  onConnector: boolean;
  segment: number;
  /** Distance along the lane or junction path to the middle of the car. */
  s: number;
  /** m/s, never negative, and the acceleration of the last step. */
  speed: number;
  accel: number;
  /** On a lane: the junction path the driver will take at its end. */
  next: number;
  /** This driver's cruising speed as a share of the limit. */
  cruiseShare: number;
  indicator: Side | null;
  /** Stop signs: the junction path this car has stopped for, and when it stopped. */
  stoppedFor: number | null;
  stoppedAt: number | null;
  /** Since when the car has been waiting at a line, and since when it has not moved. */
  waitingSince: number | null;
  stillSince: number | null;
  /** The cars it is giving way to now (LEARNER for the learner): for the debug view. */
  givingWayTo: readonly number[];
  /** It braked hard this step because of the learner. */
  evasive: boolean;
  /** Pose of the middle of the car, the curvature of the way it is driving (1/m, positive = left), metres driven. */
  x: number;
  z: number;
  heading: number;
  curvature: number;
  travelled: number;
}

/** Car id that stands for the learner. */
export const LEARNER = -1;

/** The learner's car as the traffic sees it. */
export interface LearnerInput extends Pose {
  /** m/s, negative when reversing. */
  speed: number;
  length: number;
  width: number;
  /** The indicator, which tells other drivers where the learner is going. */
  indicator: Side | null;
  /** The junction path the learner's route takes at the next junction (where the learner really goes), null off the route. */
  routeConnector: number | null;
}

/** A car's place at the junction ahead of it or the one it is in: the junction path, and its middle along it (negative before it begins). */
export interface JunctionPlace {
  junctionId: number;
  connectorId: number;
  along: number;
}

/** Things about the town worked out once for the traffic. */
export interface TrafficWorld {
  network: RoadNetwork;
  conflicts: ConflictTable;
  /** Junction paths a car may take from each lane (no U-turns). */
  exits: readonly (readonly Connector[])[];
  /** Cars parked by the kerb (and in driveways): the learner can hit them. */
  parked: readonly Body[];
  params: TrafficParams;
}

export interface TrafficState {
  time: number;
  cars: readonly TrafficCar[];
  nextId: number;
  /** Draws are made in the same order every step, so the same seed gives the same traffic. */
  random: Random;
  /** Where the learner is at the junction ahead: as other drivers read it (from the indicator), and where the route really goes. */
  learnerShown: JunctionPlace | null;
  learnerActual: JunctionPlace | null;
}

export function createTrafficWorld(network: RoadNetwork, parked: readonly Body[] = [], params: TrafficParams = CONFIG.traffic): TrafficWorld {
  const exits = network.lanes.map((lane) => network.connectors.filter((c) => c.fromLane === lane.id && c.turn !== 'uTurn'));
  return { network, conflicts: buildConflicts(network, params.conflictDistance), exits, parked, params };
}

const CAR_TYPES: readonly [CarType, number][] = [
  ['hatchback', 0.3],
  ['sedan', 0.3],
  ['wagon', 0.2],
  ['ute', 0.12],
  ['van', 0.08],
];

/** Traffic at the start of a drive: `count` cars spread over the town, none right by the learner. */
export function createTraffic(world: TrafficWorld, seed: string, learner: Pose, count: number = world.params.count): TrafficState {
  let state: TrafficState = {
    time: 0,
    cars: [],
    nextId: 0,
    random: createRandom(`${seed}/traffic`),
    learnerShown: null,
    learnerActual: null,
  };
  for (let attempt = 0; attempt < count * 40 && state.cars.length < count; attempt++) {
    state = trySpawn(world, state, learner, true);
  }
  return state;
}

/** A car placed by hand (tests): on a lane at distance s, taking the given junction path at its end. */
export function addCar(
  world: TrafficWorld,
  state: TrafficState,
  place: { laneId: number; s: number; next: number; speed?: number; type?: CarType },
): TrafficState {
  const type = place.type ?? 'sedan';
  const lane = world.network.lanes[place.laneId];
  if (!lane) throw new Error(`No lane ${place.laneId}`);
  const car = withPose(world, {
    ...blankCar(state.nextId, type, PALETTE.car.silver),
    segment: place.laneId,
    s: place.s,
    next: place.next,
    speed: place.speed ?? (lane.speedLimit / 3.6) * 0.95,
    cruiseShare: 0.95,
  });
  return { ...state, cars: [...state.cars, car], nextId: state.nextId + 1 };
}

/** One physics step of all the cars; then cars far away are taken away and new ones appear. */
export function stepTraffic(
  world: TrafficWorld,
  state: TrafficState,
  learner: LearnerInput,
  dt: number,
  count: number = world.params.count,
): { state: TrafficState; view: TrafficView } {
  const time = state.time + dt;
  const learnerShown = learnerPlace(world, learner, true);
  const learnerActual = learnerPlace(world, learner, false);
  const others = state.cars;
  const cars = others.map((car) => stepCar(world, car, others, learner, learnerShown, time, dt, state.random));

  const p = world.params;
  let next: TrafficState = { ...state, time, learnerShown, learnerActual };
  const kept = cars.filter((car) => {
    const away = Math.hypot(car.x - learner.x, car.z - learner.z);
    const stuck = car.stillSince !== null && time - car.stillSince > p.stuckSeconds && away > p.stuckRemoveDistance;
    return away <= p.despawnDistance && !stuck;
  });
  next = { ...next, cars: kept };
  // At most one new car a step keeps the work per step small.
  if (next.cars.length < count) next = trySpawn(world, next, learner, false);
  return { state: next, view: trafficView(world, next, learner) };
}

// ---------------------------------------------------------------------------------------------
// One car

interface Leg {
  path: Path;
  /** Distance along the path where this leg starts, and how far ahead of the car's middle that is. */
  from: number;
  ahead: number;
}

interface Obstacle {
  gap: number;
  speed: number;
  minGap: number;
  learner: boolean;
}

function stepCar(
  world: TrafficWorld,
  car: TrafficCar,
  all: readonly TrafficCar[],
  learner: LearnerInput,
  learnerShown: JunctionPlace | null,
  time: number,
  dt: number,
  random: Random,
): TrafficCar {
  const p = world.params;
  const { network } = world;
  const legs = legsAhead(world, car);
  const lane = network.lanes[car.onConnector ? (network.connectors[car.segment]?.toLane ?? 0) : car.segment];
  let v0 = ((lane?.speedLimit ?? 50) / 3.6) * car.cruiseShare;

  // Speeds to be down to at points ahead: curves (taken at the allowed sideways acceleration) and give-way lines.
  const limits: { d: number; v: number }[] = [];
  for (const leg of legs) {
    let start = 0;
    for (const piece of leg.path.pieces) {
      const end = start + piece.length;
      if (piece.kind === 'arc' && end > leg.from) {
        const d = Math.max(0, leg.ahead + start - leg.from);
        if (d < p.lookAhead) {
          const vc = Math.sqrt(p.curveAcceleration * piece.radius);
          limits.push({ d, v: vc });
        }
      }
      start = end;
    }
  }

  // The give-way or Stop line ahead.
  const obstacles: Obstacle[] = [];
  const place = carPlace(world, car);
  let stoppedFor = car.stoppedFor;
  let stoppedAt = car.stoppedAt;
  let givingWayTo: number[] = [];
  let atLine = false;
  if (place) {
    const connector = network.connectors[place.connectorId] as Connector;
    const control = network.lanes[connector.fromLane]?.control ?? 'none';
    const toLine = world.conflicts.gate(place.connectorId) - (place.along + car.length / 2);
    if (toLine > -0.1) {
      if (control === 'stop' && stoppedFor !== place.connectorId && toLine < p.stopNear && car.speed < p.stopSpeed) {
        stoppedFor = place.connectorId;
        stoppedAt = time;
      }
      const mustStop = control === 'stop' && (stoppedFor !== place.connectorId || time - (stoppedAt ?? time) < p.stopWaitSeconds);
      const longWait = car.waitingSince !== null && time - car.waitingSince > p.impatientSeconds;
      givingWayTo = toLine < p.giveWayLookDistance ? whoToGiveWayTo(world, car, place, all, learner, learnerShown, longWait) : [];
      // Too late to stop (it would take more than twice the comfortable braking) for a car with
      // priority: carry on. The stop for a Stop sign is always made.
      const tooLate = car.speed * car.speed > 2 * (2 * p.comfortableBraking) * Math.max(toLine, 0.1);
      if (mustStop || (givingWayTo.length > 0 && !tooLate)) {
        obstacles.push({ gap: toLine, speed: 0, minGap: p.lineGap, learner: false });
        atLine = toLine < p.stopNear + 3 && car.speed < 1;
      } else {
        givingWayTo = [];
        if (control !== 'none') {
          const vg = p.giveWaySpeed;
          limits.push({ d: Math.max(0, toLine), v: vg });
        }
      }
    }
  }

  // Cars ahead along the way: the learner whichever way it faces, other cars going the same way (or standing still).
  const samples = corridor(legs, p);
  const consider = (other: Body & { speed: number }, isLearner: boolean): void => {
    const reach = p.lookAhead + 10;
    if (Math.abs(other.x - car.x) > reach || Math.abs(other.z - car.z) > reach) return;
    for (const sample of samples) {
      const dx = other.x - sample.x;
      const dz = other.z - sample.z;
      if (dx * dx + dz * dz > p.corridorHalfWidth * p.corridorHalfWidth) continue;
      const diff = Math.abs(normalizeAngle(other.heading - sample.heading));
      // A car crossing further ahead will be gone by then; one crossing right in front is braked for.
      if (!isLearner && diff > p.sameWayAngle && Math.abs(other.speed) > 0.5 && sample.d > p.crossingBrakeDistance) return;
      obstacles.push({
        gap: sample.d - car.length / 2 - other.length / 2,
        speed: Math.max(0, other.speed * Math.cos(diff)),
        minGap: p.minGap,
        learner: isLearner,
      });
      return;
    }
  };
  for (const other of all) if (other.id !== car.id) consider(other, false);
  consider(learner, true);

  // Intelligent driver model: the most cautious of free driving and each obstacle.
  for (const limit of limits) v0 = Math.min(v0, Math.sqrt(limit.v * limit.v + 2 * p.comfortableBraking * limit.d));
  const v = car.speed;
  const vMax = Math.max(v0, 0.1);
  const free = p.acceleration * (1 - (v / vMax) ** 4);
  let accel = free;
  let cause: Obstacle | null = null;
  for (const o of obstacles) {
    const wanted = o.minGap + Math.max(0, v * p.timeGap + (v * (v - o.speed)) / (2 * Math.sqrt(p.acceleration * p.comfortableBraking)));
    const a = o.gap <= 0.05 ? -Infinity : free - p.acceleration * (wanted / o.gap) ** 2;
    if (a < accel) {
      accel = a;
      cause = o;
    }
  }
  // Slow down for the speed limits ahead: the model's free-road term alone would get there too fast.
  for (const limit of limits) {
    if (v <= limit.v) continue;
    const needed = limit.d < 0.5 ? (limit.v - v) / 0.5 : (limit.v * limit.v - v * v) / (2 * limit.d);
    if (needed < accel) accel = needed;
  }
  accel = Math.max(accel, -p.maxBraking);
  // Right up to something standing still: stand still too (the model only creeps up to it).
  const blocked = cause !== null && (cause.gap <= 0.05 || (cause.speed === 0 && cause.gap - cause.minGap < 0.3 && v < 0.5));
  const speed = blocked ? 0 : Math.max(0, v + accel * dt);
  // Evasive action: braking that stopping in time behind the learner really needs, not just easing off.
  const learnerAhead = obstacles.find((o) => o.learner);
  const needed = learnerAhead && v > learnerAhead.speed ? (v - learnerAhead.speed) ** 2 / (2 * Math.max(learnerAhead.gap - 1, 0.1)) : 0;
  const evasive = needed > p.evasiveBraking && accel < -1;

  let moved: TrafficCar = {
    ...car,
    speed,
    accel: blocked ? -p.maxBraking : accel,
    s: car.s + speed * dt,
    travelled: car.travelled + speed * dt,
    stoppedFor,
    stoppedAt,
    givingWayTo,
    evasive,
    waitingSince: atLine ? (car.waitingSince ?? time) : null,
    stillSince: speed < 0.1 ? (car.stillSince ?? time) : null,
  };
  moved = advanceSegments(world, moved, random);
  return withPose(world, { ...moved, indicator: indicatorFor(world, moved) });
}

/** Moves the car onto the next junction path or lane once it has driven past the end of the one it is on. */
function advanceSegments(world: TrafficWorld, car: TrafficCar, random: Random): TrafficCar {
  const { network } = world;
  let c = car;
  for (let i = 0; i < 3; i++) {
    if (c.onConnector) {
      const connector = network.connectors[c.segment] as Connector;
      if (c.s <= connector.path.length) break;
      const s = c.s - connector.path.length;
      const next = chooseExit(world, connector.toLane, random);
      c = { ...c, onConnector: false, segment: connector.toLane, s, next, stoppedFor: null, stoppedAt: null };
    } else {
      const lane = network.lanes[c.segment];
      if (!lane || c.s <= lane.path.length) break;
      c = { ...c, onConnector: true, segment: c.next, s: c.s - lane.path.length };
    }
  }
  return c;
}

function chooseExit(world: TrafficWorld, laneId: number, random: Random): number {
  const exits = world.exits[laneId] ?? [];
  if (exits.length === 0) throw new Error(`Lane ${laneId} leads nowhere`);
  const weights = world.params.turnWeights;
  const weightOf = (turn: Turn): number => (turn === 'left' ? weights.left : turn === 'right' ? weights.right : weights.straight);
  const total = exits.reduce((sum, c) => sum + weightOf(c.turn), 0);
  let pick = random.next() * total;
  for (const c of exits) {
    pick -= weightOf(c.turn);
    if (pick <= 0) return c.id;
  }
  return (exits[exits.length - 1] as Connector).id;
}

/** The stretches of road ahead of the car: the rest of its lane or junction path, then what follows. */
function legsAhead(world: TrafficWorld, car: TrafficCar): Leg[] {
  const { network } = world;
  const legs: Leg[] = [];
  if (car.onConnector) {
    const connector = network.connectors[car.segment] as Connector;
    legs.push({ path: connector.path, from: car.s, ahead: 0 });
    const lane = network.lanes[connector.toLane];
    if (lane) legs.push({ path: lane.path, from: 0, ahead: connector.path.length - car.s });
  } else {
    const lane = network.lanes[car.segment];
    if (!lane) return legs;
    legs.push({ path: lane.path, from: car.s, ahead: 0 });
    const connector = network.connectors[car.next];
    if (connector) {
      const toEnd = lane.path.length - car.s;
      legs.push({ path: connector.path, from: 0, ahead: toEnd });
      const after = network.lanes[connector.toLane];
      if (after) legs.push({ path: after.path, from: 0, ahead: toEnd + connector.path.length });
    }
  }
  return legs;
}

/** Points along the way ahead, `corridorStep` apart, with their distance ahead of the car's middle. */
function corridor(legs: readonly Leg[], p: TrafficParams): (Pose & { d: number })[] {
  const points: (Pose & { d: number })[] = [];
  for (let d = p.corridorStep; d <= p.lookAhead; d += p.corridorStep) {
    const leg = [...legs].reverse().find((l) => l.ahead <= d);
    if (!leg) continue;
    const s = leg.from + d - leg.ahead;
    if (s > leg.path.length) continue;
    points.push({ ...pointAt(leg.path, s), d });
  }
  return points;
}

/** The car's place at the junction ahead of it (or the one it is in). */
function carPlace(world: TrafficWorld, car: TrafficCar): JunctionPlace | null {
  const { network } = world;
  if (car.onConnector) {
    const connector = network.connectors[car.segment];
    return connector ? { junctionId: connector.junctionId, connectorId: connector.id, along: car.s } : null;
  }
  const lane = network.lanes[car.segment];
  const connector = network.connectors[car.next];
  if (!lane || !connector) return null;
  return { junctionId: connector.junctionId, connectorId: connector.id, along: car.s - lane.path.length };
}

interface Mover {
  id: number;
  place: JunctionPlace;
  length: number;
  speed: number;
  /** Who it is giving way to itself. */
  waitsFor: readonly number[];
}

/** Whether a car is past its give-way line: on a roundabout, that is being on the circle. */
function pastLine(world: TrafficWorld, m: Mover): boolean {
  return m.place.along + m.length / 2 > world.conflicts.gate(m.place.connectorId);
}

/**
 * Two cars and the place where their ways meet (area as seen from `me`'s path): how far each
 * front is from it, and whether `other` is through it. Crossing: once its back is past the end
 * of the place. Merging or sharing a stretch: also once it is far enough ahead of `me` in it
 * (it is then just a car ahead to follow).
 */
function meeting(
  world: TrafficWorld,
  me: Mover,
  other: Mover,
  area: ConflictArea,
): { meTo: number; otherTo: number; otherClear: boolean; meClear: boolean } {
  const meTo = area.aFrom - (me.place.along + me.length / 2);
  const otherTo = area.bFrom - (other.place.along + other.length / 2);
  const meBack = me.place.along - me.length / 2;
  const otherBack = other.place.along - other.length / 2;
  const apart = (me.length + other.length) / 2 + world.params.clearMargin;
  // Positive: other is further into the shared stretch than me.
  const lead = me.place.along - area.aFrom - (other.place.along - area.bFrom);
  return {
    meTo,
    otherTo,
    otherClear: otherBack > area.bTo || (area.merge && otherBack > area.bFrom && -lead > apart),
    meClear: meBack > area.aTo || (area.merge && meBack > area.aFrom && lead > apart),
  };
}

function movementOfMover(world: TrafficWorld, m: Mover): Movement {
  return movementOf(world.network, m.place.connectorId, pastLine(world, m));
}

/** Is the car one of a circle of cars each waiting for the next (three or four arms at once)? */
function waitsInCircle(car: TrafficCar, all: readonly TrafficCar[]): boolean {
  const byId = new Map(all.map((c) => [c.id, c]));
  let ring: readonly number[] = car.givingWayTo;
  for (let hop = 0; hop < 4; hop++) {
    if (ring.includes(car.id)) return true;
    ring = ring.flatMap((id) => byId.get(id)?.givingWayTo ?? []);
  }
  return false;
}

/** The cars (and the learner) this car must give way to before it may cross its line. */
function whoToGiveWayTo(
  world: TrafficWorld,
  car: TrafficCar,
  place: JunctionPlace,
  all: readonly TrafficCar[],
  learner: LearnerInput,
  learnerShown: JunctionPlace | null,
  longWait: boolean,
): number[] {
  // After a long wait, a car standing still at its line is no longer waited for if it waits for
  // nobody (it is held up by something else) or the cars wait for each other in a circle.
  const circle = longWait && waitsInCircle(car, all);
  const p = world.params;
  const me: Mover = { id: car.id, place, length: car.length, speed: car.speed, waitsFor: [] };
  const mine = movementOf(world.network, place.connectorId, false);
  const movers: Mover[] = [];
  for (const other of all) {
    if (other.id === car.id) continue;
    const otherPlace = carPlace(world, other);
    if (!otherPlace || otherPlace.junctionId !== place.junctionId) continue;
    movers.push({ id: other.id, place: otherPlace, length: other.length, speed: other.speed, waitsFor: other.givingWayTo });
  }
  if (learnerShown && learnerShown.junctionId === place.junctionId) {
    movers.push({ id: LEARNER, place: learnerShown, length: learner.length, speed: Math.max(0, learner.speed), waitsFor: [] });
  }
  const waitFor: number[] = [];
  for (const other of movers) {
    const area = world.conflicts.between(me.place.connectorId, other.place.connectorId);
    if (!area) continue;
    if (!mustGiveWay(mine, movementOfMover(world, other))) continue;
    const { otherTo: to, otherClear: clear } = meeting(world, me, other, area);
    if (clear || to > p.giveWayLookDistance) continue;
    if (to <= 0) {
      waitFor.push(other.id);
      continue;
    }
    // A car standing still is not coming yet, unless it is right there, or it stands at its own
    // line about to go.
    if (other.speed < p.stopSpeed && to > p.stopNear) {
      const atItsLine = world.conflicts.gate(other.place.connectorId) - (other.place.along + other.length / 2) < p.stopNear + 1;
      const impatient = longWait && (circle || other.waitsFor.length === 0);
      if (impatient || other.id === LEARNER || !atItsLine) continue;
      waitFor.push(other.id);
      continue;
    }
    // Go only if the other car is further away than the time this car needs to get through, plus a margin.
    const through = timeToCover(area.aTo - (place.along + car.length / 2) + car.length, car.speed, p.acceleration);
    const gap = Math.max(p.giveWayGapSeconds, through + p.giveWayMarginSeconds);
    if (to / Math.max(other.speed, 1) < gap) waitFor.push(other.id);
  }
  return waitFor;
}

/** Seconds to drive `d` metres starting at speed v and speeding up at a. */
function timeToCover(d: number, v: number, a: number): number {
  if (d <= 0) return 0;
  return (Math.sqrt(v * v + 2 * a * d) - v) / a;
}

/** The indicator for the junction path ahead (on a lane, once close) or the one the car is on. */
function indicatorFor(world: TrafficWorld, car: TrafficCar): Side | null {
  const p = world.params;
  const { network } = world;
  if (car.onConnector) {
    const connector = network.connectors[car.segment] as Connector;
    const junction = network.junctions[connector.junctionId];
    if (junction?.kind === 'roundabout') {
      const onRing = car.s + car.length / 2 > world.conflicts.gate(connector.id);
      // The way off the circle is about as long as the way onto it (up to the give-way line).
      if (onRing && connector.path.length - car.s < p.exitSignalDistance + world.conflicts.gate(connector.id)) return 'left';
    }
    return approachSignal(connector);
  }
  const lane = network.lanes[car.segment];
  const connector = network.connectors[car.next];
  if (!lane || !connector) return null;
  const toEnd = lane.path.length - car.s;
  return toEnd < Math.max(p.signalMinDistance, car.speed * p.signalSeconds) ? approachSignal(connector) : null;
}

/** NZ: left or right for a turn; at a roundabout left for the first exit, right for going further than straight on. */
function approachSignal(connector: Connector): Side | null {
  if (connector.turn === 'left') return 'left';
  if (connector.turn === 'right' || connector.turn === 'uTurn') return 'right';
  return null;
}

function withPose(world: TrafficWorld, car: TrafficCar): TrafficCar {
  const path = segmentPath(world, car);
  const pose = pointAt(path, car.s);
  return { ...car, x: pose.x, z: pose.z, heading: pose.heading, curvature: curvatureAt(path, car.s) };
}

function segmentPath(world: TrafficWorld, car: Pick<TrafficCar, 'onConnector' | 'segment'>): Path {
  const path = car.onConnector ? world.network.connectors[car.segment]?.path : world.network.lanes[car.segment]?.path;
  if (!path) throw new Error(`No ${car.onConnector ? 'junction path' : 'lane'} ${car.segment}`);
  return path;
}

function curvatureAt(path: Path, s: number): number {
  let start = 0;
  for (const piece of path.pieces) {
    if (s <= start + piece.length) return piece.kind === 'arc' ? Math.sign(piece.sweep) / piece.radius : 0;
    start += piece.length;
  }
  return 0;
}

function blankCar(id: number, type: CarType, color: number): TrafficCar {
  const size = CAR_SIZES[type];
  return {
    id,
    type,
    color,
    length: size.length,
    width: size.width,
    onConnector: false,
    segment: 0,
    s: 0,
    speed: 0,
    accel: 0,
    next: -1,
    cruiseShare: 1,
    indicator: null,
    stoppedFor: null,
    stoppedAt: null,
    waitingSince: null,
    stillSince: null,
    givingWayTo: [],
    evasive: false,
    x: 0,
    z: 0,
    heading: 0,
    curvature: 0,
    travelled: 0,
  };
}

/** Tries to place one new car somewhere out of the learner's sight (or, at the start, anywhere not too close). */
function trySpawn(world: TrafficWorld, state: TrafficState, learner: Pose, atStart: boolean): TrafficState {
  const { network, params: p } = world;
  const random = state.random;
  const lane = random.pick(network.lanes);
  const s = random.range(10, Math.max(10, lane.path.length - p.spawnBeforeJunction));
  const type = weighted(random, CAR_TYPES);
  const color = random.pick(Object.values(PALETTE.car));
  const cruiseShare = random.range(p.cruiseShareMin, p.cruiseShareMax);
  const next = chooseExit(world, lane.id, random);
  if (lane.path.length < p.spawnBeforeJunction + 10) return state;

  const pose = pointAt(lane.path, s);
  const dx = pose.x - learner.x;
  const dz = pose.z - learner.z;
  const away = Math.hypot(dx, dz);
  if (away > p.spawnMaxDistance || away < (atStart ? p.startMinDistance : p.spawnMinDistance)) return state;
  if (!atStart && away < p.spawnFrontDistance) {
    const ahead = forward(learner.heading);
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * ahead.x + dz * ahead.z) / away)));
    if (angle < p.spawnFrontAngle) return state;
  }
  if (state.cars.some((c) => Math.hypot(c.x - pose.x, c.z - pose.z) < p.spawnGap)) return state;

  const car = withPose(world, {
    ...blankCar(state.nextId, type, color),
    segment: lane.id,
    s,
    next,
    cruiseShare,
    speed: (lane.speedLimit / 3.6) * cruiseShare,
  });
  return { ...state, cars: [...state.cars, car], nextId: state.nextId + 1 };
}

function weighted<T>(random: Random, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let pick = random.next() * total;
  for (const [item, w] of items) {
    pick -= w;
    if (pick <= 0) return item;
  }
  return (items[items.length - 1] as readonly [T, number])[0];
}

// ---------------------------------------------------------------------------------------------
// The learner

/**
 * Where the learner is at the junction ahead. `shown`: as other drivers read it, from the
 * indicator (no indicator: straight on, if there is a straight way). Otherwise where the route
 * really goes, or the indicator's way off the route.
 */
export function learnerPlace(world: TrafficWorld, learner: LearnerInput, shown: boolean): JunctionPlace | null {
  const { network } = world;
  const where = locate(network, learner, learner.heading);
  if (where.kind === 'road') {
    const lane = network.lanes[where.laneId];
    const exits = world.exits[where.laneId] ?? [];
    if (!lane || exits.length === 0) return null;
    const route = exits.find((c) => c.id === learner.routeConnector);
    const read = byIndicator(network, exits, learner.indicator);
    const connector = shown ? (read ?? route ?? exits[0]) : (route ?? read ?? exits[0]);
    if (!connector) return null;
    return { junctionId: connector.junctionId, connectorId: connector.id, along: where.s - lane.path.length };
  }
  if (where.kind === 'junction') {
    const candidates = network.connectors.filter((c) => c.junctionId === where.junctionId);
    let best: { connector: Connector; score: number; s: number } | null = null;
    for (const connector of candidates) {
      const pr = project(connector.path, learner);
      let score = pr.distance + 2 * Math.abs(normalizeAngle(pr.heading - learner.heading));
      // The route's way wins whenever the car is on it; then the indicated way.
      if (connector.id === learner.routeConnector && pr.distance < 3) score -= 10;
      const turnSide = connector.turn === 'left' ? 'left' : connector.turn === 'right' ? 'right' : null;
      if (turnSide !== null && turnSide === learner.indicator) score -= 0.5;
      if (!best || score < best.score) best = { connector, score, s: pr.s };
    }
    if (!best) return null;
    // Before the path begins (still on the approach), the distance counts as negative.
    const start = pointAt(best.connector.path, 0);
    const back = (learner.x - start.x) * forward(start.heading).x + (learner.z - start.z) * forward(start.heading).z;
    const along = best.s <= 1e-6 && back < 0 ? back : best.s;
    return { junctionId: where.junctionId, connectorId: best.connector.id, along };
  }
  return null;
}

function byIndicator(network: RoadNetwork, exits: readonly Connector[], indicator: Side | null): Connector | undefined {
  if (indicator === null) return exits.find((c) => c.turn === 'straight');
  const roundabout = network.junctions[exits[0]?.junctionId ?? -1]?.kind === 'roundabout';
  if (roundabout && indicator === 'right') return exits.find((c) => c.turn === 'right') ?? exits.find((c) => c.turn === 'straight');
  return exits.find((c) => c.turn === indicator);
}

/** What the traffic means for the learner this step (see types.ts). */
export function trafficView(world: TrafficWorld, state: TrafficState, learner: LearnerInput): TrafficView {
  const p = world.params;
  const body: Body = learner;
  const conflicts: TrafficConflict[] = [];
  const place = state.learnerActual;
  if (place) {
    const me: Mover = { id: LEARNER, place, length: learner.length, speed: learner.speed, waitsFor: [] };
    const mine = movementOfMover(world, me);
    for (const car of state.cars) {
      const carAt = carPlace(world, car);
      if (!carAt || carAt.junctionId !== place.junctionId) continue;
      const area = world.conflicts.between(place.connectorId, carAt.connectorId);
      if (!area) continue;
      const other: Mover = { id: car.id, place: carAt, length: car.length, speed: car.speed, waitsFor: car.givingWayTo };
      const m = meeting(world, me, other, area);
      if (m.otherTo > p.giveWayLookDistance || m.meTo > p.giveWayLookDistance) continue;
      conflicts.push({
        carId: car.id,
        learnerGivesWay: mustGiveWay(mine, movementOfMover(world, other)),
        learnerTo: m.meTo,
        learnerClear: m.meClear,
        carTo: m.otherTo,
        carClear: m.otherClear,
        carSpeed: car.speed,
        from: directionFrom(learner, car),
      });
    }
  }

  let collision: TrafficView['collision'] = null;
  if (state.cars.some((car) => bodiesOverlap(body, car))) collision = 'car';
  else if (world.parked.some((parked) => bodiesOverlap(body, parked))) collision = 'parkedCar';

  let ahead: TrafficView['ahead'] = null;
  const f = forward(learner.heading);
  const l = leftOf(learner.heading);
  for (const car of state.cars) {
    const dx = car.x - learner.x;
    const dz = car.z - learner.z;
    const along = dx * f.x + dz * f.z;
    const side = dx * l.x + dz * l.z;
    if (along <= 0 || along > p.lookAhead || Math.abs(side) > p.corridorHalfWidth) continue;
    const diff = Math.abs(normalizeAngle(car.heading - learner.heading));
    if (diff > 0.8) continue;
    const gap = along - car.length / 2 - learner.length / 2;
    if (!ahead || gap < ahead.gap) ahead = { carId: car.id, gap, speed: car.speed * Math.cos(diff) };
  }

  return { conflicts, evasive: state.cars.filter((c) => c.evasive).map((c) => c.id), collision, ahead };
}

/** Where another car is, seen from the driver's seat: coming towards the driver, behind, or to one side. */
function directionFrom(viewer: Pose, car: Pose): Direction {
  const angle = normalizeAngle(Math.atan2(car.x - viewer.x, car.z - viewer.z) - viewer.heading);
  const facing = Math.abs(normalizeAngle(car.heading - viewer.heading));
  if (Math.abs(angle) < 0.6 && facing > Math.PI - 0.8) return 'ahead';
  if (Math.abs(angle) > Math.PI - 0.6 && facing < 0.8) return 'behind';
  // A positive heading change turns left.
  return angle > 0 ? 'left' : 'right';
}
