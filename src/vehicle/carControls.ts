import { CONFIG, type ControlsParams } from '../config';
import { moveTowards } from '../util/math';
import { shiftRefusal, type Gear, type ShiftRefusal } from './gearbox';
import {
  INDICATORS_OFF,
  pressIndicator,
  stepIndicators,
  toggleHazard,
  type IndicatorSide,
  type IndicatorState,
} from './indicators';
import type { VehicleControls, VehicleState } from './vehicle';

// Everything the driver operates: pedals, gear selector, engine button, handbrake, belt and
// indicators. Pure logic, no Three.js. This state (together with the car's motion) is the
// snapshot the rules engine will read every frame, and the events are what it will listen to.

export interface CarControlsState extends VehicleControls {
  beltFastened: boolean;
  indicators: IndicatorState;
}

/** Keys that act while held. */
export interface HeldKeys {
  throttle: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
}

export const NO_KEYS: HeldKeys = { throttle: false, brake: false, steerLeft: false, steerRight: false };

/** One-off actions, one per key press. */
export type ControlCommand =
  | { type: 'toggleEngine' }
  | { type: 'toggleBelt' }
  | { type: 'toggleHandbrake' }
  | { type: 'shift'; gear: Gear }
  | { type: 'indicator'; side: IndicatorSide }
  | { type: 'toggleHazard' };

export interface ControlsInput {
  held: HeldKeys;
  commands: readonly ControlCommand[];
}

export type EngineStartRefusal = 'notInPark' | 'brakeNotPressed';

export type ControlEvent =
  | { type: 'engineStarted' }
  | { type: 'engineStopped' }
  | { type: 'engineStartRefused'; reason: EngineStartRefusal }
  | { type: 'engineStopRefused'; reason: 'moving' }
  | { type: 'beltFastened' }
  | { type: 'beltUnfastened' }
  | { type: 'handbrakeApplied' }
  | { type: 'handbrakeReleased' }
  | { type: 'gearSelected'; gear: Gear; previous: Gear }
  | { type: 'gearRefused'; gear: Gear; reason: ShiftRefusal }
  | { type: 'indicatorOn'; side: IndicatorSide }
  | { type: 'indicatorOff'; side: IndicatorSide }
  | { type: 'hazardOn' }
  | { type: 'hazardOff' };

/** A drive starts like the real test: engine off, in P, handbrake on, belt off. */
export function createCarControls(overrides: Partial<CarControlsState> = {}): CarControlsState {
  return {
    throttle: 0,
    brake: 0,
    handbrake: true,
    gear: 'P',
    engineOn: false,
    steerInput: 0,
    beltFastened: false,
    indicators: INDICATORS_OFF,
    ...overrides,
  };
}

export function isBrakePressed(state: CarControlsState): boolean {
  return state.brake > 0;
}

/**
 * One fixed simulation step: pedals follow the held keys, then the step's commands are applied
 * in order, then the indicators flash.
 */
export function stepCarControls(
  state: CarControlsState,
  input: ControlsInput,
  motion: Pick<VehicleState, 'speed'>,
  dt: number,
  params: ControlsParams = CONFIG.controls,
): { state: CarControlsState; events: ControlEvent[] } {
  const { held } = input;
  let next: CarControlsState = {
    ...state,
    throttle: stepPedal(state.throttle, held.throttle, params.throttleFullSeconds, params.pedalReleaseSeconds, dt),
    brake: stepPedal(state.brake, held.brake, params.brakeFullSeconds, params.pedalReleaseSeconds, dt),
    steerInput: (held.steerLeft ? 1 : 0) - (held.steerRight ? 1 : 0),
  };
  const events: ControlEvent[] = [];

  for (const command of input.commands) {
    next = applyCommand(next, command, motion.speed, events, params);
  }

  next = { ...next, indicators: stepIndicators(next.indicators, dt) };

  return { state: next, events };
}

function applyCommand(
  state: CarControlsState,
  command: ControlCommand,
  speed: number,
  events: ControlEvent[],
  params: ControlsParams,
): CarControlsState {
  switch (command.type) {
    case 'toggleEngine':
      return state.engineOn ? stopEngine(state, speed, events, params) : startEngine(state, events);

    case 'toggleBelt':
      events.push({ type: state.beltFastened ? 'beltUnfastened' : 'beltFastened' });
      return { ...state, beltFastened: !state.beltFastened };

    case 'toggleHandbrake':
      events.push({ type: state.handbrake ? 'handbrakeReleased' : 'handbrakeApplied' });
      return { ...state, handbrake: !state.handbrake };

    case 'shift': {
      if (command.gear === state.gear) return state;
      const refusal = shiftRefusal(
        state.gear,
        command.gear,
        { speed, brakePressed: isBrakePressed(state), engineOn: state.engineOn },
        params.standstillSpeed,
      );
      if (refusal) {
        events.push({ type: 'gearRefused', gear: command.gear, reason: refusal });
        return state;
      }
      events.push({ type: 'gearSelected', gear: command.gear, previous: state.gear });
      return { ...state, gear: command.gear };
    }

    case 'indicator': {
      const before = state.indicators.lever;
      const indicators = pressIndicator(state.indicators, command.side);
      const after = indicators.lever;
      if (before) events.push({ type: 'indicatorOff', side: before });
      if (after) events.push({ type: 'indicatorOn', side: after });
      return { ...state, indicators };
    }

    case 'toggleHazard':
      events.push({ type: state.indicators.hazard ? 'hazardOff' : 'hazardOn' });
      return { ...state, indicators: toggleHazard(state.indicators) };
  }
}

// Like a real push-button start in an automatic: only in P, with the foot on the brake.
function startEngine(state: CarControlsState, events: ControlEvent[]): CarControlsState {
  const refusal: EngineStartRefusal | null =
    state.gear !== 'P' ? 'notInPark' : !isBrakePressed(state) ? 'brakeNotPressed' : null;
  if (refusal) {
    events.push({ type: 'engineStartRefused', reason: refusal });
    return state;
  }
  events.push({ type: 'engineStarted' });
  return { ...state, engineOn: true };
}

function stopEngine(
  state: CarControlsState,
  speed: number,
  events: ControlEvent[],
  params: ControlsParams,
): CarControlsState {
  if (Math.abs(speed) > params.standstillSpeed) {
    events.push({ type: 'engineStopRefused', reason: 'moving' });
    return state;
  }
  events.push({ type: 'engineStopped' });
  return { ...state, engineOn: false };
}

function stepPedal(position: number, held: boolean, fullSeconds: number, releaseSeconds: number, dt: number): number {
  return held ? moveTowards(position, 1, dt / fullSeconds) : moveTowards(position, 0, dt / releaseSeconds);
}
