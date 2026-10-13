import { CONFIG, type RouteParams } from '../config';
import { createRandom, type Random } from '../util/random';
import type { Connector, Lane, RoadNetwork } from '../world/network';
import { project } from '../world/path';
import { laneById, laneEndOf, laneIndexAt, type Route, type RoutePlan } from './route';

// Choosing where a route goes: a random test route for the seed, and the way back onto the route
// after a wrong turn. Pure logic, no Three.js.

/** The test route for the town's seed: from the parked car through a few junctions to a stop by the kerb. */
export function planRoute(network: RoadNetwork, params: RouteParams = CONFIG.route): RoutePlan {
  const startLane = laneById(network, network.start.laneId);
  const startS = project(startLane.path, network.start).s;
  const outgoing = connectorsByLane(network);
  const hasRoundabout = network.junctions.some((j) => j.kind === 'roundabout');
  let best: { plan: RoutePlan; score: number } | null = null;
  // Like the town plan: if a route lacks variety, try again with the same seed and the next attempt number.
  for (let attempt = 0; attempt < params.maxAttempts; attempt++) {
    const random = createRandom(`${network.seed}/route/${attempt}`);
    const count = random.int(params.minManeuvers, params.maxManeuvers);
    const walk = randomWalk(network, outgoing, startLane.id, count, random, params);
    if (!walk) continue;
    const plan: RoutePlan = { ...walk, startS, fromKerb: true };
    const score = variety(network, plan, hasRoundabout);
    if (!best || score > best.score) best = { plan, score };
    if (score === 3) break;
  }
  if (!best) throw new Error(`No route found for seed "${network.seed}"`);
  return best.plan;
}

/** One point each for a left turn, a right turn and a roundabout (if the town has none, that point is free). */
function variety(network: RoadNetwork, plan: RoutePlan, hasRoundabout: boolean): number {
  const passes = plan.connectors.map((id) => {
    const connector = network.connectors[id] as Connector;
    return { connector, roundabout: network.junctions[connector.junctionId]?.kind === 'roundabout' };
  });
  const left = passes.some((p) => !p.roundabout && p.connector.turn === 'left');
  const right = passes.some((p) => !p.roundabout && p.connector.turn === 'right');
  const roundabout = !hasRoundabout || passes.some((p) => p.roundabout);
  return Number(left) + Number(right) + Number(roundabout);
}

/**
 * A walk through `count` junctions that never drives the same lane twice and ends on a lane with
 * room to pull over. Tries the turns in a random (weighted) order and backs up from dead ends.
 */
function randomWalk(
  network: RoadNetwork,
  outgoing: ReadonlyMap<number, readonly Connector[]>,
  startLane: number,
  count: number,
  random: Random,
  params: RouteParams,
): { lanes: number[]; connectors: number[]; endS: number } | null {
  const lanes = [startLane];
  const connectors: number[] = [];
  const used = new Set(lanes);
  let budget = 20000;
  const extend = (): number | null => {
    if (--budget < 0) return null;
    const current = lanes[lanes.length - 1] as number;
    if (connectors.length === count) {
      const spots = finishSpots(laneById(network, current), params);
      if (spots.length === 0) return null;
      const spot = random.pick(spots);
      return random.range(spot.from, spot.to);
    }
    const options = (outgoing.get(current) ?? []).filter((c) => c.turn !== 'uTurn' && !used.has(c.toLane));
    const weight = (c: Connector): number => (c.turn === 'uTurn' ? 0 : params.turnWeights[c.turn]);
    for (const connector of weightedOrder(options, weight, random)) {
      lanes.push(connector.toLane);
      connectors.push(connector.id);
      used.add(connector.toLane);
      const endS = extend();
      if (endS !== null) return endS;
      lanes.pop();
      connectors.pop();
      used.delete(connector.toLane);
    }
    return null;
  };
  const endS = extend();
  return endS === null ? null : { lanes, connectors, endS };
}

/**
 * Where on a lane the car can stop by the kerb at the end: on a straight, clear of the junction
 * ahead, and far enough from the junction behind to signal for the full time first.
 */
