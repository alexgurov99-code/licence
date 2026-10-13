import { describe, expect, it } from 'vitest';
import { adjustedCockpit, readiness } from '../vehicle/cockpit';
import { adjustText, describeCockpit, seatHint } from './adjustPanel';

describe('adjust panel', () => {
  it('says which way the seat still has to go', () => {
    const cockpit = { ...adjustedCockpit(), seat: { forward: -0.1, height: 0.05 } };
    expect(seatHint(cockpit)).toBe('Move it forward → and down ↓');
    expect(seatHint(adjustedCockpit())).toBe('');
  });

  it('names the part being adjusted and ticks the ready ones', () => {
    const cockpit = { ...adjustedCockpit(), seat: { forward: 0.1, height: 0 } };
    const text = adjustText('seat', cockpit, readiness(cockpit));
    expect(text.title).toBe('Adjusting: Seat');
    expect(text.hint).toBe('Move it back ←');
    expect(text.keys).toContain('Tab next');
    expect(text.parts.map((p) => p.current)).toEqual([true, false, false, false]);
    const done = adjustText('left', adjustedCockpit(), readiness(adjustedCockpit()));
    expect(done.hint).toBe('✓ Adjusted');
  });

  it('debug line shows the angles off', () => {
    expect(describeCockpit(adjustedCockpit(), readiness(adjustedCockpit()))).toMatch(/^seat f \+0\.00 h \+0\.00 ✓ · interior \+0\.0\/\+0\.0° ✓/);
  });
});
