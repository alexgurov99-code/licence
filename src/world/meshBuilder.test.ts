import { describe, expect, it } from 'vitest';
import { MeshBuilder, UP, type Vec3 } from './meshBuilder';

const WHITE = [1, 1, 1] as const;

/** Normal of each triangle from its winding (counter-clockwise seen from the front). */
function windingNormals(mesh: MeshBuilder): Vec3[] {
  const p = (i: number): Vec3 => [mesh.positions[i * 3] ?? 0, mesh.positions[i * 3 + 1] ?? 0, mesh.positions[i * 3 + 2] ?? 0];
  const result: Vec3[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [p(mesh.indices[t] ?? 0), p(mesh.indices[t + 1] ?? 0), p(mesh.indices[t + 2] ?? 0)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    result.push([
      (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
      (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
      (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
    ]);
  }
  return result;
}

/** Every triangle's winding agrees with the normal stored on its first vertex. */
function expectFacesMatchNormals(mesh: MeshBuilder): void {
  windingNormals(mesh).forEach((n, t) => {
    const i = mesh.indices[t * 3] ?? 0;
    const stored = [mesh.normals[i * 3] ?? 0, mesh.normals[i * 3 + 1] ?? 0, mesh.normals[i * 3 + 2] ?? 0];
    expect(n[0] * (stored[0] ?? 0) + n[1] * (stored[1] ?? 0) + n[2] * (stored[2] ?? 0)).toBeGreaterThan(0);
  });
}

describe('mesh builder', () => {
  it('makes quads face their normal whichever way round the corners come', () => {
    const mesh = new MeshBuilder();
    const corners: [Vec3, Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ];
    mesh.quad(corners, UP, WHITE);
    mesh.quad([...corners].reverse() as [Vec3, Vec3, Vec3, Vec3], UP, WHITE);
    expect(mesh.triangleCount).toBe(4);
    for (const n of windingNormals(mesh)) expect(n[1]).toBeGreaterThan(0);
  });

  it('builds boxes with four walls and a top, all facing outwards', () => {
    const mesh = new MeshBuilder();
    mesh.box({ x: 3, z: -2, heading: 0.7, width: 4, height: 2, depth: 6 }, WHITE);
    expect(mesh.triangleCount).toBe(10);
    expectFacesMatchNormals(mesh);
    // Normals point away from the middle of the box.
    for (let i = 0; i < mesh.vertexCount; i++) {
      const out = [(mesh.positions[i * 3] ?? 0) - 3, (mesh.positions[i * 3 + 1] ?? 0) - 1, (mesh.positions[i * 3 + 2] ?? 0) + 2];
      const n = [mesh.normals[i * 3] ?? 0, mesh.normals[i * 3 + 1] ?? 0, mesh.normals[i * 3 + 2] ?? 0];
      expect((out[0] ?? 0) * (n[0] ?? 0) + (out[1] ?? 0) * (n[1] ?? 0) + (out[2] ?? 0) * (n[2] ?? 0)).toBeGreaterThan(0);
    }
  });

  it('turns boxes to their heading: heading 0 has the front towards +Z and the width along X', () => {
    const mesh = new MeshBuilder();
    mesh.box({ x: 0, z: 0, heading: 0, width: 4, height: 1, depth: 2 }, WHITE);
    const xs = mesh.positions.filter((_, i) => i % 3 === 0);
    const zs = mesh.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...zs)).toBeCloseTo(1, 9);
  });

  it('builds gable roofs whose slopes face up and outwards', () => {
    const mesh = new MeshBuilder();
    mesh.gableRoof({ x: 0, z: 0, heading: 0, width: 10, height: 3, depth: 8 }, 2, 0.3, WHITE, WHITE);
    expect(mesh.triangleCount).toBe(6);
    expectFacesMatchNormals(mesh);
    const top = Math.max(...mesh.positions.filter((_, i) => i % 3 === 1));
    expect(top).toBeCloseTo(5, 9);
  });

  it('builds cylinders and flat shapes facing outwards and up', () => {
    const mesh = new MeshBuilder();
    mesh.cylinder(0, 0, 2, 0, 1, 12, WHITE, WHITE);
    mesh.flatPolygon(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      0,
      WHITE,
    );
    expectFacesMatchNormals(mesh);
    expect(mesh.triangleCount).toBe(12 * 2 + 10 + 2);
  });
});
