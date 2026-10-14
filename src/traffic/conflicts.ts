import { CONFIG } from '../config';
import type { RoadNetwork } from '../world/network';
import { normalizeAngle } from '../util/math';
import { pointAt, type Vec2 } from '../world/path';

// Where two paths through the same junction meet: they cross (a right turn across the oncoming
// lane), merge (two cars heading into the same lane) or share a stretch (round a roundabout).
// Worked out once per town from the junction paths. Pure logic.

/** The stretch of each of two junction paths where cars on them would touch. */
export interface ConflictArea {
  /** Distances along the first path (a) and along the second (b). */
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
  /** The paths run the same way there (merging into one lane, or round a roundabout together) rather than crossing. */
  merge: boolean;
}

export interface ConflictTable {
  /** The area of junction paths a and b (as seen from a), or null where they never come close. */
  between(a: number, b: number): ConflictArea | null;
  /**
   * Distance along each junction path to its give-way line: 0 at T and cross junctions (the
   * line is where the lane ends), further in at roundabouts (where the entry meets the circle).
   */
  gate(connectorId: number): number;
}

const SAMPLE_STEP = 0.5;
/** Paths closer than this in direction in the middle of where they meet merge rather than cross. */
const MERGE_ANGLE = 0.6;

export function buildConflicts(network: RoadNetwork, closeDistance: number = CONFIG.traffic.conflictDistance): ConflictTable {
  const areas = new Map<number, ConflictArea>();
  const count = network.connectors.length;
  const samples = network.connectors.map((c) => {
    const points: Vec2[] = [];
    const n = Math.max(1, Math.ceil(c.path.length / SAMPLE_STEP));
    for (let i = 0; i <= n; i++) points.push(pointAt(c.path, (c.path.length * i) / n));
    return { points, step: c.path.length / n };
  });
  const close2 = closeDistance * closeDistance;

  for (const junction of network.junctions) {
    const here = network.connectors.filter((c) => c.junctionId === junction.id);
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        const a = here[i];
        const b = here[j];
        // Paths from the same lane are driven one after the other: the car ahead is just followed.
        if (!a || !b || a.fromLane === b.fromLane) continue;
        const sa = samples[a.id];
        const sb = samples[b.id];
        if (!sa || !sb) continue;
        let aFrom = Infinity;
        let aTo = -Infinity;
        let bFrom = Infinity;
        let bTo = -Infinity;
        sa.points.forEach((p, ia) => {
          sb.points.forEach((q, ib) => {
            const dx = p.x - q.x;
            const dz = p.z - q.z;
            if (dx * dx + dz * dz >= close2) return;
            aFrom = Math.min(aFrom, ia * sa.step);
            aTo = Math.max(aTo, ia * sa.step);
            bFrom = Math.min(bFrom, ib * sb.step);
            bTo = Math.max(bTo, ib * sb.step);
          });
        });
        if (aFrom === Infinity) continue;
        const headingA = pointAt(a.path, (aFrom + aTo) / 2).heading;
        const headingB = pointAt(b.path, (bFrom + bTo) / 2).heading;
        const merge = Math.abs(normalizeAngle(headingA - headingB)) < MERGE_ANGLE;
        areas.set(a.id * count + b.id, { aFrom, aTo, bFrom, bTo, merge });
        areas.set(b.id * count + a.id, { aFrom: bFrom, aTo: bTo, bFrom: aFrom, bTo: aTo, merge });
      }
    }
  }

  const gates = network.connectors.map((c) => {
    const line = network.limitLines.find((l) => l.laneId === c.fromLane && l.junctionId === c.junctionId);
    const laneLength = network.lanes[c.fromLane]?.path.length ?? 0;
    return line ? Math.max(0, line.s - laneLength) : 0;
  });

  return {
    between: (a, b) => areas.get(a * count + b) ?? null,
    gate: (id) => gates[id] ?? 0,
  };
}
