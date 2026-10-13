import { CONFIG, type RouteParams, type WorldParams } from '../config';
import { dirHeading, type Control } from '../world/layout';
import type { Connector, Lane, RoadNetwork, Turn } from '../world/network';
import { add, distance, joinPaths, leftOf, pointAt, slicePath, type Path, type Pose, type Vec2 } from '../world/path';

// A driving-test route through the road network: the lanes and junction paths to follow, the
// manoeuvres along the way, and invisible zones where the driver must check the mirrors, signal,
// stop or cancel the indicator. Pure data, no Three.js: the route tracker follows the car along
// it, the minimap draws it and the rules engine (stage 5) checks the zones.
//
// "Route distance" is metres along the route from where it begins.

export type Side = 'left' | 'right';
export type ManeuverKind = 'pullOut' | 'left' | 'right' | 'straight' | 'roundabout' | 'pullOver';

/** Which lanes and junction paths a route takes. */
export interface RoutePlan {
  /** Lanes in driving order; connectors[i] leads from lanes[i] to lanes[i + 1]. */
  lanes: readonly number[];
  connectors: readonly number[];
  /** Distance along the first lane where the route begins, and along the last lane where the car pulls over. */
  startS: number;
  endS: number;
  /** The route begins parked at the kerb, so it starts by pulling out (after a reroute it does not). */
  fromKerb: boolean;
}

export interface Maneuver {
  index: number;
  kind: ManeuverKind;
  /** Junction manoeuvres only. */
  junctionId: number | null;
  connectorId: number | null;
  /** Which way the car leaves the junction; at roundabouts this decides the signals. */
  turn: Turn | null;
  /** Roundabouts: 1 = first exit, 2 = second, ... */
  exit: number | null;
  /** What the driver must do on arriving at the junction. */
  control: Control;
  /**
   * Route distance where the manoeuvre begins: the end of the approach lane, the give-way line
   * of a roundabout, the car moving off from the kerb, or where it starts moving over to the kerb.
   */
  start: number;
  /** Route distance where it is over: the start of the next lane, the car in the lane, or the stopping place. */
  end: number;
  /** Indicator needed on the approach, if any. */
  signal: Side | null;
  /** Speed limit on the approach, km/h. */
  speedLimit: number;
  /** Where it happens: the middle of the junction, or the parking spot by the kerb. */
  point: Vec2;
}

/**
 * - mirror: look in a mirror somewhere here, before the indicator goes on. It begins where the
 *   previous manoeuvre ended: signalling before that would be too early.
 * - signal: the indicator on `side` must be on all along here. It begins `minSignalSeconds`
 *   before the manoeuvre at the speed limit (NZ: signal for at least 3 seconds).
 * - signalOff: the indicator must be off again by this line.
 * - stopLine: Stop sign: the car must come to a complete stop before its front reaches this line.
 * - giveWayLine: Give Way sign or roundabout.
 * - stopBox: the place to stop by the kerb at the end.
 */
export type ZoneKind = 'mirror' | 'signal' | 'signalOff' | 'stopLine' | 'giveWayLine' | 'stopBox';

export interface Zone {
  id: number;
  kind: ZoneKind;
  /** Index of the manoeuvre it belongs to. */
  maneuver: number;
  /** Route distances; lines have from === to. */
  from: number;
  to: number;
  /** Signal zones: which indicator. */
  side: Side | null;
}

/** A bend in the road between junctions (a bend tile): route distances and which way it goes. */
export interface Bend {
  from: number;
  to: number;
  side: Side;
}

export interface Route {
  plan: RoutePlan;
  /** The middle of the lanes along the whole route, through the junctions; it runs on to the end of the last lane. */
  path: Path;
  /** Route distance where each lane of the plan begins (for the first lane that is -startS: the route begins part way along it). */
  laneStarts: readonly number[];
  maneuvers: readonly Maneuver[];
  /** Ordered by where they begin. */
  zones: readonly Zone[];
  /** Bends of the road along the route (not junctions), in order. */
  bends: readonly Bend[];
  /** Middle of the stopping place by the kerb, facing along the road, and its route distance. */
  finish: Pose;
  finishS: number;
}

interface ManeuverDraft {
  maneuver: Omit<Maneuver, 'index'>;
  /** Roundabouts: route distance where the car passes the exit before its own (signal left from here). */
  exitSignalFrom: number | null;
}

