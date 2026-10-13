import { describe, expect, it } from 'vitest';
import type { RulesState } from './engine';
import { coach, createCoachState, type Coaching } from './coach';
import type { RulesSnapshot } from './types';
import type { Route } from '../route/route';
import { drive, findSeed, setup } from './testing';

/** Learner mode followed through a drive, remembering its state from step to step. */
function coaching(): (snap: RulesSnapshot, rules: RulesState) => Coaching | null {
  let state = createCoachState();
  return (snap, rules) => {
    const result = coach(snap, rules, state);
    state = result.state;
    return result.coaching;
  };
}

describe('learner mode', () => {
  for (const seed of ['rules-0', 'rules-1', 'rules-2', 'rules-3']) {
    it(`the model driver has done every step before each manoeuvre and misses none (${seed})`, () => {
      const coachAt = coaching();
      drive(seed, {
        onStep: (snap, rules, events) => {
          const coached = coachAt(snap, rules);
          if (!coached) return;
          expect(coached.steps.filter((s) => s.state === 'missed')).toEqual([]);
          expect(coached.warnings).toEqual([]);
          for (const event of events) {
            if (event.type !== 'maneuverStarted') continue;
            // Everything up to the manoeuvre itself is done as it begins.
            const steps = coached.steps;
            const goAt = steps.findIndex((s) => s.kind === 'go' || s.kind === 'moveOff' || s.kind === 'pullOver');
            expect(steps.slice(0, goAt).filter((s) => s.state !== 'done')).toEqual([]);
          }
        },
      });
    });
  }

  it('pulling out: belt, engine, mirror, indicator for 3 s, shoulder, move off — one at a time', () => {
    const seen: string[] = [];
    const coachAt = coaching();
    drive('rules-1', {
      onStep: (snap, rules) => {
        if (snap.time > 6) return;
        const now = coachAt(snap, rules)?.steps.find((s) => s.state === 'now')?.kind ?? 'none';
        if (seen.at(-1) !== now) seen.push(now);
      },
    });
    expect(seen).toEqual(['mirror', 'signal', 'shoulder', 'moveOff', 'none']);
  });

  it('the cockpit drill comes first: seat, mirrors, belt, engine', () => {
    const seen: string[] = [];
    const coachAt = coaching();
    drive('rules-1', {
      cockpit: { seat: false, interior: false, left: true, right: true },
      belt: (time) => time > 0.3,
      engineOnAt: 0.4,
      onStep: (snap, rules) => {
        if (snap.time > 0.5) return;
        const steps = coachAt(snap, rules)?.steps ?? [];
        const now = steps.find((s) => s.state === 'now')?.kind ?? 'none';
        if (seen.at(-1) !== now) seen.push(now);
        expect(steps.slice(0, 4).map((s) => s.kind)).toEqual(['seat', 'adjustMirrors', 'belt', 'engine']);
      },
    });
    expect(seen[0]).toBe('seat');
  });

  it('names a manoeuvre far ahead without its steps, and shows them once the car is close', () => {
    const { seed, m } = findSeed((c, route) => {
      const previous = route.maneuvers[c.index - 1];
      return c.kind === 'roundabout' && c.turn === 'right' && !!previous && c.start - previous.end > 200;
    });
    const at: Coaching[] = [];
    const coachAt = coaching();
    drive(seed, {
      onStep: (snap, rules) => {
        const coached = coachAt(snap, rules);
        if (coached?.maneuver.index === m.index) at.push(coached);
      },
    });
    const far = at.filter((c) => (c.distance ?? 0) > 150);
    expect(far.length).toBeGreaterThan(0);
    for (const c of far) {
      expect(c.phase).not.toBe('steps');
      expect(c.steps.filter((s) => s.kind !== 'cancelSignal')).toEqual([]);
    }
    const first = at.find((c) => c.phase === 'steps') as Coaching;
    expect(first.steps.map((s) => s.kind)).toEqual(['mirror', 'signal', 'giveWay', 'go', 'exitSignal', 'cancelSignal']);
    expect(first.steps.map((s) => s.state)).toEqual(['now', 'todo', 'todo', 'todo', 'todo', 'todo']);
    // Under way, after switching from the right indicator to the left one to leave.
    const leaving = at.at(-1) as Coaching;
    expect(leaving.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'now', 'done', 'todo']);
  });

  it('before a bend of the road names the bend, not the steps; a look in the mirror there does not tick the mirror step', () => {
    // A bend before a signalled manoeuvre, with room after it for the steps to show.
    const { seed, m } = findSeed((c, route) => {
      const bend = route.bends.find((b) => b.to <= c.start && b.to > c.start - 120);
      const previous = route.maneuvers[c.index - 1];
      return !!c.signal && c.kind !== 'pullOver' && !!bend && !!previous && bend.from - previous.end > 40;
    });
    const route = setup(seed).route;
    const bend = route.bends.find((b) => b.to <= m.start && b.to > m.start - 120) as Route['bends'][number];
    const at: { s: number; c: Coaching }[] = [];
    const coachAt = coaching();
    drive(seed, {
      mirrors: false,
      // A look in the mirror while still before the bend.
      glance: (ctx) => (ctx.s > bend.from - 15 && ctx.s < bend.from - 10 ? 'interiorMirror' : null),
      onStep: (snap, rules) => {
        const coached = coachAt(snap, rules);
        if (coached?.maneuver.index === m.index) at.push({ s: snap.progress, c: coached });
      },
    });
    const beforeBend = at.filter((x) => x.s > bend.from - 30 && x.s < bend.from);
    expect(beforeBend.length).toBeGreaterThan(0);
    for (const { c } of beforeBend) {
      expect(c.phase).toBe('bend');
      expect(c.bend).toBe(bend.side);
      expect(c.steps).toEqual([]);
    }
    const shown = at.find((x) => x.c.phase === 'steps');
    expect(shown && shown.s).toBeGreaterThanOrEqual(bend.to - 1);
    expect(shown?.c.steps.find((s) => s.kind === 'mirror')?.state).toBe('now');
  });

  it('marks a mirror check that was not done as missed', () => {
    let missed = 0;
    const coachAt = coaching();
    drive('rules-1', {
      mirrors: false,
      onStep: (snap, rules) => {
        if (coachAt(snap, rules)?.steps.some((s) => s.kind === 'mirror' && s.state === 'missed')) missed += 1;
      },
    });
    expect(missed).toBeGreaterThan(0);
  });

  it('warns when over the limit', () => {
    let warned = false;
    const coachAt = coaching();
    drive('rules-1', {
      speed: (ideal, ctx) => (ctx.s > 100 && ctx.s < 120 ? ideal + 3 : ideal),
      onStep: (snap, rules) => {
        if (coachAt(snap, rules)?.warnings.some((w) => w.kind === 'speeding')) warned = true;
      },
    });
    expect(warned).toBe(true);
  });
});
