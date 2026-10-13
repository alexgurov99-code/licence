import { CONFIG, type RouteParams, type WorldParams } from '../config';
import { normalizeAngle } from '../util/math';
import { locate } from '../world/locate';
import type { RoadNetwork } from '../world/network';
import { projectWithin, type Pose } from '../world/path';
import { reroute } from './planner';
import { buildRoute, type Maneuver, type Route, type Zone } from './route';

// Follows the car along its route, like a satnav: how far along it is, which manoeuvre comes
// next, which zones it is in, when it crosses a line, when it has left the route (and the new
// way back), and when it has arrived. Pure logic: it gets the car's position each physics step
// and returns events, which the rules engine (stage 5) will read.

export interface CarSnapshot extends Pose {
  /** m/s, negative when reversing. */
  speed: number;
}

export interface RouteTracker {
  route: Route;
  /** Route distance of the middle of the car now, and the furthest it has got. */
  progress: number;
  reached: number;
  /** Sideways distance from the middle of the route's lane (positive = left), and straight-line distance from it. */
  offset: number;
  distance: number;
  /** The first manoeuvre not completed yet (maneuvers.length once they are all done), and whether the car has begun it. */
  next: number;
  nextStarted: boolean;
  /** Ids of the zones the car is in. */
  inside: readonly number[];
  /** How long the car has looked to be off the route, and whether that has lasted long enough to count. */
  awaySeconds: number;
  offRoute: boolean;
  arrived: boolean;
  /** Manoeuvres completed and new routes found, counted across reroutes. */
  completed: number;
  reroutes: number;
}

export type RouteEvent =
  | { type: 'zoneEntered'; zone: Zone }
  | { type: 'zoneLeft'; zone: Zone }
  /** The front of the car has crossed a stop, give-way or "indicator off" line. */
  | { type: 'lineCrossed'; zone: Zone }
  | { type: 'maneuverStarted'; maneuver: Maneuver }
  | { type: 'maneuverCompleted'; maneuver: Maneuver }
  | { type: 'leftRoute' }
  /** A new route back from where the car is; it replaces the old one (not a driving fault). */
  | { type: 'rerouted'; route: Route }
  | { type: 'arrived' };

export interface TrackerOptions {
  params: RouteParams;
  world: WorldParams;
  /** From the middle of the car to its front bumper. */
  frontOffset: number;
  /** Below this speed the car counts as stopped. */
  standstillSpeed: number;
}

const DEFAULT_OPTIONS: TrackerOptions = {
  params: CONFIG.route,
  world: CONFIG.world,
  frontOffset: CONFIG.vehicle.length / 2,
  standstillSpeed: CONFIG.controls.standstillSpeed,
};

const LINE_KINDS: readonly Zone['kind'][] = ['stopLine', 'giveWayLine', 'signalOff'];

export function createTracker(
  route: Route,
  car: Pose,
  counts = { completed: 0, reroutes: 0 },
  params: RouteParams = CONFIG.route,
): RouteTracker {
  const p = projectWithin(route.path, car, 0, params.tracking.searchAhead);
  return {
    route,
    progress: p.s,
    reached: p.s,
    offset: p.offset,
    distance: p.distance,
    next: 0,
    nextStarted: false,
    // Empty, so the first step reports the zones the car starts in.
    inside: [],
    awaySeconds: 0,
    offRoute: false,
    arrived: false,
    ...counts,
  };
}

