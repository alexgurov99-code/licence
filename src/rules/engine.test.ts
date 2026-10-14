import { describe, expect, it } from 'vitest';
import { NO_TRAFFIC } from '../traffic/types';
import { COCKPIT_READY } from '../vehicle/cockpitTypes';
import type { Maneuver, Route, Side, Zone } from '../route/route';
import { stepRules } from './engine';
import { drive, faultList, findSeed, JUNCTION_SLOW_FROM, setup, type DriveContext } from './testing';
import { summarizeFaults, type Fault, type RulesSnapshot } from './types';

const kmh = (value: number): number => value / 3.6;
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');
const turnAt = (kind: 'left' | 'right'): ((m: Maneuver) => boolean) => (m) => m.kind === kind;
/** A manoeuvre after a long straight stretch of road (to speed or dawdle on). */
const afterLongRoad = (m: Maneuver, route: Route): boolean => {
  const previous = route.maneuvers[m.index - 1];
  if (!previous || m.kind === 'pullOver' || m.start - previous.end < 240) return false;
  // Straight: no bend of the road on it.
  return !route.bends.some((b) => b.to > previous.end && b.from < m.start);
};
/** On the stretch of road before manoeuvre `m`, from `from` metres after the previous one, for `length` metres. */
const onStretch = (route: Route, m: Maneuver, ctx: DriveContext, from: number, length: number): boolean => {
  const start = (route.maneuvers[m.index - 1] as Maneuver).end + from;
  return ctx.s >= start && ctx.s < start + length;
};

describe('the model driver', () => {
  for (const seed of ['rules-0', 'rules-1', 'rules-2', 'rules-3', 'rules-4', 'rules-5', 'rules-6', 'rules-7']) {
    it(`drives the whole route without a fault (${seed})`, () => {
      const result = drive(seed);
      expect(result.tracker.arrived).toBe(true);
      expect(result.tracker.reroutes).toBe(0);
      expect(result.rules.finished).toBe(true);
      expect(faultList(result.faults)).toEqual([]);
    });
  }
});

describe('indicators', () => {
  for (const kind of ['left', 'right'] as const) {
    it(`no indicator for a ${kind} turn is a critical error`, () => {
      const { seed, m } = findSeed(turnAt(kind));
      const { faults } = drive(seed, { indicator: (ideal, ctx) => (ctx.m.index === m.index ? null : ideal) });
      expect(faultList(faults)).toEqual([`noSignal@${m.index}`]);
      expect(faults[0]?.severity).toBe('critical');
      expect(faults[0]?.correct).toContain(`Indicate ${kind}`);
    });
  }

  it('the wrong indicator is a critical error', () => {
    const { seed, m } = findSeed(turnAt('left'));
    const { faults } = drive(seed, {
      indicator: (ideal, ctx) => (ctx.m.index === m.index && ideal ? other(ideal) : ideal),
    });
    expect(faultList(faults)).toEqual([`wrongSignal@${m.index}`]);
    expect(faults[0]?.severity).toBe('critical');
  });

  it('signalling less than 3 seconds before turning is late (minor)', () => {
    const { seed, m } = findSeed(turnAt('right'));
    // About one second before the turn at junction speed.
    const { faults } = drive(seed, {
      indicator: (ideal, ctx) => (ctx.m.index === m.index && ctx.s < m.start - 4 ? null : ideal),
    });
    expect(faultList(faults)).toEqual([`lateSignal@${m.index}`]);
    expect(faults[0]?.severity).toBe('minor');
  });

  it('signalling for the next turn while still going through a junction is too early', () => {
    const { seed, m } = findSeed((c, route) => c.kind === 'straight' && !!route.maneuvers[c.index + 1]?.signal);
    const next = m.index + 1;
    const { faults } = drive(seed, {
      indicator: (ideal, ctx) => {
        const nextSignal = ctx.route.maneuvers[next]?.signal ?? null;
        return ctx.m.index === m.index && ctx.s > m.start + 3 ? nextSignal : ideal;
      },
    });
    expect(faultList(faults)).toEqual([`earlySignal@${next}`]);
  });

  it('leaving the indicator on after the turn is minor', () => {
    const { seed, m } = findSeed((c, route) => {
      const off = route.zones.find((z) => z.kind === 'signalOff' && z.maneuver === c.index);
      const nextSignal = route.zones.find((z) => z.kind === 'signal' && z.maneuver === c.index + 1);
      return (c.kind === 'left' || c.kind === 'right') && !!off && off.from > c.end + 10 && (!nextSignal || nextSignal.from > off.from + 20);
    });
    const { faults } = drive(seed, {
      indicator: (ideal, ctx) => (ctx.s >= m.end && ctx.s < m.end + 30 ? m.signal : ideal),
    });
    expect(faultList(faults)).toEqual([`signalNotCancelled@${m.index}`]);
  });

  it('no indicator to leave a roundabout is a critical error', () => {
    const { seed, m } = findSeed((c) => c.kind === 'roundabout' && c.turn !== 'left');
    const { faults } = drive(seed, {
      indicator: (ideal, ctx) => (ctx.m.index === m.index && ctx.s > m.start ? null : ideal),
    });
    expect(faultList(faults)).toEqual([`noSignal@${m.index}`]);
    expect(faults[0]?.what).toContain('leaving the roundabout');
  });

  it('a left signal on the approach when going straight through a roundabout is misleading', () => {
    const { seed, m } = findSeed((c) => c.kind === 'roundabout' && c.turn === 'straight');
    const { faults } = drive(seed, {
      indicator: (ideal, ctx) => (ctx.m.index === m.index && ctx.s < m.start && ctx.s > m.start - 20 ? 'left' : ideal),
    });
    expect(faultList(faults)).toEqual([`unneededSignal@${m.index}`]);
  });
});

