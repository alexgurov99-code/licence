import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { NO_TRAFFIC, type TrafficConflict, type TrafficView } from '../traffic/types';
import { COCKPIT_READY } from '../vehicle/cockpitTypes';
import { slowDrivingExpected } from './speed';
import { drive, faultList, setup } from './testing';
import { createTrafficRulesState, stepTrafficRules, type TrafficRulesState } from './traffic';
import type { FaultDraft, RulesSnapshot } from './types';

const P = CONFIG.rules.traffic;
const { route } = setup('rules-0');
const junction = route.maneuvers.find((m) => m.junctionId !== null);
if (!junction) throw new Error('No junction on the route');

function snap(time: number, kmh: number, traffic: Partial<TrafficView>, next = junction?.index ?? 1): RulesSnapshot {
  return {
    time,
    position: { x: 0, z: 0 },
    speed: kmh / 3.6,
    gear: 'D',
    handbrake: false,
    engineOn: true,
    beltFastened: true,
    cockpit: COCKPIT_READY,
    adjusting: false,
    indicator: null,
    lastChecked: { interiorMirror: null, leftMirror: null, rightMirror: null, back: null, leftShoulder: null, rightShoulder: null },
    route,
    progress: route.maneuvers[next]?.start ?? 0,
    routeOffset: 0,
    offRoute: false,
    next,
    nextStarted: true,
    arrived: false,
    road: { place: 'lane', laneOffset: 0, speedLimit: 50 },
    inJunction: false,
    traffic: { ...NO_TRAFFIC, ...traffic },
  };
}

const conflict = (learnerGivesWay: boolean): TrafficConflict => ({
  carId: 7,
  learnerGivesWay,
  learnerTo: -1,
  learnerClear: false,
  carTo: 4,
  carClear: false,
  carSpeed: 8,
  from: 'right',
});

function run(snaps: readonly RulesSnapshot[]): FaultDraft[] {
  let state: TrafficRulesState = createTrafficRulesState();
  const faults: FaultDraft[] = [];
  for (const s of snaps) {
    const result = stepTrafficRules(state, s, P);
    state = result.state;
    faults.push(...result.faults);
  }
  return faults;
}

describe('rules: other traffic', () => {
  it('failing to give way (the other car brakes hard) is an immediate failure, once per car', () => {
    const faults = run([1, 1.1, 1.2].map((t) => snap(t, 15, { conflicts: [conflict(true)], evasive: [7] })));
    expect(faults.map((f) => [f.kind, f.severity])).toEqual([['failedToGiveWay', 'immediateFail']]);
    expect(faults[0]?.what).toContain('from your right');
    expect(faults[0]?.maneuver).toBe(junction.index);
  });

  it('a car braking for the learner who has the right of way is not the learner\'s fault', () => {
    expect(run([snap(1, 15, { conflicts: [conflict(false)], evasive: [7] })])).toEqual([]);
    expect(run([snap(1, 40, { evasive: [7] })])).toEqual([]);
  });

  it('pulling out in front of a car that has to brake hard fails the test', () => {
    const faults = run([snap(1, 10, { evasive: [3] }, 0)]);
    expect(faults.map((f) => f.kind)).toEqual(['failedToGiveWay']);
    expect(faults[0]?.correct).toContain('Pulling out');
  });

  it('a collision is an immediate failure, recorded once', () => {
    const faults = run([snap(1, 20, { collision: 'car' }), snap(1.1, 0, { collision: 'car' })]);
    expect(faults.map((f) => [f.kind, f.severity])).toEqual([['collision', 'immediateFail']]);
  });

  it('following too closely: under 2 s for a while is minor, under 1 s critical', () => {
    const behind = (seconds: number, kmh: number): Partial<TrafficView> => ({ ahead: { carId: 1, gap: (seconds * kmh) / 3.6, speed: kmh / 3.6 } });
    const steps = (seconds: number, from: number, to: number): RulesSnapshot[] => {
      const list: RulesSnapshot[] = [];
      for (let t = from; t < to; t += 0.1) list.push(snap(t, 50, behind(seconds, 50)));
      return list;
    };
    expect(run(steps(1.5, 0, P.followMinorFor - 0.5))).toEqual([]);
    expect(run(steps(1.5, 0, P.followMinorFor + 0.5)).map((f) => f.severity)).toEqual(['minor']);
    expect(run(steps(0.7, 0, P.followCriticalFor + 0.5)).map((f) => f.severity)).toEqual(['critical']);
    // Two seconds or more is fine, and so is creeping along in a queue.
    expect(run(steps(2.2, 0, 20))).toEqual([]);
    const queue: RulesSnapshot[] = [];
    for (let t = 0; t < 20; t += 0.1) queue.push(snap(t, 10, { ahead: { carId: 1, gap: 3, speed: 3 } }));
    expect(run(queue)).toEqual([]);
  });

  it('driving slowly behind a car or while giving way is not "too slow"', () => {
    const open = snap(1, 20, {}, route.maneuvers.length - 1);
    // Far from any manoeuvre or bend (the distances that excuse slow driving there are switched off).
    const params = { ...CONFIG.rules.speed, slowBeforeManeuver: -1e6, slowAfterManeuver: -1e6, slowAroundBend: -1e6 };
    const away = { ...open, nextStarted: false };
    expect(slowDrivingExpected(away, params)).toBe(false);
    expect(slowDrivingExpected({ ...away, traffic: { ...NO_TRAFFIC, ahead: { carId: 1, gap: 12, speed: 5 } } }, params)).toBe(true);
    const waiting = { ...conflict(true), learnerTo: 2 };
    expect(slowDrivingExpected({ ...away, traffic: { ...NO_TRAFFIC, conflicts: [waiting] } }, params)).toBe(true);
  });
});

describe('driving with traffic', () => {
  it('the model driver waits for gaps and keeps its distance: no faults', () => {
    for (const seed of ['rules-0', 'rules-4', 'rules-8']) {
      const result = drive(seed, { traffic: { count: CONFIG.traffic.count } }, 900);
      expect(result.rules.finished).toBe(true);
      expect(faultList(result.faults)).toEqual([]);
    }
  });

  it('a driver who never gives way gets failed', () => {
    // Busy roads and a driver who drives as if they were empty.
    const kinds = ['rules-2', 'rules-4'].flatMap((seed) =>
      drive(seed, { traffic: { count: 20 }, givesWay: false }, 900)
        .faults.filter((f) => f.severity === 'immediateFail')
        .map((f) => f.kind),
    );
    expect(kinds).toContain('failedToGiveWay');
    expect(kinds).toContain('collision');
  });
});
