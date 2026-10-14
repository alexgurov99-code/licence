import { CONFIG } from '../config';
import { keyLabel } from '../input/keymap';
import { mirrorError, type Cockpit } from '../vehicle/cockpit';
import { ADJUST_ITEMS, type AdjustItem, type CockpitReadiness } from '../vehicle/cockpitTypes';

// Panel at the bottom of the screen while adjusting the seat or a mirror (Tab): what is being
// adjusted, which arrows do what, and whether each part is right yet.

const NAMES: Record<AdjustItem, string> = { seat: 'Seat', interior: 'Rear-view mirror', left: 'Left mirror', right: 'Right mirror' };

export interface AdjustText {
  title: string;
  keys: string;
  /** Seat: which way it still has to go. Mirrors: none, the picture shows it. */
  hint: string;
  parts: { name: string; current: boolean; ready: boolean }[];
}

/** Which way the seat has to move, e.g. "move it forward and down", or "" when it is right. */
export function seatHint(cockpit: Cockpit, tolerance: number = CONFIG.cockpit.seatTolerance): string {
  const { forward, height } = cockpit.seat;
  const ways = [
    forward < -tolerance ? `forward ${keyLabel('lookRight')}` : forward > tolerance ? `back ${keyLabel('lookLeft')}` : '',
    height < -tolerance ? `up ${keyLabel('lookUp')}` : height > tolerance ? `down ${keyLabel('lookDown')}` : '',
  ].filter((way) => way !== '');
  return ways.length > 0 ? `Move it ${ways.join(' and ')}` : '';
}

export function adjustText(item: AdjustItem, cockpit: Cockpit, ready: CockpitReadiness): AdjustText {
  const k = keyLabel;
  const arrows = `${k('lookLeft')} ${k('lookRight')} ${k('lookUp')} ${k('lookDown')}`;
  const keys =
    item === 'seat'
      ? `${k('lookLeft')} ${k('lookRight')} back / forward · ${k('lookUp')} ${k('lookDown')} up / down`
      : `${arrows} aim the mirror at the road behind`;
  const done = ready[item] ? '✓ Adjusted' : '';
  const hint = item === 'seat' ? done || seatHint(cockpit) : done || 'Not yet';
  return {
    title: `Adjusting: ${NAMES[item]}`,
    keys: `${keys} · ${k('adjust')} next · ${k('adjustDone')} done`,
    hint,
    parts: ADJUST_ITEMS.map((part) => ({ name: NAMES[part], current: part === item, ready: ready[part] })),
  };
}

/** Angles in degrees, for the debug panel: "seat f +0.05 h -0.02 · rear-view 1.2/-0.3° ✓ ..." */
export function describeCockpit(cockpit: Cockpit, ready: CockpitReadiness): string {
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');
  const signed = (value: number, digits: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
  const deg = (rad: number): string => signed((rad * 180) / Math.PI, 1);
  const mirrors = (['interior', 'left', 'right'] as const).map((id) => {
    const error = mirrorError(cockpit, id);
    return `${id} ${deg(error.yaw)}/${deg(error.pitch)}° ${mark(ready[id])}`;
  });
  return `seat f ${signed(cockpit.seat.forward, 2)} h ${signed(cockpit.seat.height, 2)} ${mark(ready.seat)} · ${mirrors.join(' · ')}`;
}

export class AdjustPanel {
  private readonly element: HTMLDivElement;
  private shown = '';

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'adjust-panel';
    this.element.hidden = true;
    container.appendChild(this.element);
  }

  /** null hides the panel. */
  update(text: AdjustText | null): void {
    const key = JSON.stringify(text);
    if (key === this.shown) return;
    this.shown = key;
    this.element.replaceChildren();
    this.element.hidden = !text;
    if (!text) return;
    const line = (className: string, content: string): void => {
      const div = document.createElement('div');
      div.className = className;
      div.textContent = content;
      this.element.appendChild(div);
    };
    line('adjust-title', text.title);
    line(`adjust-hint${text.hint.startsWith('✓') ? ' ok' : ''}`, text.hint);
    line('adjust-keys', text.keys);
    const parts = document.createElement('div');
    parts.className = 'adjust-parts';
    for (const part of text.parts) {
      const span = document.createElement('span');
      span.className = `adjust-part${part.current ? ' current' : ''}${part.ready ? ' ready' : ''}`;
      span.textContent = `${part.ready ? '✓' : '·'} ${part.name}`;
      parts.appendChild(span);
    }
    this.element.appendChild(parts);
  }
}
