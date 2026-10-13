import { describe, expect, it } from 'vitest';
import { arcadeControls, type DrivingKeys } from './arcadeControls';

const NONE: DrivingKeys = { forward: false, back: false, left: false, right: false };

describe('arcadeControls', () => {
  it('W from standstill drives forwards', () => {
    expect(arcadeControls({ ...NONE, forward: true }, 0)).toMatchObject({ throttle: 1, brake: 0, direction: 1 });
  });

  it('S while rolling forwards brakes', () => {
    expect(arcadeControls({ ...NONE, back: true }, 5)).toMatchObject({ throttle: 0, brake: 1 });
  });

  it('S at standstill reverses', () => {
    expect(arcadeControls({ ...NONE, back: true }, 0)).toMatchObject({ throttle: 1, brake: 0, direction: -1 });
  });

  it('W while reversing brakes', () => {
    expect(arcadeControls({ ...NONE, forward: true }, -2)).toMatchObject({ throttle: 0, brake: 1 });
  });

  it('W and S together brake', () => {
    expect(arcadeControls({ ...NONE, forward: true, back: true }, 3)).toMatchObject({ throttle: 0, brake: 1 });
  });

  it('A steers left, D steers right, both cancel out', () => {
    expect(arcadeControls({ ...NONE, left: true }, 0).steerInput).toBe(1);
    expect(arcadeControls({ ...NONE, right: true }, 0).steerInput).toBe(-1);
    expect(arcadeControls({ ...NONE, left: true, right: true }, 0).steerInput).toBe(0);
  });

  it('no keys means no pedals', () => {
    expect(arcadeControls(NONE, 10)).toMatchObject({ throttle: 0, brake: 0, steerInput: 0 });
  });
});
