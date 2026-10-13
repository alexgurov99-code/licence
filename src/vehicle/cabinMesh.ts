import * as THREE from 'three';
import { CONFIG, type CabinParams } from '../config';

// Car interior seen from the driver's seat, built from simple shapes. Coordinates are the car's
// own: +Z forward, +X to the car's left, Y up from the ground. NZ cars are right-hand drive, so
// the driver (and the steering wheel and instruments) sit on the -X side.

const COLORS = {
  dash: 0x24272c,
  trim: 0x30343a,
  headliner: 0xa9a49a,
  seat: 0x3a3f47,
  wheel: 0x141517,
  wheelMarker: 0xc9ced4,
  mirrorHousing: 0x1d1f22,
  /** Placeholder until the mirrors get a live picture (stage 2). */
  mirrorGlass: 0x9fb4c8,
};

const STEERING_WHEEL = {
  y: 0.86,
  z: 0.2,
  radius: 0.185,
  /** The column rises towards the driver, so the wheel leans back from vertical. */
  tilt: 0.4,
};

const CLUSTER = { width: 0.34, y: 1.087, z: 0.505, tilt: 0.15 };

export class CabinMesh {
  readonly root = new THREE.Group();
  private readonly steeringSpin = new THREE.Group();
  private readonly clusterTexture: THREE.CanvasTexture;

  constructor(
    clusterCanvas: HTMLCanvasElement,
    maxAnisotropy: number,
    private readonly cabin: CabinParams = CONFIG.cabin,
  ) {
    this.root.name = 'cabin';
    const material = (color: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const dash = material(COLORS.dash);
    const trim = material(COLORS.trim);
    const headliner = material(COLORS.headliner);
    const seat = material(COLORS.seat);
    const driverX = cabin.driverX;

    // Floor, dashboard and door panels close the cabin in from below.
    this.add(block(1.6, 0.04, 2.15, dash), 0, 0.32, -0.35);
    this.add(block(1.52, 0.67, 0.42, dash), 0, 0.685, 0.51);
    for (const side of [-1, 1]) this.add(block(0.06, 0.64, 2.14, trim), side * 0.8, 0.67, -0.35);
    this.add(block(0.22, 0.25, 0.9, trim), 0, 0.5, -0.05);

    // Window frame: A-pillars, roof, B- and C-pillars.
    for (const side of [-1, 1]) {
      this.root.add(beam(v(side * 0.72, 1.0, 0.68), v(side * 0.67, 1.44, 0.14), 0.07, 0.1, trim));
      this.root.add(beam(v(side * 0.73, 1.0, -0.62), v(side * 0.71, 1.45, -0.6), 0.07, 0.14, trim));
      this.root.add(beam(v(side * 0.73, 1.0, -1.3), v(side * 0.68, 1.45, -1.2), 0.07, 0.16, trim));
    }
    this.add(block(1.44, 0.06, 0.12, trim), 0, 1.44, 0.12);
    this.add(block(1.5, 0.03, 1.6, headliner), 0, 1.47, -0.6);

    // Seats: two front seats and a rear bench.
    for (const x of [driverX, -driverX]) {
      this.add(block(0.5, 0.14, 0.5, seat), x, 0.52, -0.32);
      const back = this.add(block(0.5, 0.62, 0.12, seat), x, 0.88, -0.66);
      back.rotation.x = -0.25;
      this.add(block(0.28, 0.18, 0.1, seat), x, 1.3, -0.76);
    }
    this.add(block(1.3, 0.14, 0.5, seat), 0, 0.5, -1.05);
    this.add(block(1.3, 0.55, 0.12, seat), 0, 0.8, -1.33);
    // Parcel shelf over the boot, kept just under the body's top so it does not show from outside.
    this.add(block(1.5, 0.05, 0.6, dash), 0, 0.96, -1.72);

    // Instrument cluster in a cowl behind the steering wheel, seen over the top of the rim.
    this.add(block(0.42, 0.15, 0.2, dash), driverX, 1.085, 0.62);
    this.add(block(0.44, 0.02, 0.1, dash), driverX, 1.17, 0.51);
    this.clusterTexture = new THREE.CanvasTexture(clusterCanvas);
    this.clusterTexture.colorSpace = THREE.SRGBColorSpace;
    this.clusterTexture.anisotropy = maxAnisotropy;
    const clusterHeight = (CLUSTER.width * clusterCanvas.height) / clusterCanvas.width;
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(CLUSTER.width, clusterHeight),
      new THREE.MeshBasicMaterial({ map: this.clusterTexture }),
    );
    // A plane faces +Z; turn it round to face the driver and lean its top away a little.
    display.position.set(driverX, CLUSTER.y, CLUSTER.z);
    display.rotation.set(CLUSTER.tilt, Math.PI, 0);
    this.root.add(display);

    this.root.add(this.buildSteeringWheel(driverX));
    this.root.add(this.buildRearViewMirror());
    for (const side of [-1, 1] as const) this.root.add(this.buildSideMirror(side));
  }

