import type { VehicleControls, VehicleState } from '../vehicle/vehicle';

export interface DebugInfo {
  fps: number;
  seed: string | null;
  vehicle: VehicleState;
  controls: VehicleControls;
  drawCalls: number;
  triangles: number;
}

/** Developer panel in the top-left corner. Hidden by default, toggled with the debug key. */
export class DebugOverlay {
  private readonly element: HTMLPreElement;
  private visible = false;
  private sinceRefresh = Infinity;

  constructor(
    parent: HTMLElement,
    private readonly refreshIntervalSeconds: number,
  ) {
    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
    this.sinceRefresh = Infinity;
  }

  update(frameSeconds: number, info: DebugInfo): void {
    if (!this.visible) return;
    this.sinceRefresh += frameSeconds;
    if (this.sinceRefresh < this.refreshIntervalSeconds) return;
    this.sinceRefresh = 0;
    this.element.textContent = formatDebugInfo(info);
  }
}

export function formatDebugInfo(info: DebugInfo): string {
  const { vehicle: v, controls: c } = info;
  const headingDeg = (((v.heading * 180) / Math.PI) + 360) % 360;
  const pedals = c.brake > 0 ? 'brake' : c.throttle > 0 ? (c.direction > 0 ? 'gas fwd' : 'gas rev') : '-';
  return [
    `FPS      ${info.fps.toFixed(0)}`,
    `seed     ${info.seed ?? '-'}`,
    `speed    ${(v.speed * 3.6).toFixed(1)} km/h`,
    `pos      x ${v.x.toFixed(1)}  z ${v.z.toFixed(1)} m`,
    `heading  ${headingDeg.toFixed(0)} deg`,
    `steer    ${(v.steer * 100).toFixed(0)} %`,
    `pedals   ${pedals}`,
    `draws    ${info.drawCalls}  tris ${info.triangles}`,
  ].join('\n');
}
