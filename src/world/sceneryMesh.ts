import * as THREE from 'three';
import { CONFIG } from '../config';
import { createCar } from './models/cars';
import { MATERIALS } from './models/materials';
import { createCornerShop } from './models/houses';
import { createSection, type SectionUserData } from './models/section';
import {
  createBench,
  createBin,
  createBusStop,
  createFireHydrantMarker,
  createParkedTrailer,
  createPowerPole,
  createStreetLight,
  createWheelieBins,
} from './models/street';
import { createShrub, createTree } from './models/trees';
import type { Scenery, SceneryItem } from './scenery';

// The scenery drawn fast. The kit's models are made of many small meshes (a section has 55-120),
// and the scene is drawn 4-5 times a frame (main view, mirrors, shadows), so every model is baked
// into a few big meshes: one per square of the map and per kind of material, with the colours
// kept per vertex. Small parts (letterboxes, bins, window sills, ...) go on their own layer, which
// the mirrors do not draw.

/** Layer of small details: drawn in the main view, skipped in the mirrors. */
export const DETAIL_LAYER = 1;

/** Meshes smaller than this (bounding sphere radius, metres) count as details. */
const DETAIL_RADIUS = 0.6;
/** Size of the squares the town is cut into, so whole squares out of view are skipped. */
const CHUNK = CONFIG.world.tileSize * 2;

interface Part {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  colour: THREE.Color;
}

interface Bucket {
  material: THREE.MeshStandardMaterial;
  detail: boolean;
  parts: Part[];
  vertices: number;
}

export class SceneryMesh {
  readonly root = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  /** Meshes and triangles this adds to the scene, for the debug panel. */
  readonly meshCount: number;
  readonly triangleCount: number;

