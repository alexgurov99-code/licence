import * as THREE from 'three';
import { CONFIG, type CabinParams, type FirstPersonCameraParams } from '../config';

/**
 * Driver's-eye camera. It is attached to the car model, so it moves and turns with the car
 * without any extra maths.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  constructor(
    car: THREE.Object3D,
    params: FirstPersonCameraParams = CONFIG.camera.firstPerson,
    cabin: CabinParams = CONFIG.cabin,
  ) {
    this.camera = new THREE.PerspectiveCamera(params.fov, 1, params.near, CONFIG.camera.far);
    this.camera.position.set(cabin.driverX, cabin.eyeHeight, cabin.eyeZ);
    // A camera looks along its own -Z. Tilt it slightly down, then turn it round to face the car's +Z.
    this.camera.rotation.set(params.pitch, Math.PI, 0, 'YXZ');
    car.add(this.camera);
  }
}
