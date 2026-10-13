import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { buildNetwork, type RoadNetwork } from '../world/network';
import { add, leftOf, pointAt, type Path, type Pose } from '../world/path';
import { currentInstruction, ordinal, roundDistance } from './instructions';
import { planRoute } from './planner';
import { buildRoute, kerbOffset, type Route } from './route';
import { createTracker, stepTracker, type CarSnapshot, type RouteEvent, type RouteTracker } from './tracker';

const R = CONFIG.route;
const DT = 1 / 20;
const SPEED = 10;
const KERB = kerbOffset();

function setup(seed: string): { network: RoadNetwork; route: Route } {
  const network = buildNetwork(seed);
  return { network, route: buildRoute(network, planRoute(network)) };
}

/** A pose `offset` metres to the left of the path at distance s. */
function beside(path: Path, s: number, offset: number): Pose {
  const p = pointAt(path, s);
  return { ...add(p, leftOf(p.heading), offset), heading: p.heading };
}

/** The car driven along the route: out from the kerb, along the lanes and in to the kerb at the end. */
function routeDrive(route: Route, to = route.finishS, step = SPEED * DT): CarSnapshot[] {
  const cars: CarSnapshot[] = [];
  for (let s = 0; s <= to; s += step) {
    const outOfKerb = Math.max(0, 1 - s / R.pullOutLength);
    const intoKerb = Math.min(1, Math.max(0, (s - (route.finishS - R.pullOverLength)) / R.pullOverLength));
    cars.push({ ...beside(route.path, s, KERB * Math.max(outOfKerb, intoKerb)), speed: SPEED });
  }
  return cars;
}

function run(
  tracker: RouteTracker,
  cars: readonly CarSnapshot[],
  network: RoadNetwork,
): { tracker: RouteTracker; events: RouteEvent[] } {
  const events: RouteEvent[] = [];
  let current = tracker;
  for (const car of cars) {
    const result = stepTracker(current, car, DT, network);
    current = result.tracker;
    events.push(...result.events);
  }
  return { tracker: current, events };
}

const stopped = (car: CarSnapshot | undefined, steps = 10): CarSnapshot[] =>
  car ? Array.from({ length: steps }, () => ({ ...car, speed: 0 })) : [];

describe('following the route', () => {
  for (const seed of ['tracker-1', 'tracker-2', 'tracker-3', 'tracker-4']) {
    it(`reports every manoeuvre, zone and line in order and arrives (${seed})`, () => {
      const { network, route } = setup(seed);
      const drive = routeDrive(route);
      const { tracker, events } = run(createTracker(route, network.start), [...drive, ...stopped(drive.at(-1))], network);

      expect(events.some((e) => e.type === 'leftRoute' || e.type === 'rerouted')).toBe(false);
      expect(tracker.arrived).toBe(true);
      expect(events.at(-1)?.type).toBe('arrived');
      expect(tracker.completed).toBe(route.maneuvers.length);

      // Each manoeuvre starts and then completes, one after another.
      const steps = events.flatMap((e) =>
        e.type === 'maneuverStarted' || e.type === 'maneuverCompleted' ? [`${e.type === 'maneuverStarted' ? '+' : '-'}${e.maneuver.index}`] : [],
      );
      expect(steps).toEqual(route.maneuvers.flatMap((m) => [`+${m.index}`, `-${m.index}`]));

      // Every zone with a length is entered once and left once, except those the car stops in at the end.
      const lastProgress = tracker.progress;
      for (const zone of route.zones.filter((z) => z.from < z.to)) {
        const entered = events.filter((e) => e.type === 'zoneEntered' && e.zone.id === zone.id).length;
        const left = events.filter((e) => e.type === 'zoneLeft' && e.zone.id === zone.id).length;
        const stillIn = lastProgress >= zone.from && lastProgress < zone.to;
        expect([zone.kind, entered, left]).toEqual([zone.kind, 1, stillIn ? 0 : 1]);
      }
      expect(tracker.inside.map((id) => route.zones[id]?.kind).sort()).toEqual(['signal', 'stopBox']);
      // Every line is crossed once, in order along the route.
      const lines = route.zones.filter((z) => z.kind === 'stopLine' || z.kind === 'giveWayLine' || z.kind === 'signalOff');
      const crossed = events.flatMap((e) => (e.type === 'lineCrossed' ? [e.zone.id] : []));
      expect(crossed).toEqual(lines.filter((z) => z.from <= route.finishS + CONFIG.vehicle.length / 2).map((z) => z.id));
    });
  }

  it('crosses a line when the front of the car reaches it', () => {
    const { network, route } = setup('tracker-1');
    const line = route.zones.find((z) => z.kind === 'stopLine' || z.kind === 'giveWayLine');
    if (!line) throw new Error('no line on this route');
    let tracker = createTracker(route, network.start);
    for (const car of routeDrive(route, line.from + 5, 0.1)) {
      const result = stepTracker(tracker, car, DT, network);
      if (result.events.some((e) => e.type === 'lineCrossed' && e.zone.id === line.id)) {
        expect(result.tracker.progress + CONFIG.vehicle.length / 2).toBeCloseTo(line.from, 0);
        return;
      }
      tracker = result.tracker;
    }
    throw new Error('line never crossed');
  });

  it('only counts as arrived when stopped near the kerb in the stopping place', () => {
    const { network, route } = setup('tracker-2');
    let tracker = run(createTracker(route, network.start), routeDrive(route, route.finishS - 30), network).tracker;
    // Stopped in the middle of the lane beside the stopping place: not yet.
    const inLane: CarSnapshot[] = [];
    for (let s = route.finishS - 30; s <= route.finishS; s += SPEED * DT) inLane.push({ ...beside(route.path, s, 0), speed: SPEED });
    tracker = run(tracker, [...inLane, ...stopped(inLane.at(-1))], network).tracker;
    expect(tracker.arrived).toBe(false);
    // Rolling slowly past near the kerb: not yet either.
    tracker = run(tracker, [{ ...beside(route.path, route.finishS, KERB), speed: 1.5 }], network).tracker;
    expect(tracker.arrived).toBe(false);
    tracker = run(tracker, stopped({ ...beside(route.path, route.finishS, KERB), speed: 0 }, 1), network).tracker;
    expect(tracker.arrived).toBe(true);
  });
});

