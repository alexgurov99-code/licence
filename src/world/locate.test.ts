import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { locate } from './locate';
import { buildNetwork } from './network';
import { add, leftOf, pointAt } from './path';

const network = buildNetwork('locate-test');
const HALF_LANE = CONFIG.world.laneWidth / 2;

describe('where the car is', () => {
  const lane = network.lanes.find((l) => l.path.length > 80);
  if (!lane) throw new Error('no long lane');
  const middle = pointAt(lane.path, lane.path.length / 2);
  const at = (sideways: number, heading = middle.heading) =>
    locate(network, add(middle, leftOf(middle.heading), sideways), heading);

  it('finds the lane, its speed limit and the distance along it', () => {
    const where = at(0);
    expect(where.kind).toBe('road');
    if (where.kind !== 'road') return;
    expect(where.laneId).toBe(lane.id);
    expect(where.roadId).toBe(lane.roadId);
    expect(where.offset).toBeCloseTo(0, 9);
    expect(where.place).toBe('lane');
    expect(where.speedLimit).toBe(lane.speedLimit);
    expect(where.s).toBeCloseTo(lane.path.length / 2, 6);
  });

  it('measures the offset from the middle of the lane, positive to the left', () => {
    const left = at(1);
    const right = at(-1);
    expect(left.kind === 'road' && left.offset).toBeCloseTo(1, 9);
    expect(right.kind === 'road' && right.offset).toBeCloseTo(-1, 9);
  });

  it('tells the lane from the shoulder and from the other side of the centre line', () => {
    expect(at(HALF_LANE + 1)).toMatchObject({ place: 'shoulder', laneId: lane.id });
    expect(at(-HALF_LANE - 1)).toMatchObject({ place: 'oncoming', laneId: lane.id });
  });

  it('uses the lane that goes the way the car faces', () => {
    const turnedRound = at(0, middle.heading + Math.PI);
    expect(turnedRound.kind).toBe('road');
    if (turnedRound.kind !== 'road') return;
    const road = network.roads[lane.roadId];
    expect(turnedRound.laneId).toBe(lane.forward ? road?.backwardLane : road?.forwardLane);
    // Facing the other way in this lane means being on the wrong side of the road.
    expect(turnedRound.offset).toBeCloseTo(-2 * HALF_LANE, 9);
    expect(turnedRound.place).toBe('oncoming');
  });

  it('reports junctions and places off the road', () => {
    const junction = network.junctions[0];
    if (!junction) throw new Error('no junction');
    expect(locate(network, junction.centre, 0)).toEqual({
      kind: 'junction',
      junctionId: junction.id,
      junctionKind: junction.kind,
    });
    expect(locate(network, { x: 5000, z: 0 }, 0)).toEqual({ kind: 'offRoad' });
  });
});
