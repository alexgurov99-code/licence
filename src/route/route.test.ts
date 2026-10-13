import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { normalizeAngle } from '../util/math';
import { locate } from '../world/locate';
import { buildNetwork, type RoadNetwork } from '../world/network';
import { distance, pathStart, pointAt, project } from '../world/path';
import { finishSpots, planRoute, reroute } from './planner';
import { buildRoute, laneEndOf, type Maneuver, type Route, type Zone } from './route';

const R = CONFIG.route;
const SEEDS = Array.from({ length: 50 }, (_, i) => `route-${i}`);
const cases = SEEDS.map((seed) => {
  const network = buildNetwork(seed);
  return { network, route: buildRoute(network, planRoute(network)) };
});

function forEachRoute(check: (route: Route, network: RoadNetwork) => void): void {
  for (const { network, route } of cases) {
    try {
      check(route, network);
    } catch (error) {
      throw new Error(`seed "${network.seed}": ${(error as Error).message}`, { cause: error });
    }
  }
}

const zonesOf = (route: Route, m: Maneuver, kind?: Zone['kind']): Zone[] =>
  route.zones.filter((z) => z.maneuver === m.index && (kind === undefined || z.kind === kind));

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

describe('planned route', () => {
  it('is the same for the same seed', () => {
    const network = buildNetwork('same-route');
    expect(planRoute(network)).toEqual(planRoute(buildNetwork('same-route')));
    expect(planRoute(network)).not.toEqual(planRoute(buildNetwork('other-route')));
  });

  it('pulls out, goes through 6 to 10 junctions and pulls over', () => {
    forEachRoute((route) => {
      const kinds = route.maneuvers.map((m) => m.kind);
      check(kinds[0] === 'pullOut', 'does not start by pulling out');
      check(kinds[kinds.length - 1] === 'pullOver', 'does not end by pulling over');
      const junctions = route.maneuvers.filter((m) => m.junctionId !== null).length;
      check(junctions >= R.minManeuvers && junctions <= R.maxManeuvers, `${junctions} junctions`);
      route.maneuvers.forEach((m, i) => check(m.index === i, 'manoeuvres out of order'));
    });
  });

  it('starts where the car is parked, never drives a lane twice and makes no U-turns', () => {
    forEachRoute((route, network) => {
      check(route.plan.lanes[0] === network.start.laneId, 'starts on another lane');
      check(project(route.path, network.start).s < 1e-6, 'does not start beside the car');
      check(new Set(route.plan.lanes).size === route.plan.lanes.length, 'drives a lane twice');
      for (const id of route.plan.connectors) check(network.connectors[id]?.turn !== 'uTurn', 'U-turn');
    });
  });

  it('has a left turn, a right turn and a roundabout', () => {
    forEachRoute((route) => {
      const kinds = new Set(route.maneuvers.map((m) => m.kind));
      for (const kind of ['left', 'right', 'roundabout'] as const) check(kinds.has(kind), `no ${kind}`);
    });
  });

  it('is one continuous path through the lanes and junctions', () => {
    forEachRoute((route, network) => {
      for (let s = 0; s < route.path.length; s += 5) {
        const p = pointAt(route.path, s);
        const where = locate(network, p, p.heading);
        check(where.kind !== 'offRoad', `off the road at ${s.toFixed(0)} m`);
        if (where.kind === 'road') check(Math.abs(where.offset) < 1e-6 && where.place === 'lane', `not in the lane at ${s} m`);
      }
    });
  });
});