describe('mirrors and the shoulder check', () => {
  it('no mirror check before signalling is minor, for every signal', () => {
    const { route, faults } = drive('rules-1', { mirrors: false });
    expect(faults.length).toBeGreaterThanOrEqual(3);
    expect(new Set(faults.map((f) => f.kind))).toEqual(new Set(['noMirrorCheck']));
    expect(faults.every((f) => f.severity === 'minor')).toBe(true);
    expect(faults[0]?.maneuver).toBe(0);
    for (const f of faults) expect(route.maneuvers[f.maneuver ?? -1]?.signal).not.toBeNull();
  });

  it('a mirror check still in the previous junction counts, if the signal follows soon', () => {
    const { seed, m } = findSeed((c, route) => {
      const previous = route.maneuvers[c.index - 1];
      const zone = route.zones.find((z) => z.kind === 'signal' && z.maneuver === c.index);
      return !!c.signal && !!previous && previous.junctionId !== null && !!zone && zone.from - previous.end < 25;
    });
    const previous = setup(seed).route.maneuvers[m.index - 1] as Maneuver;
    const { faults } = drive(seed, {
      mirrors: false,
      glance: (ctx) => (ctx.s > previous.end - 6 && ctx.s < previous.end - 3 ? 'interiorMirror' : null),
    });
    expect(faultList(faults)).not.toContain(`noMirrorCheck@${m.index}`);
    expect(faultList(drive(seed, { mirrors: false }).faults)).toContain(`noMirrorCheck@${m.index}`);
  });

  it('the mirror on the other side does not count', () => {
    const { seed, m } = findSeed((c) => c.kind === 'right');
    const zone = setup(seed).route.zones.find((z) => z.kind === 'signal' && z.maneuver === m.index) as Zone;
    const { faults } = drive(seed, {
      mirrors: false,
      glance: (ctx) => (ctx.s > zone.from - 8 && ctx.s < zone.from - 1 ? 'leftMirror' : null),
    });
    expect(faultList(faults)).toContain(`noMirrorCheck@${m.index}`);
  });

  it('pulling out without the look over the right shoulder is minor', () => {
    const { faults } = drive('rules-1', { shoulder: false });
    expect(faultList(faults)).toEqual(['noShoulderCheck@0']);
  });

  it('pulling out with no look at all is a critical error', () => {
    const { faults } = drive('rules-1', { shoulder: false, mirrors: false });
    expect(faultList(faults)[0]).toBe('noObservation@0');
    expect(faults[0]?.severity).toBe('critical');
    expect(faultList(faults)).not.toContain('noMirrorCheck@0');
  });
});