  constructor(scenery: Scenery) {
    this.root.name = 'scenery';
    const buckets = new Map<string, Bucket>();
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const sphere = new THREE.Sphere();
    const models: THREE.Object3D[] = [];

    // First sort every mesh of every model into its bucket...
    for (const item of scenery.items) {
      const model = buildModel(item);
      model.position.set(item.x, item.y, item.z);
      model.rotation.y = item.heading;
      model.updateMatrixWorld(true);
      models.push(model);
      const chunk = `${Math.floor(item.x / CHUNK)},${Math.floor(item.z / CHUNK)}`;
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const source = object.material as THREE.MeshStandardMaterial;
        const geometry = object.geometry as THREE.BufferGeometry;
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        sphere.copy(geometry.boundingSphere as THREE.Sphere).applyMatrix4(object.matrixWorld);
        const detail = sphere.radius < DETAIL_RADIUS;
        const kind = materialKind(source);
        let material = materials.get(kind);
        if (!material) {
          material = bakedMaterial(source);
          materials.set(kind, material);
        }
        const key = `${chunk}|${kind}|${detail}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { material, detail, parts: [], vertices: 0 };
          buckets.set(key, bucket);
        }
        bucket.parts.push({ geometry, matrix: object.matrixWorld, colour: source.color });
        bucket.vertices += geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
      });
    }

    // ...then copy them, moved into place, into one set of arrays per bucket.
    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    let meshes = 0;
    let triangles = 0;
    for (const bucket of buckets.values()) {
      const positions = new Float32Array(bucket.vertices * 3);
      const normals = new Float32Array(bucket.vertices * 3);
      const colours = new Float32Array(bucket.vertices * 3);
      let k = 0;
      for (const part of bucket.parts) {
        normalMatrix.getNormalMatrix(part.matrix);
        const pos = part.geometry.getAttribute('position');
        const nor = part.geometry.getAttribute('normal');
        const index = part.geometry.getIndex();
        const count = index ? index.count : pos.count;
        for (let i = 0; i < count; i++, k += 3) {
          const v = index ? index.getX(i) : i;
          position.fromBufferAttribute(pos, v).applyMatrix4(part.matrix);
          normal.fromBufferAttribute(nor, v).applyMatrix3(normalMatrix).normalize();
          positions[k] = position.x;
          positions[k + 1] = position.y;
          positions[k + 2] = position.z;
          normals[k] = normal.x;
          normals[k + 1] = normal.y;
          normals[k + 2] = normal.z;
          colours[k] = part.colour.r;
          colours[k + 1] = part.colour.g;
          colours[k + 2] = part.colour.b;
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, bucket.material);
      mesh.castShadow = !bucket.detail && !bucket.material.transparent;
      mesh.receiveShadow = true;
      if (bucket.detail) mesh.layers.set(DETAIL_LAYER);
      this.root.add(mesh);
      this.disposables.push(geometry);
      meshes += 1;
      triangles += bucket.vertices / 3;
    }
    for (const model of models) disposeModel(model);
    for (const material of materials.values()) this.disposables.push(material);
    this.meshCount = meshes;
    this.triangleCount = triangles;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
  }
}

/** The kit model for an item, in its own coordinates. */
function buildModel(item: SceneryItem): THREE.Object3D {
  switch (item.kind) {
    case 'section': {
      const section = createSection(item.options);
      const { drivewayX, parkZ } = section.userData as SectionUserData;
      if (item.driveway) {
        const parked = item.driveway.kind === 'car' ? createCar(item.driveway.car, { color: item.driveway.color }) : createParkedTrailer();
        // Nose towards the house.
        parked.position.set(drivewayX, 0, parkZ);
        parked.rotation.y = Math.PI;
        section.add(parked);
      }
      return section;
    }
    case 'cornerShop':
      return createCornerShop(item.options);
    case 'tree':
      return createTree(item.tree, item.treeHeight);
    case 'shrub':
      return createShrub({ size: item.size });
    case 'streetLight':
      return createStreetLight();
    case 'powerPole':
      return createPowerPole();
    case 'busStop':
      return createBusStop();
    case 'bench':
      return createBench();
    case 'bin':
      return createBin();
    case 'wheelieBins':
      return createWheelieBins({ count: item.count });
    case 'hydrant':
      return createFireHydrantMarker();
    case 'car':
      return createCar(item.car, { color: item.color });
    case 'crossing': {
      const group = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(item.width, 0.04, item.length), MATERIALS.concrete);
      slab.position.y = 0.02;
      group.add(slab);
      return group;
    }
  }
}

/**
 * Materials that differ only in colour bake into the same mesh (the colour goes into the vertices).
 * Shininess is rounded to a few steps so that nearly equal materials share a mesh too.
 */
function materialKind(m: THREE.MeshStandardMaterial): string {
  const glow = m.emissiveIntensity > 0 ? `${m.emissive.getHex()}/${m.emissiveIntensity}` : '-';
  return [roughnessStep(m.roughness), metalnessStep(m.metalness), m.flatShading, glow, m.transparent, m.opacity].join('|');
}

const ROUGHNESS_STEPS = [0.2, 0.45, 0.7, 0.9];

function roughnessStep(value: number): number {
  return ROUGHNESS_STEPS.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best));
}

function metalnessStep(value: number): number {
  return value >= 0.2 ? 0.4 : 0;
}

function bakedMaterial(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const glows = m.emissiveIntensity > 0;
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: roughnessStep(m.roughness),
    metalness: metalnessStep(m.metalness),
    flatShading: m.flatShading,
    emissive: glows ? m.emissive : 0x000000,
    emissiveIntensity: glows ? m.emissiveIntensity : 1,
    transparent: m.transparent,
    opacity: m.opacity,
    depthWrite: m.depthWrite,
  });
}

/** The kit makes fresh geometry for every model; once baked it is not needed. Materials are shared and stay. */
function disposeModel(model: THREE.Object3D): void {
  const seen = new Set<THREE.BufferGeometry>();
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && !seen.has(object.geometry)) {
      seen.add(object.geometry);
      (object.geometry as THREE.BufferGeometry).dispose();
    }
  });
}
