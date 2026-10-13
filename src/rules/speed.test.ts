import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSpeedState, stepSpeed, type SpeedState } from './speed';
import { setup } from './testing';
import type { FaultDraft, RulesSnapshot } from './types';

const P = CONFIG.rules.speed;
const DT = 0.1;
const { route } = setup('rules-0');

/** On a road in the middle of a manoeuvre (so slow driving is fine), at `kmh`. */
function snap(time: number, kmh: number, limit: number | null): RulesSnapshot {
  return {
    time,
    position: { x: 0, z: 0 },
    speed: kmh / 3.6,
    gear: 'D',
    handbrake: false,
    engineOn: true,
    beltFastened: true,
    indicator: null,
    lastChecked: { interiorMirror: null, leftMirror: null, rightMirror: null, back: null, leftShoulder: null, rightShoulder: null },
    route,
    progress: 0,
    routeOffset: 0,
    offRoute: false,
    next: 1,
    nextStarted: true,
    arrived: false,
    road: limit === null ? null : { place: 'lane', laneOffset: 0, speedLimit: limit },
    inJunction: limit === null,
  };
}

function run(steps: readonly [kmh: number, limit: number | null, seconds: number][]): FaultDraft[] {
  let state: SpeedState = createSpeedState();
  const faults: FaultDraft[] = [];
  let time = 0;
  for (const [kmh, limit, seconds] of steps) {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      time += DT;
      const result = stepSpeed(state, snap(time, kmh, limit), P);
      state = result.state;
      faults.push(...result.faults);
    }
  }
  return faults;
}

describe('speed limit', () => {
  it('is kept through a junction', () => {
    expect(run([[48, 50, 2], [57, null, 2]]).map((f) => f.severity)).toEqual(['critical']);
  });

  it('when it drops, applies after a moment (its sign stands a few metres along)', () => {
    expect(run([[57, 60, 2], [57, 50, P.limitDropGraceSeconds - 0.5]])).toEqual([]);
    expect(run([[57, 60, 2], [57, 50, P.limitDropGraceSeconds + 0.5]]).map((f) => f.severity)).toEqual(['critical']);
  });

  it('a speeding fault that gets worse is reported again in the same episode', () => {
    const faults = run([[53, 50, P.minorOverSeconds + 0.5], [57, 50, 1], [62, 50, 1]]);
    expect(faults.map((f) => f.severity)).toEqual(['minor', 'critical', 'immediateFail']);
    expect(new Set(faults.map((f) => f.episode)).size).toBe(1);
  });

  it('slow driving is fine during a manoeuvre', () => {
    expect(run([[10, 50, 30]])).toEqual([]);
  });
});