describe('signal zones', () => {
  it('give at least 3 seconds at the speed limit, but never begin before the previous manoeuvre is over', () => {
    forEachRoute((route) => {
      for (const m of route.maneuvers) {
        if (!m.signal) continue;
        const earliest = m.index > 0 ? (route.maneuvers[m.index - 1] as Maneuver).end : 0;
        const [mirror] = zonesOf(route, m, 'mirror');
        const [signal] = zonesOf(route, m, 'signal');
        if (!mirror || !signal) throw new Error(`${m.kind} without mirror or signal zone`);
        check(signal.side === m.signal, 'signal zone for the wrong side');
        check(mirror.from === earliest && mirror.to === signal.from, 'mirror zone is not just before the signal zone');
        const seconds = (m.start - signal.from) / (m.speedLimit / 3.6);
        const clamped = Math.abs(signal.from - earliest) < 1e-9;
        check(seconds >= R.minSignalSeconds - 1e-9 || clamped, `${m.kind}: signal due ${seconds.toFixed(1)} s before`);
      }
    });
  });

  it('follow the NZ roundabout rules', () => {
    let seen = { left: 0, straight: 0, right: 0 };
    forEachRoute((route) => {
      for (const m of route.maneuvers.filter((x) => x.kind === 'roundabout')) {
        const signals = zonesOf(route, m, 'signal');
        const sides = signals.map((z) => z.side).join(' then ');
        if (m.turn === 'left') {
          // Left (first exit): signal left on the approach and keep it on until leaving.
          check(sides === 'left' && signals[0]?.to === m.end, `left: ${sides}`);
          seen = { ...seen, left: seen.left + 1 };
        } else if (m.turn === 'straight') {
          // Straight on: no signal on the approach; signal left after passing the exit before.
          const exit = signals[0];
          check(sides === 'left' && !!exit && exit.from > m.start && exit.to === m.end, `straight: ${sides}`);
          seen = { ...seen, straight: seen.straight + 1 };
        } else {
          // Right: signal right on the approach, then left after passing the exit before.
          const [right, left] = signals;
          check(sides === 'right then left' && !!right && !!left, `right: ${sides}`);
          check(right?.to === left?.from && (left?.from ?? 0) > m.start && left?.to === m.end, 'right: change-over point');
          seen = { ...seen, right: seen.right + 1 };
        }
      }
    });
    expect(Math.min(seen.left, seen.straight, seen.right)).toBeGreaterThan(0);
  });

  it('end with an "indicator off" line after the manoeuvre and before the next signal', () => {
    forEachRoute((route) => {
      for (const m of route.maneuvers) {
        const signals = zonesOf(route, m, 'signal');
        const off = zonesOf(route, m, 'signalOff');
        if (m.kind === 'pullOver' || signals.length === 0) {
          check(off.length === 0, `${m.kind}: unexpected indicator-off line`);
          continue;
        }
        const line = off[0];
        if (!line) throw new Error(`${m.kind}: no indicator-off line`);
        check(line.from === line.to && line.from >= m.end && line.from <= m.end + R.signalOffDistance, 'off line misplaced');
        const next = route.zones.find((z) => z.kind === 'signal' && z.maneuver > m.index);
        if (next) check(line.from <= next.from + 1e-9, 'off line after the next signal');
      }
    });
  });
});

describe('junction lines and the stopping place', () => {
  it('put a stop line at every Stop and a give-way line at every Give Way and roundabout', () => {
    forEachRoute((route, network) => {
      for (const m of route.maneuvers.filter((x) => x.junctionId !== null)) {
        const stops = zonesOf(route, m, 'stopLine');
        const giveWays = zonesOf(route, m, 'giveWayLine');
        if (m.control === 'stop') check(stops.length === 1 && giveWays.length === 0, 'Stop without a stop line');
        else if (m.control === 'none') check(stops.length + giveWays.length === 0, 'line where there is no sign');
        else check(giveWays.length === 1 && stops.length === 0, `${m.control} without a give-way line`);
        const line = stops[0] ?? giveWays[0];
        if (!line) continue;
        // The zone sits exactly on the painted line.
        const limit = network.limitLines.find((l) => l.junctionId === m.junctionId && l.kind === (stops[0] ? 'stop' : 'giveWay'));
        const at = pointAt(route.path, line.from);
        const nearest = Math.min(
          ...network.limitLines
            .filter((l) => l.junctionId === m.junctionId)
            .map((l) => distance(at, { x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 })),
        );
        check(!!limit && nearest < 1e-6, 'line zone is not on the painted line');
      }
    });
  });

  it('end parked by the kerb on a straight, clear of junctions, with room to signal', () => {
    forEachRoute((route, network) => {
      const pullOver = route.maneuvers[route.maneuvers.length - 1] as Maneuver;
      const [box] = zonesOf(route, pullOver, 'stopBox');
      if (!box) throw new Error('no stopping place');
      check(Math.abs((box.from + box.to) / 2 - route.finishS) < 1e-9, 'stopping place not around the finish');
      const where = locate(network, route.finish, route.finish.heading);
      check(where.kind === 'road' && where.place === 'shoulder', 'finish is not on the shoulder');
      const lastIndex = route.plan.lanes.length - 1;
      check(laneEndOf(route, network, lastIndex) - route.finishS >= R.finishBeforeJunction, 'too close to the junction ahead');
      const [signal] = zonesOf(route, pullOver, 'signal');
      const previous = route.maneuvers[route.maneuvers.length - 2] as Maneuver;
      check(!!signal && signal.from - previous.end >= R.finishAfterJunction - 1e-9, 'no room to signal');
      const lane = network.lanes[route.plan.lanes[lastIndex] as number];
      check(!!lane && finishSpots(lane).some((s) => route.plan.endS >= s.from && route.plan.endS <= s.to), 'not a finish spot');
    });
  });
});

