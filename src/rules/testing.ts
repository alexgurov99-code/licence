import { createGlanceState, type GlanceTarget } from '../camera/glance';
import { CONFIG } from '../config';
import { planRoute } from '../route/planner';
import { buildRoute, kerbOffset, laneIndexAt, type Maneuver, type Route, type Side } from '../route/route';
import { createTraffic, createTrafficWorld, stepTraffic, type TrafficState, type TrafficWorld } from '../traffic/traffic';
import { NO_TRAFFIC, type TrafficView } from '../traffic/types';
import { createTracker, stepTracker, type RouteEvent, type RouteTracker } from '../route/tracker';
import { createCar } from '../vehicle/car';
import { COCKPIT_READY, type CockpitReadiness } from '../vehicle/cockpitTypes';
import { INDICATORS_OFF } from '../vehicle/indicators';
import { locate } from '../world/locate';
import { buildNetwork, type RoadNetwork } from '../world/network';
import { add, leftOf, pointAt } from '../world/path';
import { createRulesState, stepRules, type RulesState } from './engine';
import { rulesSnapshot } from './snapshot';
import type { Fault, RulesSnapshot } from './types';

// Test helper: a scripted driver that follows a route the way the NZ test expects (mirrors,
// signal, shoulder check, stops at Stop signs, slows for Give Way, keeps to the limit), with
// hooks to make one particular mistake. Runs the real route tracker and rules engine.

export const DT = 1 / 20;
const kmh = (value: number): number => value / 3.6;
const R = CONFIG.route;
const KERB = kerbOffset();
const FRONT = CONFIG.vehicle.length / 2;
/** The driver slows down this far before a junction manoeuvre, and to this speed. */
export const JUNCTION_SLOW_FROM = 35;
export const JUNCTION_SPEED = kmh(15);

export interface DriveContext {
  /** Route distance of the middle of the car, and the first manoeuvre not finished yet. */
  s: number;
  m: Maneuver;
  route: Route;
}

/** Ways to drive differently from the model driver. Each gets what the model driver would do. */
export interface Habits {
  indicator?: (ideal: Side | null, ctx: DriveContext) => Side | null;
  /** m/s */
  speed?: (ideal: number, ctx: DriveContext) => number;
  /** Sideways from the route line, positive = left. */
  offset?: (ideal: number, ctx: DriveContext) => number;
  /** Look in the mirror just before each signal, and over the right shoulder before pulling out. */
  mirrors?: boolean;
  /** An extra glance being held now (counted straight away). */
  glance?: (ctx: DriveContext) => GlanceTarget | null;
  shoulder?: boolean;
  /** Called after every step with what the rules engine saw. */
  onStep?: (snap: RulesSnapshot, rules: RulesState, events: readonly RouteEvent[]) => void;
  /** Stop at Stop lines. */
  stops?: boolean;
  /** Cockpit drill: which parts are adjusted (default all), the belt and adjusting at a given time. */
  cockpit?: CockpitReadiness;
  belt?: (time: number) => boolean;
  adjusting?: (time: number) => boolean;
  /** The engine goes on at this time (default at once). */
  engineOnAt?: number;
  /** Handbrake and P once parked at the end (default true). */
  park?: boolean;
  /**
   * Other traffic: this many cars spread over the town by the seed, then `place` (cars put there
   * by hand). Without it the roads are empty.
   */
  traffic?: { count: number; place?: (world: TrafficWorld, state: TrafficState) => TrafficState };
  /** With traffic: wait for a gap where the learner must give way, and keep 2 seconds behind (default true). */
  givesWay?: boolean;
}

export interface DriveResult {
  route: Route;
  tracker: RouteTracker;
  rules: RulesState;
  faults: readonly Fault[];
  /** With traffic: how long the driver waited to give way, in all. */
  waited: number;
}

const cache = new Map<string, { network: RoadNetwork; route: Route }>();

export function setup(seed: string): { network: RoadNetwork; route: Route } {
  let found = cache.get(seed);
  if (!found) {
    const network = buildNetwork(seed);
    found = { network, route: buildRoute(network, planRoute(network)) };
    cache.set(seed, found);
  }
  return found;
}

/** The first of the seeds `rules-0`, `rules-1`... whose route has a manoeuvre that passes the test. */
export function findSeed(test: (m: Maneuver, route: Route) => boolean, tries = 60): { seed: string; m: Maneuver } {
  for (let i = 0; i < tries; i += 1) {
    const seed = `rules-${i}`;
    const { route } = setup(seed);
    const m = route.maneuvers.find((candidate) => test(candidate, route));
    if (m) return { seed, m };
  }
  throw new Error('No route with such a manoeuvre');
}