  /** Turns the steering wheel to match the front wheels (steer: -1 full right .. +1 full left). */
  update(steer: number): void {
    // Seen from the driver's seat, a left turn spins the wheel anticlockwise: a negative turn
    // about the column axis, which points away from the driver.
    this.steeringSpin.rotation.z = -steer * this.cabin.steeringWheelTurns * Math.PI * 2;
  }

  /** Call after the instrument cluster canvas was redrawn. */
  refreshCluster(): void {
    this.clusterTexture.needsUpdate = true;
  }

  private add(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    return mesh;
  }

  private buildSteeringWheel(driverX: number): THREE.Group {
    const { y, z, radius, tilt } = STEERING_WHEEL;
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: COLORS.wheel, roughness: 0.6 });

    const tilted = new THREE.Group();
    tilted.position.set(driverX, y, z);
    tilted.rotation.x = tilt;
    tilted.add(this.steeringSpin);

    // Built in the X/Y plane, facing the driver; the spin group turns it about the column (local Z).
    this.steeringSpin.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 0.02, 12, 48), wheelMaterial));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 24), wheelMaterial);
    hub.rotation.x = Math.PI / 2;
    this.steeringSpin.add(hub);
    const spokeLength = radius - 0.06;
    for (const angle of [0, Math.PI, -Math.PI / 2]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(spokeLength, 0.045, 0.02), wheelMaterial);
      spoke.position.set(Math.cos(angle) * (0.06 + spokeLength / 2), Math.sin(angle) * (0.06 + spokeLength / 2), 0);
      spoke.rotation.z = angle;
      this.steeringSpin.add(spoke);
    }
    // A light stripe at twelve o'clock makes the wheel's rotation easy to see.
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.045, 0.045),
      new THREE.MeshStandardMaterial({ color: COLORS.wheelMarker, roughness: 0.5 }),
    );
    marker.position.y = radius;
    this.steeringSpin.add(marker);

    // Steering column going forwards and down into the dashboard.
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 12), wheelMaterial);
    column.rotation.x = Math.PI / 2;
    column.position.z = 0.15;
    tilted.add(column);
    return tilted;
  }

  private buildRearViewMirror(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 1.36, 0.34);
    // Angled towards the driver on the right.
    group.rotation.y = 0.18;
    const housing = new THREE.MeshStandardMaterial({ color: COLORS.mirrorHousing, roughness: 0.7 });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.035), housing));
    const glass = mirrorGlass(0.24, 0.065);
    glass.position.z = -0.0185;
    group.add(glass);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), housing);
    stem.position.set(0, 0.06, 0.01);
    group.add(stem);
    return group;
  }

  /** side: +1 = the car's left (passenger side), -1 = right (driver's side). */
  private buildSideMirror(side: 1 | -1): THREE.Group {
    const group = new THREE.Group();
    group.position.set(side * 0.98, 1.03, 0.6);
    // Turned so the glass faces the driver; the far (left) mirror needs a bigger angle.
    group.rotation.y = side > 0 ? 0.5 : -0.3;
    const housing = new THREE.MeshStandardMaterial({ color: COLORS.mirrorHousing, roughness: 0.7 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.09), housing);
    shell.castShadow = true;
    group.add(shell);
    const glass = mirrorGlass(0.17, 0.095);
    glass.position.z = -0.046;
    group.add(glass);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.05), housing);
    arm.position.set(-side * 0.13, -0.03, 0.01);
    group.add(arm);
    return group;
  }
}

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

function block(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

/** A box stretched between two points, e.g. a window pillar. */
function beam(
  from: THREE.Vector3,
  to: THREE.Vector3,
  thickness: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, direction.length(), depth), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function mirrorGlass(width: number, height: number): THREE.Mesh {
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: COLORS.mirrorGlass }),
  );
  // Planes face +Z; the glass faces backwards, towards the driver.
  glass.rotation.y = Math.PI;
  return glass;
}
