import type { RulesParams } from '../config';
import type { Maneuver } from '../route/route';
import { ADJUST_ITEMS, type MirrorName } from '../vehicle/cockpitTypes';
import { adjustedWhileMoving, drillOrder, mirrorsNotAdjusted, noBelt, notSecured, seatNotAdjusted } from './faults';
import type { FaultDraft, RulesSnapshot } from './types';

// The cockpit drill before the drive and securing the car after it. Pure logic.
//
// Before moving off: seat and three mirrors adjusted, belt fastened, and all of that before the
// engine is started. While driving: belt on, no adjusting. Parked at the end: handbrake and P.

export interface DrillState {
  /** The car has moved: the drive has begun and the drill was judged. */
  movedOff: boolean;
  engineWasOn: boolean;
  orderJudged: boolean;
  beltFaulted: boolean;
  /** Adjusting while moving: one fault per go, until the driver stops adjusting. */
  adjustingFaulted: boolean;
  /** Time the car arrived at the end, and whether it has been secured (or judged not to be). */
  arrivedAt: number | null;
  parkJudged: boolean;
}

export function createDrillState(): DrillState {
  return {
    movedOff: false,
    engineWasOn: false,
    orderJudged: false,
    beltFaulted: false,
    adjustingFaulted: false,
    arrivedAt: null,
    parkJudged: false,
  };
}

const drillDone = (snap: RulesSnapshot): boolean => snap.beltFastened && ADJUST_ITEMS.every((item) => snap.cockpit[item]);

export function stepDrill(
  state: DrillState,
  snap: RulesSnapshot,
  params: RulesParams['drill'],
): { state: DrillState; faults: FaultDraft[] } {
  const faults: FaultDraft[] = [];
  const next = { ...state };
  const moving = Math.abs(snap.speed) * 3.6 > params.movingKmh;

  if (snap.engineOn && !state.engineWasOn && !state.orderJudged && !state.movedOff) {
    next.orderJudged = true;
    if (!drillDone(snap)) faults.push(drillOrder());
  }
  next.engineWasOn = snap.engineOn;

  if (moving && !state.movedOff) {
    next.movedOff = true;
    if (!snap.cockpit.seat) faults.push(seatNotAdjusted());
    const mirrors = (['interior', 'left', 'right'] as const).filter((id: MirrorName) => !snap.cockpit[id]);
    if (mirrors.length > 0) faults.push(mirrorsNotAdjusted(mirrors));
  }

  if (moving && !snap.beltFastened && !state.beltFaulted) {
    next.beltFaulted = true;
    faults.push(noBelt());
  }

  if (moving && snap.adjusting && !state.adjustingFaulted) {
    next.adjustingFaulted = true;
    faults.push(adjustedWhileMoving());
  }
  if (!snap.adjusting) next.adjustingFaulted = false;

  return { state: next, faults };
}

/**
 * After arriving: secured once the handbrake is on and the car is in P. Returns done when the
 * drive is over (secured, or the time for it ran out).
 */
export function stepPark(
  state: DrillState,
  snap: RulesSnapshot,
  last: Maneuver | undefined,
  params: RulesParams['drill'],
): { state: DrillState; faults: FaultDraft[]; done: boolean } {
  const arrivedAt = state.arrivedAt ?? snap.time;
  const secured = snap.handbrake && snap.gear === 'P';
  if (secured) return { state: { ...state, arrivedAt, parkJudged: true }, faults: [], done: true };
  if (snap.time - arrivedAt >= params.secureSeconds && last) {
    return { state: { ...state, arrivedAt, parkJudged: true }, faults: [notSecured(last)], done: true };
  }
  return { state: { ...state, arrivedAt }, faults: [], done: false };
}
