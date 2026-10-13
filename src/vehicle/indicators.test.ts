import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import {
  INDICATORS_OFF,
  indicatorLamps,
  isFlasherLit,
  pressIndicator,
  stepIndicators,
  toggleHazard,
} from './indicators';

const DT = CONFIG.simulation.fixedStepSeconds;
const PERIOD = CONFIG.indicators.flashPeriodSeconds;

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
    s = stepIndicators(s, DT);
    expect(indicatorLamps(s)).toEqual({ left: false, right: true });

    const litAt = (seconds: number): boolean => isFlasherLit({ ...s, flasherTime: seconds });
    expect(litAt(PERIOD * 0.25)).toBe(true);
    expect(litAt(PERIOD * 0.75)).toBe(false);
    expect(litAt(PERIOD * 1.25)).toBe(true);
  });

  it('flashes both sides with hazards', () => {
    const s = stepIndicators(toggleHazard(INDICATORS_OFF), DT);
    expect(indicatorLamps(s)).toEqual({ left: true, right: true });
  });

  it('is dark when nothing is switched on', () => {
    const s = stepIndicators(INDICATORS_OFF, 5);
    expect(s.flasherTime).toBe(0);
    expect(indicatorLamps(s)).toEqual({ left: false, right: false });
  });

  it('keeps its rhythm when switching sides', () => {
    let s = pressIndicator(INDICATORS_OFF, 'left');
    s = stepIndicators(s, 0.5);
    expect(pressIndicator(s, 'right').flasherTime).toBe(s.flasherTime);
  });
});

describe('switching off', () => {
  it('is done by hand: the stalk stays on however long it flashes', () => {
    let s = pressIndicator(INDICATORS_OFF, 'left');
    for (let i = 0; i < 600; i++) s = stepIndicators(s, DT);
    expect(s.lever).toBe('left');
    expect(pressIndicator(s, 'left').lever).toBeNull();
  });
});
