// The one place where keys are assigned to actions.
// Values are physical key codes (KeyboardEvent.code), so they work the same with any
// keyboard layout, e.g. W is still W when the Russian layout is active.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values

export const KEYMAP = {
  throttle: ['KeyW'],
  brake: ['KeyS'],
  steerLeft: ['KeyA'],
  steerRight: ['KeyD'],
  toggleDebug: ['Backquote'],
} as const satisfies Record<string, readonly string[]>;

export type Action = keyof typeof KEYMAP;
