// Pictures of the NZ signs and the symbols painted on the road, drawn once into a single canvas
// (an "atlas") so every sign in the town can share one texture and one draw call.
//
// Looks (NZTA, Traffic Control Devices Manual / MOTSAM, and the Road Code):
//   Stop (RG-5): red octagon, white border, white STOP.
//   Give Way (RG-6): triangle pointing down, white with a red border, GIVE WAY in red.
//   Roundabout Give Way (RG-6R): the same triangle with a black roundabout symbol.
//   Speed limit (R1-1): white disc, red ring, black number.
//   On the road: the word STOP before a Stop, a triangle before a Give Way (both white).

/** Pixels per cell. Signs take one cell, road symbols two cells stacked (they are long and narrow). */
const CELL = 256;
const COLUMNS = 8;
const ROWS = 4;
/** Empty border inside each cell, so neighbouring pictures never bleed into each other. */
const PADDING = 6;

const RED = '#c8102e';
const WHITE = '#ffffff';
const BLACK = '#111111';
const BACK = '#aeb3b8';
const FONT = 'Arial, Helvetica, sans-serif';

/** Speed limits that have a sign picture. */
export const SPEED_LIMIT_SIGNS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110] as const;

export type SignPicture = 'stop' | 'giveWay' | 'roundaboutGiveWay' | 'octagonBack' | 'triangleBack' | 'discBack';
export type RoadPicture = 'stopText' | 'giveWayTriangle';
export type AtlasPicture = SignPicture | RoadPicture | `speed${number}`;

/** Texture coordinates of a picture: u from left to right, v from bottom to top. */
export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface Cell {
  col: number;
  row: number;
  /** Cells tall. */
  height: number;
}

const LAYOUT: Record<string, Cell> = {
  stop: { col: 0, row: 0, height: 1 },
  octagonBack: { col: 1, row: 0, height: 1 },
  giveWay: { col: 2, row: 0, height: 1 },
  roundaboutGiveWay: { col: 3, row: 0, height: 1 },
  triangleBack: { col: 4, row: 0, height: 1 },
  discBack: { col: 5, row: 0, height: 1 },
  stopText: { col: 6, row: 0, height: 2 },
  giveWayTriangle: { col: 7, row: 0, height: 2 },
};
SPEED_LIMIT_SIGNS.forEach((limit, i) => {
  LAYOUT[`speed${limit}`] = { col: i % COLUMNS, row: 2 + Math.floor(i / COLUMNS), height: 1 };
});

/**
 * Sign pictures fill their cell minus the padding; a quad drawn with the whole cell must be this
 * much bigger than the sign so the sign itself comes out at the right size.
 */
export const SIGN_QUAD_SCALE = CELL / (CELL - 2 * PADDING);

export function speedPicture(limit: number): AtlasPicture {
  const nearest = SPEED_LIMIT_SIGNS.reduce((best, value) => (Math.abs(value - limit) < Math.abs(best - limit) ? value : best));
  return `speed${nearest}`;
}

export function atlasUv(picture: AtlasPicture): UvRect {
  const cell = LAYOUT[picture];
  if (!cell) throw new Error(`No picture "${picture}"`);
  const width = COLUMNS * CELL;
  const height = ROWS * CELL;
  const top = cell.row * CELL;
  return {
    u0: (cell.col * CELL) / width,
    u1: ((cell.col + 1) * CELL) / width,
    // Canvas rows go down, texture v goes up.
    v1: 1 - top / height,
    v0: 1 - (top + cell.height * CELL) / height,
  };
}

/** Draws every picture into one canvas. */
export function drawSignAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const inCell = (picture: string, draw: (size: number) => void): void => {
    const cell = LAYOUT[picture];
    if (!cell) return;
    ctx.save();
    ctx.translate(cell.col * CELL + PADDING, cell.row * CELL + PADDING);
    draw(CELL - 2 * PADDING);
    ctx.restore();
  };

  inCell('stop', (s) => drawStop(ctx, s));
  inCell('octagonBack', (s) => fillShape(ctx, octagon(s), BACK));
  inCell('giveWay', (s) => drawGiveWay(ctx, s));
  inCell('roundaboutGiveWay', (s) => drawRoundaboutGiveWay(ctx, s));
  inCell('triangleBack', (s) => fillShape(ctx, triangleDown(s), BACK));
  inCell('discBack', (s) => fillShape(ctx, disc(s), BACK));
  for (const limit of SPEED_LIMIT_SIGNS) inCell(`speed${limit}`, (s) => drawSpeedLimit(ctx, s, limit));
  inCell('stopText', (s) => drawRoadStop(ctx, s, s * 2 + 2 * PADDING));
  inCell('giveWayTriangle', (s) => drawRoadTriangle(ctx, s, s * 2 + 2 * PADDING));
  return canvas;
}

type Shape = (ctx: CanvasRenderingContext2D) => void;

