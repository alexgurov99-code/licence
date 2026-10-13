import * as THREE from 'three';
import { PALETTE } from './catalogue';

// Shared palette of the NZ suburb kit (design/nz-suburb-kit.html). Models take materials from
// here; colour parameters go through MATERIALS.byColor(), which caches one material per colour so
// equal colours share a material.

type Material = THREE.MeshStandardMaterial;

const make = (
  color: number,
  roughness = 0.85,
  metalness = 0,
  extra: THREE.MeshStandardMaterialParameters = {},
): Material => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const flat = { flatShading: true };
const cache = new Map<string, Material>();

export const MATERIALS = {
  trim: make(0xf7f7f2, 0.8),
  glass: make(0x3b4a58, 0.2, 0.1),
  brick: make(0xa4624a, 0.95),
  timberLight: make(0xb89a72, 0.9),
  timberDark: make(0x6e5640, 0.9),
  concrete: make(0xb8b6b0, 0.95),
  asphalt: make(0x3c3e42, 0.95),
  lawn: make(0x6f8f5a, 1),
  garageDoor: make(0xe6e2d8, 0.7),
  groove: make(0xb4b0a6, 0.8),
  aluminium: make(0xc4c7c9, 0.45, 0.5),
  leafDark: make(0x3f6b3a, 0.95, 0, flat),
  leafMid: make(0x5a8a45, 0.95, 0, flat),
  leafLight: make(0x7fa35a, 0.95, 0, flat),
  blossom: make(0xc23a3a, 0.9, 0, flat),
  trunk: make(0x5e4a38, 0.95),
  metal: make(0x8a8f94, 0.5, 0.4),
  metalDark: make(0x3a3d40, 0.6, 0.3),
  porcelain: make(0xd9d7d0, 0.4),
  signYellowGreen: make(0xb9c640, 0.6),
  hydrantYellow: make(0xe0b43a, 0.8),
  catsEye: make(0x2f6fd6, 0.3, 0, { emissive: 0x1d4fa8, emissiveIntensity: 0.4 }),
  lampLens: make(0xf6f1df, 0.4, 0, { emissive: 0xfff1c8, emissiveIntensity: 0.35 }),
  shelterGlass: make(0xa9c2cc, 0.1, 0, { transparent: true, opacity: 0.4, depthWrite: false }),
  rubber: make(0x232427, 0.9),
  bumper: make(0x3a3c40, 0.7),
  carGlass: make(0x27313b, 0.15, 0.2),
  hubcap: make(0xa7abb0, 0.4, 0.5, flat),
  plate: make(0xf0f0ea, 0.6),
  /** Colour presets for parameters (hex numbers, not materials). */
  colors: PALETTE,
  /** Cached material for a parameter colour. flatShading for foliage and faceted shapes. */
  byColor(hex: number, roughness = 0.85, metalness = 0, flatShading = false): Material {
    const key = `${hex}|${roughness}|${metalness}|${flatShading}`;
    let material = cache.get(key);
    if (!material) {
      material = make(hex, roughness, metalness, flatShading ? flat : {});
      cache.set(key, material);
    }
    return material;
  },
};
