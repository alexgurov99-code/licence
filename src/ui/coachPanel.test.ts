import { describe, expect, it } from 'vitest';
import type { Maneuver } from '../route/route';
import { coachText } from './coachPanel';

const turn: Maneuver = {
  index: 3,
  kind: 'right',
  junctionId: 1,
  connectorId: 2,
  turn: 'right',
  exit: null,
  control: 'giveWay',
  start: 100,
  end: 120,
  signal: 'right',
  speedLimit: 50,
  point: { x: 0, z: 0 },
};

describe('learner mode panel text', () => {
  it('names the manoeuvre, the distance and each step with its keys', () => {
    const text = coachText({
      maneuver: turn,
      distance: 234,
      phase: 'steps',
      bend: null,
      steps: [
        { kind: 'mirror', state: 'done', side: 'right' },
        { kind: 'signal', state: 'now', side: 'right', seconds: 1.42, needSeconds: 3 },
        { kind: 'giveWay', state: 'todo' },
        { kind: 'go', state: 'todo' },
        { kind: 'cancelSignal', state: 'todo' },
      ],
      warnings: [{ kind: 'speeding', limit: 50 }, { kind: 'giveWay', from: 'right' }, { kind: 'tooClose' }],
    });
    expect(text.title).toBe('Turn right (Give Way) · 230 m');
    expect(text.steps).toEqual([
      { text: 'Mirror ↑ or →', state: 'done' },
      { text: 'Indicate right E 1.4 / 3 s', state: 'now' },
      { text: 'Slow below 20 km/h, look both ways', state: 'todo' },
      { text: 'Turn right', state: 'todo' },
      { text: 'Indicator off: Q / E again', state: 'todo' },
    ]);
    expect(text.warnings).toEqual([
      'Slow down: the limit is 50 km/h',
      'Give way to the car on your right',
      'Too close: keep 2 seconds behind the car ahead',
    ]);
  });

  it('pulling out lists the keys for the whole sequence', () => {
    const text = coachText({
      maneuver: { ...turn, index: 0, kind: 'pullOut', junctionId: null, control: 'none' },
      distance: null,
      phase: 'steps',
      bend: null,
      steps: [
        { kind: 'engine', state: 'now' },
        { kind: 'shoulder', state: 'todo', side: 'right' },
        { kind: 'moveOff', state: 'todo' },
      ],
      warnings: [],
    });
    expect(text.title).toBe('Pull out from the kerb');
    expect(text.steps.map((s) => s.text)).toEqual(['Engine: hold S, press Enter', 'Right shoulder ↓+→', 'D 4, handbrake off Space, go']);
  });
});

describe('learner mode panel before the steps', () => {
  const base = { maneuver: turn, distance: 152, steps: [], warnings: [] };

  it('names the next manoeuvre quietly while it is a way off', () => {
    expect(coachText({ ...base, phase: 'ahead', bend: null })).toMatchObject({ title: 'Next: Turn right (Give Way) · 150 m', quiet: true, steps: [] });
  });

  it('says to just follow a bend of the road first', () => {
    expect(coachText({ ...base, phase: 'bend', bend: 'left' }).title).toBe(
      'The road bends left: just follow it, no signal. Then: Turn right (Give Way) · 150 m',
    );
  });
});
