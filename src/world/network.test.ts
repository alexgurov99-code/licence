import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { normalizeAngle } from '../util/math';
import { dirHeading, opposite } from './layout';
import { locate } from './locate';
import { buildNetwork, houseOutline, turnBetween, type Lane, type RoadNetwork, type Sign } from './network';
import {
  distance,
  forward,
  leftOf,
  pathEnd,
  pathStart,
  pointAt,
  pointOnPiece,
  project,
  samplePath,
  type Path,
  type Pose,
  type Vec2,
} from './path';

const W = CONFIG.world;
const HALF_LANE = W.laneWidth / 2;
const ROAD_HALF_WIDTH = W.laneWidth + W.shoulderWidth;
const SEEDS = Array.from({ length: 60 }, (_, i) => `network-${i}`);
const networks = SEEDS.map((seed) => buildNetwork(seed));

function forEachNetwork(check: (network: RoadNetwork) => void): void {
  for (const network of networks) {
    try {
      check(network);
    } catch (error) {
      throw new Error(`seed "${network.seed}": ${(error as Error).message}`, { cause: error });
    }
  }
}

function lane(network: RoadNetwork, id: number): Lane {
  const found = network.lanes[id];
  if (!found) throw new Error(`no lane ${id}`);
  return found;
}

function expectSamePose(a: Pose, b: Pose, label: string): void {
  if (distance(a, b) > 1e-6) throw new Error(`${label}: points ${distance(a, b)} m apart`);
  const turn = Math.abs(normalizeAngle(a.heading - b.heading));
  if (turn > 1e-6) throw new Error(`${label}: kink of ${turn} rad`);
}

/** Every piece of the path starts where the previous one ended, in the same direction. */
function expectSmooth(path: Path, label: string): void {
  for (let i = 1; i < path.pieces.length; i++) {
    const before = path.pieces[i - 1];
    const after = path.pieces[i];
    if (!before || !after) continue;
    expectSamePose(pointOnPiece(before, before.length), pointOnPiece(after, 0), `${label}, piece ${i}`);
  }
}

/** Sideways distance of `p` from a pose: positive = on its left. */
function sideways(pose: Pose, p: Vec2): number {
  const left = leftOf(pose.heading);
  return (p.x - pose.x) * left.x + (p.z - pose.z) * left.z;
}

/** Distance of `p` ahead of a pose along its heading. */
function ahead(pose: Pose, p: Vec2): number {
  const f = forward(pose.heading);
  return (p.x - pose.x) * f.x + (p.z - pose.z) * f.z;
}