function octagon(size: number, inset = 0): Shape {
  return (ctx) => {
    const r = (size / 2 - inset) / Math.cos(Math.PI / 8);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      ctx.lineTo(size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a));
    }
    ctx.closePath();
  };
}

/** Equilateral triangle pointing down, as wide as the cell, centred in it. */
function triangleDown(size: number, inset = 0): Shape {
  return (ctx) => {
    const h = (size * Math.sqrt(3)) / 2;
    const top = (size - h) / 2;
    // Moving each side inwards by `inset` shrinks the triangle about its centre by 3 * inset in height.
    const scale = (h - 3 * inset) / h;
    const cx = size / 2;
    const cy = top + h / 3;
    const p = (x: number, y: number): [number, number] => [cx + (x - cx) * scale, cy + (y - cy) * scale];
    ctx.beginPath();
    ctx.moveTo(...p(0, top));
    ctx.lineTo(...p(size, top));
    ctx.lineTo(...p(size / 2, top + h));
    ctx.closePath();
  };
}

function disc(size: number, inset = 0): Shape {
  return (ctx) => {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - inset, 0, Math.PI * 2);
  };
}

function fillShape(ctx: CanvasRenderingContext2D, shape: Shape, colour: string): void {
  shape(ctx);
  ctx.fillStyle = colour;
  ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, height: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.font = `bold ${Math.round(height)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

function drawStop(ctx: CanvasRenderingContext2D, s: number): void {
  fillShape(ctx, octagon(s), WHITE);
  fillShape(ctx, octagon(s, s * 0.04), RED);
  ctx.save();
  // NZ STOP letters are tall and narrow.
  ctx.translate(s / 2, s / 2 + s * 0.02);
  ctx.scale(0.82, 1);
  text(ctx, 'STOP', 0, 0, s * 0.3, WHITE);
  ctx.restore();
}

function drawTriangleSign(ctx: CanvasRenderingContext2D, s: number): void {
  fillShape(ctx, triangleDown(s), RED);
  fillShape(ctx, triangleDown(s, s * 0.09), WHITE);
}

function drawGiveWay(ctx: CanvasRenderingContext2D, s: number): void {
  drawTriangleSign(ctx, s);
  const top = (s - (s * Math.sqrt(3)) / 2) / 2;
  text(ctx, 'GIVE', s / 2, top + s * 0.23, s * 0.12, RED);
  text(ctx, 'WAY', s / 2, top + s * 0.37, s * 0.12, RED);
}

/** Three arrows chasing each other clockwise round a circle. */
function drawRoundaboutGiveWay(ctx: CanvasRenderingContext2D, s: number): void {
  drawTriangleSign(ctx, s);
  const h = (s * Math.sqrt(3)) / 2;
  const cx = s / 2;
  const cy = (s - h) / 2 + h * 0.36;
  const r = s * 0.12;
  ctx.strokeStyle = BLACK;
  ctx.fillStyle = BLACK;
  ctx.lineWidth = s * 0.035;
  for (let i = 0; i < 3; i++) {
    // Canvas angles grow clockwise on screen, which is clockwise seen from above.
    const start = (i * Math.PI * 2) / 3 - Math.PI / 2 + 0.25;
    const end = start + (Math.PI * 2) / 3 - 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end, false);
    ctx.stroke();
    // Arrow head pointing along the clockwise direction at the end of the arc.
    const tipX = cx + r * Math.cos(end);
    const tipY = cy + r * Math.sin(end);
    const along = end + Math.PI / 2;
    const head = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(tipX + Math.cos(along) * head, tipY + Math.sin(along) * head);
    ctx.lineTo(tipX + Math.cos(end) * head * 0.8, tipY + Math.sin(end) * head * 0.8);
    ctx.lineTo(tipX - Math.cos(end) * head * 0.8, tipY - Math.sin(end) * head * 0.8);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSpeedLimit(ctx: CanvasRenderingContext2D, s: number, limit: number): void {
  fillShape(ctx, disc(s), RED);
  fillShape(ctx, disc(s, s * 0.1), WHITE);
  ctx.save();
  ctx.translate(s / 2, s / 2 + s * 0.02);
  ctx.scale(limit >= 100 ? 0.72 : 0.9, 1);
  text(ctx, String(limit), 0, 0, s * 0.42, BLACK);
  ctx.restore();
}

/**
 * The word STOP painted on the lane: stretched lengthways, because drivers see it at a shallow
 * angle. The top of the picture points away from the driver.
 */
function drawRoadStop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(1, 2.6);
  text(ctx, 'STOP', 0, 0, width * 0.36, WHITE);
  ctx.restore();
}

/** Outline triangle painted before a Give Way: its point faces the approaching driver. */
function drawRoadTriangle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const stroke = width * 0.13;
  ctx.beginPath();
  ctx.moveTo(stroke / 2, stroke / 2);
  ctx.lineTo(width - stroke / 2, stroke / 2);
  ctx.lineTo(width / 2, height - stroke);
  ctx.closePath();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = stroke;
  ctx.lineJoin = 'round';
  ctx.stroke();
}
