import { describe, expect, it } from 'vitest';
import { createGlanceState } from '../camera/glance';
import { buildNetwork } from '../world/network';
import { describeGlanceEvent, describeMap, formatGlance, formatLocation } from './debugOverlay';

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

describe('location line in the debug panel', () => {
  const road = {
    kind: 'road' as const,
    roadId: 7,
    roadClass: 'main' as const,
    laneId: 14,
    offset: 0.42,
    place: 'lane' as const,
    s: 30,
    speedLimit: 60,
  };

  it('shows road / lane / offset from the middle of the lane / speed limit', () => {
    expect(formatLocation(road)).toBe('road 7 main / lane 14 / 0.42 m left / 60 km/h');
    expect(formatLocation({ ...road, offset: -0.3 })).toBe('road 7 main / lane 14 / 0.30 m right / 60 km/h');
    expect(formatLocation({ ...road, offset: 0.001 })).toBe('road 7 main / lane 14 / centred / 60 km/h');
  });

  it('points out the shoulder and the wrong side of the road', () => {
    expect(formatLocation({ ...road, offset: 2.5, place: 'shoulder' })).toContain('(shoulder)');
    expect(formatLocation({ ...road, offset: -3.5, place: 'oncoming' })).toContain('(ONCOMING SIDE)');
  });

  it('names junctions and places off the road', () => {
    expect(formatLocation({ kind: 'junction', junctionId: 3, junctionKind: 'roundabout' })).toBe('junction 3 (roundabout)');
    expect(formatLocation({ kind: 'offRoad' })).toBe('off road');
  });

  it('sums up the town', () => {
    const summary = describeMap(buildNetwork('debug-summary'));
    expect(summary).toMatch(/^T \d+ \/ cross \d+ \/ roundabout \d+ \/ \d+ roads \/ \d+ houses/);
  });
});