describe('road network', () => {
  it('is the same for the same seed', () => {
    expect(JSON.stringify(buildNetwork('repeat'))).toBe(JSON.stringify(buildNetwork('repeat')));
    expect(JSON.stringify(buildNetwork('repeat'))).not.toBe(JSON.stringify(buildNetwork('repeat2')));
  });

  it('has smooth roads, lanes and junction paths with no breaks or kinks', () => {
    forEachNetwork((network) => {
      for (const road of network.roads) expectSmooth(road.centreline, `road ${road.id}`);
      for (const l of network.lanes) {
        expect(l.path.length).toBeGreaterThan(0);
        expectSmooth(l.path, `lane ${l.id}`);
      }
      for (const c of network.connectors) expectSmooth(c.path, `connector ${c.id}`);
    });
  });

  it('joins every junction path to the end of one lane and the start of the next', () => {
    forEachNetwork((network) => {
      for (const c of network.connectors) {
        expectSamePose(pathStart(c.path), pathEnd(lane(network, c.fromLane).path), `connector ${c.id} start`);
        expectSamePose(pathEnd(c.path), pathStart(lane(network, c.toLane).path), `connector ${c.id} end`);
      }
    });
  });

  it('starts and ends roads at the edge of their junctions', () => {
    forEachNetwork((network) => {
      for (const road of network.roads) {
        const start = network.junctions[road.startJunction];
        const end = network.junctions[road.endJunction];
        if (!start || !end) throw new Error('missing junction');
        expect(distance(pathStart(road.centreline), start.centre)).toBeCloseTo(start.size, 6);
        expect(distance(pathEnd(road.centreline), end.centre)).toBeCloseTo(end.size, 6);
      }
    });
  });

  it('keeps each lane on the left of the centre line in its direction of travel', () => {
    forEachNetwork((network) => {
      for (const l of network.lanes) {
        const road = network.roads[l.roadId];
        if (!road) throw new Error('missing road');
        for (const p of samplePath(l.path, 0, l.path.length, 3)) {
          const nearest = project(road.centreline, p);
          expect(nearest.distance).toBeCloseTo(HALF_LANE, 6);
          // The centre line is half a lane to the driver's right.
          expect(sideways(p, nearest)).toBeCloseTo(-HALF_LANE, 6);
        }
      }
    });
  });

  it('lets traffic from every arm of a junction go every way (and round again at roundabouts)', () => {
    forEachNetwork((network) => {
      for (const junction of network.junctions) {
        expect(junction.arms.length).toBe(junction.kind === 'tee' ? 3 : 4);
        for (const from of junction.arms) {
          const exits = network.connectors.filter((c) => c.fromLane === from.inLane);
          const expected = junction.arms.filter((to) => junction.kind === 'roundabout' || to !== from);
          expect(exits.map((c) => c.toLane).sort()).toEqual(expected.map((to) => to.outLane).sort());
          for (const c of exits) {
            expect(c.junctionId).toBe(junction.id);
            const to = junction.arms.find((arm) => arm.outLane === c.toLane);
            if (!to) throw new Error('connector to an unknown arm');
            expect(c.turn).toBe(turnBetween(from.dir, to.dir));
          }
        }
      }
    });
  });

  it('turns the right way on left and right turns', () => {
    forEachNetwork((network) => {
      for (const c of network.connectors) {
        const junction = network.junctions[c.junctionId];
        if (!junction || junction.kind === 'roundabout') continue;
        const change = normalizeAngle(pathEnd(c.path).heading - pathStart(c.path).heading);
        const expected = { left: Math.PI / 2, straight: 0, right: -Math.PI / 2, uTurn: NaN }[c.turn];
        expect(change).toBeCloseTo(expected, 6);
      }
    });
  });

  it('goes clockwise round roundabouts, with the island always on the right', () => {
    forEachNetwork((network) => {
      const roundabouts = network.junctions.filter((j) => j.kind === 'roundabout');
      expect(roundabouts.length).toBeGreaterThanOrEqual(1);
      for (const junction of roundabouts) {
        const paths = network.connectors.filter((c) => c.junctionId === junction.id);
        for (const c of paths) {
          for (const piece of c.path.pieces) {
            if (piece.kind === 'arc' && distance(piece.centre, junction.centre) < 1e-6) expect(piece.sweep).toBeLessThan(0);
          }
          for (const p of samplePath(c.path, 0, c.path.length, 1)) {
            if (distance(p, junction.centre) < W.roundabout.outerRadius) expect(sideways(p, junction.centre)).toBeLessThan(0);
          }
          // Nobody drives over the island.
          for (const p of samplePath(c.path, 0, c.path.length, 0.5)) {
            expect(distance(p, junction.centre)).toBeGreaterThan(W.roundabout.islandRadius + 1);
          }
        }
        // Exits are numbered clockwise; the last one is the way back.
        for (const from of junction.arms) {
          const exits = paths.filter((c) => c.fromLane === from.inLane).sort((a, b) => (a.exit ?? 0) - (b.exit ?? 0));
          expect(exits.map((c) => c.exit)).toEqual(junction.arms.map((_, i) => i + 1));
          expect(exits.map((c) => c.turn)).toEqual(['left', 'straight', 'right', 'uTurn'].slice(4 - junction.arms.length));
        }
      }
    });
  });

  it('can get from any lane to any other lane', () => {
    forEachNetwork((network) => {
      const next = new Map<number, number[]>();
      const previous = new Map<number, number[]>();
      for (const c of network.connectors) {
        next.set(c.fromLane, [...(next.get(c.fromLane) ?? []), c.toLane]);
        previous.set(c.toLane, [...(previous.get(c.toLane) ?? []), c.fromLane]);
      }
      const reach = (links: Map<number, number[]>): number => {
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length > 0) {
          for (const other of links.get(queue.pop() as number) ?? []) {
            if (!seen.has(other)) {
              seen.add(other);
              queue.push(other);
            }
          }
        }
        return seen.size;
      };
      expect(reach(next)).toBe(network.lanes.length);
      expect(reach(previous)).toBe(network.lanes.length);
    });
  });

  it('leaves at least 3 seconds of driving at the limit between junctions, with room to spare', () => {
    forEachNetwork((network) => {
      for (const l of network.lanes) {
        const threeSeconds = (l.speedLimit / 3.6) * 3;
        expect(l.path.length).toBeGreaterThan(threeSeconds + 30);
      }
    });
  });
});

