import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCar, LIGHT_NAMES, WHEEL_NAMES } from './cars';
import { createCornerShop, createGarage, createHouseBungalow, createHouseTwoStorey, createHouseVilla, createUnitBlock } from './houses';
import { createSection } from './section';
import { CAR_SIZES, type CarType } from './catalogue';
import {
  createBench,
  createBin,
  createBusStop,
  createFence,
  createFireHydrantMarker,
  createLetterbox,
  createParkedTrailer,
  createPowerPole,
  createStreetLight,
  createWheelieBins,
} from './street';
import { createHedge, createTree } from './trees';

function meshes(object: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) list.push(o);
  });
  return list;
}

function size(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}

describe('kit models', () => {
  it('build with the documented number of meshes', () => {
    expect(meshes(createHouseBungalow()).length).toBe(42);
    expect(meshes(createHouseBungalow({ hasChimney: false })).length).toBe(40);
    expect(meshes(createHouseVilla()).length).toBe(41);
    expect(meshes(createHouseTwoStorey()).length).toBe(36);
    expect(meshes(createUnitBlock()).length).toBe(43);
    expect(meshes(createCornerShop()).length).toBe(36);
    expect(meshes(createGarage()).length).toBe(11);
    expect(meshes(createGarage({ type: 'carport' })).length).toBe(8);
    expect(meshes(createStreetLight()).length).toBe(5);
    expect(meshes(createPowerPole()).length).toBe(6);
    expect(meshes(createBusStop()).length).toBe(8);
    expect(meshes(createBench()).length).toBe(6);
    expect(meshes(createBin()).length).toBe(3);
    expect(meshes(createWheelieBins()).length).toBe(6);
    expect(meshes(createFireHydrantMarker()).length).toBe(2);
    expect(meshes(createParkedTrailer()).length).toBe(8);
    expect(meshes(createLetterbox()).length).toBe(4);
    expect(meshes(createFence()).length).toBe(3);
    expect(meshes(createHedge()).length).toBe(2);
    expect(meshes(createTree('deciduous')).length).toBe(4);
    expect(meshes(createTree('pohutukawa')).length).toBe(7);
    expect(meshes(createTree('cabbage')).length).toBe(10);
    expect(meshes(createTree('conifer')).length).toBe(4);
    expect(meshes(createTree('shrub')).length).toBe(2);
  });

  it('stand on the ground at their documented size', () => {
    const house = size(createHouseBungalow());
    // Ridge 5.5 m, chimney cap a little higher.
    expect(house.y).toBeGreaterThan(5.5);
    expect(house.y).toBeLessThan(6);
    const tree = size(createTree('deciduous', 6));
    expect(tree.y).toBeGreaterThan(5);
    expect(tree.y).toBeLessThan(7);
    const section = createSection({ houseType: 'villa', fenceType: 'paling' });
    const box = new THREE.Box3().setFromObject(section);
    // 18 m wide; tree crowns in the corner slots may hang over the boundary a little.
    expect(box.min.x).toBeGreaterThanOrEqual(-10);
    expect(box.max.x).toBeLessThanOrEqual(10);
    // The letterbox stands just outside the front boundary.
    expect(box.max.z).toBeLessThan(15.6);
    expect(box.min.y).toBeGreaterThan(-0.01);
  });

  for (const type of Object.keys(CAR_SIZES) as CarType[]) {
    it(`${type}: separate named wheels and lights, and the size used for parking`, () => {
      const car = createCar(type, { color: 0x24364f });
      for (const name of [...WHEEL_NAMES, ...LIGHT_NAMES]) expect(car.getObjectByName(name)).toBeInstanceOf(THREE.Group);
      const s = size(car);
      expect(s.z).toBeCloseTo(CAR_SIZES[type].length, 0);
      expect(s.x).toBeLessThan(CAR_SIZES[type].width + 0.4);
    });
  }
});
