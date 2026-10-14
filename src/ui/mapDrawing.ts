import type { WorldParams } from '../config';
import { dirVector } from '../world/layout';
import type { RoadNetwork } from '../world/network';
import type { Scenery } from '../world/scenery';
import { add, samplePath, type Vec2 } from '../world/path';

// Drawing the town from above on a 2D canvas: shared by the satnav map and the results screen.

/** How world positions are laid out on a map canvas. */
export interface MapView {
  /** Pixel position (CSS pixels from the top-left corner) where `centre` is drawn. */
  cx: number;
  cy: number;
  centre: Vec2;
  /** Pixels per metre. */
  scale: number;
  /** This heading points up the screen. */
  up: number;
}

/**
 * The 2D canvas transform [a, b, c, d, e, f] that draws world (x, z) at its place on the map.
 * Seen from above with heading 0 (+Z) up, +X (the left of a car facing +Z) is on the left.
 */
export function mapMatrix(view: MapView): [number, number, number, number, number, number] {
  const cos = Math.cos(view.up) * view.scale;
  const sin = Math.sin(view.up) * view.scale;
  const a = -cos;
  const b = -sin;
  const c = sin;
  const d = -cos;
  return [a, b, c, d, view.cx - a * view.centre.x - c * view.centre.z, view.cy - b * view.centre.x - d * view.centre.z];
}

export function toScreen(view: MapView, p: Vec2): { x: number; y: number } {
  const [a, b, c, d, e, f] = mapMatrix(view);
  return { x: a * p.x + c * p.z + e, y: b * p.x + d * p.z + f };
}

export const COLOURS = {
  background: 'rgba(28, 38, 32, 0.88)',
  road: '#8b9097',
  block: 'rgba(150, 156, 150, 0.32)',
  island: 'rgba(28, 38, 32, 1)',
  routeDone: 'rgba(80, 160, 255, 0.35)',
  route: '#3d9bff',
  car: '#ffffff',
  carOutline: '#11161a',
  next: '#ffffff',
  number: '#3d9bff',
  flag: '#ffffff',
};

/** The roads and the blocks of houses, ready to draw. */
export interface TownMap {
  network: RoadNetwork;
  roads: Vec2[][];
  /** Outlines of the sections and shops, drawn as grey blocks under the roads. */
  blocks: (readonly Vec2[])[];
}

export function townMap(network: RoadNetwork, scenery?: Scenery): TownMap {
  return {
    network,
    roads: network.roads.map((road) => samplePath(road.centreline, 0, road.centreline.length, 3)),
    blocks: (scenery?.items ?? []).filter((i) => i.kind === 'section' || i.kind === 'cornerShop').map((i) => i.footprint),
  };
}

/** Draws the town in world units: set the canvas transform with mapMatrix first. */
export function drawTown(ctx: CanvasRenderingContext2D, town: TownMap, w: WorldParams): void {
  const { network } = town;
  ctx.fillStyle = COLOURS.block;
  for (const block of town.blocks) {
    ctx.beginPath();
    polyline(ctx, block);
    ctx.closePath();
    ctx.fill();
  }
  const width = 2 * (w.laneWidth + w.shoulderWidth);
  ctx.strokeStyle = COLOURS.road;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const points of town.roads) polyline(ctx, points);
  // Junctions: arms from the middle to where the roads begin; roundabouts get a ring round an island.
  for (const junction of network.junctions) {
    for (const arm of junction.arms) {
      ctx.moveTo(junction.centre.x, junction.centre.z);
      const end = add(junction.centre, dirVector(arm.dir), junction.size);
      ctx.lineTo(end.x, end.z);
    }
  }
  ctx.stroke();
  for (const junction of network.junctions.filter((j) => j.kind === 'roundabout')) {
    ctx.fillStyle = COLOURS.road;
    ctx.beginPath();
    ctx.arc(junction.centre.x, junction.centre.z, w.roundabout.outerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOURS.island;
    ctx.beginPath();
    ctx.arc(junction.centre.x, junction.centre.z, w.roundabout.islandRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function polyline(ctx: CanvasRenderingContext2D, points: readonly Vec2[]): void {
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)));
}

/** An arrow at `p` pointing `angle` radians clockwise from straight up the screen. */
export function drawCar(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, angle: number, size: number): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  // Heading turns left for positive angles, which is anticlockwise on the map.
  ctx.rotate(-angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.75, size * 0.8);
  ctx.lineTo(0, size * 0.4);
  ctx.lineTo(-size * 0.75, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = COLOURS.car;
  ctx.strokeStyle = COLOURS.carOutline;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

export function drawFlag(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = COLOURS.flag;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -18);
  ctx.stroke();
  const cell = 3.5;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(1 + col * cell, -18 + row * cell, cell, cell);
    }
  }
  ctx.restore();
}