/** The indicator the route asks for at route distance s (the signal zone the car is in). */
export function idealIndicator(route: Route, s: number): Side | null {
  const zone = route.zones.find((z) => z.kind === 'signal' && s >= z.from && s < z.to);
  return zone?.side ?? null;
}

export function drive(seed: string, habits: Habits = {}, maxSeconds = 600): DriveResult {
  const { network, route: firstRoute } = setup(seed);
  const mirrors = habits.mirrors ?? true;
  const shoulder = habits.shoulder ?? true;
  const stops = habits.stops ?? true;

  let tracker = createTracker(firstRoute, network.start);
  let rules = createRulesState();
  let glance = createGlanceState();
  const look = (target: GlanceTarget, time: number): void => {
    glance = { ...glance, lastChecked: { ...glance.lastChecked, [target]: time } };
  };

  let s = 0;
  let time = 0;
  let lever: Side | null = null;
  let stoppedAt: number | null = null;
  const stopLinesDone = new Set<number>();
  const route = tracker.route;
  const pullOut = route.maneuvers[0]?.kind === 'pullOut';

  const park = habits.park ?? true;
  const engineOnAt = habits.engineOnAt ?? 0;
  let arrivedAt: number | null = null;
  let lastPose = { x: network.start.x, z: network.start.z, heading: network.start.heading };

  // Other traffic, and what it meant for the driver at the last step.
  const world = habits.traffic ? trafficWorld(seed) : null;
  let traffic: TrafficState | null = null;
  if (world && habits.traffic) {
    traffic = createTraffic(world, seed, network.start, habits.traffic.count);
    if (habits.traffic.place) traffic = habits.traffic.place(world, traffic);
  }
  let view: TrafficView = NO_TRAFFIC;
  const givesWay = habits.givesWay ?? true;
  let movedOff = !pullOut;
  let waited = 0;
  let lastShoulder = -Infinity;
  // After arriving the driver secures the car a second later; the drive is over once the rules say so.
  while (time < maxSeconds && !rules.finished) {
    time += DT;
    if (tracker.arrived) {
      arrivedAt ??= time;
      const secured = park && time - arrivedAt > 1;
      const parkedCar = createCar({
        motion: { ...lastPose, speed: 0 },
        controls: { engineOn: true, beltFastened: true, gear: secured ? 'P' : 'D', handbrake: secured },
      });
      const snap = rulesSnapshot(time, parkedCar, glance, tracker, locate(network, parkedCar.motion, parkedCar.motion.heading));
      rules = stepRules(rules, snap, []).state;
      habits.onStep?.(snap, rules, []);
      continue;
    }
    const m = route.maneuvers.find((candidate) => candidate.end > s || candidate.kind === 'pullOver') as Maneuver;
    const ctx: DriveContext = { s, m, route };

    // Pulling out: mirrors at 0.5 s, signal at 1 s, over the shoulder at 4.5 s, move off at 5 s
    // (with traffic: once no car is coming up behind; the look over the shoulder is repeated).
    if (!movedOff && time >= 5) movedOff = !givesWay || !traffic || !world || !comingBehind(traffic, network.start.laneId, route);
    const parked = pullOut && !movedOff;
    if (parked && time >= 5) waited += DT;
    let ideal = idealIndicator(route, s);
    if (parked) ideal = time >= 1 ? 'right' : null;
    const wanted = habits.indicator ? habits.indicator(ideal, ctx) : ideal;
    if (wanted !== lever && wanted && mirrors && !parked) look('interiorMirror', time);
    if (parked && mirrors && time >= 0.5 && time < 0.6) look('interiorMirror', time);
    if (parked && shoulder && time >= 4.5 && time - lastShoulder > 2) {
      look('rightShoulder', time);
      lastShoulder = time;
    }
    const extra = habits.glance?.(ctx);
    if (extra) look(extra, time);
    lever = wanted;

    // Speed: a little under the limit, slow through junctions, stop at Stop lines and at the end.
    const limit = m.speedLimit;
    let speed = parked ? 0 : kmh(limit - 5);
    if (m.junctionId !== null && s > m.start - JUNCTION_SLOW_FROM) speed = JUNCTION_SPEED;
    if (m.kind === 'pullOver' && s > m.start - JUNCTION_SLOW_FROM) speed = JUNCTION_SPEED;
    const stopLine = route.zones.find((z) => z.kind === 'stopLine' && !stopLinesDone.has(z.id) && z.from - (s + FRONT) < 1.5);
    if (stopLine && stops && !parked) {
      stoppedAt ??= time;
      speed = 0;
      if (time - stoppedAt > 1.5) {
        stopLinesDone.add(stopLine.id);
        stoppedAt = null;
        speed = JUNCTION_SPEED;
      }
    }
    if (m.kind === 'pullOver' && s >= route.finishS) speed = 0;
    if (givesWay && !parked) {
      // Two seconds (and a bit) behind the car ahead.
      if (view.ahead) speed = Math.min(speed, Math.max(0, (view.ahead.gap - 4) / 2.5));
      // Wait at the line while a car to give way to is close.
      const waitFor = view.conflicts.some(
        (c) => c.learnerGivesWay && !c.carClear && !c.learnerClear && (c.carTo <= 0 || (c.carSpeed > 0.3 && c.carTo / c.carSpeed < 7)),
      );
      const line = m.junctionId !== null ? m.start : Infinity;
      if (waitFor && s + FRONT >= line - 2 && s + FRONT < line + 0.5) {
        speed = 0;
        waited += DT;
      }
    }
    if (habits.speed && !parked) speed = habits.speed(speed, ctx);

    // Sideways: out from the kerb at the start, in to the kerb at the end.
    const outOfKerb = pullOut ? Math.max(0, 1 - s / R.pullOutLength) : 0;
    const intoKerb = Math.min(1, Math.max(0, (s - (route.finishS - R.pullOverLength)) / R.pullOverLength));
    let offset = KERB * Math.max(outOfKerb, intoKerb);
    if (habits.offset) offset = habits.offset(offset, ctx);

    s = Math.min(s + speed * DT, route.finishS);
    const p = pointAt(tracker.route.path, Math.min(s, tracker.route.path.length));
    const pose = { ...add(p, leftOf(p.heading), offset), heading: p.heading };
    lastPose = pose;
    const car = createCar({
      motion: { x: pose.x, z: pose.z, heading: pose.heading, speed },
      controls: {
        indicators: { ...INDICATORS_OFF, lever },
        engineOn: time >= engineOnAt,
        beltFastened: habits.belt ? habits.belt(time) : true,
        gear: parked ? 'P' : 'D',
        handbrake: parked,
      },
    });
    const step = stepTracker(tracker, { ...pose, speed }, DT, network);
    tracker = step.tracker;
    if (world && traffic) {
      const plan = tracker.route.plan;
      const result = stepTraffic(
        world,
        traffic,
        {
          ...pose,
          speed,
          length: CONFIG.vehicle.length,
          width: CONFIG.vehicle.width,
          indicator: lever,
          routeConnector: tracker.offRoute ? null : (plan.connectors[laneIndexAt(tracker.route, tracker.progress)] ?? null),
        },
        DT,
        habits.traffic?.count,
      );
      traffic = result.state;
      view = result.view;
    }
    const snap = rulesSnapshot(
      time,
      car,
      glance,
      tracker,
      locate(network, pose, pose.heading),
      { readiness: habits.cockpit ?? COCKPIT_READY, adjusting: habits.adjusting?.(time) ?? false },
      view,
    );
    rules = stepRules(rules, snap, step.events).state;
    habits.onStep?.(snap, rules, step.events);
  }
  return { route, tracker, rules, faults: rules.faults, waited };
}

const worlds = new Map<string, TrafficWorld>();

function trafficWorld(seed: string): TrafficWorld {
  let world = worlds.get(seed);
  if (!world) {
    world = createTrafficWorld(setup(seed).network);
    worlds.set(seed, world);
  }
  return world;
}

/** A car coming up behind in the lane the driver pulls out into, close enough to need to brake. */
function comingBehind(traffic: TrafficState, laneId: number, route: Route): boolean {
  const startS = route.plan.startS;
  return traffic.cars.some((c) => {
    if (c.onConnector || c.segment !== laneId || c.s > startS) return false;
    return startS - c.s < 15 || (startS - c.s) / Math.max(c.speed, 0.1) < 8;
  });
}

/** "kind@manoeuvre" for each fault, for compact expectations. */
export function faultList(faults: readonly Fault[]): string[] {
  return faults.map((f) => `${f.kind}@${f.maneuver ?? '-'}`);
}
