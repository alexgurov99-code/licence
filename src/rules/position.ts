import type { RulesParams } from '../config';
import { centreLine, cutCorner, keepLeft, wrongSide } from './faults';
import type { FaultDraft, RulesSnapshot } from './types';

// Where the car is on the road: left in its lane, not over the centre line, not on the wrong side,
// and not cutting the corner when turning at a T or crossroads. Each time it happens is one fault.

export interface PositionState {
  keepLeftSince: number | null;
  centreLineSince: number | null;
  wrongSideSince: number | null;
  /** Already faulted this time (until the car is back where it should be). */
  keepLeftFaulted: boolean;
  centreLineFaulted: boolean;
  wrongSideFaulted: boolean;
  /** Manoeuvres of the current route already faulted for cutting the corner. */
  cutCorners: readonly number[];
}

export function createPositionState(): PositionState {
  return {
    keepLeftSince: null,
    centreLineSince: null,
    wrongSideSince: null,
    keepLeftFaulted: false,
    centreLineFaulted: false,
    wrongSideFaulted: false,
    cutCorners: [],
  };
}

export interface PositionOptions {
  laneWidth: number;
  carWidth: number;
}

export function stepPosition(
  state: PositionState,
  snap: RulesSnapshot,
  params: RulesParams['position'],
  options: PositionOptions,
): { state: PositionState; faults: FaultDraft[] } {
  const faults: FaultDraft[] = [];
  const s = { ...state };
  const halfLane = options.laneWidth / 2;
  // Positive = left of the middle of the lane the car is driving along.
  const offset = snap.road?.laneOffset ?? 0;
  const onRoad = snap.road !== null && !snap.arrived;

  const wrong = onRoad && offset < -halfLane;
  const overLine = onRoad && offset - options.carWidth / 2 < -halfLane - params.centreLineTolerance;
  const tooFarRight = onRoad && offset < -params.keepLeftOffset;

  const timed = (on: boolean, since: number | null): number | null => (on ? (since ?? snap.time) : null);
  s.wrongSideSince = timed(wrong, s.wrongSideSince);
  s.centreLineSince = timed(overLine, s.centreLineSince);
  s.keepLeftSince = timed(tooFarRight, s.keepLeftSince);
  if (!wrong) s.wrongSideFaulted = false;
  if (!overLine) s.centreLineFaulted = false;
  if (!tooFarRight) s.keepLeftFaulted = false;

  // The worst one only: on the wrong side the car is also over the line and right in its lane.
  const lasted = (since: number | null, seconds: number): boolean => since !== null && snap.time - since >= seconds;
  if (!s.wrongSideFaulted && lasted(s.wrongSideSince, params.wrongSideSeconds)) {
    faults.push(wrongSide());
    s.wrongSideFaulted = s.centreLineFaulted = s.keepLeftFaulted = true;
  } else if (!s.centreLineFaulted && lasted(s.centreLineSince, params.centreLineSeconds)) {
    faults.push(centreLine());
    s.centreLineFaulted = s.keepLeftFaulted = true;
  } else if (!s.keepLeftFaulted && lasted(s.keepLeftSince, params.keepLeftSeconds)) {
    faults.push(keepLeft());
    s.keepLeftFaulted = true;
  }

  const m = snap.nextStarted && !snap.offRoute ? snap.route.maneuvers[snap.next] : undefined;
  if (snap.inJunction && m && (m.kind === 'left' || m.kind === 'right') && !s.cutCorners.includes(m.index)) {
    const inside = m.kind === 'left' ? snap.routeOffset : -snap.routeOffset;
    if (inside > params.cutCornerOffset) {
      s.cutCorners = [...s.cutCorners, m.index];
      faults.push(cutCorner(m));
    }
  }
  return { state: s, faults };
}
