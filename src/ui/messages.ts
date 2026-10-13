import { CONFIG } from '../config';
import { GEAR_ACTIONS } from '../input/carInput';
import { keyLabel } from '../input/keymap';
import type { CarState } from '../vehicle/car';
import type { ControlEvent } from '../vehicle/carControls';

/** Explains why an action did not work, or null for events that need no message. */
export function eventMessage(event: ControlEvent): string | null {
  switch (event.type) {
    case 'engineStartRefused':
      return event.reason === 'notInPark'
        ? `Shift to P (${keyLabel(GEAR_ACTIONS.P)}) before starting the engine`
        : `Hold the brake (${keyLabel('brake')}) while starting the engine`;
    case 'engineStopRefused':
      return 'Stop the car before switching the engine off';
    case 'gearRefused':
      switch (event.reason) {
        case 'engineOff':
          return `Start the engine (${keyLabel('engine')}) before shifting out of P`;
        case 'brakeRequired':
          return `Hold the brake (${keyLabel('brake')}) to shift out of P`;
        case 'stopRequired':
          return `Stop the car before shifting to ${event.gear}`;
      }
      return null;
    default:
      return null;
  }
}

/** If the driver is pressing the accelerator but the car cannot move, says why. */
export function stuckHint(car: CarState): string | null {
  const { controls, motion } = car;
  if (controls.throttle < 0.5 || Math.abs(motion.speed) > 0.5) return null;
  if (!controls.engineOn) return `The engine is off: hold ${keyLabel('brake')} and press ${keyLabel('engine')}`;
  if (controls.gear === 'P' || controls.gear === 'N') {
    return `Shift to D (${keyLabel(GEAR_ACTIONS.D)}) to drive or R (${keyLabel(GEAR_ACTIONS.R)}) to reverse`;
  }
  if (controls.handbrake) return `Release the handbrake (${keyLabel('handbrake')})`;
  return null;
}

/** Short message at the top of the screen that fades after a few seconds. */
export class MessageBanner {
  private readonly element: HTMLDivElement;
  private remaining = 0;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'message-banner';
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  show(text: string, seconds: number = CONFIG.ui.messageSeconds): void {
    if (this.element.textContent !== text) this.element.textContent = text;
    this.element.hidden = false;
    this.remaining = seconds;
  }

  update(frameSeconds: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= frameSeconds;
    if (this.remaining <= 0) this.element.hidden = true;
  }
}
