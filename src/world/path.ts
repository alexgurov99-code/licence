// Road geometry made of straight lines and circular arcs. Pure maths, no Three.js.
//
// Same conventions as the car (see vehicle.ts): the ground is the X/Z plane, heading 0 points
// along +Z, and a positive heading change is a turn to the left. The direction of travel is
// (sin(heading), cos(heading)); the left side is (cos(heading), -sin(heading)).
// A point on an arc at angle `a` is centre + radius * (sin a, cos a).

import { normalizeAngle } from '../util/math';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose extends Vec2 {
  heading: number;
}

export interface PathPoint extends Pose {
  /** Distance along the path from its start. */
  s: number;
}

export interface LinePiece {
  readonly kind: 'line';
  readonly from: Vec2;
  readonly to: Vec2;
  readonly length: number;
}

export interface ArcPiece {
  readonly kind: 'arc';
  readonly centre: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  /** Radians turned along the arc: positive = turning left, negative = turning right. */
  readonly sweep: number;
  readonly length: number;
}

export type PathPiece = LinePiece | ArcPiece;

export interface Path {
  readonly pieces: readonly PathPiece[];
  readonly length: number;
}

/** Closest point of a path to a given point. */
export interface Projection extends PathPoint {
  /** Sideways distance from the path to the point: positive = the point is to the left of the direction of travel. */
  offset: number;
  /** Straight-line distance from the path to the point. */
  distance: number;
}

const TWO_PI = Math.PI * 2;

