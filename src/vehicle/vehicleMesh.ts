import * as THREE from 'three';
import { CONFIG, type VehicleParams } from '../config';
import type { VehicleState } from './vehicle';

/** Placeholder car built from boxes and cylinders. The model faces +Z, matching heading = 0. */
export class VehicleMesh {
  readonly root = new THREE.Group();
  private readonly frontWheels: THREE.Object3D[] = [];

  constructor(private readonly params: VehicleParams = CONFIG.vehicle) {
    this.root.name = 'vehicle';
    const { length, width, height, wheelbase, wheelRadius, wheelWidth } = params;

    const bodyHeight = height * 0.5;
    const body = box(width, bodyHeight, length, 0xc8372d);
    body.position.y = wheelRadius + bodyHeight / 2 - 0.05;
    this.root.add(body);

    // Cabin sits towards the back so the front of the car is obvious at a glance.
    const cabinHeight = height - bodyHeight - wheelRadius + 0.1;
    const cabinLength = length * 0.5;
    const cabin = box(width * 0.86, cabinHeight, cabinLength, 0x2b3440);
    cabin.position.set(0, body.position.y + bodyHeight / 2 + cabinHeight / 2, -length * 0.08);
    this.root.add(cabin);

    const lightZ = length / 2 + 0.01;
    for (const side of [-1, 1]) {
      const headlight = box(0.35, 0.14, 0.04, 0xfff6d5, true);
      headlight.position.set(side * width * 0.32, body.position.y + 0.08, lightZ);
      this.root.add(headlight);

      const taillight = box(0.35, 0.14, 0.04, 0xff2a1a, true);
      taillight.position.set(side * width * 0.32, body.position.y + 0.08, -lightZ);
      this.root.add(taillight);
    }

    const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 20);
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    const trackHalf = width / 2 - wheelWidth / 2 + 0.02;
    for (const axleZ of [wheelbase / 2, -wheelbase / 2]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.castShadow = true;
        wheel.position.set(side * trackHalf, wheelRadius, axleZ);
        this.root.add(wheel);
        if (axleZ > 0) this.frontWheels.push(wheel);
      }
    }
  }

  update(state: VehicleState): void {
    this.root.position.set(state.x, 0, state.z);
    this.root.rotation.y = state.heading;
    const wheelAngle = state.steer * this.params.maxSteerAngle;
    for (const wheel of this.frontWheels) wheel.rotation.y = wheelAngle;
  }
}

function box(width: number, height: number, depth: number, color: number, emissive = false): THREE.Mesh {
  const material = emissive
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = !emissive;
  return mesh;
}
