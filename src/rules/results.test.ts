import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { clock, driveResults, extendTrail, immediateFailTime, type ResultsInput } from './results';
import { drive, findSeed } from './testing';
import type { Fault } from './types';

const fault = (fields: Partial<Fault>): Fault => ({
  id: 0,
  kind: 'speeding',
  severity: 'minor',
  time: 0,
  at: { x: 0, z: 0 },
  maneuver: null,
  place: null,
  what: 'Something happened.',
  correct: 'Do it right.',
  ...fields,
});

const results = (faults: Fault[], more: Partial<ResultsInput> = {}): ReturnType<typeof driveResults> =>
  driveResults({ faults, maxCriticalErrors: 2, seconds: 462, metres: 3140, endedEarly: false, ...more });

describe('results', () => {
  it('a drive with no faults is a clean pass', () => {
    const r = results([]);
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('A clean drive: no faults at all.');
    expect(r.counts).toBe('0 immediate fail · 0 critical · 0 minor');
    expect(r.drive).toBe('7:42 · 3.1 km');
    expect(r.items).toEqual([]);
  });

  it('passes with up to 2 critical errors and says how many were allowed', () => {
    const r = results([fault({ severity: 'critical' }), fault({ id: 1, severity: 'minor' })]);
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('1 critical error (up to 2 allowed) and 1 minor fault.');
  });

  it('fails with too many critical errors', () => {
    const r = results([0, 1, 2].map((id) => fault({ id, severity: 'critical' })));
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('3 critical errors: no more than 2 are allowed.');
  });

  it('an immediate fail names what happened', () => {
    const r = results([fault({ severity: 'immediateFail', what: 'Did not stop at the Stop sign.' })], { endedEarly: true });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('Immediate fail: Did not stop at the Stop sign.');
    expect(r.endedEarly).toBe(true);
  });

  it('lists the faults in the order they happened, numbered, with where and when', () => {
    const r = results([
      fault({ id: 0, time: 125, place: 'Left turn' }),
      fault({ id: 1, time: 3, kind: 'seatNotAdjusted' }),
      fault({ id: 2, time: 61.9 }),
    ]);
    expect(r.items.map((i) => [i.number, i.fault.id, i.place, i.clock])).toEqual([
      [1, 1, 'Cockpit drill', '0:03'],
      [2, 2, 'On the road', '1:01'],
      [3, 0, 'Left turn', '2:05'],
    ]);
  });

  it('formats drive time as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(59.9)).toBe('0:59');
    expect(clock(605)).toBe('10:05');
  });

  it('the test ends at the first immediate fail', () => {
    expect(immediateFailTime([fault({ severity: 'critical', time: 5 })])).toBeNull();
    expect(immediateFailTime([fault({ severity: 'immediateFail', time: 40 }), fault({ severity: 'immediateFail', time: 30 })])).toBe(30);
  });
});

describe('the driven trail', () => {
  it('keeps a point every few metres and counts the distance', () => {
    const trail: { x: number; z: number }[] = [];
    let metres = 0;
    for (let i = 0; i <= 100; i += 1) metres += extendTrail(trail, { x: i * 0.5, z: 0 }, 4);
    expect(trail.length).toBe(13);
    expect(metres).toBeCloseTo(48);
  });
});

describe('results of recorded drives', () => {
  const max = CONFIG.rules.maxCriticalErrors;

  it('the model driver passes with no faults', () => {
    const { faults } = drive('rules-0');
    const r = driveResults({ faults, maxCriticalErrors: max, seconds: 300, metres: 2000, endedEarly: false });
    expect(r.passed).toBe(true);
    expect(r.items).toEqual([]);
  });

  it('running a Stop sign fails, and the fault says which manoeuvre it was', () => {
    const { seed, m } = findSeed((c) => c.control === 'stop');
    const { faults } = drive(seed, { stops: false });
    const r = driveResults({ faults, maxCriticalErrors: max, seconds: 300, metres: 2000, endedEarly: true });
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/^Immediate fail: /);
    const stop = r.items.find((i) => i.fault.kind === 'missedStop');
    expect(stop?.fault.maneuver).toBe(m.index);
    expect(stop?.place).toMatch(/^(Left turn|Right turn|Straight through)$/);
  });
});