describe('leaving the route', () => {
  it('finds a new way back after a wrong turn, keeping the count of manoeuvres done', () => {
    const { network, route } = setup('tracker-3');
    const m = route.maneuvers.filter((x) => x.junctionId !== null)[2];
    if (!m || m.connectorId === null) throw new Error('route too short');
    const planned = network.connectors[m.connectorId];
    const wrong = network.connectors.find((c) => c.fromLane === planned?.fromLane && c.id !== planned.id && c.turn !== 'uTurn');
    if (!wrong) throw new Error('no other way at this junction');
    const wrongLane = network.lanes[wrong.toLane];
    if (!wrongLane) throw new Error('no lane');

    const approach = routeDrive(route, m.start);
    const turn: CarSnapshot[] = [];
    for (let s = 0; s <= wrong.path.length; s += SPEED * DT) turn.push({ ...beside(wrong.path, s, 0), speed: SPEED });
    for (let s = 0; s <= 30; s += SPEED * DT) turn.push({ ...beside(wrongLane.path, s, 0), speed: SPEED });
    const { tracker, events } = run(createTracker(route, network.start), [...approach, ...turn], network);

    const types = events.map((e) => e.type);
    expect(types).toContain('leftRoute');
    expect(types.indexOf('rerouted')).toBeGreaterThan(types.indexOf('leftRoute'));
    expect(tracker.offRoute).toBe(false);
    expect(tracker.reroutes).toBe(1);
    expect(tracker.route.plan.lanes[0]).toBe(wrongLane.id);
    expect(tracker.route.maneuvers[0]?.kind).not.toBe('pullOut');
    // Pulling out and the two junctions before were done; the missed one is not counted.
    expect(tracker.completed).toBe(3);
    expect(currentInstruction(tracker).icon).not.toBe('reroute');
  });

  it('notices a U-turn in the middle of a road', () => {
    const { network, route } = setup('tracker-4');
    const drive = routeDrive(route, 60);
    const last = drive.at(-1) as CarSnapshot;
    // Turned round onto the other side of the road and driving back.
    const back = beside(route.path, 55, -3.5);
    const reversed: CarSnapshot[] = Array.from({ length: 40 }, (_, i) => {
      const p = beside(route.path, 55 - i * SPEED * DT, -3.5);
      return { ...p, heading: p.heading + Math.PI, speed: SPEED };
    });
    const { tracker, events } = run(createTracker(route, network.start), [...drive, { ...last }, { ...back, speed: 0 }, ...reversed], network);
    const types = events.map((e) => e.type);
    expect(types).toContain('leftRoute');
    expect(types).toContain('rerouted');
    expect(tracker.route.plan.lanes[0]).not.toBe(route.plan.lanes[0]);
  });

  it('goes round the block when the car drives past the stopping place', () => {
    const { network, route } = setup('tracker-1');
    const lastLane = network.lanes[route.plan.lanes.at(-1) as number];
    if (!lastLane) throw new Error('no lane');
    const past: CarSnapshot[] = [];
    // On through the stopping place to the end of the lane and into the junction.
    const laneEndS = route.laneStarts.at(-1)! + lastLane.path.length;
    for (let s = 0; s <= laneEndS; s += SPEED * DT) past.push({ ...beside(route.path, s, 0), speed: SPEED });
    const next = network.connectors.find((c) => c.fromLane === lastLane.id && c.turn !== 'uTurn');
    const nextLane = next && network.lanes[next.toLane];
    if (!next || !nextLane) throw new Error('no way on');
    for (let s = 0; s <= next.path.length; s += SPEED * DT) past.push({ ...beside(next.path, s, 0), speed: SPEED });
    for (let s = 0; s <= 20; s += SPEED * DT) past.push({ ...beside(nextLane.path, s, 0), speed: SPEED });
    const { tracker } = run(createTracker(route, network.start), past, network);
    expect(tracker.arrived).toBe(false);
    expect(tracker.reroutes).toBe(1);
    expect(tracker.route.plan.lanes.at(-1)).toBe(lastLane.id);
    expect(tracker.completed).toBe(route.maneuvers.length - 1);
  });
});

