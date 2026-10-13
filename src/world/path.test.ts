import { describe, expect, it } from 'vitest';
import {
  arc,
  arcFrom,
  forward,
  leftOf,
  line,
  makePath,
  offsetPath,
  pathEnd,
  pathStart,
  pointAt,
  project,
  reversePath,
  samplePath,
} from './path';

const QUARTER = Math.PI / 2;

describe('directions', () => {
  it('match the car: heading 0 is +Z, and the left of +Z is +X', () => {
    expect(forward(0).x).toBeCloseTo(0, 12);
    expect(forward(0).z).toBeCloseTo(1, 12);
    expect(leftOf(0).x).toBeCloseTo(1, 12);
    expect(leftOf(0).z).toBeCloseTo(0, 12);
    // Turning left (positive heading) from +Z points towards +X.
    expect(forward(QUARTER).x).toBeCloseTo(1, 12);
  });
});

describe('arcs', () => {
  it('a left turn from heading 0 ends at +X with heading +90 degrees', () => {
    const turn = makePath([arcFrom({ x: 0, z: 0 }, 0, 10, QUARTER)]);
    const end = pathEnd(turn);
    expect(end.x).toBeCloseTo(10, 9);
    expect(end.z).toBeCloseTo(10, 9);
    expect(end.heading).toBeCloseTo(QUARTER, 9);
    expect(turn.length).toBeCloseTo(10 * QUARTER, 9);
  });

  it('a right turn from heading 0 ends at -X with heading -90 degrees', () => {
    const end = pathEnd(makePath([arcFrom({ x: 0, z: 0 }, 0, 10, -QUARTER)]));
    expect(end.x).toBeCloseTo(-10, 9);
    expect(end.z).toBeCloseTo(10, 9);
    expect(end.heading).toBeCloseTo(-QUARTER, 9);
  });

  it('refuse a radius that is not positive', () => {
    expect(() => arc({ x: 0, z: 0 }, 0, 0, 1)).toThrow();
  });
});

describe('paths', () => {
  // 20 m straight along +Z, then a quarter circle of radius 10 to the left.
  const path = makePath([line({ x: 0, z: 0 }, { x: 0, z: 20 }), arcFrom({ x: 0, z: 20 }, 0, 10, QUARTER)]);

  it('add up their pieces and drop empty ones', () => {
    expect(path.length).toBeCloseTo(20 + 10 * QUARTER, 9);
    expect(makePath([line({ x: 1, z: 1 }, { x: 1, z: 1 })]).pieces).toHaveLength(0);
  });

  it('give the position and heading at any distance, clamped to the ends', () => {
    const p = pointAt(path, 10);
    expect([p.x, p.z, p.heading]).toEqual([0, 10, 0]);
    const q = pointAt(path, 20 + 5 * QUARTER);
    expect(q.heading).toBeCloseTo(QUARTER / 2, 9);
    expect(pointAt(path, -5).s).toBe(0);
    expect(pointAt(path, 1000).s).toBeCloseTo(path.length, 9);
  });

  it('find the closest point, with the sideways offset positive on the left', () => {
    const onLeft = project(path, { x: 2, z: 5 });
    expect(onLeft.s).toBeCloseTo(5, 9);
    expect(onLeft.offset).toBeCloseTo(2, 9);
    const onRight = project(path, { x: -3, z: 5 });
    expect(onRight.offset).toBeCloseTo(-3, 9);
    // Inside the left turn is on the left.
    const inside = project(path, { x: 10 - 8 * Math.cos(Math.PI / 4), z: 20 + 8 * Math.sin(Math.PI / 4) });
    expect(inside.offset).toBeCloseTo(2, 9);
    expect(inside.s).toBeCloseTo(20 + 10 * (Math.PI / 4), 9);
  });

  it('projects points beyond an arc onto its nearer end', () => {
    const turn = makePath([arc({ x: 0, z: 0 }, 10, 0, QUARTER)]);
    expect(project(turn, { x: -1, z: 10 }).s).toBeCloseTo(0, 9);
    expect(project(turn, { x: 10, z: -1 }).s).toBeCloseTo(turn.length, 9);
  });

  it('run alongside at a fixed distance when offset', () => {
    const left = offsetPath(path, 2);
    for (const p of samplePath(left, 0, left.length, 0.5)) {
      const back = project(path, p);
      expect(back.offset).toBeCloseTo(2, 9);
    }
    // The inside of a left turn is tighter.
    expect(left.length).toBeCloseTo(20 + 8 * QUARTER, 9);
    expect(offsetPath(path, -2).length).toBeCloseTo(20 + 12 * QUARTER, 9);
  });

  it('reverse into the same points driven the other way', () => {
    const back = reversePath(path);
    expect(back.length).toBeCloseTo(path.length, 9);
    const start = pathStart(back);
    const end = pathEnd(path);
    expect(start.x).toBeCloseTo(end.x, 9);
    expect(start.z).toBeCloseTo(end.z, 9);
    expect(start.heading).toBeCloseTo(end.heading - Math.PI, 9);
    const mid = pointAt(back, 7);
    const sameMid = pointAt(path, path.length - 7);
    expect(mid.x).toBeCloseTo(sameMid.x, 9);
    expect(mid.z).toBeCloseTo(sameMid.z, 9);
  });

  it('sample both ends, every joint and points along curves', () => {
    const points = samplePath(path, 5, path.length, 2);
    expect(points[0]?.s).toBe(5);
    expect(points.some((p) => Math.abs(p.s - 20) < 1e-9)).toBe(true);
    expect(points[points.length - 1]?.s).toBeCloseTo(path.length, 9);
    for (let i = 1; i < points.length; i++) {
      expect((points[i]?.s ?? 0) - (points[i - 1]?.s ?? 0)).toBeLessThanOrEqual(15 + 1e-9);
    }
    // On the arc itself the points are no more than 2 m apart.
    const onArc = points.filter((p) => p.s >= 20);
    for (let i = 1; i < onArc.length; i++) expect((onArc[i]?.s ?? 0) - (onArc[i - 1]?.s ?? 0)).toBeLessThanOrEqual(2 + 1e-9);
  });
});
