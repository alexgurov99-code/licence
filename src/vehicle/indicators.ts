import { CONFIG, type IndicatorParams } from '../config';

// Indicator stalk, hazard lights and the flasher. Pure logic, no Three.js.

export type IndicatorSide = 'left' | 'right';

export interface IndicatorState {
  /** Position of the indicator stalk. */
  lever: IndicatorSide | null;
  hazard: boolean;
  /**
   * The steering has turned far enough towards the signalled side: the stalk will flip back
   * by itself once the steering returns to the centre, like the cancelling cam in a real car.
   */
  armed: boolean;
  /** Seconds since the flasher started. Zero while nothing is flashing. */
  flasherTime: number;
}

export const INDICATORS_OFF: IndicatorState = { lever: null, hazard: false, armed: false, flasherTime: 0 };

export function isFlashing(state: IndicatorState): boolean {
  return state.hazard || state.lever !== null;
}

/** Q / E: switches the stalk to that side, or back to the middle if it is already there. */
export function pressIndicator(state: IndicatorState, side: IndicatorSide): IndicatorState {
  return withFlasher(state, { ...state, lever: state.lever === side ? null : side, armed: false });
}

/** H: hazard lights on or off. Works independently of the stalk. */
export function toggleHazard(state: IndicatorState): IndicatorState {
  return withFlasher(state, { ...state, hazard: !state.hazard });
}

/**
 * Advances the flasher and handles self-cancelling.
 * `steer` is the steering position from -1 (full right) to +1 (full left).
 */
export function stepIndicators(
  state: IndicatorState,
  steer: number,
  dt: number,
  params: IndicatorParams = CONFIG.indicators,
): { state: IndicatorState; autoCancelled: IndicatorSide | null } {
  let { lever, armed } = state;
  let autoCancelled: IndicatorSide | null = null;

  if (lever) {
    const towardsSignal = lever === 'left' ? steer : -steer;
    if (towardsSignal >= params.selfCancelArmSteer) {
      armed = true;
    } else if (armed && towardsSignal <= params.selfCancelReleaseSteer) {
      autoCancelled = lever;
      lever = null;
      armed = false;
    }
  }

  const next: IndicatorState = { ...state, lever, armed };
  next.flasherTime = isFlashing(next) ? state.flasherTime + dt : 0;
  return { state: next, autoCancelled };
}

/** Whether the flasher is in the "lit" half of its cycle. */
export function isFlasherLit(state: IndicatorState, params: IndicatorParams = CONFIG.indicators): boolean {
  if (!isFlashing(state)) return false;
  const period = params.flashPeriodSeconds;
  return state.flasherTime % period < period / 2;
}

/** Which indicator lamps are lit right now. */
export function indicatorLamps(
  state: IndicatorState,
  params: IndicatorParams = CONFIG.indicators,
): { left: boolean; right: boolean } {
  const lit = isFlasherLit(state, params);
  return {
    left: lit && (state.hazard || state.lever === 'left'),
    right: lit && (state.hazard || state.lever === 'right'),
  };
}

// The flasher starts in the "lit" phase when signalling begins, so the first flash is immediate.
// Switching sides or adding hazards while already flashing keeps the rhythm, as a real flasher relay does.
function withFlasher(previous: IndicatorState, next: IndicatorState): IndicatorState {
  if (!isFlashing(next) || !isFlashing(previous)) return { ...next, flasherTime: 0 };
  return next;
}