export function forward(heading: number): Vec2 {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

export function leftOf(heading: number): Vec2 {
  return { x: Math.cos(heading), z: -Math.sin(heading) };
}

/** Heading of the direction (dx, dz). */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function add(a: Vec2, b: Vec2, scale = 1): Vec2 {
  return { x: a.x + b.x * scale, z: a.z + b.z * scale };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function line(from: Vec2, to: Vec2): LinePiece {
  return { kind: 'line', from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, length: distance(from, to) };
}

export function arc(centre: Vec2, radius: number, startAngle: number, sweep: number): ArcPiece {
  if (!(radius > 0)) throw new Error(`Arc radius must be positive, got ${radius}`);
  return {
    kind: 'arc',
    centre: { x: centre.x, z: centre.z },
    radius,
    startAngle,
    sweep,
    length: Math.abs(sweep) * radius,
  };
}

/** Arc that starts at `start` heading along `heading` and turns by `sweep` (positive = left) with the given radius. */
export function arcFrom(start: Vec2, heading: number, radius: number, sweep: number): ArcPiece {
  const turn = Math.sign(sweep) || 1;
  const centre = add(start, leftOf(heading), radius * turn);
  return arc(centre, radius, heading - (turn * Math.PI) / 2, sweep);
}

/** Joins pieces into a path, dropping any of zero length. */
export function makePath(pieces: readonly PathPiece[]): Path {
  const kept = pieces.filter((piece) => piece.length > 1e-9);
  return { pieces: kept, length: kept.reduce((sum, piece) => sum + piece.length, 0) };
}

/** Position and heading at distance `t` along one piece. */
export function pointOnPiece(piece: PathPiece, t: number): Pose {
  if (piece.kind === 'line') {
    const heading = headingOf(piece.to.x - piece.from.x, piece.to.z - piece.from.z);
    const k = piece.length > 0 ? t / piece.length : 0;
    return {
      x: piece.from.x + (piece.to.x - piece.from.x) * k,
      z: piece.from.z + (piece.to.z - piece.from.z) * k,
      heading,
    };
  }
  const turn = Math.sign(piece.sweep) || 1;
  const angle = piece.startAngle + (turn * t) / piece.radius;
  return {
    x: piece.centre.x + piece.radius * Math.sin(angle),
    z: piece.centre.z + piece.radius * Math.cos(angle),
    heading: normalizeAngle(angle + (turn * Math.PI) / 2),
  };
}

/** Position and heading at distance `s` along the path (clamped to its ends). */
export function pointAt(path: Path, s: number): PathPoint {
  const clamped = Math.min(Math.max(s, 0), path.length);
  let start = 0;
  for (const piece of path.pieces) {
    if (clamped <= start + piece.length || piece === path.pieces[path.pieces.length - 1]) {
      return { ...pointOnPiece(piece, Math.min(clamped - start, piece.length)), s: clamped };
    }
    start += piece.length;
  }
  throw new Error('Empty path');
}

export function pathStart(path: Path): PathPoint {
  return pointAt(path, 0);
}

export function pathEnd(path: Path): PathPoint {
  return pointAt(path, path.length);
}

/** The point of the path closest to `p`. */
export function project(path: Path, p: Vec2): Projection {
  let best: Projection | null = null;
  let start = 0;
  for (const piece of path.pieces) {
    const t = closestOnPiece(piece, p);
    const pose = pointOnPiece(piece, t);
    const d = distance(pose, p);
    if (!best || d < best.distance) {
      const left = leftOf(pose.heading);
      const offset = (p.x - pose.x) * left.x + (p.z - pose.z) * left.z;
      best = { ...pose, s: start + t, offset, distance: d };
    }
    start += piece.length;
  }
  if (!best) throw new Error('Empty path');
  return best;
}

function closestOnPiece(piece: PathPiece, p: Vec2): number {
  if (piece.kind === 'line') {
    if (piece.length === 0) return 0;
    const dx = (piece.to.x - piece.from.x) / piece.length;
    const dz = (piece.to.z - piece.from.z) / piece.length;
    const t = (p.x - piece.from.x) * dx + (p.z - piece.from.z) * dz;
    return Math.min(Math.max(t, 0), piece.length);
  }
  const angle = Math.atan2(p.x - piece.centre.x, p.z - piece.centre.z);
  const turn = Math.sign(piece.sweep) || 1;
  const along = mod(turn * (angle - piece.startAngle), TWO_PI);
  const span = Math.abs(piece.sweep);
  if (along <= span) return along * piece.radius;
  // Outside the arc: whichever end is nearer around the circle.
  return along - span < TWO_PI - along ? piece.length : 0;
}

/** A path running alongside this one, `offset` metres to its left (negative = to the right). */
export function offsetPath(path: Path, offset: number): Path {
  return makePath(
    path.pieces.map((piece) => {
      if (piece.kind === 'line') {
        const left = leftOf(headingOf(piece.to.x - piece.from.x, piece.to.z - piece.from.z));
        return line(add(piece.from, left, offset), add(piece.to, left, offset));
      }
      // A left-turning arc has its centre on the left, so moving left makes it tighter.
      const radius = piece.radius - Math.sign(piece.sweep) * offset;
      return arc(piece.centre, radius, piece.startAngle, piece.sweep);
    }),
  );
}

/** The same path driven the other way. */
export function reversePath(path: Path): Path {
  return makePath(
    [...path.pieces].reverse().map((piece) =>
      piece.kind === 'line'
        ? line(piece.to, piece.from)
        : arc(piece.centre, piece.radius, piece.startAngle + piece.sweep, -piece.sweep),
    ),
  );
}

/**
 * Points along the stretch [from, to] of the path: both ends, every joint between pieces, and
 * extra points on arcs at most `maxArcStep` apart, so straight lines between them follow the curve.
 */
export function samplePath(path: Path, from = 0, to = path.length, maxArcStep = 2): PathPoint[] {
  const stops = new Set<number>([clampS(path, from), clampS(path, to)]);
  let start = 0;
  for (const piece of path.pieces) {
    const end = start + piece.length;
    if (end > from && start < to) {
      const a = Math.max(start, from);
      const b = Math.min(end, to);
      stops.add(a);
      stops.add(b);
      if (piece.kind === 'arc') {
        const steps = Math.ceil((b - a) / maxArcStep);
        for (let i = 1; i < steps; i++) stops.add(a + ((b - a) * i) / steps);
      }
    }
    start = end;
  }
  return [...stops].sort((a, b) => a - b).map((s) => pointAt(path, s));
}

function clampS(path: Path, s: number): number {
  return Math.min(Math.max(s, 0), path.length);
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}
