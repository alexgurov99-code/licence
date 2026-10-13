import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { driverEye } from './firstPersonCamera';
import { lookPose } from './lookCamera';

const EYE = driverEye();

/** Look direction in car coordinates: x > 0 is the car's left, z < 0 is backwards. */
function direction(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

describe('lookPose', () => {
  it('over the right shoulder looks back and to the right', () => {
    const d = direction(lookPose('rightShoulder', EYE).yaw);
    expect(d.x).toBeLessThan(-0.5);
    expect(d.z).toBeLessThan(-0.3);
  });

  it('over the left shoulder looks back and to the left', () => {
    const d = direction(lookPose('leftShoulder', EYE).yaw);
    expect(d.x).toBeGreaterThan(0.5);
    expect(d.z).toBeLessThan(-0.3);
  });

  it('looking back points straight back, with the head moved towards the middle of the car', () => {
    const pose = lookPose('back', EYE);
    const d = direction(pose.yaw);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
    // The driver sits on the right (-X); twisting round moves the head towards x = 0.
    expect(pose.position.x).toBeCloseTo(EYE.x + CONFIG.glance.lookBackShift, 6);
    expect(pose.pitch).toBeLessThan(0);
  });

  it('turning the head moves the eyes back a little, as the head turns about the neck', () => {
    for (const target of ['back', 'leftShoulder', 'rightShoulder'] as const) {
      expect(lookPose(target, EYE).position.z).toBeLessThan(EYE.z);
    }
  });
});
