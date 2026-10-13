import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { driveAcceleration, shiftRefusal, type ShiftConditions } from './gearbox';

const params = CONFIG.vehicle;
const STOPPED_ON_BRAKE: ShiftConditions = { speed: 0, brakePressed: true, engineOn: true };

describe('shiftRefusal', () => {
  it('leaves P only with the engine running and the brake pressed', () => {
    expect(shiftRefusal('P', 'D', STOPPED_ON_BRAKE)).toBeNull();
    expect(shiftRefusal('P', 'D', { ...STOPPED_ON_BRAKE, brakePressed: false })).toBe('brakeRequired');
    expect(shiftRefusal('P', 'R', { ...STOPPED_ON_BRAKE, engineOn: false })).toBe('engineOff');
  });

  it('allows D, N and R changes without the brake once out of P', () => {
    const noBrake = { ...STOPPED_ON_BRAKE, brakePressed: false };
    expect(shiftRefusal('D', 'R', noBrake)).toBeNull();
    expect(shiftRefusal('R', 'N', noBrake)).toBeNull();
    expect(shiftRefusal('N', 'D', noBrake)).toBeNull();
  });

  it('refuses P while moving and R while rolling forwards', () => {
    const rollingForwards = { ...STOPPED_ON_BRAKE, speed: 5 };
    expect(shiftRefusal('D', 'P', rollingForwards)).toBe('stopRequired');
    expect(shiftRefusal('D', 'R', rollingForwards)).toBe('stopRequired');
    expect(shiftRefusal('R', 'P', { ...STOPPED_ON_BRAKE, speed: -2 })).toBe('stopRequired');
  });

  it('refuses D while rolling backwards', () => {
    expect(shiftRefusal('R', 'D', { ...STOPPED_ON_BRAKE, speed: -2 })).toBe('stopRequired');
  });

  it('allows N at any speed', () => {
    expect(shiftRefusal('D', 'N', { ...STOPPED_ON_BRAKE, speed: 25 })).toBeNull();
  });

  it('counts a car that is barely rolling as stopped', () => {
    expect(shiftRefusal('D', 'P', { ...STOPPED_ON_BRAKE, speed: CONFIG.controls.standstillSpeed / 2 })).toBeNull();
  });
});

describe('driveAcceleration', () => {
  it('gives nothing with the engine off, in P or in N', () => {
    expect(driveAcceleration('D', false, 1, 0)).toBe(0);
    expect(driveAcceleration('P', true, 1, 0)).toBe(0);
    expect(driveAcceleration('N', true, 1, 0)).toBe(0);
  });

  it('pushes forwards in D and backwards in R', () => {
    expect(driveAcceleration('D', true, 1, 0)).toBeCloseTo(params.acceleration, 9);
    expect(driveAcceleration('R', true, 1, 0)).toBeCloseTo(-params.acceleration, 9);
  });

  it('does not push a car standing still without the accelerator (no creep)', () => {
    expect(Math.abs(driveAcceleration('D', true, 0, 0))).toBe(0);
    expect(Math.abs(driveAcceleration('R', true, 0, 0))).toBe(0);
  });

  it('brakes gently with the engine above walking pace when the accelerator is released', () => {
    expect(driveAcceleration('D', true, 0, 15)).toBeCloseTo(-params.engineBraking, 9);
  });

  it('loses power as speed rises', () => {
    const low = driveAcceleration('D', true, 1, 5);
    const high = driveAcceleration('D', true, 1, 100 / 3.6);
    expect(high).toBeLessThan(low / 2);
    expect(driveAcceleration('D', true, 1, params.maxForwardSpeed)).toBeCloseTo(0, 9);
  });

  it('pushes harder the further the accelerator is pressed', () => {
    for (const speed of [0, 3, 15]) {
      expect(driveAcceleration('D', true, 0.5, speed)).toBeGreaterThan(driveAcceleration('D', true, 0.2, speed));
    }
  });
});
