import type { RulesParams } from '../config';
import type { Maneuver } from '../route/route';
import { collision, failedToGiveWay, followingTooClosely } from './faults';
import type { FaultDraft, RulesSnapshot } from './types';

// The learner and the other traffic (stage 8). NZ restricted test: failing to give way so that
// another road user has to take evasive action is an immediate failure, and so is a collision;
// following too closely is a critical error (NZ Road Code: keep at least 2 seconds behind).
// Who has to give way comes from the traffic (traffic/priority.ts) in the snapshot.

export interface TrafficRulesState {
  /** Cars the learner has already failed to give way to (one fault each). */
  faultedCars: readonly number[];
  collided: boolean;
  /** Following: since when closer than the minor and the critical gap, how bad it got, and how many times. */
  closeSince: number | null;
  tooCloseSince: number | null;
  level: number;
  episode: number;
}

export function createTrafficRulesState(): TrafficRulesState {
  return { faultedCars: [], collided: false, closeSince: null, tooCloseSince: null, level: 0, episode: 0 };
}

export function stepTrafficRules(
  state: TrafficRulesState,
  snap: RulesSnapshot,
  params: RulesParams['traffic'],
): { state: TrafficRulesState; faults: FaultDraft[] } {
  const faults: FaultDraft[] = [];
  const s = { ...state };
  const { traffic, time } = snap;

  if (traffic.collision && !s.collided) {
    s.collided = true;
    faults.push(collision(traffic.collision));
  }

  // Another car braked hard because of the learner: a fault if the learner had to give way to it
  // at a junction, or was pulling out from the kerb in front of it.
  for (const carId of traffic.evasive) {
    if (s.faultedCars.includes(carId)) continue;
    const conflict = traffic.conflicts.find((c) => c.carId === carId && c.learnerGivesWay);
    const pullOut = pullingOut(snap, params.pullOutGrace);
    if (!conflict && !pullOut) continue;
    s.faultedCars = [...s.faultedCars, carId];
    const m = pullOut ?? (snap.offRoute ? null : (snap.route.maneuvers[snap.next] ?? null));
    faults.push(failedToGiveWay(m, conflict?.from ?? 'behind'));
  }

  // Following distance, in seconds behind the car ahead.
  const speed = Math.abs(snap.speed);
  const ahead = traffic.ahead;
  const seconds = ahead && speed * 3.6 > params.followMinKmh ? Math.max(0, ahead.gap) / speed : Infinity;
  if (seconds >= params.followMinorSeconds) {
    if (s.level > 0) s.episode += 1;
    s.closeSince = null;
    s.tooCloseSince = null;
    s.level = 0;
  } else {
    s.closeSince ??= time;
    s.tooCloseSince = seconds < params.followCriticalSeconds ? (s.tooCloseSince ?? time) : null;
    let level = 0;
    if (s.tooCloseSince !== null && time - s.tooCloseSince >= params.followCriticalFor) level = 2;
    else if (time - s.closeSince >= params.followMinorFor) level = 1;
    if (level > s.level) {
      s.level = level;
      faults.push(followingTooClosely(level === 2 ? 'critical' : 'minor', seconds, `follow-${s.episode}`));
    }
  }
  return { state: s, faults };
}

/** The pull-out from the kerb, while the learner is doing it or has only just done it. */
function pullingOut(snap: RulesSnapshot, grace: number): Maneuver | null {
  if (snap.offRoute) return null;
  const { maneuvers } = snap.route;
  const next = maneuvers[snap.next];
  if (next?.kind === 'pullOut') return next;
  const previous = maneuvers[snap.next - 1];
  // A car coming up behind may brake a little after the learner is in the lane.
  if (previous?.kind === 'pullOut' && snap.progress < previous.end + grace) return previous;
  return null;
}

/** The learner is held up by the car ahead or is giving way: a reason to drive slowly. */
export function heldUp(snap: RulesSnapshot, heldUpGap: number): boolean {
  const { ahead, conflicts } = snap.traffic;
  if (ahead && ahead.gap < heldUpGap) return true;
  return conflicts.some((c) => c.learnerGivesWay && !c.carClear && !c.learnerClear);
}