describe('signs and limit lines', () => {
  const controlSigns = (network: RoadNetwork, laneId: number): Sign[] =>
    network.signs.filter((s) => s.laneId === laneId && s.kind !== 'speedLimit');

  it('puts the right sign and limit line on every approach that gives way, and none on the others', () => {
    forEachNetwork((network) => {
      for (const junction of network.junctions) {
        for (const arm of junction.arms) {
          const signs = controlSigns(network, arm.inLane);
          const lines = network.limitLines.filter((l) => l.laneId === arm.inLane);
          const symbols = network.symbols.filter((s) => s.laneId === arm.inLane);
          if (arm.control === 'none') {
            expect(signs).toEqual([]);
            expect(lines).toEqual([]);
            expect(symbols).toEqual([]);
            continue;
          }
          const expectedSign = { stop: 'stop', giveWay: 'giveWay', roundabout: 'roundaboutGiveWay' }[arm.control];
          expect(signs.map((s) => s.kind)).toEqual([expectedSign]);
          expect(lines.map((l) => l.kind)).toEqual([arm.control === 'stop' ? 'stop' : 'giveWay']);
          expect(symbols.map((s) => s.kind)).toEqual([arm.control === 'stop' ? 'stopText' : 'giveWayTriangle']);
          expect(lane(network, arm.inLane).control).toBe(arm.control);
        }
      }
    });
  });

  it('stands Stop and Give Way signs on the left, facing the driver, just before the limit line', () => {
    forEachNetwork((network) => {
      for (const line of network.limitLines) {
        const approach = lane(network, line.laneId);
        const [sign] = controlSigns(network, line.laneId);
        if (!sign) throw new Error('missing sign');
        const end = pathEnd(approach.path);
        // Beyond the shoulder on the driver's left.
        expect(sideways(end, sign)).toBeGreaterThan(ROAD_HALF_WIDTH - HALF_LANE);
        expect(sideways(end, sign)).toBeLessThan(ROAD_HALF_WIDTH - HALF_LANE + 2);
        // Its face looks back at the approaching driver.
        expect(Math.abs(normalizeAngle(sign.facing - (end.heading + Math.PI)))).toBeLessThan(1e-6);
        // Before the limit line, and not far before it.
        const toLine = ahead(end, line.a) + 0; // the line is at or past the lane end
        const signBack = -ahead(end, sign);
        expect(signBack).toBeGreaterThanOrEqual(-1e-6);
        expect(signBack + toLine).toBeGreaterThan(0);
        expect(signBack + toLine).toBeLessThan(8);
      }
    });
  });

  it('draws limit lines across the whole lane: yellow at Stop, white at Give Way', () => {
    forEachNetwork((network) => {
      for (const line of network.limitLines) {
        expect(distance(line.a, line.b)).toBeCloseTo(W.laneWidth, 6);
        const marking = network.markings.find((m) => m.corners[0] === line.a);
        expect(marking?.colour).toBe(line.kind === 'stop' ? 'yellow' : 'white');
        const junction = network.junctions[line.junctionId];
        if (!junction) throw new Error('missing junction');
        if (junction.kind === 'roundabout') {
          // At the edge of the circulating road.
          const middle = { x: (line.a.x + line.b.x) / 2, z: (line.a.z + line.b.z) / 2 };
          expect(distance(middle, junction.centre)).toBeCloseTo(W.roundabout.outerRadius + W.markings.lineWidth, 3);
        } else {
          expect(line.s).toBeCloseTo(lane(network, line.laneId).path.length, 9);
        }
      }
    });
  });

  it('paints STOP or a give-way triangle on the lane before each limit line', () => {
    forEachNetwork((network) => {
      for (const symbol of network.symbols) {
        const l = lane(network, symbol.laneId);
        const nearest = project(l.path, symbol);
        expect(nearest.distance).toBeLessThan(1e-6);
        expect(nearest.s).toBeGreaterThan(symbol.length / 2);
        expect(nearest.s).toBeLessThan(l.path.length);
      }
    });
  });

  it('has at least one Stop and one Give Way on every map, and the roundabout sign on every roundabout entry', () => {
    forEachNetwork((network) => {
      const count = (kind: string): number => network.signs.filter((s) => s.kind === kind).length;
      expect(count('stop')).toBeGreaterThanOrEqual(1);
      expect(count('giveWay')).toBeGreaterThanOrEqual(1);
      const roundaboutEntries = network.junctions.filter((j) => j.kind === 'roundabout').flatMap((j) => j.arms).length;
      expect(count('roundaboutGiveWay')).toBe(roundaboutEntries);
    });
  });

  it('puts a speed limit sign wherever the limit changes, and nowhere else', () => {
    forEachNetwork((network) => {
      const speedSigns = network.signs.filter((s) => s.kind === 'speedLimit');
      for (const c of network.connectors) {
        const from = lane(network, c.fromLane);
        const to = lane(network, c.toLane);
        if (from.speedLimit === to.speedLimit) continue;
        const left = speedSigns.find((s) => s.laneId === to.id && s.side === 'left');
        if (!left) throw new Error(`no speed sign after a change from ${from.speedLimit} to ${to.speedLimit}`);
      }
      for (const sign of speedSigns) {
        const l = lane(network, sign.laneId);
        expect(sign.speedLimit).toBe(l.speedLimit);
        const changes = network.connectors.some(
          (c) => c.toLane === l.id && lane(network, c.fromLane).speedLimit !== l.speedLimit,
        );
        expect(changes).toBe(true);
        // Within 20 m of the change, beside the road, facing the driver.
        const nearest = project(l.path, sign);
        expect(nearest.s).toBeLessThanOrEqual(20);
        expect(Math.abs(nearest.offset)).toBeGreaterThan(ROAD_HALF_WIDTH - HALF_LANE);
        expect(Math.sign(nearest.offset)).toBe(sign.side === 'left' ? 1 : -1);
        expect(Math.abs(normalizeAngle(sign.facing - (nearest.heading + Math.PI)))).toBeLessThan(1e-6);
      }
    });
    // Over many maps the limit does change somewhere.
    expect(networks.some((n) => n.signs.some((s) => s.kind === 'speedLimit'))).toBe(true);
  });

  it('gives each lane the speed limit of its road', () => {
    const { normal, fastMainRoad, slowStreet } = W.speedLimits;
    forEachNetwork((network) => {
      for (const l of network.lanes) {
        expect([normal, fastMainRoad, slowStreet]).toContain(l.speedLimit);
        expect(l.speedLimit).toBe(network.roads[l.roadId]?.speedLimit);
      }
    });
  });

  it('only main-road arms that end at a T give way to a side street', () => {
    forEachNetwork((network) => {
      for (const junction of network.junctions) {
        if (junction.kind === 'roundabout') continue;
        for (const arm of junction.arms) {
          const hasOpposite = junction.arms.some((other) => other.dir === opposite(arm.dir));
          if (arm.roadClass === 'main' && hasOpposite) expect(arm.control).toBe('none');
        }
      }
    });
  });
});

