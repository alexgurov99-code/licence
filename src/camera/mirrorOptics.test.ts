import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG, type MirrorSpec } from '../config';
import {
  aimMirror,
  glassCentre,
  glassNormal,
  glassQuaternion,
  MIRROR_IDS,
  mirrorImageUv,
  mirrorView,
  viewDirection,
  type MirrorAim,
} from './mirrorOptics';

const EYE = new THREE.Vector3(CONFIG.cabin.driverX, CONFIG.cabin.eyeHeight, CONFIG.cabin.eyeZ);
const FAR = CONFIG.camera.far;
const flat = (spec: MirrorSpec): MirrorSpec => ({ ...spec, wideAngle: 1 });

/** Point on the glass as the driver sees it: u from the glass's left edge to its right, v from bottom to top. */
function glassPoint(spec: MirrorSpec, aim: MirrorAim, u: number, v: number): THREE.Vector3 {
  const q = glassQuaternion(aim);
  // The glass's own +X is the edge on the driver's left.
  const towardsDriversRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return glassCentre(spec)
    .addScaledVector(towardsDriversRight, (u - 0.5) * spec.width)
    .addScaledVector(up, (v - 0.5) * spec.height);
}

/** Follows the driver's line of sight to a point on the glass and on after it bounces off. */
function reflectedPoint(spec: MirrorSpec, aim: MirrorAim, u: number, v: number, distance: number): THREE.Vector3 {
  const onGlass = glassPoint(spec, aim, u, v);
  const sight = onGlass.clone().sub(EYE).normalize();
  const bounced = sight.reflect(glassNormal(aim));
  return onGlass.addScaledVector(bounced, distance);
}

describe('mirror optics', () => {
  for (const id of MIRROR_IDS) {
    describe(`${id} mirror`, () => {
      const spec = flat(CONFIG.mirrors[id]);
      const aim = aimMirror(spec, EYE);
      const view = mirrorView(spec, aim, EYE, FAR);

      it('shows each point where the reflected line of sight lands (angle in = angle out)', () => {
        for (const u of [0.05, 0.5, 0.95]) {
          for (const v of [0.05, 0.5, 0.95]) {
            const seen = mirrorImageUv(view, reflectedPoint(spec, aim, u, v, 25));
            expect(seen).not.toBeNull();
            expect(seen?.u).toBeCloseTo(u, 6);
            expect(seen?.v).toBeCloseTo(v, 6);
          }
        }
      });

      it('shows the configured view direction in the middle of the glass', () => {
        const ahead = glassCentre(spec).addScaledVector(viewDirection(spec), 100);
        const seen = mirrorImageUv(view, ahead);
        expect(seen?.u).toBeCloseTo(0.5, 6);
        expect(seen?.v).toBeCloseTo(0.5, 6);
      });

      it('does not show things behind the glass', () => {
        const behindGlass = glassCentre(spec).addScaledVector(glassNormal(aim), -0.05);
        expect(mirrorImageUv(view, behindGlass)).toBeNull();
      });

      it('does not show the driver what is outside the glass edges', () => {
        expect(mirrorImageUv(view, reflectedPoint(spec, aim, -0.1, 0.5, 25))).toBeNull();
        expect(mirrorImageUv(view, reflectedPoint(spec, aim, 0.5, 1.1, 25))).toBeNull();
      });
    });
  }

  it('moves the picture when the glass is turned', () => {
    const spec = CONFIG.mirrors.right;
    const aim = aimMirror(spec, EYE);
    const behindRight = new THREE.Vector3(-3, 0.5, -30);
    const before = mirrorImageUv(mirrorView(spec, aim, EYE, FAR), behindRight);
    // Turning the glass outwards (positive yaw turns the right mirror away from the driver) shows
    // more of the side, so things already in view slide towards the car.
    const turned = mirrorImageUv(mirrorView(spec, { ...aim, yaw: aim.yaw + 0.02 }, EYE, FAR), behindRight);
    expect(before).not.toBeNull();
    expect(turned).not.toBeNull();
    expect(turned!.u).toBeLessThan(before!.u - 0.05);
    // Tilting the glass down brings the road up in the picture.
    const tilted = mirrorImageUv(mirrorView(spec, { ...aim, pitch: aim.pitch - 0.01 }, EYE, FAR), behindRight);
    expect(tilted!.v).toBeGreaterThan(before!.v + 0.05);
  });

  it('a convex mirror shows the same scene smaller', () => {
    const spec = flat(CONFIG.mirrors.left);
    const aim = aimMirror(spec, EYE);
    // Far away, so the small shift of the viewpoint does not matter.
    const point = reflectedPoint(spec, aim, 0.8, 0.3, 1000);
    const convex = mirrorImageUv(mirrorView({ ...spec, wideAngle: 2 }, aim, EYE, FAR), point);
    expect(convex?.u).toBeCloseTo(0.5 + 0.3 / 2, 3);
    expect(convex?.v).toBeCloseTo(0.5 - 0.2 / 2, 3);
  });

  describe('default adjustment', () => {
    const halfWidth = CONFIG.vehicle.width / 2;
    const rearZ = -CONFIG.vehicle.length / 2;
    const viewOf = (id: 'left' | 'right') =>
      mirrorView(CONFIG.mirrors[id], aimMirror(CONFIG.mirrors[id], EYE), EYE, FAR);

    it('door mirrors see the side of the car from outside, as they stick out from the doors', () => {
      // Otherwise the car's side would be seen from within and not drawn.
      expect(viewOf('left').position.x).toBeGreaterThan(halfWidth);
      expect(viewOf('right').position.x).toBeLessThan(-halfWidth);
    });

    it('side mirrors show a thin strip of the car at their inner edge', () => {
      // The car's rear corner on each side; the car is on the right of the left mirror and on the left of the right one.
      const left = mirrorImageUv(viewOf('left'), new THREE.Vector3(halfWidth, 0.8, rearZ));
      const right = mirrorImageUv(viewOf('right'), new THREE.Vector3(-halfWidth, 0.8, rearZ));
      expect(left?.u).toBeGreaterThan(0.7);
      expect(right?.u).toBeLessThan(0.3);
    });

    it('side mirrors show the lane next to the car further back', () => {
      const lane = 3.5;
      expect(mirrorImageUv(viewOf('left'), new THREE.Vector3(halfWidth + lane, 0.5, -30))).not.toBeNull();
      expect(mirrorImageUv(viewOf('right'), new THREE.Vector3(-halfWidth - lane, 0.5, -30))).not.toBeNull();
    });

    it('the rear-view mirror shows the road straight behind, keeping left and right where they are', () => {
      const spec = CONFIG.mirrors.interior;
      const view = mirrorView(spec, aimMirror(spec, EYE), EYE, FAR);
      const behind = mirrorImageUv(view, new THREE.Vector3(0, 1, -40));
      expect(behind?.u).toBeCloseTo(0.5, 1);
      // A car behind and to the left appears on the left of the mirror, as in a real car.
      expect(mirrorImageUv(view, new THREE.Vector3(3, 0.5, -30))!.u).toBeLessThan(0.4);
      expect(mirrorImageUv(view, new THREE.Vector3(-3, 0.5, -30))!.u).toBeGreaterThan(0.6);
    });
  });
});