export function stepTracker(
  tracker: RouteTracker,
  car: CarSnapshot,
  dt: number,
  network: RoadNetwork,
  options: TrackerOptions = DEFAULT_OPTIONS,
): { tracker: RouteTracker; events: RouteEvent[] } {
  if (tracker.arrived) return { tracker, events: [] };
  if (tracker.offRoute) return findWayBack(tracker, car, network, options);

  const t = options.params.tracking;
  const { route } = tracker;
  const events: RouteEvent[] = [];
  const p = projectWithin(route.path, car, tracker.progress - t.searchBehind, tracker.progress + t.searchAhead);
  const facingAway = car.speed > t.headingCheckSpeed && Math.abs(normalizeAngle(car.heading - p.heading)) > t.offRouteHeading;
  if (p.distance > t.offRouteDistance || facingAway) {
    const awaySeconds = tracker.awaySeconds + dt;
    if (awaySeconds < t.offRouteSeconds) return { tracker: { ...tracker, awaySeconds, distance: p.distance }, events };
    for (const id of tracker.inside) events.push({ type: 'zoneLeft', zone: route.zones[id] as Zone });
    events.push({ type: 'leftRoute' });
    const left = { ...tracker, awaySeconds, distance: p.distance, inside: [], offRoute: true, nextStarted: false };
    // On a road already (a U-turn mid-block): the way back can be found straight away.
    const back = findWayBack(left, car, network, options);
    return { tracker: back.tracker, events: [...events, ...back.events] };
  }

  const progress = p.s;
  const reached = Math.max(tracker.reached, progress);

  // Zones are entered and left by the middle of the car; lines are crossed by its front.
  const inside = route.zones.filter((z) => z.from < z.to && progress >= z.from && progress < z.to).map((z) => z.id);
  for (const id of tracker.inside) if (!inside.includes(id)) events.push({ type: 'zoneLeft', zone: route.zones[id] as Zone });
  for (const id of inside) if (!tracker.inside.includes(id)) events.push({ type: 'zoneEntered', zone: route.zones[id] as Zone });
  const frontBefore = tracker.reached + options.frontOffset;
  const frontNow = reached + options.frontOffset;
  for (const zone of route.zones) {
    if (LINE_KINDS.includes(zone.kind) && zone.from > frontBefore && zone.from <= frontNow) {
      events.push({ type: 'lineCrossed', zone });
    }
  }

  let { next, nextStarted, completed } = tracker;
  let arrived = false;
  for (let m = route.maneuvers[next]; m; m = route.maneuvers[next]) {
    if (!nextStarted && reached > m.start) {
      nextStarted = true;
      events.push({ type: 'maneuverStarted', maneuver: m });
    }
    if (m.kind === 'pullOver') {
      // Done only by stopping in the stopping place, close to the kerb.
      const box = route.zones.find((z) => z.kind === 'stopBox' && z.maneuver === m.index);
      const inBox = !!box && progress >= box.from && progress <= box.to;
      if (inBox && Math.abs(car.speed) < options.standstillSpeed && p.offset >= t.finishMinOffset) {
        arrived = true;
        completed += 1;
        next += 1;
        events.push({ type: 'maneuverCompleted', maneuver: m }, { type: 'arrived' });
      }
      break;
    }
    if (!nextStarted || reached < m.end) break;
    events.push({ type: 'maneuverCompleted', maneuver: m });
    next += 1;
    completed += 1;
    nextStarted = false;
  }

  return {
    tracker: {
      ...tracker,
      progress,
      reached,
      offset: p.offset,
      distance: p.distance,
      next,
      nextStarted,
      inside,
      awaySeconds: 0,
      arrived,
      completed,
    },
    events,
  };
}

/**
 * Off the route: as soon as the car is in a lane (not in a junction, on the grass or on the wrong
 * side of the road), a new way back from there.
 */
function findWayBack(
  tracker: RouteTracker,
  car: CarSnapshot,
  network: RoadNetwork,
  options: TrackerOptions,
): { tracker: RouteTracker; events: RouteEvent[] } {
  const where = locate(network, car, car.heading, options.world);
  if (where.kind !== 'road' || where.place === 'oncoming') return { tracker, events: [] };
  const plan = reroute(network, tracker.route, { laneId: where.laneId, s: where.s }, tracker.reached);
  if (!plan) return { tracker, events: [] };
  const route = buildRoute(network, plan, options.params, options.world);
  const fresh = createTracker(route, car, { completed: tracker.completed, reroutes: tracker.reroutes + 1 }, options.params);
  return { tracker: fresh, events: [{ type: 'rerouted', route }] };
}
