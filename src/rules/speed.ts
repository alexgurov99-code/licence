import type { RulesParams } from '../config';
import { speeding, tooSlow } from './faults';
import type { FaultDraft, RulesSnapshot, Severity } from './types';

// Speed against the limit. Over the limit: minor if a little and for a while; NZ restricted test:
// 5 km/h over is a critical error, 10 over (or 5 over for 5 seconds) an immediate failure. One
// fault per time over the limit, the worst it got. Too slow: 10 km/h under with no reason.

const LEVELS: readonly (Severity | null)[] = [null, 'minor', 'critical', 'immediateFail'];

export interface SpeedState {
  /** The limit that applies (km/h), or null before the car has been on a road; a lower one waiting to apply since `dropSince`. */
  limit: number | null;
  dropSince: number | null;
  /** Since when the car has been over the limit by the minor and critical margins. */
  minorSince: number | null;
  criticalSince: number | null;
  /** The worst level reached this time over the limit (index into LEVELS), and how many times over so far. */
  level: number;
  episode: number;
  /** Since when the car has been too slow, and whether that has been faulted. */
  slowSince: number | null;
  slowFaulted: boolean;
}

export function createSpeedState(): SpeedState {
  return {
    limit: null,
    dropSince: null,
    minorSince: null,
    criticalSince: null,
    level: 0,
    episode: 0,
    slowSince: null,
    slowFaulted: false,
  };
}

export function stepSpeed(
  state: SpeedState,
  snap: RulesSnapshot,
  params: RulesParams['speed'],
): { state: SpeedState; faults: FaultDraft[] } {
  const faults: FaultDraft[] = [];
  const { time } = snap;
  const s = { ...state };

  // In a junction the limit of the road before it still applies. A lower limit after a junction
  // applies a moment later: its sign stands a few metres along the road.
  const posted = snap.road?.speedLimit ?? null;
  if (posted !== null) {
    if (s.limit === null || posted >= s.limit) {
      s.limit = posted;
      s.dropSince = null;
    } else {
      s.dropSince ??= time;
      if (time - s.dropSince >= params.limitDropGraceSeconds) {
        s.limit = posted;
        s.dropSince = null;
      }
    }
  }
  if (s.limit === null) return { state: s, faults };
  const limit = s.limit;
  const kmh = Math.abs(snap.speed) * 3.6;
  const over = kmh - limit;

  if (over < params.minorOverKmh) {
    s.minorSince = null;
    s.criticalSince = null;
    if (s.level > 0) s.episode += 1;
    s.level = 0;
  } else {
    s.minorSince ??= time;
    s.criticalSince = over >= params.criticalOverKmh ? (s.criticalSince ?? time) : null;
    let level = 0;
    if (over >= params.immediateOverKmh || (s.criticalSince !== null && time - s.criticalSince >= params.immediateOverSeconds)) level = 3;
    else if (over >= params.criticalOverKmh) level = 2;
    else if (time - s.minorSince >= params.minorOverSeconds) level = 1;
    const severity = LEVELS[level];
    if (level > s.level && severity) {
      s.level = level;
      faults.push(speeding(severity, kmh, limit, `speed-${s.episode}`));
    }
  }

  const slow = kmh < limit - params.tooSlowUnderKmh && !slowDrivingExpected(snap, params);
  if (!slow) {
    s.slowSince = null;
    s.slowFaulted = false;
  } else {
    s.slowSince ??= time;
    if (!s.slowFaulted && time - s.slowSince >= params.tooSlowSeconds) {
      s.slowFaulted = true;
      faults.push(tooSlow(kmh, limit));
    }
  }
  return { state: s, faults };
}

/** Near junctions, pulling out or in, off the route or off the lane, slow driving has a reason. */
export function slowDrivingExpected(snap: RulesSnapshot, params: RulesParams['speed']): boolean {
  if (snap.offRoute || snap.arrived || snap.inJunction || snap.nextStarted) return true;
  if (!snap.road || snap.road.place !== 'lane') return true;
  const { maneuvers } = snap.route;
  const next = maneuvers[snap.next];
  if (!next || next.kind === 'pullOut') return true;
  if (next.start - snap.progress < params.slowBeforeManeuver) return true;
  const previousEnd = maneuvers[snap.next - 1]?.end ?? 0;
  return snap.progress - previousEnd < params.slowAfterManeuver;
}
