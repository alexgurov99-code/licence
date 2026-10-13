import { describe, expect, it } from 'vitest';
import { createGlanceState } from '../camera/glance';
import { describeGlanceEvent, formatGlance } from './debugOverlay';

describe('glance lines in the debug panel', () => {
  it('shows the current glance and how long ago each check was done', () => {
    const glance = {
      ...createGlanceState(),
      target: 'rightMirror' as const,
      seconds: 0.62,
      counted: true,
      lastChecked: { ...createGlanceState().lastChecked, rightMirror: 10, leftShoulder: 7.5 },
    };
    expect(formatGlance(glance, 10)).toEqual([
      'glance   right mirror 0.6s (counted)',
      'checked  (seconds ago)',
      '  mirror   rear -  L -  R 0.0s',
      '  shoulder L 2.5s  R -  back -',
    ]);
  });

  it('lists counted checks and glances that were too short', () => {
    expect(describeGlanceEvent({ type: 'glanceCounted', target: 'leftShoulder' })).toBe('left shoulder check counted');
    expect(describeGlanceEvent({ type: 'glanceEnded', target: 'leftMirror', seconds: 0.2, counted: false })).toBe(
      'left mirror too short (0.2s)',
    );
    expect(describeGlanceEvent({ type: 'glanceEnded', target: 'leftMirror', seconds: 1, counted: true })).toBeNull();
    expect(describeGlanceEvent({ type: 'glanceStarted', target: 'back' })).toBeNull();
  });
});
