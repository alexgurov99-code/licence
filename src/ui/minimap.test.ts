import { describe, expect, it } from 'vitest';
import { leftOf } from '../world/path';
import { screenDirection, toScreen, type MapView } from './minimap';

describe('map layout', () => {
  it('draws the centre point at its place on the canvas, at the given scale', () => {
    const view: MapView = { cx: 100, cy: 150, centre: { x: 30, z: -20 }, scale: 2, up: 0.7 };
    const p = toScreen(view, view.centre);
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(150, 9);
    const q = toScreen(view, { x: 33, z: -16 });
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(10, 9);
  });

  it('with north up shows +Z up and +X (the left of a car facing +Z) on the left', () => {
    const view: MapView = { cx: 0, cy: 0, centre: { x: 0, z: 0 }, scale: 1, up: 0 };
    expect(toScreen(view, { x: 0, z: 10 }).y).toBeCloseTo(-10, 9);
    expect(toScreen(view, { x: 10, z: 0 }).x).toBeCloseTo(-10, 9);
  });

  it('turned with the car, shows its way ahead up the screen and its left on the left', () => {
    for (const heading of [0, 0.4, 1.9, -2.5, Math.PI]) {
      const view: MapView = { cx: 50, cy: 50, centre: { x: 5, z: 7 }, scale: 3, up: heading };
      const ahead = screenDirection(view, heading);
      expect(ahead.x).toBeCloseTo(0, 9);
      expect(ahead.y).toBeLessThan(0);
      const left = toScreen(view, { x: 5 + leftOf(heading).x, z: 7 + leftOf(heading).z });
      expect(left.x).toBeLessThan(50);
      expect(left.y).toBeCloseTo(50, 9);
      // Turning left (a larger heading) turns the way ahead anticlockwise on the screen.
      const turned = screenDirection(view, heading + 0.3);
      expect(turned.x).toBeLessThan(0);
    }
  });
});
