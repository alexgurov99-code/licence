import { CONFIG, type MinimapParams, type WorldParams } from '../config';
import type { Instruction } from '../route/instructions';
import type { Route } from '../route/route';
import type { RouteTracker } from '../route/tracker';
import { dirVector } from '../world/layout';
import type { RoadNetwork } from '../world/network';
import type { Scenery } from '../world/scenery';
import { add, forward, samplePath, type PathPoint, type Pose, type Vec2 } from '../world/path';

// The satnav in the corner: the town from above with the route, the car and the next manoeuvre
// ("In 120 m turn left"). The small map turns with the car, so "left" on the map is always the
// driver's left; the big map (M) shows the whole town with north up and the manoeuvres numbered.
// Drawn with the 2D canvas.

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

const COLOURS = {
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

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly hintText: HTMLSpanElement;
  private readonly icon: HTMLCanvasElement;
  private readonly canvas: HTMLCanvasElement;
  private large = false;
  private size = 0;
  private network: RoadNetwork | null = null;
  private roads: Vec2[][] = [];
  /** Outlines of the sections and shops, drawn as grey blocks under the roads. */
  private blocks: (readonly Vec2[])[] = [];
  private route: Route | null = null;
  private routePoints: PathPoint[] = [];
  private iconKey = '';
  private text = '';

  constructor(
    parent: HTMLElement,
    private readonly params: MinimapParams = CONFIG.minimap,
    private readonly world: WorldParams = CONFIG.world,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.hint = document.createElement('div');
    this.hint.className = 'minimap-hint';
    this.icon = document.createElement('canvas');
    this.hintText = document.createElement('span');
    this.hint.append(this.icon, this.hintText);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-map';
    this.root.append(this.hint, this.canvas);
    parent.appendChild(this.root);
  }

  get isLarge(): boolean {
    return this.large;
  }

  toggleLarge(): void {
    this.large = !this.large;
    this.root.classList.toggle('large', this.large);
  }

  setNetwork(network: RoadNetwork, scenery?: Scenery): void {
    this.network = network;
    this.blocks = (scenery?.items ?? []).filter((i) => i.kind === 'section' || i.kind === 'cornerShop').map((i) => i.footprint);
    this.roads = network.roads.map((road) => samplePath(road.centreline, 0, road.centreline.length, 3));
  }

  setRoute(route: Route): void {
    this.route = route;
    this.routePoints = samplePath(route.path, 0, route.path.length, 2);
  }

  update(car: Pose, tracker: RouteTracker, instruction: Instruction): void {
    this.updateHint(instruction);
    const screen = Math.min(window.innerWidth, window.innerHeight);
    const size = Math.round(this.large ? this.params.largeShare * screen : this.params.size);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size !== this.size) {
      this.size = size;
      this.root.style.width = `${size}px`;
      this.canvas.style.width = this.canvas.style.height = `${size}px`;
      this.canvas.width = this.canvas.height = Math.round(size * dpr);
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.network) return;

    const view: MapView = this.large
      ? { cx: size / 2, cy: size / 2, centre: { x: 0, z: 0 }, scale: size / (this.network.size + 40), up: 0 }
      : { cx: size / 2, cy: size * this.params.carPosition, centre: car, scale: size / this.params.metresAcross, up: car.heading };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = COLOURS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const [a, b, c, d, e, f] = mapMatrix(view);
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    this.drawRoads(ctx);
    this.drawRoute(ctx, tracker, 1 / view.scale);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMarks(ctx, view, tracker);
    drawCar(ctx, toScreen(view, car), car.heading - view.up, this.large ? 9 : 8);
  }

  private updateHint(instruction: Instruction): void {
    if (instruction.text !== this.text) {
      this.text = instruction.text;
      this.hintText.textContent = instruction.text;
    }
    const key = `${instruction.icon}/${instruction.turn}/${instruction.exit}`;
    if (key === this.iconKey) return;
    this.iconKey = key;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = 40;
    this.icon.width = this.icon.height = px * dpr;
    this.icon.style.width = this.icon.style.height = `${px}px`;
    const ctx = this.icon.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawInstructionIcon(ctx, instruction, px);
  }

  private drawRoads(ctx: CanvasRenderingContext2D): void {
    const network = this.network;
    if (!network) return;
    ctx.fillStyle = COLOURS.block;
    for (const block of this.blocks) {
      ctx.beginPath();
      polyline(ctx, block);
      ctx.closePath();
      ctx.fill();
    }
    const w = this.world;
    const width = 2 * (w.laneWidth + w.shoulderWidth);
    ctx.strokeStyle = COLOURS.road;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const points of this.roads) polyline(ctx, points);
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

  private drawRoute(ctx: CanvasRenderingContext2D, tracker: RouteTracker, metresPerPixel: number): void {
    const route = this.route;
    if (!route) return;
    const end = route.finishS;
    const points = this.routePoints.filter((p) => p.s <= end);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLOURS.routeDone;
    ctx.lineWidth = 5 * metresPerPixel;
    ctx.beginPath();
    polyline(ctx, points);
    ctx.stroke();
    if (tracker.arrived) return;
    const from = tracker.progress;
    const ahead = points.filter((p) => p.s > from);
    const here = this.routePoints.find((p) => p.s >= from) ?? points[0];
    ctx.strokeStyle = COLOURS.route;
    ctx.lineWidth = 6 * metresPerPixel;
    ctx.beginPath();
    polyline(ctx, here ? [here, ...ahead] : ahead);
    ctx.stroke();
  }

  private drawMarks(ctx: CanvasRenderingContext2D, view: MapView, tracker: RouteTracker): void {
    const route = this.route;
    if (!route) return;
    const upcoming = route.maneuvers.filter((m) => m.index >= tracker.next);
    if (this.large) {
      // Junctions still ahead, numbered in the order they come.
      let number = 0;
      for (const m of upcoming) {
        if (m.junctionId === null) continue;
        number += 1;
        const p = toScreen(view, m.point);
        ctx.fillStyle = COLOURS.number;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), p.x, p.y + 0.5);
      }
    } else {
      const next = upcoming.find((m) => m.junctionId !== null && m.kind !== 'pullOut');
      if (next && next.index === tracker.next) {
        const p = toScreen(view, next.point);
        ctx.strokeStyle = COLOURS.next;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    drawFlag(ctx, toScreen(view, route.finish));
  }
}

