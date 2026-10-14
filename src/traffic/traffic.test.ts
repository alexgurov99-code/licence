import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { joinPaths, pointAt, type Pose } from '../world/path';
import { buildNetwork, type Connector, type Junction, type JunctionArm } from '../world/network';
import { bodiesOverlap } from './collision';
import { addCar, createTraffic, createTrafficWorld, LEARNER, stepTraffic, type LearnerInput, type TrafficState } from './traffic';

const P = CONFIG.traffic;
const DT = 1 / 60;
const network = buildNetwork('traffic');
const world = createTrafficWorld(network);

function learnerAt(pose: Pose, speed = 0, extra: Partial<LearnerInput> = {}): LearnerInput {
  return { ...pose, speed, length: CONFIG.vehicle.length, width: CONFIG.vehicle.width, indicator: null, routeConnector: null, ...extra };
}

/** Off the roads, near a junction (in a block of houses): the cars do not see it. */
function bystander(junction: Junction): LearnerInput {
  return learnerAt({ x: junction.centre.x + 45, z: junction.centre.z + 45, heading: 0 });
}

function empty(): TrafficState {
  return createTraffic(world, 'traffic', network.start, 0);
}

/** A T or cross junction with an arm that has this sign. */
function signedArm(control: 'stop' | 'giveWay'): { junction: Junction; arm: JunctionArm } {
  for (const junction of network.junctions) {
    if (junction.kind === 'roundabout') continue;
    const arm = junction.arms.find((a) => a.control === control);
    if (arm) return { junction, arm };
  }
  throw new Error(`No ${control} junction in the test town`);
}

function exitOf(laneId: number, turns: readonly Connector['turn'][]): Connector {
  for (const turn of turns) {
    const found = world.exits[laneId]?.find((c) => c.turn === turn);
    if (found) return found;
  }
  throw new Error('No such way out');
}

function laneLength(id: number): number {
  return network.lanes[id]?.path.length ?? 0;
}

