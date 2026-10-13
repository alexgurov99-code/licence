import { KEYMAP, type Action } from './keymap';

type KeyListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** Tracks which actions are held down and which were just pressed (for toggles). */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<Action>();
  private readonly actionByCode = new Map<string, Action>();

  constructor(
    private readonly target: KeyListenerTarget,
    keymap: Record<Action, readonly string[]> = KEYMAP,
  ) {
    for (const [action, codes] of Object.entries(keymap) as [Action, readonly string[]][]) {
      for (const code of codes) this.actionByCode.set(code, action);
    }
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** True while any key bound to the action is held. */
  isDown(action: Action): boolean {
    for (const code of this.held) {
      if (this.actionByCode.get(code) === action) return true;
    }
    return false;
  }

  /** True once per key press; use for toggles. */
  takePressed(action: Action): boolean {
    return this.pressed.delete(action);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = this.actionByCode.get(event.code);
    // Leave browser shortcuts (Ctrl+R, Cmd+W, ...) alone.
    if (!action || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    this.held.add(event.code);
    if (!event.repeat) this.pressed.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  // Keys released while the window is not focused never send keyup; drop them so nothing sticks.
  private readonly onBlur = (): void => {
    this.held.clear();
    this.pressed.clear();
  };
}