describe('Stop and Give Way', () => {
  const stop = (): ReturnType<typeof findSeed> => findSeed((c) => c.control === 'stop');

  it('not stopping at a Stop sign is an immediate failure', () => {
    const { seed, m } = stop();
    const { faults } = drive(seed, { stops: false });
    expect(faultList(faults)).toContain(`missedStop@${m.index}`);
    expect(faults.find((f) => f.kind === 'missedStop')?.severity).toBe('immediateFail');
  });

  it('rolling over the Stop line at walking pace is a critical error', () => {
    const { seed, m } = stop();
    const { faults } = drive(seed, {
      stops: false,
      speed: (ideal, ctx) => (ctx.m.control === 'stop' && ctx.s > ctx.m.start - 12 && ctx.s < ctx.m.start + 2 ? kmh(6) : ideal),
    });
    expect(faultList(faults)).toContain(`rollingStop@${m.index}`);
    expect(faults.some((f) => f.kind === 'missedStop')).toBe(false);
  });

  for (const kind of ['junction', 'roundabout'] as const) {
    it(`coming up to a Give Way line too fast is minor (${kind})`, () => {
      const { seed, m } = findSeed((c) => (kind === 'roundabout' ? c.kind === 'roundabout' : c.control === 'giveWay'));
      const { faults } = drive(seed, {
        speed: (ideal, ctx) => (ctx.m.index === m.index && ctx.s > m.start - JUNCTION_SLOW_FROM && ctx.s < m.start + 1 ? kmh(32) : ideal),
      });
      expect(faultList(faults)).toEqual([`giveWayTooFast@${m.index}`]);
    });
  }
});

describe('speed', () => {
  const { seed, m } = findSeed(afterLongRoad);

  const speedOnStretch = (overKmh: number, length: number): ReturnType<typeof drive> =>
    drive(seed, {
      speed: (ideal, ctx) => (onStretch(ctx.route, m, ctx, 45, length) ? kmh(m.speedLimit + overKmh) : ideal),
    });

  it('a little over the limit for a while is minor', () => {
    const { faults } = speedOnStretch(3, 100);
    expect(faultList(faults)).toEqual(['speeding@-']);
    expect(faults[0]?.severity).toBe('minor');
  });

  it('5 km/h over the limit is a critical error', () => {
    const { faults } = speedOnStretch(7, 30);
    expect(faultList(faults)).toEqual(['speeding@-']);
    expect(faults[0]?.severity).toBe('critical');
  });

  it('10 km/h over, or 5 over for 5 seconds, is an immediate failure, counted once', () => {
    for (const [over, length] of [
      [12, 20],
      [7, 120],
    ] as const) {
      const { faults } = speedOnStretch(over, length);
      expect(faultList(faults)).toEqual(['speeding@-']);
      expect(faults[0]?.severity).toBe('immediateFail');
    }
  });

  it('two separate times over the limit are two faults', () => {
    const { faults } = drive(seed, {
      speed: (ideal, ctx) =>
        onStretch(ctx.route, m, ctx, 45, 30) || onStretch(ctx.route, m, ctx, 120, 30) ? kmh(m.speedLimit + 7) : ideal,
    });
    expect(faultList(faults)).toEqual(['speeding@-', 'speeding@-']);
  });

  it('slowing down for a bend of the road is fine', () => {
    // A bend well away from any junction, so only the bend explains the slow driving.
    const lonely = (route: Route): Route['bends'][number] | undefined =>
      route.bends.find((b) => route.maneuvers.every((x) => x.start - b.to > 120 || b.from - x.end > 110));
    const found = findSeed((_m, route) => !!lonely(route));
    const bend = lonely(setup(found.seed).route) as Route['bends'][number];
    const { faults } = drive(found.seed, {
      speed: (ideal, ctx) => (ctx.s > bend.from - 60 && ctx.s < bend.to + 60 ? kmh(25) : ideal),
    });
    expect(faultList(faults)).toEqual([]);
  });

  it('dawdling well under the limit with no reason is minor', () => {
    const { faults } = speedOnStretch(-22, 140);
    expect(faultList(faults)).toEqual(['tooSlow@-']);
  });
});

