import { describe, expect, it } from 'vitest';
import { readGlanceKeys, readHeldKeys, takeCommands, type ActionSource } from './carInput';
import { keyLabel, type Action } from './keymap';

function fakeKeys(down: Action[], pressed: Action[]): ActionSource {
  const pending = new Set(pressed);
  return {
    isDown: (action) => down.includes(action),
    takePressed: (action) => pending.delete(action),
  };
}

describe('car input', () => {
  it('reads the held driving keys', () => {
    expect(readHeldKeys(fakeKeys(['brake', 'steerLeft'], []))).toEqual({
      throttle: false,
      brake: true,
      steerLeft: true,
      steerRight: false,
    });
  });

  it('reads the held look keys', () => {
    expect(readGlanceKeys(fakeKeys(['lookDown', 'lookRight', 'throttle'], []))).toEqual({
      up: false,
      down: true,
      left: false,
      right: true,
    });
  });

  it('turns key presses into commands, each only once', () => {
    const keys = fakeKeys([], ['engine', 'gearD', 'indicatorRight']);
    expect(takeCommands(keys)).toEqual([
      { type: 'toggleEngine' },
      { type: 'shift', gear: 'D' },
      { type: 'indicator', side: 'right' },
    ]);
    expect(takeCommands(keys)).toEqual([]);
  });
});

describe('keyLabel', () => {
  it('names keys the way they are printed on the keyboard', () => {
    expect(keyLabel('brake')).toBe('S');
    expect(keyLabel('gearD')).toBe('4');
    expect(keyLabel('handbrake')).toBe('Space');
    expect(keyLabel('engine')).toBe('Enter');
    expect(keyLabel('toggleDebug')).toBe('`');
    expect(keyLabel('lookUp')).toBe('↑');
    expect(keyLabel('lookLeft')).toBe('←');
  });
});
