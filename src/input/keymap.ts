// The one place where keys are assigned to actions.
// Values are physical key codes (KeyboardEvent.code), so they work the same with any
// keyboard layout, e.g. W is still W when the Russian layout is active.
// The first code of each action is the one shown in on-screen hints.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values

export const KEYMAP = {
  throttle: ['KeyW'],
  brake: ['KeyS'],
  steerLeft: ['KeyA'],
  steerRight: ['KeyD'],
  indicatorLeft: ['KeyQ'],
  indicatorRight: ['KeyE'],
  hazard: ['KeyH'],
  handbrake: ['Space'],
  gearP: ['Digit1', 'Numpad1'],
  gearR: ['Digit2', 'Numpad2'],
  gearN: ['Digit3', 'Numpad3'],
  gearD: ['Digit4', 'Numpad4'],
  engine: ['Enter', 'NumpadEnter'],
  belt: ['KeyB'],
  /** Cockpit drill: adjust the seat, then each mirror in turn (the arrows adjust instead of looking). */
  adjust: ['Tab'],
  adjustDone: ['Escape'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  toggleView: ['KeyC'],
  /** The whole town on a big map, and back to the small one in the corner. */
  toggleMap: ['KeyM'],
  /** Learner mode (hints on what to do next) or exam mode. */
  toggleLearner: ['KeyL'],
  toggleDebug: ['Backquote'],
  /** Debug mode only: build a new town from a random seed. */
  newMap: ['KeyN'],
} as const satisfies Record<string, readonly string[]>;

export type Action = keyof typeof KEYMAP;

const SPECIAL_LABELS: Record<string, string> = {
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Human-readable name of the key bound to an action, for hints such as "Hold the brake (S)". */
export function keyLabel(action: Action): string {
  const code: string = KEYMAP[action][0];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return SPECIAL_LABELS[code] ?? code;
}
