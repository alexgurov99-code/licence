import * as THREE from 'three';
import { CONFIG, type GlanceParams } from '../config';
import type { LookTarget } from './glance';

export interface LookPose {
  /** Eye position in car coordinates. */
  position: THREE.Vector3;
  /** Direction of the look, same convention as the car's heading: 0 = forward, positive = to the left. */
  yaw: number;
  /** Positive = up. */
  pitch: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

/** Where the driver's eyes are and where they point when looking back or over a shoulder. */
export function lookPose(target: LookTarget, eye: THREE.Vector3, params: GlanceParams = CONFIG.glance): LookPose {
  const yaw = target === 'leftShoulder' ? params.shoulderYaw : target === 'rightShoulder' ? -params.shoulderYaw : Math.PI;
  const pitch = target === 'back' ? params.lookBackPitch : params.shoulderPitch;
  const fov = target === 'back' ? params.lookBackFov : params.shoulderFov;
  // The head turns about the neck, which is behind the eyes, so the eyes swing back a little.
  const position = eye
    .clone()
    .add(new THREE.Vector3(0, 0, -params.neckOffset))
    .add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(params.neckOffset));
  // To look straight back the driver twists in the seat towards the middle of the car.
  if (target === 'back') position.x -= Math.sign(eye.x) * params.lookBackShift;
  return { position, yaw, pitch, fov };
}

/**
 * The picture for looking back and over the shoulders. One camera serves all three, since only
 * one can be shown at a time; it only draws while its window is on screen.
 */
export class LookCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(
    car: THREE.Object3D,
    private readonly params: GlanceParams = CONFIG.glance,
  ) {
    this.camera = new THREE.PerspectiveCamera(
      params.shoulderFov,
      params.aspect,
      CONFIG.camera.firstPerson.near,
      CONFIG.camera.far,
    );
    this.camera.name = 'look';
    car.add(this.camera);
    this.target = new THREE.WebGLRenderTarget(params.textureWidth, Math.round(params.textureWidth / params.aspect), {
      samples: 4,
      colorSpace: THREE.SRGBColorSpace,
    });
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, look: LookTarget, eye: THREE.Vector3): void {
    const pose = lookPose(look, eye, this.params);
    this.camera.position.copy(pose.position);
    // A camera looks along its own -Z, hence the half turn.
    this.camera.rotation.set(pose.pitch, pose.yaw + Math.PI, 0, 'YXZ');
    if (this.camera.fov !== pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previous);
  }
}
