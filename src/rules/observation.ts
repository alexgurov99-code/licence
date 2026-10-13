import type { GlanceTarget } from '../camera/glance';
import type { RulesParams } from '../config';
import type { Maneuver, Side } from '../route/route';
import { noMirrorCheck, noObservation, noShoulderCheck } from './faults';
import type { FaultDraft } from './types';

// Mirror and blind-spot checks, from the glances (camera/glance): mirror → signal → (look over
// the shoulder when pulling out) → manoeuvre. Looking straight back is not a shoulder check.

type LastChecked = Readonly<Record<GlanceTarget, number | null>>;

const SIDE_MIRROR: Record<Side, GlanceTarget> = { left: 'leftMirror', right: 'rightMirror' };

/** A check of the rear-view mirror or the mirror on `side` at `since` or later. */
export function mirrorChecked(lastChecked: LastChecked, side: Side, since: number): boolean {
  return [lastChecked.interiorMirror, lastChecked[SIDE_MIRROR[side]]].some((t) => t !== null && t >= since);
}

/**
 * Moving off from the kerb: mirrors before signalling, then a look over the right shoulder after
 * signalling, just before moving. Without either it is a critical "failing to look".
 * `mirrorBeforeSignal` is what was found when the indicator went on, or null if it never did.
 */
export function pullOutLooks(
  m: Maneuver,
  time: number,
  signalOnSince: number | null,
  mirrorBeforeSignal: boolean | null,
  lastChecked: LastChecked,
  params: RulesParams['observation'],
): FaultDraft | null {
  const mirror = mirrorBeforeSignal ?? mirrorChecked(lastChecked, 'right', time - params.mirrorMaxAgeSeconds);
  const shoulderAt = lastChecked.rightShoulder;
  const shoulder =
    shoulderAt !== null && shoulderAt >= time - params.shoulderMaxAgeSeconds && (signalOnSince === null || shoulderAt >= signalOnSince);
  if (!mirror && !shoulder) return noObservation(m);
  if (!mirror) return noMirrorCheck(m, 'right');
  if (!shoulder) return noShoulderCheck(m);
  return null;
}
