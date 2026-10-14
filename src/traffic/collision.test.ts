import { describe, expect, it } from 'vitest';
import { bodiesOverlap, type Body } from './collision';

const car = (x: number, z: number, heading = 0): Body => ({ x, z, heading, length: 4.4, width: 1.8 });

describe('bodiesOverlap', () => {
  it('cars nose to tail touch only when closer than a car length', () => {
    expect(bodiesOverlap(car(0, 0), car(0, 4.3))).toBe(true);
    expect(bodiesOverlap(car(0, 0), car(0, 4.5))).toBe(false);
  });

  it('cars side by side in two lanes do not touch', () => {
    expect(bodiesOverlap(car(0, 0), car(3.5, 0))).toBe(false);
    expect(bodiesOverlap(car(0, 0), car(1.7, 0))).toBe(true);
  });

  it('a car across the front of another', () => {
    expect(bodiesOverlap(car(0, 0), car(0, 3.0, Math.PI / 2))).toBe(true);
    expect(bodiesOverlap(car(0, 0), car(0, 3.2, Math.PI / 2))).toBe(false);
  });

  it('turned cars are checked along their own sides', () => {
    // Diagonal neighbours: the boxes around them would overlap, the cars do not.
    expect(bodiesOverlap(car(0, 0, Math.PI / 4), car(2.4, -2.4, Math.PI / 4))).toBe(false);
  });
});
