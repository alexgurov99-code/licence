import { describe, expect, it } from 'vitest';
import { createCar } from '../vehicle/car';
import { eventMessage, stuckHint } from './messages';

describe('eventMessage', () => {
  it('explains refused actions', () => {
    expect(eventMessage({ type: 'engineStartRefused', reason: 'brakeNotPressed' })).toContain('brake (S)');
    expect(eventMessage({ type: 'gearRefused', gear: 'D', reason: 'brakeRequired' })).toContain('out of P');
    expect(eventMessage({ type: 'gearRefused', gear: 'R', reason: 'stopRequired' })).toContain('shifting to R');
  });

  it('stays quiet about normal events', () => {
    expect(eventMessage({ type: 'engineStarted' })).toBeNull();
    expect(eventMessage({ type: 'indicatorOn', side: 'left' })).toBeNull();
  });
});

describe('stuckHint', () => {
  it('says why the car does not move when the accelerator is pressed', () => {
    expect(stuckHint(createCar({ controls: { throttle: 1 } }))).toContain('engine is off');
    expect(stuckHint(createCar({ controls: { throttle: 1, engineOn: true } }))).toContain('Shift to D');
    expect(stuckHint(createCar({ controls: { throttle: 1, engineOn: true, gear: 'D' } }))).toContain('handbrake');
  });

  it('says nothing when the accelerator is not pressed or the car is moving', () => {
    expect(stuckHint(createCar())).toBeNull();
    expect(stuckHint(createCar({ controls: { throttle: 1 }, motion: { speed: 5 } }))).toBeNull();
    expect(stuckHint(createCar({ controls: { throttle: 1, engineOn: true, gear: 'D', handbrake: false } }))).toBeNull();
  });
});
