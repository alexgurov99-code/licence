import { add, forward, leftOf, type Vec2 } from './path';

// Convex polygons on the ground: footprints of houses and roadside items, sight triangles at
// junctions, the strips in front of signs. Pure maths.

/**
 * The rectangle of a model placed at `centre` facing `heading`, in its own coordinates: x across
 * (towards its left, the car convention), z along its face direction.
 */
export function placedRect(
  centre: Vec2,
  heading: number,
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
): Vec2[] {
  const across = leftOf(heading);
  const ahead = forward(heading);
  const at = (x: number, z: number): Vec2 => add(add(centre, across, x), ahead, z);
  return [at(xMin, zMin), at(xMax, zMin), at(xMax, zMax), at(xMin, zMax)];
}

/** Do two convex polygons overlap (touching edges do not count)? Separating axis test. */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[], margin = 1e-6): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Vec2;
      const q = poly[(i + 1) % poly.length] as Vec2;
      const nx = q.z - p.z;
      const nz = -(q.x - p.x);
      const range = (list: readonly Vec2[]): [number, number] => {
        let min = Infinity;
        let max = -Infinity;
        for (const v of list) {
          const d = v.x * nx + v.z * nz;
          min = Math.min(min, d);
          max = Math.max(max, d);
        }
        return [min, max];
      };
      const [aMin, aMax] = range(a);
      const [bMin, bMax] = range(b);
      const length = Math.hypot(nx, nz) || 1;
      if (aMax <= bMin + margin * length || bMax <= aMin + margin * length) return false;
    }
  }
  return true;
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The corners and points along the edges of a polygon, at most `step` apart. */
export function outlinePoints(poly: readonly Vec2[], step: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / step));
    for (let k = 0; k < n; k++) points.push({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n });
  }
  return points;
}

export function polygonCentre(poly: readonly Vec2[]): Vec2 {
  const sum = poly.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / poly.length, z: sum.z / poly.length };
}
