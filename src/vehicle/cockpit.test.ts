import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { adjust, adjustedCockpit, eyeFor, misadjustedCockpit, mirrorError, nextAdjustItem, readiness, type Cockpit } from './cockpit';
import { ADJUST_ITEMS, type AdjustItem } from './cockpitTypes';

const NONE = { up: false, down: false, left: false, right: false };
const DT = 1 / 60;

/** Holds the arrow keys that bring `item` closer to right until it is (or time runs out). */
function adjustUntilRight(start: Cockpit, item: AdjustItem): Cockpit {
  let cockpit = start;
  for (let i = 0; i < 60 * 20 && !readiness(cockpit)[item]; i += 1) {
    const error = item === 'seat' ? { yaw: cockpit.seat.forward, pitch: cockpit.seat.height } : mirrorError(cockpit, item);
    const tol = CONFIG.cockpit.mirrorTolerance / 2;
    cockpit = adjust(cockpit, item, { right: error.yaw < -tol, left: error.yaw > tol, up: error.pitch < -tol, down: error.pitch > tol }, DT);
  }
  return cockpit;
}

describe('cockpit adjustment', () => {
  it('starts with everything right when adjusted', () => {
    expect(readiness(adjustedCockpit())).toEqual({ seat: true, interior: true, left: true, right: true });
  });

  it('a misadjusted cockpit is the same for the same seed and needs every part adjusted', () => {
    expect(misadjustedCockpit('abc')).toEqual(misadjustedCockpit('abc'));
    expect(misadjustedCockpit('abc')).not.toEqual(misadjustedCockpit('abd'));
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(readiness(misadjustedCockpit(seed))).toEqual({ seat: false, interior: false, left: false, right: false });
    }
  });

  it('the seat moves the eye', () => {
    const eye = eyeFor({ forward: 0.1, height: -0.05 });
    expect(eye.z).toBeCloseTo(CONFIG.cabin.eyeZ + 0.1);
    expect(eye.y).toBeCloseTo(CONFIG.cabin.eyeHeight - 0.05);
  });

  it('the arrow keys can bring every part right, seat first', () => {
    let cockpit = misadjustedCockpit('drill');
    for (const item of ADJUST_ITEMS) cockpit = adjustUntilRight(cockpit, item);
    expect(readiness(cockpit)).toEqual({ seat: true, interior: true, left: true, right: true });
  });

  it('moving the seat a lot puts the mirrors out again', () => {
    const cockpit = adjustedCockpit();
    const moved = { ...cockpit, seat: { forward: CONFIG.cockpit.seatForwardRange, height: 0 } };
    expect(readiness(moved).interior).toBe(false);
  });

  it('the seat keeps within its range', () => {
    let cockpit = adjustedCockpit();
    for (let i = 0; i < 600; i += 1) cockpit = adjust(cockpit, 'seat', { ...NONE, right: true, up: true }, DT);
    expect(cockpit.seat).toEqual({ forward: CONFIG.cockpit.seatForwardRange, height: CONFIG.cockpit.seatHeightRange });
  });

  it('right arrow turns a mirror view to the right, up tilts it up', () => {
    const cockpit = adjustedCockpit();
    const turned = adjust(cockpit, 'left', { ...NONE, right: true, up: true }, 0.1);
    const error = mirrorError(turned, 'left');
    expect(error.yaw).toBeGreaterThan(0);
    expect(error.pitch).toBeGreaterThan(0);
  });

  it('Tab goes round seat, rear-view, left, right', () => {
    expect(nextAdjustItem(null)).toBe('seat');
    expect(nextAdjustItem('seat')).toBe('interior');
    expect(nextAdjustItem('right')).toBe('seat');
  });
});
