import type { GlanceKeys } from '../camera/glance';
import type { ControlCommand, HeldKeys } from '../vehicle/carControls';
import type { Gear } from '../vehicle/gearbox';
import type { Action } from './keymap';

/** The part of the keyboard the car needs; lets tests pass a simple fake. */
export interface ActionSource {
  isDown(action: Action): boolean;
  takePressed(action: Action): boolean;
}

export const GEAR_ACTIONS: Record<Gear, Action> = { P: 'gearP', R: 'gearR', N: 'gearN', D: 'gearD' };

const COMMANDS: readonly [Action, ControlCommand][] = [
  ['belt', { type: 'toggleBelt' }],
  ['engine', { type: 'toggleEngine' }],
  ['handbrake', { type: 'toggleHandbrake' }],
  [GEAR_ACTIONS.P, { type: 'shift', gear: 'P' }],
  [GEAR_ACTIONS.R, { type: 'shift', gear: 'R' }],
  [GEAR_ACTIONS.N, { type: 'shift', gear: 'N' }],
  [GEAR_ACTIONS.D, { type: 'shift', gear: 'D' }],
  ['indicatorLeft', { type: 'indicator', side: 'left' }],
  ['indicatorRight', { type: 'indicator', side: 'right' }],
  ['hazard', { type: 'toggleHazard' }],
];

export function readHeldKeys(keys: ActionSource): HeldKeys {
  return {
    throttle: keys.isDown('throttle'),
    brake: keys.isDown('brake'),
    steerLeft: keys.isDown('steerLeft'),
    steerRight: keys.isDown('steerRight'),
  };
}

/** The look keys (arrows), held to glance into a mirror or over a shoulder. */
export function readGlanceKeys(keys: ActionSource): GlanceKeys {
  return {
    up: keys.isDown('lookUp'),
    down: keys.isDown('lookDown'),
    left: keys.isDown('lookLeft'),
    right: keys.isDown('lookRight'),
  };
}

/** Commands for every control key pressed since the last call. */
export function takeCommands(keys: ActionSource): ControlCommand[] {
  return COMMANDS.filter(([action]) => keys.takePressed(action)).map(([, command]) => command);
}
