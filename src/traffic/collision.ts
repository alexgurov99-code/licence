import type { Pose } from '../world/path';

// Do two cars touch? Each car is a rectangle on the ground (its body seen from above). Two
// rectangles overlap unless some edge direction of one of them separates them (separating axes).
// Pure maths.

export interface Body extends Pose {
  length: number;
  width: number;
}

export function bodiesOverlap(a: Body, b: Body): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Cheap early out: further apart than the two diagonals.
  const reach = Math.hypot(a.length, a.width) / 2 + Math.hypot(b.length, b.width) / 2;
  if (dx * dx + dz * dz > reach * reach) return false;
  for (const axisOwner of [a, b]) {
    for (const angle of [axisOwner.heading, axisOwner.heading + Math.PI / 2]) {
      const ax = Math.sin(angle);
      const az = Math.cos(angle);
      const gap = Math.abs(dx * ax + dz * az);
      if (gap > halfExtent(a, ax, az) + halfExtent(b, ax, az)) return false;
    }
  }
  return true;
}

/** Half the size of the rectangle measured along the direction (ax, az). */
function halfExtent(body: Body, ax: number, az: number): number {
  const fx = Math.sin(body.heading);
  const fz = Math.cos(body.heading);
  const along = Math.abs(fx * ax + fz * az);
  const across = Math.abs(fz * ax - fx * az);
  return (body.length / 2) * along + (body.width / 2) * across;
}
