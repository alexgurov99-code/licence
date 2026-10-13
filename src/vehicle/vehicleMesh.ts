import * as THREE from 'three';
import { CONFIG, type VehicleParams } from '../config';
import type { VehicleState } from './vehicle';

export interface ExteriorLamps {
  left: boolean;
  right: boolean;
  brake: boolean;
  reverse: boolean;
}

const LAMP_COLORS = {
  indicatorOn: 0xffa21a,
  indicatorOff: 0x6b4512,
  brakeOn: 0xff2a1a,
  brakeOff: 0x7a1d16,
  reverseOn: 0xffffff,
  reverseOff: 0x9a9a9a,
};

/** Placeholder car built from boxes and cylinders. The model faces +Z, matching heading = 0; its left is +X. */
export class VehicleMesh {
  readonly root = new THREE.Group();
  private readonly frontWheels: THREE.Object3D[] = [];
  /** Parts that would block the view from the driver's seat (see setInteriorView). */
  private readonly shellParts: THREE.Mesh[] = [];
  private readonly leftIndicator = lampMaterial(LAMP_COLORS.indicatorOff);
  private readonly rightIndicator = lampMaterial(LAMP_COLORS.indicatorOff);
  private readonly brakeLights = lampMaterial(LAMP_COLORS.brakeOff);
  private readonly reverseLights = lampMaterial(LAMP_COLORS.reverseOff);

  constructor(private readonly params: VehicleParams = CONFIG.vehicle) {
    this.root.name = 'vehicle';
    const { length, width, height, wheelbase, wheelRadius, wheelWidth } = params;

    const bodyHeight = height * 0.5;
    const bodyY = wheelRadius + bodyHeight / 2 - 0.05;
    const bodyTop = bodyY + bodyHeight / 2;

    // Cabin sits towards the back so the front of the car is obvious at a glance.
    const cabinHeight = height - bodyHeight - wheelRadius + 0.1;
    const cabinLength = length * 0.5;
    const cabinZ = -length * 0.08;
    const cabinFront = cabinZ + cabinLength / 2;

    // The lower body is two boxes split at the windscreen: the bonnet stays visible from the
    // driver's seat, the rest is hidden there so it does not cover the cabin floor.
    const bonnetLength = length / 2 - cabinFront;
    const bonnet = box(width, bodyHeight, bonnetLength, 0xc8372d);
    bonnet.position.set(0, bodyY, cabinFront + bonnetLength / 2);
    this.root.add(bonnet);

    const rearLength = length - bonnetLength;
    const rearBody = box(width, bodyHeight, rearLength, 0xc8372d);
    rearBody.position.set(0, bodyY, cabinFront - rearLength / 2);
    this.root.add(rearBody);

    const cabin = box(width * 0.86, cabinHeight, cabinLength, 0x2b3440);
    cabin.position.set(0, bodyTop + cabinHeight / 2, cabinZ);
    this.root.add(cabin);
    this.shellParts.push(rearBody, cabin);

    const lightY = bodyY + 0.08;
    const lightZ = length / 2 + 0.01;
    const cornerX = width / 2 - 0.08;
    for (const side of [-1, 1]) {
      const headlight = box(0.35, 0.14, 0.04, 0xfff6d5, true);
      headlight.position.set(side * width * 0.32, lightY, lightZ);
      this.root.add(headlight);

      const taillight = lampBox(0.35, 0.14, this.brakeLights);
      taillight.position.set(side * width * 0.32, lightY, -lightZ);
      this.root.add(taillight);

      const reverseLight = lampBox(0.12, 0.1, this.reverseLights);
      reverseLight.position.set(side * width * 0.12, lightY, -lightZ);
      this.root.add(reverseLight);

      // Left of the car is +X.
      const indicator = side > 0 ? this.leftIndicator : this.rightIndicator;
      for (const z of [lightZ, -lightZ]) {
        const lamp = lampBox(0.12, 0.12, indicator);
        lamp.position.set(side * cornerX, lightY, z);
        this.root.add(lamp);
      }
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

  setLamps(lamps: ExteriorLamps): void {
    this.leftIndicator.color.setHex(lamps.left ? LAMP_COLORS.indicatorOn : LAMP_COLORS.indicatorOff);
    this.rightIndicator.color.setHex(lamps.right ? LAMP_COLORS.indicatorOn : LAMP_COLORS.indicatorOff);
    this.brakeLights.color.setHex(lamps.brake ? LAMP_COLORS.brakeOn : LAMP_COLORS.brakeOff);
    this.reverseLights.color.setHex(lamps.reverse ? LAMP_COLORS.reverseOn : LAMP_COLORS.reverseOff);
  }

  /**
   * In the driver's-seat view the cabin roof box and the rear body would sit between the camera
   * and the interior. They stop drawing but keep casting the car's shadow on the road.
   */
  setInteriorView(enabled: boolean): void {
    for (const mesh of this.shellParts) {
      const material = mesh.material as THREE.Material;
      material.colorWrite = !enabled;
      material.depthWrite = !enabled;
    }
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

function lampMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

function lampBox(width: number, height: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), material);
}
