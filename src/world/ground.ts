import * as THREE from 'three';
import { CONFIG } from '../config';

const GROUND_COLOR = '#6f8f5a';
const GRID_LINE_COLOR = '#4f6a40';

/** Flat ground with a grid every few metres so movement and speed are easy to see. */
export function createGround(maxAnisotropy: number, world = CONFIG.world): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ground';

  // The grid is painted into a repeating texture rather than drawn as 1-pixel lines:
  // it stays visible near the car and does not shimmer in the distance.
  const texture = createGridTexture();
  const cells = world.groundSize / world.gridCellSize;
  texture.repeat.set(cells, cells);
  texture.anisotropy = maxAnisotropy;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(world.groundSize, world.groundSize),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  group.add(plane);

  // Marks the start point.
  const origin = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }),
  );
  origin.rotation.x = -Math.PI / 2;
  origin.position.y = 0.02;
  group.add(origin);

  return group;
}

function createGridTexture(): THREE.CanvasTexture {
  const size = 256;
  const lineWidth = 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = GRID_LINE_COLOR;
    // Half a line on each edge, so neighbouring tiles join into one full-width line.
    ctx.fillRect(0, 0, size, lineWidth / 2);
    ctx.fillRect(0, size - lineWidth / 2, size, lineWidth / 2);
    ctx.fillRect(0, 0, lineWidth / 2, size);
    ctx.fillRect(size - lineWidth / 2, 0, lineWidth / 2, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