function polyline(ctx: CanvasRenderingContext2D, points: readonly Vec2[]): void {
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)));
}

/** An arrow at `p` pointing `angle` radians clockwise from straight up the screen. */
function drawCar(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, angle: number, size: number): void {
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

function drawFlag(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
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

/** The picture next to the satnav text: an arrow, a roundabout with its exit, the kerb, or a flag. */
export function drawInstructionIcon(ctx: CanvasRenderingContext2D, instruction: Instruction, px: number): void {
  ctx.clearRect(0, 0, px, px);
  ctx.fillStyle = instruction.icon === 'reroute' ? '#c0782a' : '#2f7fe0';
  roundedRect(ctx, 0, 0, px, px, 7);
  ctx.fill();
  const s = px / 40;
  ctx.save();
  ctx.scale(s, s);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const arrowHead = (x: number, y: number, angle: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-3, -6);
    ctx.lineTo(-3, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  switch (instruction.icon) {
    case 'left':
    case 'right': {
      const k = instruction.icon === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(20, 34);
      ctx.lineTo(20, 20);
      ctx.quadraticCurveTo(20, 13, 20 + k * 7, 13);
      ctx.lineTo(20 + k * 9, 13);
      ctx.stroke();
      arrowHead(20 + k * 11, 13, k === 1 ? 0 : Math.PI);
      break;
    }
    case 'bend': {
      // A wide sweep (a turn is a sharp corner).
      const k = instruction.turn === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(20 - k * 7, 35);
      ctx.lineTo(20 - k * 7, 26);
      ctx.bezierCurveTo(20 - k * 7, 14, 20 - k * 2, 11, 20 + k * 8, 11);
      ctx.stroke();
      arrowHead(20 + k * 10, 11, k === 1 ? 0 : Math.PI);
      break;
    }
    case 'straight':
      ctx.beginPath();
      ctx.moveTo(20, 34);
      ctx.lineTo(20, 13);
      ctx.stroke();
      arrowHead(20, 9, -Math.PI / 2);
      break;
    case 'roundabout': {
      // Clockwise from the bottom: the first exit is on the left (NZ drives on the left).
      const exitAngle = { left: Math.PI, straight: Math.PI * 1.5, right: Math.PI * 2, uTurn: Math.PI * 2.5 - 0.7 }[
        instruction.turn ?? 'straight'
      ];
      const r = 7;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(20, 20, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(20, 36);
      ctx.lineTo(20, 20 + r);
      ctx.arc(20, 20, r, Math.PI / 2, exitAngle);
      const out = { x: 20 + Math.cos(exitAngle) * r, y: 20 + Math.sin(exitAngle) * r };
      const tip = { x: 20 + Math.cos(exitAngle) * (r + 8), y: 20 + Math.sin(exitAngle) * (r + 8) };
      ctx.moveTo(out.x, out.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      arrowHead(20 + Math.cos(exitAngle) * (r + 10), 20 + Math.sin(exitAngle) * (r + 10), exitAngle);
      if (instruction.exit !== null) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(instruction.exit), 38, 39);
      }
      break;
    }
    case 'pullOut':
    case 'pullOver': {
      // The kerb on the left, and the way into or out of the parking place beside it.
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, 5);
      ctx.lineTo(8, 35);
      ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      if (instruction.icon === 'pullOut') {
        ctx.moveTo(15, 34);
        ctx.bezierCurveTo(15, 22, 26, 22, 26, 13);
        ctx.stroke();
        arrowHead(26, 9, -Math.PI / 2);
      } else {
        ctx.moveTo(28, 34);
        ctx.bezierCurveTo(28, 24, 16, 24, 16, 16);
        ctx.stroke();
        ctx.fillRect(11, 8, 10, 3);
      }
      break;
    }
    case 'finish':
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(11, 34);
      ctx.lineTo(11, 6);
      ctx.stroke();
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#fff' : '#1a1a1a';
          ctx.fillRect(12 + col * 4, 6 + row * 4, 4, 4);
        }
      }
      break;
    case 'reroute':
      ctx.beginPath();
      ctx.arc(20, 21, 10, -Math.PI * 0.35, Math.PI * 1.3);
      ctx.stroke();
      arrowHead(20 + Math.cos(-Math.PI * 0.35) * 10, 21 + Math.sin(-Math.PI * 0.35) * 10, Math.PI * 0.15 + Math.PI / 2);
      break;
  }
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Screen direction of travel for a heading on a map view (for tests and the car arrow). */
export function screenDirection(view: MapView, heading: number): { x: number; y: number } {
  const origin = toScreen(view, view.centre);
  const ahead = toScreen(view, add(view.centre, forward(heading), 1));
  return { x: ahead.x - origin.x, y: ahead.y - origin.y };
}