describe('traffic', () => {
  it('drives the same way for the same seed', () => {
    const run = (): string => {
      let state = createTraffic(world, 'traffic', network.start);
      const learner = learnerAt(network.start);
      for (let i = 0; i < 600; i++) state = stepTraffic(world, state, learner, DT).state;
      return JSON.stringify(state.cars.map((c) => [c.id, c.x.toFixed(3), c.z.toFixed(3), c.speed.toFixed(3)]));
    };
    expect(run()).toBe(run());
  });

  it('keeps the cars apart, on the roads, and always about the same number of them', () => {
    for (const seed of ['traffic', 'traffic-2']) {
      const town = seed === 'traffic' ? network : buildNetwork(seed);
      const townWorld = seed === 'traffic' ? world : createTrafficWorld(town);
      let state = createTraffic(townWorld, seed, town.start);
      const learner = learnerAt(town.start);
      let touching = 0;
      let moving = 0;
      for (let i = 0; i < 60 * 120; i++) {
        state = stepTraffic(townWorld, state, learner, DT).state;
        const cars = state.cars;
        for (let a = 0; a < cars.length; a++) {
          for (let b = a + 1; b < cars.length; b++) if (bodiesOverlap(cars[a] as never, cars[b] as never)) touching += 1;
        }
        moving += cars.filter((c) => c.speed > 1).length / cars.length;
      }
      expect(touching).toBe(0);
      expect(state.cars.length).toBe(P.count);
      // Most of the time most cars are on the move.
      expect(moving / (60 * 120)).toBeGreaterThan(0.6);
    }
  });

  it('stops at a Stop line, then goes', () => {
    const { junction, arm } = signedArm('stop');
    const next = exitOf(arm.inLane, ['straight', 'left', 'right']);
    let state = addCar(world, empty(), { laneId: arm.inLane, s: laneLength(arm.inLane) - 60, next: next.id });
    const learner = bystander(junction);
    let slowestAtLine = Infinity;
    let stoppedFrom: number | null = null;
    for (let i = 0; i < 60 * 40; i++) {
      state = stepTraffic(world, state, learner, DT, 0).state;
      const car = state.cars[0];
      if (!car || car.onConnector) break;
      const toLine = laneLength(arm.inLane) - (car.s + car.length / 2);
      if (toLine < P.stopNear) slowestAtLine = Math.min(slowestAtLine, car.speed);
      if (car.speed === 0 && stoppedFrom === null) stoppedFrom = toLine;
    }
    expect(slowestAtLine).toBe(0);
    expect(stoppedFrom).toBeGreaterThan(0);
    expect(stoppedFrom).toBeLessThan(P.stopNear);
    expect(state.cars[0]?.onConnector).toBe(true);
  });

  it('signals before turning, not long before', () => {
    const { junction, arm } = signedArm('giveWay');
    const left = exitOf(arm.inLane, ['left']);
    let state = addCar(world, empty(), { laneId: arm.inLane, s: laneLength(arm.inLane) - 90, next: left.id });
    const learner = bystander(junction);
    const seen: { toEnd: number; indicator: string | null }[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      state = stepTraffic(world, state, learner, DT, 0).state;
      const car = state.cars[0];
      if (!car || car.onConnector) break;
      seen.push({ toEnd: laneLength(arm.inLane) - car.s, indicator: car.indicator });
    }
    expect(seen.find((x) => x.toEnd > 70)?.indicator).toBeNull();
    expect(seen.filter((x) => x.toEnd < P.signalMinDistance).every((x) => x.indicator === 'left')).toBe(true);
  });

  /** A give-way arm and a path on the main road that crosses or joins the way the car takes from it. */
  function giveWayScene(): { junction: Junction; arm: JunctionArm; side: Connector; main: Connector } {
    const { junction, arm } = signedArm('giveWay');
    const side = exitOf(arm.inLane, ['right', 'straight', 'left']);
    for (const other of junction.arms) {
      if (other.control !== 'none') continue;
      const main = world.exits[other.inLane]?.find((c) => c.turn === 'straight' && world.conflicts.between(side.id, c.id));
      if (main) return { junction, arm, side, main };
    }
    throw new Error('No crossing path on the main road');
  }

  /** The learner driving along the main road and through the junction at a steady speed. */
  function learnerDriving(main: Connector, from: number, speed: number, time: number): LearnerInput {
    const lane = network.lanes[main.fromLane];
    const out = network.lanes[main.toLane];
    if (!lane || !out) throw new Error('No lanes');
    const path = joinPaths([lane.path, main.path, out.path]);
    const s = from + speed * time;
    const pose = pointAt(path, s);
    return learnerAt(pose, speed, { routeConnector: main.id });
  }

  it('waits at a Give Way for the learner on the main road', () => {
    const { arm, side, main } = giveWayScene();
    let state = addCar(world, empty(), { laneId: arm.inLane, s: laneLength(arm.inLane) - 30, next: side.id, speed: 5 });
    const start = laneLength(main.fromLane) - 70;
    let gaveWay = false;
    let enteredAt: number | null = null;
    let touched = false;
    for (let i = 0; i < 60 * 15; i++) {
      const learner = learnerDriving(main, start, 12, i * DT);
      state = stepTraffic(world, state, learner, DT, 0).state;
      const car = state.cars[0];
      if (!car) break;
      if (car.givingWayTo.includes(LEARNER)) gaveWay = true;
      if (car.onConnector && enteredAt === null) enteredAt = i * DT;
      if (bodiesOverlap(car, learner)) touched = true;
    }
    expect(gaveWay).toBe(true);
    expect(touched).toBe(false);
    // The learner reaches the junction after (70 - 2) / 12 ≈ 5.7 s and is through it a second or two later.
    expect(enteredAt).toBeGreaterThan(6.5);
  });

  it('tells the learner to give way to a car on the main road, and where it comes from', () => {
    const { arm, side, main } = giveWayScene();
    let state = addCar(world, empty(), { laneId: main.fromLane, s: laneLength(main.fromLane) - 50, next: main.id, speed: 12 });
    const lane = network.lanes[arm.inLane];
    if (!lane) throw new Error('No lane');
    // Stopped just before the give-way line, going the way that meets the car's.
    const learner = learnerAt(pointAt(lane.path, lane.path.length - 3), 0, { routeConnector: side.id });
    const { view } = stepTraffic(world, state, learner, DT, 0);
    state = stepTraffic(world, state, learner, DT, 0).state;
    const conflict = view.conflicts.find((c) => c.carId === state.cars[0]?.id);
    expect(conflict?.learnerGivesWay).toBe(true);
    expect(conflict?.carClear).toBe(false);
    expect(['left', 'right']).toContain(conflict?.from);
  });

  it('brakes for the learner ahead; hard ("evasive") only when the learner pulls out close in front', () => {
    const lane = network.lanes.reduce((a, b) => (b.path.length > a.path.length ? b : a));
    const behind = (gap: number): { evasive: boolean; touched: boolean; stopped: boolean } => {
      let state = addCar(world, empty(), { laneId: lane.id, s: 10, next: exitOf(lane.id, ['straight', 'left', 'right']).id, speed: 13 });
      const learner = learnerAt(pointAt(lane.path, 10 + gap), 0);
      let evasive = false;
      let touched = false;
      for (let i = 0; i < 60 * 20; i++) {
        const result = stepTraffic(world, state, learner, DT, 0);
        state = result.state;
        if (result.view.evasive.length > 0) evasive = true;
        if (state.cars[0] && bodiesOverlap(state.cars[0], learner)) touched = true;
      }
      return { evasive, touched, stopped: (state.cars[0]?.speed ?? 1) === 0 };
    };
    expect(behind(20)).toMatchObject({ evasive: true });
    expect(behind(110)).toEqual({ evasive: false, touched: false, stopped: true });
  });

  it('new cars appear out of the learner\'s sight', () => {
    let state = createTraffic(world, 'traffic', network.start);
    const first = state.nextId;
    const learner = learnerAt(network.start);
    const ahead = { x: Math.sin(network.start.heading), z: Math.cos(network.start.heading) };
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 90; i++) {
      state = stepTraffic(world, state, learner, DT).state;
      for (const car of state.cars) {
        if (car.id < first || seen.has(car.id)) continue;
        seen.add(car.id);
        const dx = car.x - learner.x;
        const dz = car.z - learner.z;
        const away = Math.hypot(dx, dz);
        expect(away).toBeGreaterThanOrEqual(P.spawnMinDistance - 1);
        const angle = Math.acos((dx * ahead.x + dz * ahead.z) / away);
        if (away < P.spawnFrontDistance) expect(angle).toBeGreaterThanOrEqual(P.spawnFrontAngle);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