describe('position', () => {
  const { seed, m } = findSeed(afterLongRoad);
  const offsetOnStretch = (offset: number, length = 60): ReturnType<typeof drive> =>
    drive(seed, { offset: (ideal, ctx) => (onStretch(ctx.route, m, ctx, 45, length) ? offset : ideal) });

  it('driving right of the middle of the lane is minor', () => {
    expect(faultList(offsetOnStretch(-0.9).faults)).toEqual(['keepLeft@-']);
  });

  it('going over the centre line is minor, once', () => {
    expect(faultList(offsetOnStretch(-1.3).faults)).toEqual(['centreLine@-']);
  });

  it('driving on the wrong side of the road is a critical error', () => {
    const { faults } = offsetOnStretch(-3, 20);
    expect(faultList(faults)).toEqual(['wrongSide@-']);
    expect(faults[0]?.severity).toBe('critical');
  });

  for (const kind of ['left', 'right'] as const) {
    const cutBy = (metres: number): ReturnType<typeof drive> => {
      const found = findSeed(turnAt(kind));
      const inside = kind === 'left' ? metres : -metres;
      return drive(found.seed, {
        offset: (ideal, ctx) => (ctx.s > found.m.start + 3 && ctx.s < found.m.end - 3 ? inside : ideal),
      });
    };

    it(`cutting the corner on a ${kind} turn is minor`, () => {
      const found = findSeed(turnAt(kind));
      expect(faultList(cutBy(3.2).faults)).toEqual([`cutCorner@${found.m.index}`]);
    });

    it(`cutting the corner only slightly on a ${kind} turn is fine`, () => {
      expect(faultList(cutBy(1.8).faults)).toEqual([]);
    });
  }
});

describe('every fault', () => {
  it('says where it happened, what happened and how it would have been right', () => {
    const { faults } = drive('rules-2', { mirrors: false, shoulder: false, stops: false });
    expect(faults.length).toBeGreaterThan(0);
    for (const f of faults) {
      expect(Number.isFinite(f.at.x) && Number.isFinite(f.at.z)).toBe(true);
      expect(f.what.length).toBeGreaterThan(10);
      expect(f.correct.length).toBeGreaterThan(10);
    }
  });
});

describe('results', () => {
  const fault = (severity: Fault['severity']): Fault => ({ id: 0, kind: 'speeding', severity, time: 0, at: { x: 0, z: 0 }, maneuver: null, place: null, what: '', correct: '' });

  it('pass with minor faults and up to 2 critical errors; fail with more or with any immediate failure', () => {
    expect(summarizeFaults([fault('minor'), fault('minor'), fault('critical'), fault('critical')], 2).passed).toBe(true);
    expect(summarizeFaults([fault('critical'), fault('critical'), fault('critical')], 2).passed).toBe(false);
    expect(summarizeFaults([fault('immediateFail')], 2)).toEqual({ immediateFail: 1, critical: 0, minor: 0, passed: false });
  });

  it('keeps the faults when the satnav finds a new route, and judges the new route afresh', () => {
    const { route, rules } = drive('rules-3', { mirrors: false });
    const before = rules.faults.length;
    expect(before).toBeGreaterThan(0);
    const other = setup('rules-4').route;
    expect(other).not.toBe(route);
    const snap: RulesSnapshot = {
      time: 1000,
      position: { x: 0, z: 0 },
      speed: 0,
      gear: 'D',
      handbrake: false,
      engineOn: true,
      beltFastened: true,
    cockpit: COCKPIT_READY,
    adjusting: false,
      indicator: null,
      lastChecked: { interiorMirror: null, leftMirror: null, rightMirror: null, back: null, leftShoulder: null, rightShoulder: null },
      route: other,
      progress: 0,
      routeOffset: 0,
      offRoute: false,
      next: 0,
      nextStarted: false,
      arrived: false,
      road: null,
      inJunction: false,
      traffic: NO_TRAFFIC,
    };
    const next = stepRules({ ...rules, finished: false }, snap, []).state;
    expect(next.faults.length).toBe(before);
    expect(next.route).toBe(other);
    expect(next.signals.zoneEnteredAt).toEqual({});
  });
});
