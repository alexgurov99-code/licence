import { describe, expect, it } from 'vitest';
import { GLANCE_TARGETS } from '../camera/glance';
import { CONFIG } from '../config';
import { panelSpecs, popupRect, scaleRect, type Rect } from './glancePopups';

const params = CONFIG.ui.popups;
const specs = panelSpecs(params);

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('glance window layout', () => {
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [1024, 768],
    [2560, 1080],
  ] as const) {
    it(`fits on a ${width}×${height} screen`, () => {
      for (const target of GLANCE_TARGETS) {
        const spec = specs[target];
        const rect = popupRect(spec, width, height, params);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height);
        expect(rect.height).toBeLessThanOrEqual(params.maxHeight * height + 1e-9);
        expect(rect.width / rect.height).toBeCloseTo(spec.aspect, 6);
      }
      // The left and right windows never cover each other or the top one.
      const left = popupRect(specs.leftMirror, width, height, params);
      const right = popupRect(specs.rightMirror, width, height, params);
      const top = popupRect(specs.interiorMirror, width, height, params);
      expect(overlaps(left, right)).toBe(false);
      expect(overlaps(left, top)).toBe(false);
      expect(overlaps(right, top)).toBe(false);
    });
  }

  it('puts mirror windows on the side of their mirror', () => {
    const left = popupRect(specs.leftMirror, 1920, 1080, params);
    const right = popupRect(specs.rightMirror, 1920, 1080, params);
    expect(left.x + left.width).toBeLessThan(960);
    expect(right.x).toBeGreaterThan(960);
    const leftShoulder = popupRect(specs.leftShoulder, 1920, 1080, params);
    expect(leftShoulder.x).toBe(left.x);
  });

  it('a shrunk window stays attached to its screen edge', () => {
    const full = popupRect(specs.rightMirror, 1920, 1080, params);
    const small = scaleRect(full, 'right', 0.5);
    expect(small.x + small.width).toBeCloseTo(full.x + full.width, 6);
    expect(small.y + small.height / 2).toBeCloseTo(full.y + full.height / 2, 6);
    const top = popupRect(specs.interiorMirror, 1920, 1080, params);
    const smallTop = scaleRect(top, 'top', 0.5);
    expect(smallTop.y).toBe(top.y);
    expect(smallTop.x + smallTop.width / 2).toBeCloseTo(960, 6);
  });
});
