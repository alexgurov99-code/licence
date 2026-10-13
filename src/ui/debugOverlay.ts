import type { CarState } from '../vehicle/car';
import type { ControlEvent } from '../vehicle/carControls';

export interface DebugInfo {
  fps: number;
  seed: string | null;
  view: string;
  car: CarState;
  /** Newest last. */
  recentEvents: readonly string[];
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
  const { motion: v, controls: c } = info.car;
  const headingDeg = (((v.heading * 180) / Math.PI) + 360) % 360;
  const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
  const onOff = (value: boolean): string => (value ? 'on' : 'off');
  const indicator = c.indicators.lever ? `${c.indicators.lever}${c.indicators.armed ? ' (armed)' : ''}` : 'off';
  return [
    `FPS      ${info.fps.toFixed(0)}`,
    `seed     ${info.seed ?? '-'}`,
    `view     ${info.view}`,
    `speed    ${(v.speed * 3.6).toFixed(1)} km/h`,
    `pos      x ${v.x.toFixed(1)}  z ${v.z.toFixed(1)} m`,
    `heading  ${headingDeg.toFixed(0)} deg`,
    `steer    ${percent(v.steer)}`,
    `pedals   gas ${percent(c.throttle)}  brake ${percent(c.brake)}`,
    `gear     ${c.gear}   engine ${onOff(c.engineOn)}`,
    `handbr.  ${onOff(c.handbrake)}   belt ${c.beltFastened ? 'fastened' : 'off'}`,
    `indic.   ${indicator}   hazard ${onOff(c.indicators.hazard)}`,
    `draws    ${info.drawCalls}  tris ${info.triangles}`,
    'events',
    ...info.recentEvents.map((line) => `  ${line}`),
  ].join('\n');
}

/** One-line description of a control event for the debug panel. */
export function describeEvent(event: ControlEvent): string {
  switch (event.type) {
    case 'engineStarted':
      return 'engine started';
    case 'engineStopped':
      return 'engine stopped';
    case 'engineStartRefused':
      return `engine start refused (${event.reason})`;
    case 'engineStopRefused':
      return `engine stop refused (${event.reason})`;
    case 'beltFastened':
      return 'belt fastened';
    case 'beltUnfastened':
      return 'belt unfastened';
    case 'handbrakeApplied':
      return 'handbrake on';
    case 'handbrakeReleased':
      return 'handbrake off';
    case 'gearSelected':
      return `gear ${event.previous} -> ${event.gear}`;
    case 'gearRefused':
      return `gear ${event.gear} refused (${event.reason})`;
    case 'indicatorOn':
      return `indicator ${event.side} on`;
    case 'indicatorOff':
      return `indicator ${event.side} off (${event.auto ? 'auto-cancelled' : 'manual'})`;
    case 'hazardOn':
      return 'hazards on';
    case 'hazardOff':
      return 'hazards off';
  }
}
