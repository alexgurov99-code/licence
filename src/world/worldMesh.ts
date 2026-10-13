import * as THREE from 'three';
import { CONFIG, type WorldParams } from '../config';
import { DIRS } from './layout';
import { MeshBuilder, UP, type QuadUv, type Rgb, type Vec3 } from './meshBuilder';
import type { Junction, RoadNetwork, RoadSymbol, Sign } from './network';
import { add, forward, leftOf, samplePath, type Vec2 } from './path';
import { atlasUv, drawSignAtlas, SIGN_QUAD_SCALE, speedPicture, type AtlasPicture } from './signArt';

const COLOURS = {
  grass: 0x6f8f5a,
  asphalt: 0x4a4d51,
  white: 0xf2f2ec,
  yellow: 0xf2c12e,
  post: 0x8f949a,
  kerb: 0xbdbab1,
  island: 0x5d8a48,
};

/** Flat layers sit a little above each other (and are pulled forward in depth) so they never flicker. */
const ROAD_Y = 0.02;
const MARKING_Y = 0.035;
const SYMBOL_Y = 0.04;

/**
 * The whole town drawn as a handful of big meshes: grass, asphalt, road markings, signs, symbols
 * painted on the road, and everything solid (sign posts, islands; houses and the rest of the
 * scenery are in sceneryMesh.ts). The scene is
 * drawn several times a frame (mirrors), so fewer, larger meshes keep it fast.
 */
export class WorldMesh {
  readonly root = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(network: RoadNetwork, maxAnisotropy: number, params: WorldParams = CONFIG.world) {
    this.root.name = 'world';
    this.root.add(
      this.ground(params),
      this.asphalt(network, params),
      this.markings(network),
      ...this.pictures(network, maxAnisotropy, params),
      this.solids(network, params),
    );
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
  }

  private ground(params: WorldParams): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(params.groundSize, params.groundSize);
    geometry.rotateX(-Math.PI / 2);
    const mesh = this.mesh(geometry, new THREE.MeshStandardMaterial({ color: COLOURS.grass, roughness: 1 }), 'grass');
    mesh.receiveShadow = true;
    return mesh;
  }

  private asphalt(network: RoadNetwork, params: WorldParams): THREE.Mesh {
    const builder = new MeshBuilder();
    const colour = rgb(COLOURS.asphalt);
    const half = params.laneWidth + params.shoulderWidth;
    for (const road of network.roads) {
      strip(builder, samplePath(road.centreline, 0, road.centreline.length, 2), -half, half, ROAD_Y, colour);
    }
    for (const junction of network.junctions) junctionSurface(builder, junction, half, params, colour);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const mesh = this.mesh(toGeometry(builder), material, 'asphalt');
    mesh.receiveShadow = true;
    return mesh;
  }

  private markings(network: RoadNetwork): THREE.Mesh {
    const builder = new MeshBuilder();
    const white = rgb(COLOURS.white);
    const yellow = rgb(COLOURS.yellow);
    for (const marking of network.markings) {
      const [a, b, c, d] = marking.corners.map((p): Vec3 => [p.x, MARKING_Y, p.z]) as [Vec3, Vec3, Vec3, Vec3];
      builder.quad([a, b, c, d], UP, marking.colour === 'yellow' ? yellow : white);
    }
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const mesh = this.mesh(toGeometry(builder), material, 'road markings');
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Sign faces and backs, and the symbols painted on the road: all pictures come from one texture. */
  private pictures(network: RoadNetwork, maxAnisotropy: number, params: WorldParams): THREE.Mesh[] {
    const texture = new THREE.CanvasTexture(drawSignAtlas());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    this.disposables.push(texture);

    const signs = new MeshBuilder();
    for (const sign of network.signs) signPlate(signs, sign, params);
    const signMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      // Signs are reflective; a little self-lighting keeps them readable when the sun is behind them.
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.25,
      roughness: 0.6,
      // The shape of each sign comes from the picture's transparent corners.
      alphaTest: 0.5,
    });
    const signMesh = this.mesh(toGeometry(signs), signMaterial, 'signs');
    signMesh.receiveShadow = true;

    // Painted symbols are seen at a shallow angle; blending (rather than cutting at a threshold)
    // lets them fade smoothly into the distance instead of breaking up into dots.
    const symbols = new MeshBuilder();
    for (const symbol of network.symbols) roadSymbol(symbols, symbol);
    const symbolMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    const symbolMesh = this.mesh(toGeometry(symbols), symbolMaterial, 'road symbols');
    symbolMesh.receiveShadow = true;
    return [signMesh, symbolMesh];
  }

  /** Sign posts and roundabout islands. */
  private solids(network: RoadNetwork, params: WorldParams): THREE.Mesh {
    const builder = new MeshBuilder();
    const post = rgb(COLOURS.post);
    for (const sign of network.signs) {
      const w = params.signs.postWidth;
      builder.box({ x: sign.x, z: sign.z, heading: sign.facing, width: w, depth: w, height: params.signs.height + 0.1 }, post);
    }
    for (const junction of network.junctions) {
      if (junction.kind !== 'roundabout') continue;
      const { x, z } = junction.centre;
      builder.cylinder(x, z, params.roundabout.islandRadius, 0, 0.18, 40, rgb(COLOURS.kerb), rgb(COLOURS.island));
    }
    const mesh = this.mesh(toGeometry(builder), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'posts and islands');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
    this.disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }
}

