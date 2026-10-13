import { indicatorLamps } from '../vehicle/indicators';
import { GEARS, type Gear } from '../vehicle/gearbox';
import type { CarState } from '../vehicle/car';

/** Everything the instrument cluster shows. */
export interface ClusterReadout {
  /** Whole km/h, always positive (also when reversing). */
  speedKmh: number;
  gear: Gear;
  leftArrow: boolean;
  rightArrow: boolean;
  handbrakeLamp: boolean;
  beltLamp: boolean;
  engineOffLamp: boolean;
}

export function clusterReadout(car: CarState): ClusterReadout {
  const { controls, motion } = car;
  const lamps = indicatorLamps(controls.indicators);
  return {
    speedKmh: Math.round(Math.abs(motion.speed) * 3.6),
    gear: controls.gear,
    leftArrow: lamps.left,
    rightArrow: lamps.right,
    handbrakeLamp: controls.handbrake,
    beltLamp: !controls.beltFastened,
    engineOffLamp: !controls.engineOn,
  };
}

function sameReadout(a: ClusterReadout, b: ClusterReadout): boolean {
  return (Object.keys(a) as (keyof ClusterReadout)[]).every((key) => a[key] === b[key]);
}

const WIDTH = 1024;
const HEIGHT = 384;
const GAUGE_MAX_KMH = 140;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const COLORS = {
  face: '#0b0e12',
  rim: '#2b323b',
  text: '#eef2f6',
  muted: '#4b545e',
  track: '#1d232a',
  speed: '#7cc4ff',
  green: '#3ad455',
  greenOff: '#15241a',
  red: '#ff3b30',
  redOff: '#2c1715',
  amber: '#ffb020',
  amberOff: '#2b2312',
};

/**
 * The dashboard instruments, drawn on a 2D canvas. The same canvas is used as a texture on the
 * dashboard in the cabin view and shown as an on-screen panel in the view from behind.
 */
export class InstrumentCluster {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private shown: ClusterReadout | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.className = 'instrument-cluster';
    this.ctx = this.canvas.getContext('2d');
  }

  /** Redraws only when something visible changed. Returns true if the picture changed. */
  update(readout: ClusterReadout): boolean {
    if (this.shown && sameReadout(this.shown, readout)) return false;
    this.shown = readout;
    if (this.ctx) draw(this.ctx, readout);
    return true;
  }
}

function draw(ctx: CanvasRenderingContext2D, r: ClusterReadout): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  roundedRect(ctx, 6, 6, WIDTH - 12, HEIGHT - 12, 48);
  ctx.fillStyle = COLORS.face;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.rim;
  ctx.stroke();

  drawArrow(ctx, 96, 92, -1, r.leftArrow);
  drawArrow(ctx, WIDTH - 96, 92, 1, r.rightArrow);
  drawSpeed(ctx, WIDTH / 2, 214, 140, r.speedKmh);
  drawHandbrakeLamp(ctx, 250, 150, r.handbrakeLamp);
  drawBeltLamp(ctx, 250, 268, r.beltLamp);
  drawGears(ctx, 790, 170, r.gear);
  drawEngineLamp(ctx, 790, 280, r.engineOffLamp);
}

function drawSpeed(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, kmh: number): void {
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const angleFor = (value: number): number => start + (Math.min(value, GAUGE_MAX_KMH) / GAUGE_MAX_KMH) * sweep;

  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = COLORS.track;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + sweep);
  ctx.stroke();

  if (kmh > 0) {
    ctx.strokeStyle = COLORS.speed;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, angleFor(kmh));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  ctx.fillStyle = COLORS.muted;
  ctx.strokeStyle = COLORS.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 22px ${FONT}`;
  for (let value = 0; value <= GAUGE_MAX_KMH; value += 10) {
    const angle = angleFor(value);
    const major = value % 20 === 0;
    const inner = radius + 14;
    const outer = radius + (major ? 28 : 21);
    ctx.lineWidth = major ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
    if (major) {
      const labelRadius = radius + 50;
      ctx.fillText(String(value), cx + Math.cos(angle) * labelRadius, cy + Math.sin(angle) * labelRadius);
    }
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = `700 112px ${FONT}`;
  ctx.fillText(String(kmh), cx, cy + 4);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText('km/h', cx, cy + 82);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, direction: 1 | -1, lit: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  ctx.beginPath();
  ctx.moveTo(46, 0);
  ctx.lineTo(6, -38);
  ctx.lineTo(6, -15);
  ctx.lineTo(-42, -15);
  ctx.lineTo(-42, 15);
  ctx.lineTo(6, 15);
  ctx.lineTo(6, 38);
  ctx.closePath();
  ctx.fillStyle = lit ? COLORS.green : COLORS.greenOff;
  ctx.fill();
  ctx.restore();
}

/** The standard parking-brake symbol: a "P" in a circle between two brackets. */
function drawHandbrakeLamp(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean): void {
  const color = lit ? COLORS.red : COLORS.redOff;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, 30, 0, Math.PI * 2);
  ctx.stroke();
  for (const side of [-1, 1]) {
    const mid = side < 0 ? Math.PI : 0;
    ctx.beginPath();
    ctx.arc(x, y, 44, mid - 0.7, mid + 0.7);
    ctx.stroke();
  }
  ctx.font = `800 36px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', x, y + 2);
}

/** Seat-belt reminder: a seated figure with a diagonal belt. */
function drawBeltLamp(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean): void {
  const color = lit ? COLORS.red : COLORS.redOff;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(x + 2, y - 34, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(x - 2, y - 14);
  ctx.lineTo(x - 8, y + 16);
  ctx.lineTo(x + 18, y + 18);
  ctx.lineTo(x + 20, y + 38);
  ctx.stroke();

  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.face;
  ctx.beginPath();
  ctx.moveTo(x + 10, y - 16);
  ctx.lineTo(x - 16, y + 10);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawGears(ctx: CanvasRenderingContext2D, cx: number, cy: number, current: Gear): void {
  const spacing = 58;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  GEARS.forEach((gear, index) => {
    const x = cx + (index - (GEARS.length - 1) / 2) * spacing;
    const active = gear === current;
    if (active) {
      roundedRect(ctx, x - 25, cy - 32, 50, 64, 10);
      ctx.lineWidth = 4;
      ctx.strokeStyle = COLORS.text;
      ctx.stroke();
    }
    ctx.fillStyle = active ? COLORS.text : COLORS.muted;
    ctx.font = `${active ? 800 : 600} 46px ${FONT}`;
    ctx.fillText(gear, x, cy + 2);
  });
}

function drawEngineLamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, lit: boolean): void {
  ctx.fillStyle = lit ? COLORS.amber : COLORS.amberOff;
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ENGINE OFF', cx, cy);
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