export function buildRoute(
  network: RoadNetwork,
  plan: RoutePlan,
  params: RouteParams = CONFIG.route,
  world: WorldParams = CONFIG.world,
  carWidth: number = CONFIG.vehicle.width,
): Route {
  if (plan.lanes.length === 0 || plan.connectors.length !== plan.lanes.length - 1) {
    throw new Error('A route needs lanes with a junction path between each two');
  }
  const lanes = plan.lanes.map((id) => laneById(network, id));
  const connectors = plan.connectors.map((id) => connectorById(network, id));

  const laneStarts: number[] = [];
  const pieces: Path[] = [];
  let s = -plan.startS;
  lanes.forEach((lane, i) => {
    laneStarts.push(s);
    pieces.push(i === 0 ? slicePath(lane.path, plan.startS, lane.path.length) : lane.path);
    s += lane.path.length;
    const connector = connectors[i];
    if (!connector) return;
    if (connector.fromLane !== lane.id || connector.toLane !== plan.lanes[i + 1]) {
      throw new Error(`Junction path ${connector.id} does not join lanes ${lane.id} and ${plan.lanes[i + 1]}`);
    }
    pieces.push(connector.path);
    s += connector.path.length;
  });
  const path = joinPaths(pieces);
  const first = lanes[0] as Lane;
  const last = lanes[lanes.length - 1] as Lane;
  const lastStart = laneStarts[laneStarts.length - 1] as number;
  const finishS = lastStart + plan.endS;
  const sideways = kerbOffset(world, carWidth);
  const finish = kerbPose(pointAt(last.path, plan.endS), sideways);

  const drafts: ManeuverDraft[] = [];
  if (plan.fromKerb) {
    const at = kerbPose(pointAt(first.path, plan.startS), sideways);
    drafts.push({
      maneuver: {
        kind: 'pullOut',
        junctionId: null,
        connectorId: null,
        turn: null,
        exit: null,
        control: 'none',
        start: params.pullOutStart,
        end: params.pullOutLength,
        signal: 'right',
        speedLimit: first.speedLimit,
        point: { x: at.x, z: at.z },
      },
      exitSignalFrom: null,
    });
  }
  connectors.forEach((connector, i) => {
    const approach = lanes[i] as Lane;
    const junction = network.junctions[connector.junctionId];
    if (!junction) throw new Error(`No junction ${connector.junctionId}`);
    const laneEnd = (laneStarts[i] as number) + approach.path.length;
    const limit = limitLineOf(network, approach.id, junction.id);
    const roundabout = junction.kind === 'roundabout';
    if (!roundabout && connector.turn === 'uTurn') throw new Error('U-turns are only possible at roundabouts');
    drafts.push({
      maneuver: {
        kind: roundabout ? 'roundabout' : (connector.turn as 'left' | 'straight' | 'right'),
        junctionId: junction.id,
        connectorId: connector.id,
        turn: connector.turn,
        exit: connector.exit,
        control: approach.control,
        start: roundabout && limit ? (laneStarts[i] as number) + limit.s : laneEnd,
        end: laneEnd + connector.path.length,
        signal: approachSignal(connector.turn),
        speedLimit: approach.speedLimit,
        point: { ...junction.centre },
      },
      exitSignalFrom: roundabout && connector.turn !== 'left' ? laneEnd + passedExitBefore(network, connector, world) : null,
    });
  });
  drafts.push({
    maneuver: {
      kind: 'pullOver',
      junctionId: null,
      connectorId: null,
      turn: null,
      exit: null,
      control: 'none',
      start: finishS - params.pullOverLength,
      end: finishS,
      signal: 'left',
      speedLimit: last.speedLimit,
      point: { x: finish.x, z: finish.z },
    },
    exitSignalFrom: null,
  });

  const maneuvers: Maneuver[] = drafts.map(({ maneuver }, index) => ({ ...maneuver, index }));
  const zones = maneuverZones(maneuvers, drafts.map((d) => d.exitSignalFrom), network, plan, laneStarts, path.length, params);
  return { plan, path, laneStarts, maneuvers, zones, bends: routeBends(lanes, laneStarts), finish, finishS };
}

/** Lanes turn only on bend tiles: every arc in a lane is a bend of the road. */
function routeBends(lanes: readonly Lane[], laneStarts: readonly number[]): Bend[] {
  const bends: Bend[] = [];
  lanes.forEach((lane, i) => {
    let s = laneStarts[i] as number;
    for (const piece of lane.path.pieces) {
      if (piece.kind === 'arc' && s + piece.length > 0) {
        bends.push({ from: Math.max(0, s), to: s + piece.length, side: piece.sweep > 0 ? 'left' : 'right' });
      }
      s += piece.length;
    }
  });
  return bends;
}

/** NZ Road Code: at a roundabout, signal left for the first exit, right when going more than halfway round. */
function approachSignal(turn: Turn): Side | null {
  if (turn === 'left') return 'left';
  if (turn === 'right' || turn === 'uTurn') return 'right';
  return null;
}