describe('rerouting', () => {
  it('after a wrong turn, finds the way back and keeps the rest of the route', () => {
    let tried = 0;
    forEachRoute((route, network) => {
      // Take a different exit at the second junction.
      const m = route.maneuvers.filter((x) => x.junctionId !== null)[1];
      if (!m || m.connectorId === null) return;
      const planned = network.connectors[m.connectorId];
      const wrong = network.connectors.find(
        (c) => c.fromLane === planned?.fromLane && c.id !== planned.id && c.turn !== 'uTurn',
      );
      if (!wrong) return;
      tried += 1;
      const plan = reroute(network, route, { laneId: wrong.toLane, s: 5 }, m.start + 3);
      if (!plan) throw new Error('no way back');
      const detour = buildRoute(network, plan);
      check(plan.lanes[0] === wrong.toLane && !plan.fromKerb, 'does not start where the car is');
      check(detour.maneuvers[0]?.kind !== 'pullOut', 'pulls out again');
      // It ends with the rest of the original route, from a lane after the missed junction.
      const missed = route.plan.lanes.indexOf(planned?.fromLane ?? -1);
      const endsWith = (k: number): boolean => {
        const rest = route.plan.lanes.slice(k);
        return JSON.stringify(plan.lanes.slice(plan.lanes.length - rest.length)) === JSON.stringify(rest);
      };
      const rejoin = route.plan.lanes.findIndex((_, k) => k > missed && endsWith(k));
      check(rejoin > missed, 'does not rejoin the rest of the route');
      expect(plan.endS).toBe(route.plan.endS);
    });
    expect(tried).toBeGreaterThan(20);
  });

  it('continues straight on when the car is already on a lane of the route', () => {
    const { network, route } = cases[0] as (typeof cases)[number];
    const laneId = route.plan.lanes[3] as number;
    const plan = reroute(network, route, { laneId, s: 10 }, route.laneStarts[2] as number);
    expect(plan?.lanes).toEqual(route.plan.lanes.slice(3));
    expect(plan?.startS).toBe(10);
  });

  it('goes round again after driving past the stopping place', () => {
    forEachRoute((route, network) => {
      const lastIndex = route.plan.lanes.length - 1;
      const lastLane = route.plan.lanes[lastIndex] as number;
      const plan = reroute(network, route, { laneId: lastLane, s: route.plan.endS + 20 }, route.finishS + 20);
      if (!plan) throw new Error('no way back');
      check(plan.lanes.length > 1 && plan.lanes[plan.lanes.length - 1] === lastLane, 'does not come back to the last lane');
      const detour = buildRoute(network, plan);
      check(distance(detour.finish, route.finish) < 1e-6, 'finish moved');
      check(distance(pathStart(detour.path), pointAt(network.lanes[lastLane]?.path ?? route.path, route.plan.endS + 20)) < 1e-6, 'start');
    });
  });
});

describe('bends of the road', () => {
  it('are the quarter turns of bend tiles, between junctions, the way the route turns', () => {
    let count = 0;
    forEachRoute((route) => {
      for (const bend of route.bends) {
        count += 1;
        const turned = normalizeAngle(pointAt(route.path, bend.to).heading - pointAt(route.path, bend.from).heading);
        check(Math.abs(Math.abs(turned) - Math.PI / 2) < 0.05 || bend.from === 0, `bend turns ${turned.toFixed(2)}`);
        check((turned > 0) === (bend.side === 'left'), 'bend goes the other way');
        const inJunction = route.maneuvers.some((m) => m.junctionId !== null && bend.to > m.start && bend.from < m.end);
        check(!inJunction, 'bend inside a junction');
      }
    });
    expect(count).toBeGreaterThan(20);
  });
});
