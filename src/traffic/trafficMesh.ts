import * as THREE from 'three';
import { CONFIG } from '../config';
import { normalizeAngle } from '../util/math';
import { createCar, LIGHT_NAMES, WHEEL_NAMES, type CarUserData } from '../world/models/cars';
import { LEARNER, type TrafficCar, type TrafficState } from './traffic';

// The other cars in 3D: the kit's car models (world/models/cars.ts), placed where the traffic
// says, between two physics steps. Wheels turn and steer, brake lights come on when braking or
// standing, indicators flash. The body of each car is baked into one mesh per material, so a
// car costs a handful of draw calls in every view (main view, mirrors, looks). In debug mode,
// lines show who is giving way to whom (yellow; to the learner: red).

interface CarModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  front: THREE.Object3D[];
  lights: CarUserData['lightMaterials'];
  wheelRadius: number;
  wheelbase: number;
  geometries: THREE.BufferGeometry[];
}

const LIT = { brake: 1.6, indicator: 2.2 };
const DEBUG_HEIGHT = 2.2;

export class TrafficMesh {
  readonly root = new THREE.Group();
  /** Who gives way to whom, drawn in the main view in debug mode only. */
  readonly debug: THREE.LineSegments;
  private readonly models = new Map<number, CarModel>();
  private readonly debugPositions: THREE.BufferAttribute;
  private readonly debugColours: THREE.BufferAttribute;

  constructor(private readonly maxDebugLines = 64) {
    this.root.name = 'traffic';
    const geometry = new THREE.BufferGeometry();
    this.debugPositions = new THREE.BufferAttribute(new Float32Array(maxDebugLines * 6), 3);
    this.debugColours = new THREE.BufferAttribute(new Float32Array(maxDebugLines * 6), 3);
    geometry.setAttribute('position', this.debugPositions);
    geometry.setAttribute('color', this.debugColours);
    this.debug = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.debug.frustumCulled = false;
    this.debug.renderOrder = 10;
  }

  /**
   * Places the cars between the previous physics step and the latest one (alpha 0..1), lights
   * them for the simulation time, and updates the debug lines (learner: where the learner is).
   */
  update(state: TrafficState, previous: TrafficState | null, alpha: number, learner: THREE.Vector3): void {
    const before = new Map(previous?.cars.map((c) => [c.id, c]) ?? []);
    const seen = new Set<number>();
    const period = CONFIG.indicators.flashPeriodSeconds;
    for (const car of state.cars) {
      seen.add(car.id);
      let model = this.models.get(car.id);
      if (!model) {
        model = buildModel(car);
        this.models.set(car.id, model);
        this.root.add(model.root);
      }
      const from = before.get(car.id) ?? car;
      const heading = from.heading + normalizeAngle(car.heading - from.heading) * alpha;
      model.root.position.set(from.x + (car.x - from.x) * alpha, 0, from.z + (car.z - from.z) * alpha);
      model.root.rotation.y = heading;
      const spin = (from.travelled + (car.travelled - from.travelled) * alpha) / model.wheelRadius;
      for (const wheel of model.wheels) wheel.rotation.x = spin;
      const steer = Math.atan(model.wheelbase * car.curvature);
      for (const wheel of model.front) wheel.rotation.y = steer;

      // Each car flashes at its own moment, as real indicators are not in step.
      const flashOn = (state.time + car.id * 0.17) % period < period / 2;
      model.lights.brake.emissiveIntensity = car.accel < -0.3 || car.speed < 0.2 ? LIT.brake : 0;
      model.lights.left.emissiveIntensity = car.indicator === 'left' && flashOn ? LIT.indicator : 0;
      model.lights.right.emissiveIntensity = car.indicator === 'right' && flashOn ? LIT.indicator : 0;
    }
    for (const [id, model] of this.models) {
      if (seen.has(id)) continue;
      this.root.remove(model.root);
      disposeModel(model);
      this.models.delete(id);
    }
    this.updateDebug(state, learner);
  }

