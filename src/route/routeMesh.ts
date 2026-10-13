import * as THREE from 'three';
import { CONFIG, type WorldParams } from '../config';
import { MeshBuilder, type Rgb, type Vec3 } from '../world/meshBuilder';
import { add, forward, leftOf, pointAt, samplePath } from '../world/path';
import { rgb, strip, toGeometry } from '../world/worldMesh';
import type { Route, ZoneKind } from './route';

// The route in 3D: a chequered flag by the kerb where the car should stop (always visible), and
// for the debug view the zones painted on the road and the route line.

const ZONE_COLOURS: Record<ZoneKind, number> = {
  mirror: 0x3fa9ff,
  signal: 0xffb020,
  signalOff: 0xb05cff,
  stopLine: 0xff2d2d,
  giveWayLine: 0xffffff,
  stopBox: 0x30d158,
};
const ROUTE_LINE_COLOUR = 0xff4fd8;

/** Just above the road markings. */
const ZONE_Y = 0.06;
/** Lines are drawn as bars this long along the road. */
const LINE_BAR = 0.6;
/** How far the flag post stands beyond the outer edge of the shoulder. */
const FLAG_VERGE = 0.8;

export class RouteMesh {
  /** The finish flag; part of the scene in every view. */
  readonly root = new THREE.Group();
  /** Zones and the route line; shown only in the debug view. */
  readonly debug = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(route: Route, params: WorldParams = CONFIG.world) {
    this.root.name = 'route';
    this.debug.name = 'route debug';
    this.debug.visible = false;
    this.root.add(...this.flag(route, params));
    this.debug.add(this.zones(route, params), this.routeLine(route));
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
  }

  private zones(route: Route, params: WorldParams): THREE.Mesh {
    const builder = new MeshBuilder();
    const half = params.laneWidth / 2;
    for (const zone of route.zones) {
      const colour = rgb(ZONE_COLOURS[zone.kind]);
      const isLine = zone.to - zone.from < 1e-6;
      const from = isLine ? zone.from - LINE_BAR / 2 : zone.from;
      const to = isLine ? zone.to + LINE_BAR / 2 : zone.to;
      const points = samplePath(route.path, Math.max(0, from), to, 1);
      // The stopping place is on the shoulder; everything else covers the lane (lines a little wider).
      if (zone.kind === 'stopBox') strip(builder, points, half, half + params.shoulderWidth, ZONE_Y, colour);
      else if (isLine) strip(builder, points, -half - 0.3, half + 0.3, ZONE_Y + 0.005, colour);
      else strip(builder, points, -half + 0.25, half - 0.25, ZONE_Y, colour);
    }
    const geometry = toGeometry(builder);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'route zones';
    mesh.renderOrder = 9;
    return mesh;
  }

  private routeLine(route: Route): THREE.Line {
    const points = samplePath(route.path, 0, route.finishS, 1).map((p) => new THREE.Vector3(p.x, 0.45, p.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: ROUTE_LINE_COLOUR, depthTest: false, fog: false });
    this.disposables.push(geometry, material);
    const line = new THREE.Line(geometry, material);
    line.name = 'route line';
    line.renderOrder = 10;
    line.frustumCulled = false;
    return line;
  }

  /** A white post with a chequered flag facing the approaching driver, on the verge beside the stopping place. */
  private flag(route: Route, params: WorldParams): THREE.Object3D[] {
    const lane = pointAt(route.path, route.finishS);
    const foot = add(lane, leftOf(lane.heading), params.laneWidth / 2 + params.shoulderWidth + FLAG_VERGE);
    const postHeight = 2.4;
    const post = new MeshBuilder();
    post.box({ x: foot.x, z: foot.z, heading: lane.heading, width: 0.07, depth: 0.07, height: postHeight }, rgb(0xf2f2ec));
    const postGeometry = toGeometry(post);
    const postMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

    // The cloth hangs from the top of the post towards the road, facing along it.
    const cloth = new MeshBuilder();
    const towardsRoad = leftOf(lane.heading);
    const width = 0.9;
    const height = 0.6;
    const corner = (across: number, y: number): Vec3 => {
      const p = add(foot, towardsRoad, -across);
      return [p.x, y, p.z];
    };
    const top = postHeight;
    const bottom = postHeight - height;
    const facing = forward(lane.heading + Math.PI);
    const normal: Vec3 = [facing.x, 0, facing.z];
    const white: Rgb = [1, 1, 1];
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    cloth.quad([corner(0.04, bottom), corner(0.04 + width, bottom), corner(0.04 + width, top), corner(0.04, top)], normal, white, uv);
    // And the same from behind, so it can be seen in the mirrors after passing it.
    cloth.quad(
      [corner(0.04, bottom), corner(0.04 + width, bottom), corner(0.04 + width, top), corner(0.04, top)],
      [-normal[0], 0, -normal[2]],
      white,
      uv,
    );
    const texture = new THREE.CanvasTexture(chequers());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    const clothGeometry = toGeometry(cloth);
    const clothMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.2 });
    this.disposables.push(postGeometry, postMaterial, clothGeometry, clothMaterial, texture);

    const postMesh = new THREE.Mesh(postGeometry, postMaterial);
    postMesh.castShadow = true;
    postMesh.name = 'finish post';
    const clothMesh = new THREE.Mesh(clothGeometry, clothMaterial);
    clothMesh.castShadow = true;
    clothMesh.name = 'finish flag';
    return [postMesh, clothMesh];
  }
}

function chequers(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 6;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 6; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f4f4' : '#161616';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas;
}