export function finishSpots(lane: Lane, params: RouteParams = CONFIG.route): { from: number; to: number }[] {
  const half = params.stopBoxLength / 2;
  const signalRoom = (lane.speedLimit / 3.6) * params.minSignalSeconds;
  const earliest = params.finishAfterJunction + signalRoom + params.pullOverLength;
  const latest = lane.path.length - params.finishBeforeJunction - half;
  const spots: { from: number; to: number }[] = [];
  let s = 0;
  for (const piece of lane.path.pieces) {
    if (piece.kind === 'line') {
      const from = Math.max(s + half, earliest);
      const to = Math.min(s + piece.length - half, latest);
      if (to >= from) spots.push({ from, to });
    }
    s += piece.length;
  }
  return spots;
}

/** Items in a random order where heavier ones tend to come first (each draw is weighted). */
function weightedOrder<T>(items: readonly T[], weight: (item: T) => number, random: Random): T[] {
  return items
    .map((item) => ({ item, key: random.next() ** (1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map(({ item }) => item);
}

/**
 * The quickest way from where the car is back onto the rest of the route, like a satnav: it
 * rejoins the route at the nearest lane not yet driven and follows the original route from there,
 * so the manoeuvres still ahead are kept. `reached` is how far along the route the car got.
 * Returns null if there is no way (cannot happen in a connected town).
 */
export function reroute(
  network: RoadNetwork,
  route: Route,
  from: { laneId: number; s: number },
  reached: number,
): RoutePlan | null {
  const { plan } = route;
  const last = plan.lanes.length - 1;
  const index = laneIndexAt(route, reached);
  const firstTarget = Math.min(reached >= laneEndOf(route, network, index) ? index + 1 : index, last);
  const targets = new Map<number, number>();
  for (let i = firstTarget; i <= last; i++) targets.set(plan.lanes[i] as number, i);

  const rest = (i: number, lanes: number[], connectors: number[], startS: number): RoutePlan => ({
    lanes: [...lanes, ...plan.lanes.slice(i + 1)],
    connectors: [...connectors, ...plan.connectors.slice(i)],
    startS,
    endS: plan.endS,
    fromKerb: false,
  });

  // Already on a lane of the route, before the stopping place if it is the last one.
  const here = targets.get(from.laneId);
  if (here !== undefined && (here < last || from.s < plan.endS)) return rest(here, [from.laneId], [], from.s);

  // Shortest drive to the start of each lane (Dijkstra; the town has about a hundred lanes).
  const outgoing = connectorsByLane(network);
  const cost = new Map<number, number>();
  const via = new Map<number, { connector: Connector; first: boolean }>();
  const settled = new Set<number>();
  const relax = (laneFrom: number, base: number, first: boolean): void => {
    for (const connector of outgoing.get(laneFrom) ?? []) {
      const total = base + connector.path.length;
      if (total < (cost.get(connector.toLane) ?? Infinity)) {
        cost.set(connector.toLane, total);
        via.set(connector.toLane, { connector, first });
      }
    }
  };
  relax(from.laneId, laneById(network, from.laneId).path.length - from.s, true);
  for (;;) {
    let next: number | null = null;
    for (const [lane, c] of cost) {
      if (!settled.has(lane) && (next === null || c < (cost.get(next) as number))) next = lane;
    }
    if (next === null) return null;
    settled.add(next);
    const target = targets.get(next);
    if (target !== undefined) {
      const connectors: Connector[] = [];
      for (let lane = next; ; ) {
        const step = via.get(lane);
        if (!step) throw new Error('Broken shortest path');
        connectors.unshift(step.connector);
        if (step.first) break;
        lane = step.connector.fromLane;
      }
      return rest(
        target,
        [from.laneId, ...connectors.map((c) => c.toLane)],
        connectors.map((c) => c.id),
        from.s,
      );
    }
    relax(next, (cost.get(next) as number) + laneById(network, next).path.length, false);
  }
}

/** The junction paths that lead on from the end of each lane. */
export function connectorsByLane(network: RoadNetwork): Map<number, Connector[]> {
  const byLane = new Map<number, Connector[]>();
  for (const connector of network.connectors) {
    const list = byLane.get(connector.fromLane) ?? [];
    list.push(connector);
    byLane.set(connector.fromLane, list);
  }
  return byLane;
}
