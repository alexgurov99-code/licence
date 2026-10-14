import { describe, expect, it } from 'vitest';
import { spreadMarks } from './resultsMap';

describe('fault marks on the results map', () => {
  it('leaves marks that do not overlap where they are', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }];
    expect(spreadMarks(points, 20)).toEqual(points);
  });

  it('moves marks at the same spot apart so each one can be seen', () => {
    const spots = spreadMarks(Array.from({ length: 8 }, () => ({ x: 100, y: 100 })), 20);
    expect(spots[0]).toEqual({ x: 100, y: 100 });
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        const a = spots[i] as { x: number; y: number };
        const b = spots[j] as { x: number; y: number };
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(20 - 1e-9);
      }
    }
  });
});
