import * as THREE from 'three';
import { CONFIG, type ChaseCameraParams } from '../config';
import type { VehicleState } from '../vehicle/vehicle';

/** Third-person camera that follows behind the car and smoothly catches up in turns. */
export class ChaseCamera {
  private readonly position = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLookTarget = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly params: ChaseCameraParams = CONFIG.camera.chase,
  ) {}

  /** Jump straight to the resting position (e.g. at the start of a drive). */
  snapTo(vehicle: VehicleState): void {
    this.computeDesired(vehicle);
    this.position.copy(this.desiredPosition);
    this.lookTarget.copy(this.desiredLookTarget);
    this.apply();
  }

  update(vehicle: VehicleState, frameSeconds: number): void {
    this.computeDesired(vehicle);
    // Frame-rate independent smoothing: the same share of the gap is closed per second.
    const t = 1 - Math.exp(-this.params.stiffness * frameSeconds);
    this.position.lerp(this.desiredPosition, t);
    this.lookTarget.lerp(this.desiredLookTarget, t);
    this.apply();
  }

  private computeDesired(vehicle: VehicleState): void {
    const forwardX = Math.sin(vehicle.heading);
    const forwardZ = Math.cos(vehicle.heading);
    const { distance, height, lookHeight, lookAhead } = this.params;
    this.desiredPosition.set(vehicle.x - forwardX * distance, height, vehicle.z - forwardZ * distance);
    this.desiredLookTarget.set(vehicle.x + forwardX * lookAhead, lookHeight, vehicle.z + forwardZ * lookAhead);
  }

  private apply(): void {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
  }
}
