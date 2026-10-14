import { CONFIG, type WorldParams } from '../config';
import type { ResultItem } from '../rules/results';
import type { Severity } from '../rules/types';
import { samplePath, type Vec2 } from '../world/path';
import type { Route } from '../route/route';
import { drawFlag, drawTown, mapMatrix, polyline, toScreen, type MapView, type TownMap } from './mapDrawing';

// The map on the results screen: the whole town north up, the route the examiner asked for, the
// way the car really went, and a numbered mark where each fault happened.

export const SEVERITY_COLOURS: Record<Severity, string> = {
  immediateFail: '#ff3b3b',
  critical: '#ff7a2f',
  minor: '#f0c040',
};

const ROUTE_COLOUR = 'rgba(61, 155, 255, 0.45)';
const TRAIL_COLOUR = '#ffffff';
const START_COLOUR = '#3ccf6b';
const BACKGROUND = '#1c2620';
const MARK_RADIUS = 10;

export interface ResultsMapData {
  town: TownMap;
  route: Route;
  trail: readonly Vec2[];
  start: Vec2;
  finish: Vec2;
  items: readonly ResultItem[];
}

/**
 * Screen positions for marks that may sit on top of each other (several faults at the same spot,
 * like the cockpit drill at the start): each mark that would cover an earlier one is moved round
 * it on a growing circle until it is clear. Same order in and out.
 */
export function spreadMarks(points: readonly { x: number; y: number }[], minDistance: number): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [];
  for (const p of points) {
    let spot = p;
    for (let k = 0; k < 64 && placed.some((q) => Math.hypot(q.x - spot.x, q.y - spot.y) < minDistance); k += 1) {
      const ring = 1 + Math.floor(k / 6);
      const angle = (k % 6) * (Math.PI / 3) + ring * 0.5;
      spot = { x: p.x + Math.cos(angle) * minDistance * ring, y: p.y + Math.sin(angle) * minDistance * ring };
    }
    placed.push(spot);
  }
  return placed;
}

export class ResultsMap {
  readonly canvas: HTMLCanvasElement;
  private data: ResultsMapData | null = null;
  private routePoints: Vec2[] = [];
  /** Where each mark was drawn, CSS pixels, by fault number. */
  private marks: { number: number; x: number; y: number }[] = [];
  private highlighted: number | null = null;

  constructor(private readonly world: WorldParams = CONFIG.world) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'results-map';
  }

  setData(data: ResultsMapData): void {
    this.data = data;
    this.routePoints = samplePath(data.route.path, 0, data.route.finishS, 2);
    this.highlighted = null;
  }

  highlight(number: number | null): void {
    if (number === this.highlighted) return;
    this.highlighted = number;
    this.draw();
  }

  /** The fault mark under a point of the canvas (CSS pixels), if any. */
  markAt(x: number, y: number): number | null {
    let best: number | null = null;
    let bestDistance = MARK_RADIUS + 3;
    for (const mark of this.marks) {
      const d = Math.hypot(mark.x - x, mark.y - y);
      if (d < bestDistance) {
        best = mark.number;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Draws at the canvas's size on the page; call after it is shown and on resize. */
  draw(): void {
    const data = this.data;
    const size = Math.round(Math.min(this.canvas.clientWidth, this.canvas.clientHeight));
    const ctx = this.canvas.getContext('2d');
    if (!data || !ctx || size <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(size * dpr)) this.canvas.width = this.canvas.height = Math.round(size * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const view: MapView = { cx: size / 2, cy: size / 2, centre: { x: 0, z: 0 }, scale: size / (data.town.network.size + 40), up: 0 };
    const metresPerPixel = 1 / view.scale;
    const [a, b, c, d, e, f] = mapMatrix(view);
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    drawTown(ctx, data.town, this.world);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ROUTE_COLOUR;
    ctx.lineWidth = 7 * metresPerPixel;
    ctx.beginPath();
    polyline(ctx, this.routePoints);
    ctx.stroke();
    ctx.strokeStyle = TRAIL_COLOUR;
    ctx.lineWidth = 2 * metresPerPixel;
    ctx.beginPath();
    polyline(ctx, data.trail);
    ctx.stroke();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const start = toScreen(view, data.start);
    ctx.fillStyle = START_COLOUR;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
    ctx.fill();
    drawFlag(ctx, toScreen(view, data.finish));

    const spots = spreadMarks(
      data.items.map((item) => toScreen(view, item.fault.at)),
      2 * MARK_RADIUS + 2,
    );
    this.marks = data.items.map((item, i) => ({ number: item.number, ...(spots[i] as { x: number; y: number }) }));
    // The highlighted mark goes last, on top of the others.
    const order = [...data.items.keys()].sort(
      (i, j) => Number(data.items[i]?.number === this.highlighted) - Number(data.items[j]?.number === this.highlighted),
    );
    for (const i of order) {
      const item = data.items[i] as ResultItem;
      const spot = spots[i] as { x: number; y: number };
      const where = toScreen(view, item.fault.at);
      const lit = item.number === this.highlighted;
      if (Math.hypot(spot.x - where.x, spot.y - where.y) > 1) {
        // Moved aside so it does not hide another mark: a thin line back to the real spot.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(where.x, where.y);
        ctx.lineTo(spot.x, spot.y);
        ctx.stroke();
      }
      ctx.fillStyle = SEVERITY_COLOURS[item.fault.severity];
      ctx.strokeStyle = lit ? '#ffffff' : '#11161a';
      ctx.lineWidth = lit ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, lit ? MARK_RADIUS + 3 : MARK_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#11161a';
      ctx.font = `bold ${lit ? 13 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(item.number), spot.x, spot.y + 0.5);
    }
  }
}