describe('road markings', () => {
  it('has a broken centre line on the middle of every road and solid edge lines outside the lanes', () => {
    forEachNetwork((network) => {
      const white = network.markings.filter((m) => m.colour === 'white');
      for (const road of network.roads) {
        const onRoad = white.filter((m) => {
          const middle = {
            x: m.corners.reduce((sum, p) => sum + p.x, 0) / 4,
            z: m.corners.reduce((sum, p) => sum + p.z, 0) / 4,
          };
          const p = project(road.centreline, middle);
          return p.distance < ROAD_HALF_WIDTH && p.s > 1 && p.s < road.centreline.length - 1;
        });
        const offsets = onRoad.map((m) => {
          const middle = { x: (m.corners[0].x + m.corners[2].x) / 2, z: (m.corners[0].z + m.corners[2].z) / 2 };
          return project(road.centreline, middle).offset;
        });
        expect(offsets.some((o) => Math.abs(o) < 1e-6)).toBe(true);
        expect(offsets.some((o) => Math.abs(o - (W.laneWidth + W.markings.lineWidth / 2)) < 0.01)).toBe(true);
        expect(offsets.some((o) => Math.abs(o + (W.laneWidth + W.markings.lineWidth / 2)) < 0.01)).toBe(true);
        // Broken: the painted share of the centre line matches dash / (dash + gap).
        const centre = onRoad.filter((_, i) => Math.abs(offsets[i] ?? 1) < 1e-6);
        const painted = centre.reduce((sum, m) => sum + distance(m.corners[0], m.corners[1]), 0);
        const share = W.markings.centreDash / (W.markings.centreDash + W.markings.centreGap);
        expect(painted / road.centreline.length).toBeGreaterThan(share * 0.7);
        expect(painted / road.centreline.length).toBeLessThan(share * 1.2);
      }
    });
  });
});