  private updateDebug(state: TrafficState, learner: THREE.Vector3): void {
    const byId = new Map(state.cars.map((c) => [c.id, c]));
    const pos = this.debugPositions.array as Float32Array;
    const col = this.debugColours.array as Float32Array;
    let n = 0;
    const add = (a: TrafficCar, bx: number, bz: number, red: boolean): void => {
      if (n >= this.maxDebugLines) return;
      pos.set([a.x, DEBUG_HEIGHT, a.z, bx, DEBUG_HEIGHT, bz], n * 6);
      const [r, g, b] = red ? [1, 0.2, 0.2] : [1, 0.85, 0.1];
      col.set([r, g, b, r, g, b], n * 6);
      n += 1;
    };
    for (const car of state.cars) {
      for (const id of car.givingWayTo) {
        if (id === LEARNER) add(car, learner.x, learner.z, true);
        else {
          const other = byId.get(id);
          if (other) add(car, other.x, other.z, false);
        }
      }
    }
    this.debug.geometry.setDrawRange(0, n * 2);
    this.debugPositions.needsUpdate = true;
    this.debugColours.needsUpdate = true;
  }

  dispose(): void {
    for (const model of this.models.values()) disposeModel(model);
    this.models.clear();
    this.root.clear();
    this.debug.geometry.dispose();
    (this.debug.material as THREE.Material).dispose();
  }
}

function buildModel(car: TrafficCar): CarModel {
  const source = createCar(car.type, { color: car.color });
  const data = source.userData as CarUserData;
  const root = new THREE.Group();
  root.name = `traffic-${car.id}`;
  const geometries: THREE.BufferGeometry[] = [];

  // Loose meshes of the body: baked together by material. Named groups (wheels, lights) stay as they are.
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...source.children]) {
    if (child instanceof THREE.Mesh) {
      const list = byMaterial.get(child.material as THREE.Material) ?? [];
      list.push(child);
      byMaterial.set(child.material as THREE.Material, list);
    } else {
      root.add(child);
      // A light is a few small boxes of one material: one mesh each.
      if (LIGHT_NAMES.includes(child.name as (typeof LIGHT_NAMES)[number])) bakeChildren(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) geometries.push(o.geometry as THREE.BufferGeometry);
      });
    }
  }
  for (const [material, meshes] of byMaterial) {
    const geometry = mergeMeshes(meshes);
    geometries.push(geometry);
    for (const mesh of meshes) mesh.geometry.dispose();
    const baked = new THREE.Mesh(geometry, material);
    baked.castShadow = meshes.some((m) => m.castShadow);
    baked.receiveShadow = meshes.some((m) => m.receiveShadow);
    root.add(baked);
  }

  const wheels = WHEEL_NAMES.map((name) => root.getObjectByName(name)).filter((w): w is THREE.Object3D => w !== undefined);
  return {
    root,
    wheels,
    front: wheels.filter((w) => w.name === 'wheelFL' || w.name === 'wheelFR'),
    lights: data.lightMaterials,
    wheelRadius: data.wheelRadius,
    wheelbase: data.wheelbase,
    geometries,
  };
}

/** Replaces the meshes directly under `group` (all of one material) with one. */
function bakeChildren(group: THREE.Object3D): void {
  const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  const first = meshes[0];
  if (!first || meshes.length < 2) return;
  const baked = new THREE.Mesh(mergeMeshes(meshes), first.material);
  for (const mesh of meshes) {
    group.remove(mesh);
    mesh.geometry.dispose();
  }
  group.add(baked);
}

/** One geometry (positions and normals) from several meshes, each moved into place. */
function mergeMeshes(meshes: readonly THREE.Mesh[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const mesh of meshes) {
    mesh.updateMatrix();
    const geometry = (mesh.geometry as THREE.BufferGeometry).index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    positions.push(...(geometry.getAttribute('position').array as Float32Array));
    normals.push(...(geometry.getAttribute('normal').array as Float32Array));
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  return merged;
}

function disposeModel(model: CarModel): void {
  for (const geometry of model.geometries) geometry.dispose();
  for (const material of Object.values(model.lights)) material.dispose();
}
