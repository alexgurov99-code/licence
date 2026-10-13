import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import {
  createCarControls,
  NO_KEYS,
  stepCarControls,
  type CarControlsState,
  type ControlCommand,
  type ControlEvent,
  type HeldKeys,
} from './carControls';

const DT = CONFIG.simulation.fixedStepSeconds;
const STILL = { speed: 0, steer: 0 };
const BRAKE: HeldKeys = { ...NO_KEYS, brake: true };

function step(
  state: CarControlsState,
  commands: ControlCommand[] = [],
  held: HeldKeys = NO_KEYS,
  motion = STILL,
): { state: CarControlsState; events: ControlEvent[] } {
  return stepCarControls(state, { held, commands }, motion, DT);
}

function hold(state: CarControlsState, held: HeldKeys, seconds: number): CarControlsState {
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i++) s = step(s, [], held).state;
  return s;
}

describe('starting position', () => {
  it('is engine off, in P, handbrake on, belt off', () => {
    expect(createCarControls()).toMatchObject({ engineOn: false, gear: 'P', handbrake: true, beltFastened: false });
  });
});

describe('pedals', () => {
  it('press in smoothly while the key is held', () => {
    const tapped = step(createCarControls(), [], { ...NO_KEYS, throttle: true }).state;
    expect(tapped.throttle).toBeGreaterThan(0);
    expect(tapped.throttle).toBeLessThan(0.1);
    const held = hold(createCarControls(), { ...NO_KEYS, throttle: true }, CONFIG.controls.throttleFullSeconds);
    expect(held.throttle).toBeCloseTo(1, 9);
  });

  it('push the brake faster than the accelerator', () => {
    const s = hold(createCarControls(), { ...NO_KEYS, throttle: true, brake: true }, 0.2);
    expect(s.brake).toBeGreaterThan(s.throttle);
  });

  it('come back up quickly when released', () => {
    const pressed = createCarControls({ brake: 1, throttle: 1 });
    expect(hold(pressed, NO_KEYS, CONFIG.controls.pedalReleaseSeconds)).toMatchObject({ brake: 0, throttle: 0 });
  });

  it('turn the steering keys into a steering direction', () => {
    expect(step(createCarControls(), [], { ...NO_KEYS, steerLeft: true }).state.steerInput).toBe(1);
    expect(step(createCarControls(), [], { ...NO_KEYS, steerRight: true }).state.steerInput).toBe(-1);
    expect(step(createCarControls(), [], { ...NO_KEYS, steerLeft: true, steerRight: true }).state.steerInput).toBe(0);
  });
});

describe('engine', () => {
  it('starts in P with the brake pressed', () => {
    const { state, events } = step(createCarControls(), [{ type: 'toggleEngine' }], BRAKE);
    expect(state.engineOn).toBe(true);
    expect(events).toEqual([{ type: 'engineStarted' }]);
  });

  it('refuses to start without the brake', () => {
    const { state, events } = step(createCarControls(), [{ type: 'toggleEngine' }]);
    expect(state.engineOn).toBe(false);
    expect(events).toEqual([{ type: 'engineStartRefused', reason: 'brakeNotPressed' }]);
  });

  it('refuses to start outside P', () => {
    const { state, events } = step(createCarControls({ gear: 'N' }), [{ type: 'toggleEngine' }], BRAKE);
    expect(state.engineOn).toBe(false);
    expect(events).toEqual([{ type: 'engineStartRefused', reason: 'notInPark' }]);
  });

  it('switches off only when the car has stopped', () => {
    const running = createCarControls({ engineOn: true, gear: 'D' });
    const moving = step(running, [{ type: 'toggleEngine' }], NO_KEYS, { speed: 10, steer: 0 });
    expect(moving.state.engineOn).toBe(true);
    expect(moving.events).toEqual([{ type: 'engineStopRefused', reason: 'moving' }]);

    const stopped = step(running, [{ type: 'toggleEngine' }]);
    expect(stopped.state.engineOn).toBe(false);
    expect(stopped.events).toEqual([{ type: 'engineStopped' }]);
  });
});

describe('gear selector', () => {
  it('shifts out of P with the engine running and the brake pressed', () => {
    const running = createCarControls({ engineOn: true });
    const { state, events } = step(running, [{ type: 'shift', gear: 'D' }], BRAKE);
    expect(state.gear).toBe('D');
    expect(events).toEqual([{ type: 'gearSelected', gear: 'D', previous: 'P' }]);
  });

  it('stays in P without the brake and says why', () => {
    const { state, events } = step(createCarControls({ engineOn: true }), [{ type: 'shift', gear: 'D' }]);
    expect(state.gear).toBe('P');
    expect(events).toEqual([{ type: 'gearRefused', gear: 'D', reason: 'brakeRequired' }]);
  });

  it('ignores selecting the gear that is already engaged', () => {
    expect(step(createCarControls(), [{ type: 'shift', gear: 'P' }]).events).toEqual([]);
  });

  it('refuses R while rolling forwards', () => {
    const driving = createCarControls({ engineOn: true, gear: 'D' });
    const { state, events } = step(driving, [{ type: 'shift', gear: 'R' }], NO_KEYS, { speed: 8, steer: 0 });
    expect(state.gear).toBe('D');
    expect(events).toEqual([{ type: 'gearRefused', gear: 'R', reason: 'stopRequired' }]);
  });
});

describe('belt and handbrake', () => {
  it('toggle and report each change', () => {
    const { state, events } = step(createCarControls(), [{ type: 'toggleBelt' }, { type: 'toggleHandbrake' }]);
    expect(state).toMatchObject({ beltFastened: true, handbrake: false });
    expect(events).toEqual([{ type: 'beltFastened' }, { type: 'handbrakeReleased' }]);

    const again = step(state, [{ type: 'toggleBelt' }, { type: 'toggleHandbrake' }]);
    expect(again.state).toMatchObject({ beltFastened: false, handbrake: true });
    expect(again.events).toEqual([{ type: 'beltUnfastened' }, { type: 'handbrakeApplied' }]);
  });
});

describe('indicators', () => {
  it('report switching on, over and off', () => {
    let s = createCarControls();
    const on = step(s, [{ type: 'indicator', side: 'left' }]);
    expect(on.events).toEqual([{ type: 'indicatorOn', side: 'left' }]);
    s = on.state;

    const over = step(s, [{ type: 'indicator', side: 'right' }]);
    expect(over.events).toEqual([
      { type: 'indicatorOff', side: 'left', auto: false },
      { type: 'indicatorOn', side: 'right' },
    ]);

    const off = step(over.state, [{ type: 'indicator', side: 'right' }]);
    expect(off.events).toEqual([{ type: 'indicatorOff', side: 'right', auto: false }]);
  });

  it('report self-cancelling as automatic', () => {
    let s = step(createCarControls(), [{ type: 'indicator', side: 'left' }]).state;
    s = step(s, [], NO_KEYS, { speed: 3, steer: 0.9 }).state;
    const { state, events } = step(s, [], NO_KEYS, { speed: 3, steer: 0 });
    expect(state.indicators.lever).toBeNull();
    expect(events).toEqual([{ type: 'indicatorOff', side: 'left', auto: true }]);
  });

  it('report hazards', () => {
    const on = step(createCarControls(), [{ type: 'toggleHazard' }]);
    expect(on.events).toEqual([{ type: 'hazardOn' }]);
    expect(step(on.state, [{ type: 'toggleHazard' }]).events).toEqual([{ type: 'hazardOff' }]);
  });
});
