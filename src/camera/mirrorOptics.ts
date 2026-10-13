import * as THREE from 'three';
import { CONFIG, type MirrorSpec } from '../config';

// How a car mirror works, as plain geometry: no rendering here, so it can be tested without a
// browser. Everything is in the car's own coordinates: +Z forward, +X the car's left, Y up.
//
// A flat mirror shows exactly what an eye placed behind the glass (the driver's eye reflected in
// the glass plane) would see through the glass as if it were a window, flipped left to right. So
// each mirror gets a camera at that reflected eye, with a picture frame cut to the glass edges.
// The picture then depends on where the driver's eye is and on the angle of the glass, like in
// a real car.

export type MirrorId = 'interior' | 'left' | 'right';
export const MIRROR_IDS: readonly MirrorId[] = ['interior', 'left', 'right'];

/** Angle of the glass. Both zero = the glass faces straight back. Positive yaw turns it towards the car's left, positive pitch tilts it up. */
export interface MirrorAim {
  yaw: number;
  pitch: number;
}

export type MirrorAims = Readonly<Record<MirrorId, MirrorAim>>;

/** Where to put a mirror's camera, and its picture frame. */
export interface MirrorView {
  /** The driver's eye reflected in the glass (moved closer to it for a convex mirror). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Off-centre perspective whose frame is exactly the glass. */
  projection: THREE.Matrix4;
}

export function glassCentre(spec: MirrorSpec): THREE.Vector3 {
  return new THREE.Vector3(spec.x, spec.y, spec.z);
}

/**
 * Orientation of the glass. In its own coordinates the glass faces -Z (towards the driver), +X
 * is its edge on the driver's left and +Y its top edge.
 */
export function glassQuaternion(aim: MirrorAim): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(aim.pitch, aim.yaw, 0, 'YXZ'));
}

/** Unit vector out of the reflecting side of the glass. */
export function glassNormal(aim: MirrorAim): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(glassQuaternion(aim));
}

/** Direction a well-adjusted mirror shows at its centre (see CONFIG.mirrors). */
export function viewDirection(spec: MirrorSpec): THREE.Vector3 {
  const { viewYaw: yaw, viewPitch: pitch } = spec;
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** Glass angle at which the driver, looking at the glass centre, sees the mirror's view direction. */
export function aimMirror(spec: MirrorSpec, eye: THREE.Vector3): MirrorAim {
  // The glass must face halfway between the eye and the direction it should show.
  const towardsEye = eye.clone().sub(glassCentre(spec)).normalize();
  const normal = towardsEye.add(viewDirection(spec)).normalize();
  return { yaw: Math.atan2(-normal.x, -normal.z), pitch: Math.asin(normal.y) };
}

/** All three mirrors adjusted as CONFIG.mirrors describes, for this eye position. */
export function defaultMirrorAims(
  eye: THREE.Vector3,
  specs: Readonly<Record<MirrorId, MirrorSpec>> = CONFIG.mirrors,
): MirrorAims {
  return {
    interior: aimMirror(specs.interior, eye),
    left: aimMirror(specs.left, eye),
    right: aimMirror(specs.right, eye),
  };
}

export function mirrorView(spec: MirrorSpec, aim: MirrorAim, eye: THREE.Vector3, far: number): MirrorView {
  const centre = glassCentre(spec);
  const quaternion = glassQuaternion(aim);
  const normal = glassNormal(aim);
  // How far the eye is in front of the glass. The reflected eye is as far behind it.
  const eyeDistance = Math.max(normal.dot(eye.clone().sub(centre)), 0.01);
  const reflectedEye = eye.clone().addScaledVector(normal, -2 * eyeDistance);
  // A convex mirror spreads the reflected rays wider, as if they came from a point closer to the
  // glass: the picture covers more, and things look smaller.
  const position = reflectedEye.sub(centre).divideScalar(spec.wideAngle).add(centre);
  // The glass is the near clipping plane, so nothing behind the mirror shows up in it.
  const near = eyeDistance / spec.wideAngle;

  // The camera sits behind the glass looking through it, turned the same way as the glass
  // (looking along its -Z is looking along the normal). Its picture frame is the glass itself,
  // usually off to one side of where the camera points.
  const toCentre = centre.clone().sub(position);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const cx = right.dot(toCentre);
  const cy = up.dot(toCentre);
  const halfWidth = spec.width / 2;
  const halfHeight = spec.height / 2;
  const projection = new THREE.Matrix4().makePerspective(
    cx - halfWidth,
    cx + halfWidth,
    cy + halfHeight,
    cy - halfHeight,
    near,
    far,
  );
  return { position, quaternion, projection };
}

/**
 * Where a point in the car's coordinates appears in the mirror, as the driver sees it: u from the
 * glass's left edge (0) to its right edge (1), v from bottom (0) to top (1). Null if the mirror
 * does not show it.
 */
export function mirrorImageUv(view: MirrorView, point: THREE.Vector3): { u: number; v: number } | null {
  const toCamera = new THREE.Matrix4().compose(view.position, view.quaternion, new THREE.Vector3(1, 1, 1)).invert();
  const local = point.clone().applyMatrix4(toCamera);
  if (local.z >= 0) return null;
  const ndc = local.applyMatrix4(view.projection);
  if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || Math.abs(ndc.z) > 1) return null;
  // The camera looks through the glass from behind, so its left and right are the other way
  // round from the driver's. The mirror textures are flipped the same way (see mirrors.ts).
  return { u: (1 - ndc.x) / 2, v: (ndc.y + 1) / 2 };
}
