import { CONFIG, type WorldParams } from '../config';
import type { RoadClass } from './layout';
import type { JunctionKind, RoadNetwork } from './network';
import { forward, project, type Projection, type Vec2 } from './path';

// "Where is the car?" on the road network: which road and lane, how far from the middle of the
// lane, and the speed limit there. Pure logic; the debug panel shows it now and the rules engine
// (stage 5) will build on it.

/**
 * Which part of the road the car is on, seen from its direction of travel:
 * its own lane, the shoulder to the left of it, or across the centre line.
 */
export type RoadPlace = 'lane' | 'shoulder' | 'oncoming';

export type Whereabouts =
  | {
      kind: 'road';
      roadId: number;
      roadClass: RoadClass;
      /** The lane going the way the car faces. */
      laneId: number;
      /** Sideways distance from the middle of that lane: positive = left of it. */
      offset: number;
      place: RoadPlace;
      /** Distance along the lane from its start. */
      s: number;
      /** km/h. */
      speedLimit: number;
    }
  | { kind: 'junction'; junctionId: number; junctionKind: JunctionKind }
  | { kind: 'offRoad' };

export function locate(
  network: RoadNetwork,
  position: Vec2,
  heading: number,
  params: WorldParams = CONFIG.world,
): Whereabouts {
  for (const junction of network.junctions) {
    const dx = position.x - junction.centre.x;
    const dz = position.z - junction.centre.z;
    const inside =
      junction.kind === 'roundabout'
        ? Math.hypot(dx, dz) <= junction.size
        : Math.abs(dx) <= junction.size && Math.abs(dz) <= junction.size;
    if (inside) return { kind: 'junction', junctionId: junction.id, junctionKind: junction.kind };
  }

  const halfLane = params.laneWidth / 2;
  const roadHalfWidth = params.laneWidth + params.shoulderWidth;
  let road: RoadNetwork['roads'][number] | null = null;
  let projection: Projection | null = null;
  for (const candidate of network.roads) {
    const p = project(candidate.centreline, position);
    if (Math.abs(p.offset) > roadHalfWidth || p.distance > roadHalfWidth) continue;
    if (!projection || p.distance < projection.distance) {
      road = candidate;
      projection = p;
    }
  }
  if (!road || !projection) return { kind: 'offRoad' };

  // Facing along the centreline: the forward lane, which lies to the left of the centre line.
  const along = forward(projection.heading);
  const facing = forward(heading);
  const withRoad = along.x * facing.x + along.z * facing.z >= 0;
  const lane = network.lanes[withRoad ? road.forwardLane : road.backwardLane];
  if (!lane) return { kind: 'offRoad' };
  const offset = withRoad ? projection.offset - halfLane : -projection.offset - halfLane;
  const place: RoadPlace = offset > halfLane ? 'shoulder' : offset < -halfLane ? 'oncoming' : 'lane';
  return {
    kind: 'road',
    roadId: road.id,
    roadClass: road.roadClass,
    laneId: lane.id,
    offset,
    place,
    s: withRoad ? projection.s : road.centreline.length - projection.s,
    speedLimit: lane.speedLimit,
  };
}
