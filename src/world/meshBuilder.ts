// Collects many simple shapes (quads, boxes, roofs) into one set of vertex arrays, so a whole
// class of objects (all houses, all road markings, ...) is drawn in a single call. Pure arrays,
// no Three.js; worldMesh.ts turns the result into a mesh.

export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];
/** Texture coordinates of the four corners of a quad, in the same order as its corners. */
export type QuadUv = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];

/** A box or roof standing on the ground: centre of its footprint, the way its front faces, and its size. */
export interface Placement {
  x: number;
  z: number;
  /** Heading of the front (same convention as the car: 0 = +Z, positive = turned left). */
  heading: number;
  /** Size along its left-right axis, height, size front to back. */
  width: number;
  height: number;
  depth: number;
  /** Height of the bottom above the ground. */
  y?: number;
}

const NO_UV: QuadUv = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colours: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /**
   * A flat four-cornered patch (the corners in order around it). It is visible from the side
   * `normal` points to, whichever way round the corners were given.
   */
  quad(corners: readonly [Vec3, Vec3, Vec3, Vec3], normal: Vec3, colour: Rgb, uv: QuadUv = NO_UV): void {
    const [a, b, c] = corners;
    const flip = dot(cross(sub(b, a), sub(c, a)), normal) < 0;
    const order = flip ? [3, 2, 1, 0] : [0, 1, 2, 3];
    const base = this.vertexCount;
    for (const i of order) {
      const p = corners[i] as Vec3;
      const t = uv[i] as readonly [number, number];
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colours.push(colour[0], colour[1], colour[2]);
      this.uvs.push(t[0], t[1]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  triangle(corners: readonly [Vec3, Vec3, Vec3], normal: Vec3, colour: Rgb): void {
    const [a, b, c] = corners;
    const ordered = dot(cross(sub(b, a), sub(c, a)), normal) < 0 ? [a, c, b] : [a, b, c];
    const base = this.vertexCount;
    for (const p of ordered) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colours.push(colour[0], colour[1], colour[2]);
      this.uvs.push(0, 0);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  /** A flat shape lying on the ground at height `y`, facing up. Points go round its edge; the shape must be convex. */
  flatPolygon(points: readonly (readonly [number, number])[], y: number, colour: Rgb): void {
    const first = points[0];
    if (!first) return;
    for (let i = 1; i + 1 < points.length; i++) {
      const b = points[i] as readonly [number, number];
      const c = points[i + 1] as readonly [number, number];
      this.triangle(
        [
          [first[0], y, first[1]],
          [b[0], y, b[1]],
          [c[0], y, c[1]],
        ],
        UP,
        colour,
      );
    }
  }

  /** A box with four walls and a top (no bottom: it stands on the ground). */
  box(place: Placement, colour: Rgb, topColour: Rgb = colour): void {
    const frame = new Frame(place);
    const { width: w, depth: d } = place;
    const y0 = place.y ?? 0;
    const y1 = y0 + place.height;
    const corner = (sx: number, sz: number, y: number): Vec3 => frame.point((sx * w) / 2, y, (sz * d) / 2);
    // Walls: front, back, left, right.
    this.quad([corner(-1, 1, y0), corner(1, 1, y0), corner(1, 1, y1), corner(-1, 1, y1)], frame.direction(0, 1), colour);
    this.quad([corner(-1, -1, y0), corner(1, -1, y0), corner(1, -1, y1), corner(-1, -1, y1)], frame.direction(0, -1), colour);
    this.quad([corner(1, -1, y0), corner(1, 1, y0), corner(1, 1, y1), corner(1, -1, y1)], frame.direction(1, 0), colour);
    this.quad([corner(-1, -1, y0), corner(-1, 1, y0), corner(-1, 1, y1), corner(-1, -1, y1)], frame.direction(-1, 0), colour);
    this.quad([corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1)], UP, topColour);
  }

  /**
   * A gable roof on top of walls of the given placement: the ridge runs left to right, the slopes
   * face front and back, and the roof hangs over the walls by `overhang`.
   */
  gableRoof(place: Placement, rise: number, overhang: number, roofColour: Rgb, wallColour: Rgb): void {
    const frame = new Frame(place);
    const y0 = (place.y ?? 0) + place.height;
    const halfW = place.width / 2 + overhang;
    const halfD = place.depth / 2 + overhang;
    const eaves = y0 - overhang * (rise / (place.depth / 2));
    const ridgeY = y0 + rise;
    const p = (x: number, y: number, z: number): Vec3 => frame.point(x, y, z);
    const slope = Math.atan2(rise, place.depth / 2);
    const frontNormal = frame.direction(0, Math.sin(slope), Math.cos(slope));
    const backNormal = frame.direction(0, -Math.sin(slope), Math.cos(slope));
    this.quad([p(-halfW, eaves, halfD), p(halfW, eaves, halfD), p(halfW, ridgeY, 0), p(-halfW, ridgeY, 0)], frontNormal, roofColour);
    this.quad([p(-halfW, eaves, -halfD), p(halfW, eaves, -halfD), p(halfW, ridgeY, 0), p(-halfW, ridgeY, 0)], backNormal, roofColour);
    // The triangular gable walls at both ends.
    const halfWall = place.depth / 2;
    for (const side of [-1, 1]) {
      const x = (side * place.width) / 2;
      this.triangle([p(x, y0, -halfWall), p(x, y0, halfWall), p(x, ridgeY, 0)], frame.direction(side, 0), wallColour);
    }
  }

  /** An upright cylinder (approximated by `segments` flat sides) with a top, standing at height `y0`. */
  cylinder(x: number, z: number, radius: number, y0: number, y1: number, segments: number, side: Rgb, top: Rgb): void {
    const ring: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push([x + radius * Math.sin(a), z + radius * Math.cos(a)]);
    }
    ring.forEach(([ax, az], i) => {
      const [bx, bz] = ring[(i + 1) % segments] as [number, number];
      const mid = ((i + 0.5) / segments) * Math.PI * 2;
      this.quad(
        [
          [ax, y0, az],
          [bx, y0, bz],
          [bx, y1, bz],
          [ax, y1, az],
        ],
        [Math.sin(mid), 0, Math.cos(mid)],
        side,
      );
    });
    this.flatPolygon(ring, y1, top);
  }
}

export const UP: Vec3 = [0, 1, 0];

/** Local axes of a placed object: x to its left, y up, z to its front. */
class Frame {
  private readonly fx: number;
  private readonly fz: number;
  private readonly lx: number;
  private readonly lz: number;

  constructor(private readonly place: Placement) {
    this.fx = Math.sin(place.heading);
    this.fz = Math.cos(place.heading);
    this.lx = Math.cos(place.heading);
    this.lz = -Math.sin(place.heading);
  }

  point(x: number, y: number, z: number): Vec3 {
    return [this.place.x + this.lx * x + this.fx * z, y, this.place.z + this.lz * x + this.fz * z];
  }

  /** A direction given as (to the left, to the front, up) turned into world axes. */
  direction(x: number, z: number, y = 0): Vec3 {
    return [this.lx * x + this.fx * z, y, this.lz * x + this.fz * z];
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