/** Hex colour to the linear values Three.js expects in vertex colours. */
export function rgb(hex: number): Rgb {
  const colour = new THREE.Color(hex);
  return [colour.r, colour.g, colour.b];
}

export function toGeometry(builder: MeshBuilder): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(builder.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(builder.colours, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uvs, 2));
  geometry.setIndex(builder.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A flat band along sampled points, between two sideways offsets (positive = left). */
export function strip(
  builder: MeshBuilder,
  points: readonly { x: number; z: number; heading: number }[],
  right: number,
  left: number,
  y: number,
  colour: Rgb,
): void {
  const at = (p: { x: number; z: number; heading: number }, offset: number): Vec3 => {
    const q = add(p, leftOf(p.heading), offset);
    return [q.x, y, q.z];
  };
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (!p || !q) continue;
    builder.quad([at(p, right), at(q, right), at(q, left), at(p, left)], UP, colour);
  }
}

function junctionSurface(builder: MeshBuilder, junction: Junction, roadHalf: number, params: WorldParams, colour: Rgb): void {
  const { x, z } = junction.centre;
  if (junction.kind !== 'roundabout') {
    // A rectangle reaching out to where the roads start; on a T the side without a road stops at the shoulder.
    const extent = DIRS.map((d) => (junction.arms.some((arm) => arm.dir === d) ? junction.size : roadHalf));
    const [plusZ, plusX, minusZ, minusX] = extent as [number, number, number, number];
    builder.flatPolygon(
      [
        [x - minusX, z - minusZ],
        [x + plusX, z - minusZ],
        [x + plusX, z + plusZ],
        [x - minusX, z + plusZ],
      ],
      ROAD_Y,
      colour,
    );
    return;
  }
  const circle: [number, number][] = [];
  const segments = 64;
  const radius = params.roundabout.outerRadius;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    circle.push([x + radius * Math.sin(a), z + radius * Math.cos(a)]);
  }
  builder.flatPolygon(circle, ROAD_Y, colour);
  // Each arm's road runs in to meet the circle.
  for (const arm of junction.arms) {
    const d = forward((arm.dir * Math.PI) / 2);
    const side = leftOf((arm.dir * Math.PI) / 2);
    const near = add(junction.centre, d, radius - 2);
    const far = add(junction.centre, d, junction.size);
    const corner = (p: Vec2, s: number): readonly [number, number] => {
      const q = add(p, side, s * roadHalf);
      return [q.x, q.z];
    };
    builder.flatPolygon([corner(near, -1), corner(far, -1), corner(far, 1), corner(near, 1)], ROAD_Y, colour);
  }
}

const SIGN_PICTURES: Record<Exclude<Sign['kind'], 'speedLimit'>, AtlasPicture> = {
  stop: 'stop',
  giveWay: 'giveWay',
  roundaboutGiveWay: 'roundaboutGiveWay',
};

function signPlate(builder: MeshBuilder, sign: Sign, params: WorldParams): void {
  const s = params.signs;
  const size =
    sign.kind === 'stop' ? s.stopSize : sign.kind === 'speedLimit' ? s.speedLimitSize : s.giveWaySize;
  const face: AtlasPicture = sign.kind === 'speedLimit' ? speedPicture(sign.speedLimit ?? 50) : SIGN_PICTURES[sign.kind];
  const back: AtlasPicture = sign.kind === 'stop' ? 'octagonBack' : sign.kind === 'speedLimit' ? 'discBack' : 'triangleBack';
  const half = (size * SIGN_QUAD_SCALE) / 2;
  const front = forward(sign.facing);
  // Seen from the front, the viewer's left is the sign's right.
  const viewerLeft = leftOf(sign.facing + Math.PI);
  const corners = (gap: number): [Vec3, Vec3, Vec3, Vec3] => {
    const centre = add(sign, front, s.postWidth / 2 + gap);
    const p = (side: number, up: number): Vec3 => {
      const q = add(centre, viewerLeft, side * half);
      return [q.x, s.height + up * half, q.z];
    };
    return [p(1, -1), p(-1, -1), p(-1, 1), p(1, 1)];
  };
  builder.quad(corners(0.02), [front.x, 0, front.z], [1, 1, 1], quadUv(face));
  builder.quad(corners(0.015), [-front.x, 0, -front.z], [1, 1, 1], quadUv(back));
}

function roadSymbol(builder: MeshBuilder, symbol: RoadSymbol): void {
  const along = forward(symbol.heading);
  const left = leftOf(symbol.heading);
  const halfLength = (symbol.length * SIGN_QUAD_SCALE) / 2;
  const halfWidth = (symbol.width * SIGN_QUAD_SCALE) / 2;
  // The top of the picture points away from the approaching driver.
  const p = (side: number, ahead: number): Vec3 => {
    const q = add(add(symbol, left, side * halfWidth), along, ahead * halfLength);
    return [q.x, SYMBOL_Y, q.z];
  };
  builder.quad([p(1, -1), p(-1, -1), p(-1, 1), p(1, 1)], UP, [1, 1, 1], quadUv(symbol.kind));
}

/** Corners bottom-left, bottom-right, top-right, top-left of a picture. */
function quadUv(picture: AtlasPicture): QuadUv {
  const { u0, v0, u1, v1 } = atlasUv(picture);
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
}
