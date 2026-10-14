import { describe, expect, it } from 'vitest';
import type { Control, Dir } from '../world/layout';
import type { JunctionKind, Turn } from '../world/network';
import { mustGiveWay, type Movement } from './priority';

// Arms are directions from the middle of the junction: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X. A driver
// arriving along arm 2 travels towards +Z; the arm to their right is 3 (-X), to their left 1.

function move(arm: Dir, turn: Turn, control: Control = 'none', kind: JunctionKind = 'cross', extra: Partial<Movement> = {}): Movement {
  return { junctionKind: kind, arm, control, turn, onRing: false, fromStem: false, ...extra };
}

describe('give way rules (NZ Road Code)', () => {
  it('a driver at a Stop or Give Way sign gives way to traffic on the road without signs', () => {
    expect(mustGiveWay(move(2, 'straight', 'giveWay'), move(3, 'straight'))).toBe(true);
    expect(mustGiveWay(move(2, 'left', 'stop'), move(1, 'right'))).toBe(true);
    expect(mustGiveWay(move(3, 'right'), move(2, 'straight', 'giveWay'))).toBe(false);
  });

  it('at a T without signs the stem gives way to the top of the T', () => {
    const stem = move(2, 'right', 'none', 'tee', { fromStem: true });
    const top = move(1, 'straight', 'none', 'tee');
    expect(mustGiveWay(stem, top)).toBe(true);
    expect(mustGiveWay(top, stem)).toBe(false);
  });

  it('a driver turning gives way to traffic not turning', () => {
    expect(mustGiveWay(move(2, 'right'), move(0, 'straight'))).toBe(true);
    expect(mustGiveWay(move(0, 'straight'), move(2, 'right'))).toBe(false);
    // Both facing signs: the same rule between them.
    expect(mustGiveWay(move(2, 'left', 'giveWay'), move(0, 'straight', 'giveWay'))).toBe(true);
  });

  it('a driver turning right gives way to an oncoming driver turning left (2012 rule)', () => {
    expect(mustGiveWay(move(2, 'right'), move(0, 'left'))).toBe(true);
    expect(mustGiveWay(move(0, 'left'), move(2, 'right'))).toBe(false);
  });

  it('otherwise gives way to traffic from the right', () => {
    // Arriving along arm 2 (heading +Z), the arm on the right is 3.
    expect(mustGiveWay(move(2, 'left'), move(3, 'right'))).toBe(true);
    expect(mustGiveWay(move(3, 'right'), move(2, 'left'))).toBe(false);
  });

  it('on a roundabout gives way to traffic on it and arriving from the right', () => {
    const entering = move(2, 'straight', 'roundabout', 'roundabout');
    expect(mustGiveWay(entering, move(1, 'right', 'roundabout', 'roundabout', { onRing: true }))).toBe(true);
    expect(mustGiveWay(entering, move(3, 'straight', 'roundabout', 'roundabout'))).toBe(true);
    expect(mustGiveWay(entering, move(1, 'straight', 'roundabout', 'roundabout'))).toBe(false);
    // Once on the roundabout, nobody entering is given way to.
    expect(mustGiveWay({ ...entering, onRing: true }, move(3, 'straight', 'roundabout', 'roundabout'))).toBe(false);
  });

  it('never gives way to a car from the same arm (that one is just followed)', () => {
    expect(mustGiveWay(move(2, 'right'), move(2, 'straight'))).toBe(false);
  });
});
