import { describe, expect, it } from 'vitest';
import { FpsCounter } from './fpsCounter';

describe('FpsCounter', () => {
  it('reports 0 until the first window is complete', () => {
    const counter = new FpsCounter(0.5);
    counter.tick(1 / 60);
    expect(counter.fps).toBe(0);
  });

  it('averages frames over the window', () => {
    // Powers of two keep the float sums exact.
    const counter = new FpsCounter(0.5);
    for (let i = 0; i < 32; i++) counter.tick(1 / 64);
    expect(counter.fps).toBe(64);
    for (let i = 0; i < 16; i++) counter.tick(1 / 32);
    expect(counter.fps).toBe(32);
  });
});