describe('houses', () => {
  it('stand off the roads, clear of junctions and of each other, inside the town', () => {
    forEachNetwork((network) => {
      expect(network.houses.length).toBeGreaterThan(50);
      const limit = network.size / 2;
      const problems: string[] = [];
      network.houses.forEach((house, i) => {
        for (const p of houseOutline(house)) {
          if (Math.abs(p.x) > limit || Math.abs(p.z) > limit) problems.push(`house ${i} outside the town`);
          const road = Math.min(...network.roads.map((r) => project(r.centreline, p).distance));
          if (road < ROAD_HALF_WIDTH + W.houses.clearance - 1e-6) problems.push(`house ${i} ${road.toFixed(2)} m from a road`);
          const junction = Math.min(...network.junctions.map((j) => distance(p, j.centre)));
          if (junction < W.houses.junctionClearance - 1e-6) problems.push(`house ${i} too close to a junction`);
        }
        // No two houses overlap (each footprint is inside a circle, and the circles do not touch).
        for (let j = i + 1; j < network.houses.length; j++) {
          const other = network.houses[j];
          if (!other) continue;
          const reach = (Math.hypot(house.width, house.depth) + Math.hypot(other.width, other.depth)) / 2;
          if (distance(house, other) < reach) problems.push(`houses ${i} and ${j} overlap`);
        }
      });
      expect(problems).toEqual([]);
    });
  });

  it('face the road', () => {
    forEachNetwork((network) => {
      for (const house of network.houses.slice(0, 20)) {
        const front = { x: house.x + forward(house.heading).x * house.depth, z: house.z + forward(house.heading).z * house.depth };
        const nearest = Math.min(...network.roads.map((road) => project(road.centreline, house).distance));
        const nearestFromFront = Math.min(...network.roads.map((road) => project(road.centreline, front).distance));
        expect(nearestFromFront).toBeLessThan(nearest);
      }
    });
  });
});

describe('start position', () => {
  it('is parked on the left shoulder of a straight, facing along the lane with room ahead', () => {
    forEachNetwork((network) => {
      const { start } = network;
      const where = locate(network, start, start.heading);
      if (where.kind !== 'road') throw new Error(`start is ${where.kind}`);
      expect(where.laneId).toBe(start.laneId);
      expect(where.place).toBe('shoulder');
      // The whole car is outside the lane but on the shoulder.
      expect(where.offset - CONFIG.vehicle.width / 2).toBeGreaterThan(HALF_LANE);
      expect(where.offset + CONFIG.vehicle.width / 2).toBeLessThanOrEqual(HALF_LANE + W.shoulderWidth);
      const l = lane(network, start.laneId);
      const along = project(l.path, start);
      expect(Math.abs(normalizeAngle(start.heading - along.heading))).toBeLessThan(1e-9);
      // Straight road ahead for at least the required distance.
      const ahead = pointAt(l.path, along.s + W.start.minRoomAhead);
      expect(Math.abs(normalizeAngle(ahead.heading - start.heading))).toBeLessThan(1e-9);
      expect(l.path.length - along.s).toBeGreaterThanOrEqual(W.start.minRoomAhead);
      expect(network.roads[l.roadId]?.roadClass).toBe('minor');
    });
  });

  it('points along a grid direction', () => {
    forEachNetwork((network) => {
      const fits = [0, 1, 2, 3].some(
        (d) => Math.abs(normalizeAngle(network.start.heading - dirHeading(d as 0 | 1 | 2 | 3))) < 1e-9,
      );
      expect(fits).toBe(true);
    });
  });
});
