import { describe, expect, it } from 'vitest';
import { createGlanceState } from '../camera/glance';
import { planRoute } from '../route/planner';
import { buildRoute } from '../route/route';
import { createTracker } from '../route/tracker';
import { createRulesState } from '../rules/engine';
import type { Fault } from '../rules/types';
import { buildNetwork } from '../world/network';
import {
  describeFault,
  describeGlanceEvent,
  describeMap,
  describeRouteEvent,
  formatGlance,
  formatLocation,
  formatRoute,
  formatRules,
  formatTraffic,
  maneuverName,
} from './debugOverlay';
import { addCar, createTraffic, createTrafficWorld, LEARNER } from '../traffic/traffic';
import { NO_TRAFFIC } from '../traffic/types';

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
    const summary = describeMap(buildNetwork('debug-summary'), { items: [], sightTriangles: [], signCorridors: [] });
    expect(summary).toMatch(/^T \d+ \/ cross \d+ \/ roundabout \d+ \/ \d+ roads \/ 0 houses/);
  });
});

describe('route lines in the debug panel', () => {
  const network = buildNetwork('debug-route');
  const route = buildRoute(network, planRoute(network));
  const tracker = createTracker(route, network.start);

  it('shows the next manoeuvre, progress along the route and the zones the car is in', () => {
    const lines = formatRoute({ ...tracker, inside: route.zones.filter((z) => z.kind === 'signal').slice(0, 1).map((z) => z.id) });
    expect(lines[0]).toBe(`route    1/${route.maneuvers.length} pull out (parked)`);
    expect(lines[1]).toMatch(/^ {9}0 \/ \d+ m · \d\.\d m L of line · reroutes 0$/);
    expect(lines[2]).toBe('zones    signal right');
    expect(formatRoute({ ...tracker, offRoute: true })[0]).toContain('OFF ROUTE');
  });

  it('names manoeuvres and route events', () => {
    const roundabout = { ...route.maneuvers[0]!, kind: 'roundabout' as const, exit: 3, turn: 'right' as const };
    expect(maneuverName(roundabout)).toBe('roundabout exit 3 (right)');
    expect(maneuverName({ ...roundabout, kind: 'left', control: 'stop' })).toBe('left turn (Stop)');
    const line = route.zones.find((z) => z.kind === 'signalOff')!;
    expect(describeRouteEvent({ type: 'lineCrossed', zone: line })).toBe(`crossed indicator-off line (#${line.maneuver})`);
    expect(describeRouteEvent({ type: 'arrived' })).toBe('arrived');
  });
});

describe('rules lines in the debug panel', () => {
  const fault: Fault = {
    id: 0,
    kind: 'noSignal',
    severity: 'critical',
    time: 12.34,
    at: { x: 0, z: 0 },
    maneuver: 3,
    place: 'Left turn',
    what: 'No left indicator for the left turn.',
    correct: 'Indicate left.',
  };

  it('describes a fault in one line', () => {
    expect(describeFault(fault)).toBe('CRITICAL #3: No left indicator for the left turn.');
    expect(describeFault({ ...fault, severity: 'immediateFail', maneuver: null })).toBe(
      'IMMEDIATE FAIL: No left indicator for the left turn.',
    );
  });

  it('shows the result so far, the indicator and the latest faults', () => {
    const rules = { ...createRulesState(), faults: [fault, { ...fault, id: 1, severity: 'minor' as const }] };
    const lines = formatRules({ ...rules, signals: { ...rules.signals, side: 'left', since: 10 } }, 12, 2);
    expect(lines[0]).toBe('rules    PASS · fail 0 / critical 1 / minor 1');
    expect(lines[1]).toContain('indicator left on 2.0s');
    expect(lines.slice(2)).toEqual([
      '  12.3s CRITICAL #3: No left indicator for the left turn.',
      '  12.3s minor #3: No left indicator for the left turn.',
    ]);
  });
});

describe('traffic lines in the debug panel', () => {
  it('shows the cars, who gives way to whom and the cars whose way meets the learner\'s', () => {
    const network = buildNetwork('debug-traffic');
    const world = createTrafficWorld(network);
    let state = createTraffic(world, 'debug-traffic', network.start, 0);
    state = addCar(world, state, { laneId: 0, s: 20, next: world.exits[0]?.[0]?.id ?? 0 });
    const car = state.cars[0];
    if (!car) throw new Error('No car');
    state = { ...state, cars: [{ ...car, givingWayTo: [LEARNER] }] };
    const lines = formatTraffic(state, {
      ...NO_TRAFFIC,
      ahead: { carId: 0, gap: 23.4, speed: 10 },
      evasive: [0],
      conflicts: [{ carId: 0, learnerGivesWay: true, learnerTo: 5, learnerClear: false, carTo: 31, carClear: false, carSpeed: 9, from: 'right' }],
    });
    expect(lines).toEqual([
      'traffic  1 cars · #0 23 m ahead · BRAKING FOR YOU: #0',
      '         giving way: #0→you',
      '         #0 right you give way (car 31 m, you 5 m)',
    ]);
  });
});