function maneuverZones(
  maneuvers: readonly Maneuver[],
  exitSignals: readonly (number | null)[],
  network: RoadNetwork,
  plan: RoutePlan,
  laneStarts: readonly number[],
  routeLength: number,
  params: RouteParams,
): Zone[] {
  const zones: Omit<Zone, 'id'>[] = [];
  // Signalling is too early before the previous manoeuvre is over.
  const earliestSignal = (index: number): number => (index > 0 ? (maneuvers[index - 1] as Maneuver).end : 0);
  const signalBy = (m: Maneuver): number =>
    Math.max(earliestSignal(m.index), m.start - (m.speedLimit / 3.6) * params.minSignalSeconds);
  // Where each manoeuvre's first signal zone begins, to keep the previous "indicator off" line before it.
  const firstSignal = maneuvers.map((m) => (m.signal ? signalBy(m) : (exitSignals[m.index] ?? Infinity)));

  for (const m of maneuvers) {
    const index = m.index;
    const exitSignalFrom = exitSignals[index] ?? null;
    if (m.signal) {
      const by = signalBy(m);
      zones.push({ kind: 'mirror', maneuver: index, from: earliestSignal(index), to: by, side: null });
      // Going more than halfway round a roundabout the right signal changes to left at the exit before.
      const end = m.signal === 'right' && exitSignalFrom !== null ? exitSignalFrom : m.end;
      zones.push({ kind: 'signal', maneuver: index, from: by, to: end, side: m.signal });
    }
    if (exitSignalFrom !== null) {
      zones.push({ kind: 'signal', maneuver: index, from: exitSignalFrom, to: m.end, side: 'left' });
    }
    if (m.junctionId !== null) {
      const laneIndex = maneuvers[0]?.kind === 'pullOut' ? index - 1 : index;
      const laneId = plan.lanes[laneIndex];
      const limit = laneId === undefined ? undefined : limitLineOf(network, laneId, m.junctionId);
      if (limit) {
        const s = (laneStarts[laneIndex] as number) + limit.s;
        zones.push({ kind: limit.kind === 'stop' ? 'stopLine' : 'giveWayLine', maneuver: index, from: s, to: s, side: null });
      }
    }
    if (m.kind === 'pullOver') {
      const half = params.stopBoxLength / 2;
      zones.push({ kind: 'stopBox', maneuver: index, from: m.end - half, to: m.end + half, side: null });
    } else if (m.signal || exitSignalFrom !== null) {
      const next = firstSignal[index + 1] ?? Infinity;
      const off = Math.max(m.end, Math.min(m.end + params.signalOffDistance, next, routeLength));
      zones.push({ kind: 'signalOff', maneuver: index, from: off, to: off, side: null });
    }
  }
  return zones
    .map((zone, i) => ({ zone, i }))
    .sort((a, b) => a.zone.from - b.zone.from || a.i - b.i)
    .map(({ zone }, id) => ({ ...zone, id }));
}

/**
 * Distance along a roundabout path to where the car passes the exit before its own: where the
 * circulating lane crosses the middle of that exit's arm.
 */
function passedExitBefore(network: RoadNetwork, connector: Connector, world: WorldParams): number {
  const junction = network.junctions[connector.junctionId];
  if (!junction || connector.exit === null || connector.exit < 2) throw new Error('No exit before this one');
  const previous = network.connectors.find(
    (c) => c.junctionId === junction.id && c.fromLane === connector.fromLane && c.exit === (connector.exit as number) - 1,
  );
  const arm = previous && junction.arms.find((a) => a.outLane === previous.toLane);
  if (!arm) throw new Error('Roundabout exit without an arm');
  const armAngle = dirHeading(arm.dir);
  let start = 0;
  for (const piece of connector.path.pieces) {
    const onRing =
      piece.kind === 'arc' &&
      distance(piece.centre, junction.centre) < 1e-6 &&
      Math.abs(piece.radius - world.roundabout.laneRadius) < 1e-6;
    if (onRing) {
      // Clockwise round the island the angle decreases.
      const t = piece.radius * mod(piece.startAngle - armAngle, Math.PI * 2);
      return start + Math.min(t, piece.length);
    }
    start += piece.length;
  }
  throw new Error('Roundabout path without a circulating part');
}

/** Sideways from the middle of the lane to the middle of a car parked by the outer edge of the shoulder. */
export function kerbOffset(world: WorldParams = CONFIG.world, carWidth: number = CONFIG.vehicle.width): number {
  return world.laneWidth / 2 + world.shoulderWidth - world.start.kerbGap - carWidth / 2;
}

function kerbPose(lanePose: Pose, sideways: number): Pose {
  const p = add(lanePose, leftOf(lanePose.heading), sideways);
  return { x: p.x, z: p.z, heading: lanePose.heading };
}

/** Index into plan.lanes of the lane at route distance `s`, or of the lane just before the junction there. */
export function laneIndexAt(route: Route, s: number): number {
  let index = 0;
  route.laneStarts.forEach((start, i) => {
    if (i > 0 && start <= s) index = i;
  });
  return index;
}

/** Route distance where lane `index` of the plan ends (and its junction path begins). */
export function laneEndOf(route: Route, network: RoadNetwork, index: number): number {
  const id = route.plan.lanes[index];
  if (id === undefined) throw new Error(`Route has no lane ${index}`);
  return (route.laneStarts[index] as number) + laneById(network, id).path.length;
}

export function laneById(network: RoadNetwork, id: number): Lane {
  const lane = network.lanes[id];
  if (!lane) throw new Error(`No lane ${id}`);
  return lane;
}

export function connectorById(network: RoadNetwork, id: number): Connector {
  const connector = network.connectors[id];
  if (!connector) throw new Error(`No junction path ${id}`);
  return connector;
}

function limitLineOf(network: RoadNetwork, laneId: number, junctionId: number): RoadNetwork['limitLines'][number] | undefined {
  return network.limitLines.find((l) => l.laneId === laneId && l.junctionId === junctionId);
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
