import { describe, expect, it } from 'vitest';
import { Keyboard } from './keyboard';

function key(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat });
}

function setup(): { target: EventTarget; keyboard: Keyboard } {
  const target = new EventTarget();
  const keyboard = new Keyboard(target as unknown as Window);
  return { target, keyboard };
}

describe('Keyboard', () => {
  it('reports an action as held between keydown and keyup', () => {
    const { target, keyboard } = setup();
    expect(keyboard.isDown('throttle')).toBe(false);
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(keyboard.isDown('throttle')).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(keyboard.isDown('throttle')).toBe(false);
  });

  it('reports a press once, ignoring auto-repeat', () => {
    const { target, keyboard } = setup();
    target.dispatchEvent(key('keydown', 'Backquote'));
    target.dispatchEvent(key('keydown', 'Backquote', true));
    expect(keyboard.takePressed('toggleDebug')).toBe(true);
    expect(keyboard.takePressed('toggleDebug')).toBe(false);
  });

  it('releases everything when the window loses focus', () => {
    const { target, keyboard } = setup();
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(new Event('blur'));
    expect(keyboard.isDown('steerLeft')).toBe(false);
  });

  it('stops default browser handling only for mapped keys', () => {
    const { target } = setup();
    const mapped = key('keydown', 'KeyW');
    const unmapped = key('keydown', 'KeyZ');
    target.dispatchEvent(mapped);
    target.dispatchEvent(unmapped);
    expect(mapped.defaultPrevented).toBe(true);
    expect(unmapped.defaultPrevented).toBe(false);
  });

  it('stops listening after dispose', () => {
    const { target, keyboard } = setup();
    keyboard.dispose();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(keyboard.isDown('throttle')).toBe(false);
  });
});
