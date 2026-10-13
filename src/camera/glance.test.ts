import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import {
  createGlanceState,
  glanceTarget,
  NO_GLANCE_KEYS,
  stepGlance,
  updateHeldKeys,
  type GlanceEvent,
  type GlanceKey,
  type GlanceKeys,
  type GlanceState,
} from './glance';

const DT = CONFIG.simulation.fixedStepSeconds;
const PARAMS = { minCheckSeconds: 0.5 };

function keys(...down: GlanceKey[]): GlanceKeys {
  return { ...NO_GLANCE_KEYS, ...Object.fromEntries(down.map((key) => [key, true])) };
}

/** Runs the glance logic for a while with the same keys held; returns the final state and all events. */
class Driver {
  state: GlanceState = createGlanceState();
  time = 0;
  events: GlanceEvent[] = [];

  hold(held: GlanceKeys, seconds: number): this {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      this.time += DT;
      const result = stepGlance(this.state, held, this.time, DT, PARAMS);
      this.state = result.state;
      this.events.push(...result.events);
    }
    return this;
  }
}

describe('glanceTarget', () => {
  it('maps the arrows to the mirrors and to looking back', () => {
    expect(glanceTarget([])).toBeNull();
    expect(glanceTarget(['up'])).toBe('interiorMirror');
    expect(glanceTarget(['left'])).toBe('leftMirror');
    expect(glanceTarget(['right'])).toBe('rightMirror');
    expect(glanceTarget(['down'])).toBe('back');
  });

  it('down together with a side arrow looks over that shoulder, in either order', () => {
    expect(glanceTarget(['down', 'left'])).toBe('leftShoulder');
    expect(glanceTarget(['left', 'down'])).toBe('leftShoulder');
    expect(glanceTarget(['down', 'right'])).toBe('rightShoulder');
    expect(glanceTarget(['right', 'down'])).toBe('rightShoulder');
  });

  it('the newest key wins', () => {
    expect(glanceTarget(['left', 'right'])).toBe('rightMirror');
    expect(glanceTarget(['right', 'up'])).toBe('interiorMirror');
    expect(glanceTarget(['down', 'left', 'up'])).toBe('interiorMirror');
    expect(glanceTarget(['left', 'right', 'down'])).toBe('rightShoulder');
  });
});

describe('updateHeldKeys', () => {
  it('keeps the order of presses and drops released keys', () => {
    expect(updateHeldKeys([], keys('left'))).toEqual(['left']);
    expect(updateHeldKeys(['right'], keys('left', 'right'))).toEqual(['right', 'left']);
    expect(updateHeldKeys(['right', 'left'], keys('left'))).toEqual(['left']);
    expect(updateHeldKeys(['left'], keys())).toEqual([]);
  });
});

describe('stepGlance', () => {
  it('counts a glance held long enough, exactly once', () => {
    const driver = new Driver().hold(keys('right'), 0.4);
    expect(driver.state.target).toBe('rightMirror');
    expect(driver.state.counted).toBe(false);
    expect(driver.state.lastChecked.rightMirror).toBeNull();

    driver.hold(keys('right'), 1);
    expect(driver.state.counted).toBe(true);
    expect(driver.events.filter((e) => e.type === 'glanceCounted')).toEqual([
      { type: 'glanceCounted', target: 'rightMirror' },
    ]);
  });

  it('counts at the configured time, not one step later', () => {
    const driver = new Driver().hold(keys('up'), PARAMS.minCheckSeconds);
    // The first step starts the glance; the time is counted from there.
    expect(driver.state.counted).toBe(false);
    driver.hold(keys('up'), DT);
    expect(driver.state.counted).toBe(true);
  });

  it('does not count a quick tap', () => {
    const driver = new Driver().hold(keys('left'), 0.2).hold(NO_GLANCE_KEYS, 1);
    expect(driver.state.target).toBeNull();
    expect(driver.state.lastChecked.leftMirror).toBeNull();
    const ended = driver.events.find((e) => e.type === 'glanceEnded');
    expect(ended).toMatchObject({ target: 'leftMirror', counted: false });
    if (ended?.type === 'glanceEnded') expect(ended.seconds).toBeCloseTo(0.2 - DT, 6);
  });

  it('remembers the last moment of each check', () => {
    const driver = new Driver().hold(keys('right'), 1);
    const endOfLook = driver.time;
    driver.hold(NO_GLANCE_KEYS, 2);
    expect(driver.state.lastChecked.rightMirror).toBeCloseTo(endOfLook, 6);
    expect(driver.state.lastChecked.leftMirror).toBeNull();
  });

  it('switching from the mirror to the shoulder ends one glance and starts another', () => {
    const driver = new Driver().hold(keys('left'), 0.7).hold(keys('left', 'down'), 0.7);
    expect(driver.state.target).toBe('leftShoulder');
    expect(driver.events.map((e) => `${e.type} ${e.target}`)).toEqual([
      'glanceStarted leftMirror',
      'glanceCounted leftMirror',
      'glanceEnded leftMirror',
      'glanceStarted leftShoulder',
      'glanceCounted leftShoulder',
    ]);
    expect(driver.state.lastChecked.leftMirror).not.toBeNull();
    expect(driver.state.lastChecked.leftShoulder).not.toBeNull();
  });

  it('looking straight back is not a shoulder check', () => {
    const driver = new Driver().hold(keys('down'), 1);
    expect(driver.state.lastChecked.back).not.toBeNull();
    expect(driver.state.lastChecked.leftShoulder).toBeNull();
    expect(driver.state.lastChecked.rightShoulder).toBeNull();
  });
});
