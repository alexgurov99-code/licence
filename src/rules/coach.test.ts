import { describe, expect, it } from 'vitest';
import { coach, type Coaching } from './coach';
import { drive, findSeed } from './testing';

describe('learner mode', () => {
  for (const seed of ['rules-0', 'rules-1', 'rules-2', 'rules-3']) {
    it(`the model driver has done every step before each manoeuvre and misses none (${seed})`, () => {
      drive(seed, {
        onStep: (snap, rules, events) => {
          const coaching = coach(snap, rules);
          if (!coaching) return;
          expect(coaching.steps.filter((s) => s.state === 'missed')).toEqual([]);
          expect(coaching.warnings).toEqual([]);
          for (const event of events) {
            if (event.type !== 'maneuverStarted') continue;
            // Everything up to the manoeuvre itself is done as it begins.
            const steps = coaching.steps;
            const goAt = steps.findIndex((s) => s.kind === 'go' || s.kind === 'moveOff' || s.kind === 'pullOver');
            expect(steps.slice(0, goAt).filter((s) => s.state !== 'done')).toEqual([]);
          }
        },
      });
    });
  }

  it('pulling out: belt, engine, mirror, indicator for 3 s, shoulder, move off — one at a time', () => {
    const seen: string[] = [];
    drive('rules-1', {
      onStep: (snap, rules) => {
        if (snap.time > 6) return;
        const now = coach(snap, rules)?.steps.find((s) => s.state === 'now')?.kind ?? 'none';
        if (seen.at(-1) !== now) seen.push(now);
      },
    });
    expect(seen).toEqual(['mirror', 'signal', 'shoulder', 'moveOff', 'none']);
  });

  it('shows the steps of a manoeuvre, greyed out until the car is close', () => {
    const { seed, m } = findSeed((c, route) => {
      const previous = route.maneuvers[c.index - 1];
      return c.kind === 'roundabout' && c.turn === 'right' && !!previous && c.start - previous.end > 200;
    });
    const at: Coaching[] = [];
    drive(seed, {
      onStep: (snap, rules) => {
        const coaching = coach(snap, rules);
        if (coaching?.maneuver.index === m.index) at.push(coaching);
      },
    });
    const first = at.filter((c) => (c.distance ?? 0) > 150).at(-1) as Coaching;
    expect(first.steps.map((s) => s.kind)).toEqual(['mirror', 'signal', 'giveWay', 'go', 'exitSignal', 'cancelSignal']);
    expect(first.steps.every((s) => s.state === 'todo')).toBe(true);
    expect(first.distance).toBeGreaterThan(0);
    expect(at.some((c) => c.steps.find((s) => s.kind === 'mirror')?.state === 'now')).toBe(true);
    // Under way, after switching from the right indicator to the left one to leave.
    const leaving = at.at(-1) as Coaching;
    expect(leaving.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'now', 'done', 'todo']);
  });

  it('marks a mirror check that was not done as missed', () => {
    let missed = 0;
    drive('rules-1', {
      mirrors: false,
      onStep: (snap, rules) => {
        if (coach(snap, rules)?.steps.some((s) => s.kind === 'mirror' && s.state === 'missed')) missed += 1;
      },
    });
    expect(missed).toBeGreaterThan(0);
  });

  it('warns when over the limit', () => {
    let warned = false;
    drive('rules-1', {
      speed: (ideal, ctx) => (ctx.s > 100 && ctx.s < 120 ? ideal + 3 : ideal),
      onStep: (snap, rules) => {
        if (coach(snap, rules)?.warnings.some((w) => w.kind === 'speeding')) warned = true;
      },
    });
    expect(warned).toBe(true);
  });
});