describe('satnav instructions', () => {
  it('round distances like a satnav', () => {
    expect(roundDistance(123)).toBe(120);
    expect(roundDistance(4)).toBe(10);
    expect(roundDistance(296)).toBe(300);
    expect(roundDistance(312)).toBe(300);
    expect(roundDistance(338)).toBe(350);
    expect([1, 2, 3, 4, 11, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '21st']);
  });

  it('say what to do next', () => {
    const { network, route } = setup('tracker-1');
    let tracker = createTracker(route, network.start);
    expect(currentInstruction(tracker).text).toBe('Pull out from the kerb when it is safe');
    // Moving off: the first junction is announced with its distance.
    tracker = run(tracker, routeDrive(route, 5), network).tracker;
    const first = route.maneuvers[1];
    if (!first) throw new Error('no junction');
    const instruction = currentInstruction(tracker);
    expect(instruction.icon).toBe(first.kind);
    expect(instruction.text).toMatch(/^In \d+ m (turn left|turn right|go straight on|at the roundabout take the \d(st|nd|rd|th) exit)/);
    // Right at the junction the distance is no longer said.
    tracker = run(tracker, routeDrive(route, first.start - 5).slice(-20), network).tracker;
    expect(currentInstruction(tracker).text).not.toMatch(/^In /);
  });

  it('describe roundabout exits by number', () => {
    for (let i = 0; i < 20; i++) {
      const { network, route } = setup(`tracker-ra-${i}`);
      const m = route.maneuvers.find((x) => x.kind === 'roundabout');
      if (!m) continue;
      const tracker = run(createTracker(route, network.start), routeDrive(route, m.start - 60), network).tracker;
      if (tracker.next !== m.index) continue;
      expect(currentInstruction(tracker).text).toMatch(new RegExp(`at the roundabout take the ${ordinal(m.exit ?? 0)} exit`));
      return;
    }
    throw new Error('no roundabout found to test');
  });
});

describe('waiting to find a way back', () => {
  it('does not plan a new route while the car is on the wrong side of the road', () => {
    const { network, route } = setup('tracker-2');
    const drive = routeDrive(route, 60);
    // Still facing the right way, but over on the far side of the road for a while.
    const wrongSide: CarSnapshot[] = Array.from({ length: 60 }, (_, i) => ({
      ...beside(route.path, 60 + i * SPEED * DT, -7),
      speed: SPEED,
    }));
    const { tracker, events } = run(createTracker(route, network.start), [...drive, ...wrongSide], network);
    expect(events.map((e) => e.type)).toContain('leftRoute');
    expect(tracker.offRoute).toBe(true);
    expect(tracker.reroutes).toBe(0);
    expect(currentInstruction(tracker).icon).toBe('reroute');
    // Back in its own lane: the route carries on from there.
    const back = run(tracker, [{ ...beside(route.path, 95, 0), speed: SPEED }], network).tracker;
    expect(back.offRoute).toBe(false);
    expect(back.route.plan.lanes[0]).toBe(route.plan.lanes[0]);
  });
});
