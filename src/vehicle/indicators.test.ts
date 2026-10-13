import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import {
  INDICATORS_OFF,
  indicatorLamps,
  isFlasherLit,
  pressIndicator,
  stepIndicators,
  toggleHazard,
  type IndicatorState,
} from './indicators';

const DT = CONFIG.simulation.fixedStepSeconds;
const PERIOD = CONFIG.indicators.flashPeriodSeconds;

/** Steps the indicators through a list of steering positions, one per step. */
function steerThrough(state: IndicatorState, steering: number[]): { state: IndicatorState; cancelled: string[] } {
  let s = state;
  const cancelled: string[] = [];
  for (const steer of steering) {
    const result = stepIndicators(s, steer, DT);
    s = result.state;
    if (result.autoCancelled) cancelled.push(result.autoCancelled);
  }
  return { state: s, cancelled };
}

function ramp(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);
}

describe('indicator stalk', () => {
  it('switches on, switches over and switches off', () => {
    const left = pressIndicator(INDICATORS_OFF, 'left');
    expect(left.lever).toBe('left');
    const right = pressIndicator(left, 'right');
    expect(right.lever).toBe('right');
    expect(pressIndicator(right, 'right').lever).toBeNull();
  });

  it('hazards work independently of the stalk', () => {
    const both = toggleHazard(pressIndicator(INDICATORS_OFF, 'left'));
    expect(both.hazard).toBe(true);
    expect(both.lever).toBe('left');
    const afterHazards = toggleHazard(both);
    expect(afterHazards.hazard).toBe(false);
    expect(afterHazards.lever).toBe('left');
  });
});

describe('flasher', () => {
  it('lights up straight away and blinks with the configured period', () => {
    let s = pressIndicator(INDICATORS_OFF, 'right');
    s = stepIndicators(s, 0, DT).state;
    expect(indicatorLamps(s)).toEqual({ left: false, right: true });

    const litAt = (seconds: number): boolean => isFlasherLit({ ...s, flasherTime: seconds });
    expect(litAt(PERIOD * 0.25)).toBe(true);
    expect(litAt(PERIOD * 0.75)).toBe(false);
    expect(litAt(PERIOD * 1.25)).toBe(true);
  });

  it('flashes both sides with hazards', () => {
    const s = stepIndicators(toggleHazard(INDICATORS_OFF), 0, DT).state;
    expect(indicatorLamps(s)).toEqual({ left: true, right: true });
  });

  it('is dark when nothing is switched on', () => {
    const s = stepIndicators(INDICATORS_OFF, 0, 5).state;
    expect(s.flasherTime).toBe(0);
    expect(indicatorLamps(s)).toEqual({ left: false, right: false });
  });

  it('keeps its rhythm when switching sides', () => {
    let s = pressIndicator(INDICATORS_OFF, 'left');
    s = stepIndicators(s, 0, 0.5).state;
    expect(pressIndicator(s, 'right').flasherTime).toBe(s.flasherTime);
  });
});

describe('self-cancelling', () => {
  it('cancels after a real turn once the steering comes back', () => {
    const start = pressIndicator(INDICATORS_OFF, 'left');
    const turned = steerThrough(start, ramp(0, 0.8, 30));
    expect(turned.state.lever).toBe('left');
    expect(turned.state.armed).toBe(true);

    const back = steerThrough(turned.state, ramp(0.8, 0, 30));
    expect(back.state.lever).toBeNull();
    expect(back.cancelled).toEqual(['left']);
  });

  it('works for the right side too (negative steering)', () => {
    const start = pressIndicator(INDICATORS_OFF, 'right');
    const { state, cancelled } = steerThrough(start, [...ramp(0, -0.9, 20), ...ramp(-0.9, 0, 20)]);
    expect(state.lever).toBeNull();
    expect(cancelled).toEqual(['right']);
  });

  it('does not cancel after a small steering movement such as a lane change', () => {
    const start = pressIndicator(INDICATORS_OFF, 'right');
    const { state, cancelled } = steerThrough(start, [
      ...ramp(0, -0.15, 10),
      ...ramp(-0.15, 0.15, 20),
      ...ramp(0.15, 0, 10),
    ]);
    expect(state.lever).toBe('right');
    expect(cancelled).toEqual([]);
  });

  it('does not cancel while the wheel is still turned', () => {
    const start = pressIndicator(INDICATORS_OFF, 'left');
    const { state } = steerThrough(start, [...ramp(0, 1, 20), ...ramp(1, 0.4, 20)]);
    expect(state.lever).toBe('left');
  });

  it('cancels when switched on with the wheel already turned, once it straightens', () => {
    const start = pressIndicator(INDICATORS_OFF, 'right');
    const { state } = steerThrough(start, ramp(-1, 0, 30));
    expect(state.lever).toBeNull();
  });

  it('leaves hazards on', () => {
    const start = toggleHazard(pressIndicator(INDICATORS_OFF, 'left'));
    const { state } = steerThrough(start, [...ramp(0, 0.8, 20), ...ramp(0.8, 0, 20)]);
    expect(state.lever).toBeNull();
    expect(state.hazard).toBe(true);
  });
});
