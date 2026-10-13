import { CONFIG, type RulesParams } from '../config';
import type { Maneuver, Side } from '../route/route';
import type { RulesState } from './engine';
import { mirrorChecked } from './observation';
import { exitZoneOf } from './signals';
import type { RulesSnapshot } from './types';

// Learner mode: the steps the next manoeuvre needs, in order, and which are done, following the
// same rules the engine checks. Pure logic; the UI (ui/coachPanel.ts) puts it into words and keys.

export type CoachStepKind =
  | 'belt'
  | 'engine'
  | 'mirror'
  | 'signal'
  | 'shoulder'
  | 'moveOff'
  | 'stop'
  | 'giveWay'
  | 'go'
  | 'exitSignal'
  | 'cancelSignal'
  | 'pullOver'
  | 'park';

/** done; now: do this next; todo: later; missed: too late for this one (a fault was recorded). */
export type CoachStepState = 'done' | 'now' | 'todo' | 'missed';

export interface CoachStep {
  kind: CoachStepKind;
  state: CoachStepState;
  /** Mirror, signal and shoulder steps: which side. */
  side?: Side;
  /** Signal steps: how long the indicator has been on, out of how long it should be. */
  seconds?: number;
  needSeconds?: number;
}

export type CoachWarning = { kind: 'speeding'; limit: number } | { kind: 'keepLeft' };

export interface Coaching {
  /** The manoeuvre the steps are for, and how far away it is (null once under way). */
  maneuver: Maneuver;
  distance: number | null;
  steps: CoachStep[];
  warnings: CoachWarning[];
}

export interface CoachOptions {
  params: RulesParams;
  minSignalSeconds: number;
  /** Steps start to light up this far before where the signal should go on. */
  aheadDistance: number;
}

const DEFAULT_OPTIONS: CoachOptions = {
  params: CONFIG.rules,
  minSignalSeconds: CONFIG.route.minSignalSeconds,
  aheadDistance: CONFIG.ui.coachAheadDistance,
};

interface Draft {
  kind: CoachStepKind;
  done: boolean;
  missed?: boolean;
  side?: Side;
  seconds?: number;
  needSeconds?: number;
}

export function coach(snap: RulesSnapshot, rules: RulesState, options: CoachOptions = DEFAULT_OPTIONS): Coaching | null {
  if (snap.offRoute) return null;
  const { params } = options;
  const { route, time } = snap;
  const s = rules.signals;
  const last = route.maneuvers[route.maneuvers.length - 1];
  const m = snap.arrived ? last : route.maneuvers[snap.next];
  if (!m) return null;

  const drafts: Draft[] = [];
  const previous = route.maneuvers[m.index - 1];
  // An indicator left on from the previous manoeuvre, not wanted for this one.
  if (!snap.arrived && snap.indicator && snap.indicator !== m.signal && previous && s.sinceProgress < previous.end) {
    drafts.push({ kind: 'cancelSignal', done: false });
  }

  const mirrorStep = (side: Side): Draft => {
    const before = s.mirrorBeforeSignal[m.index];
    const recent = mirrorChecked(snap.lastChecked, side, time - params.observation.mirrorMaxAgeSeconds);
    return { kind: 'mirror', side, done: before === true || (snap.indicator !== side && recent), missed: before === false };
  };
  const signalStep = (side: Side): Draft => {
    const seconds = snap.indicator === side ? time - s.since : 0;
    // Once under way, the approach signal was judged as the manoeuvre began.
    const missed = rules.faults.some((f) => f.maneuver === m.index && (f.kind === 'noSignal' || f.kind === 'wrongSignal'));
    return {
      kind: 'signal',
      side,
      seconds,
      needSeconds: options.minSignalSeconds,
      done: seconds >= options.minSignalSeconds || (snap.nextStarted && !missed),
      missed,
    };
  };
  const slowest = (kind: 'stopLine' | 'giveWayLine'): number | null => {
    const zone = route.zones.find((z) => z.kind === kind && z.maneuver === m.index);
    if (!zone) return null;
    return (rules.junctions.slowest[zone.id] ?? Infinity) * 3.6;
  };

  if (m.kind === 'pullOut') {
    const side: Side = 'right';
    const shoulderAt = snap.lastChecked.rightShoulder;
    drafts.push(
      { kind: 'belt', done: snap.beltFastened },
      { kind: 'engine', done: snap.engineOn },
      mirrorStep(side),
      signalStep(side),
      {
        kind: 'shoulder',
        side,
        done:
          shoulderAt !== null &&
          snap.indicator === side &&
          shoulderAt >= s.since &&
          shoulderAt >= time - params.observation.shoulderMaxAgeSeconds,
      },
      { kind: 'moveOff', done: snap.nextStarted },
    );
  } else if (m.kind === 'pullOver') {
    if (!snap.arrived) {
      drafts.push(mirrorStep('left'), signalStep('left'), { kind: 'pullOver', done: false });
    } else {
      drafts.push({ kind: 'park', done: snap.handbrake && snap.gear === 'P' });
    }
  } else {
    if (m.signal) drafts.push(mirrorStep(m.signal), signalStep(m.signal));
    const stop = slowest('stopLine');
    if (stop !== null) drafts.push({ kind: 'stop', done: stop <= params.junction.stopSpeedKmh });
    const giveWay = slowest('giveWayLine');
    if (giveWay !== null) drafts.push({ kind: 'giveWay', done: giveWay <= params.junction.giveWayKmh });
    drafts.push({ kind: 'go', done: false });
    const exit = exitZoneOf(route, m);
    if (exit) drafts.push({ kind: 'exitSignal', side: 'left', done: rules.signals.exitSignalShare[exit.id] !== undefined });
    if (m.signal || exit) drafts.push({ kind: 'cancelSignal', done: false });
  }

  // Steps light up once the car is close: from a little before the signal should go on.
  const firstZone = route.zones.find((z) => z.maneuver === m.index && (z.kind === 'signal' || z.kind === 'stopLine' || z.kind === 'giveWayLine'));
  const from = Math.min(firstZone?.from ?? m.start, m.start) - options.aheadDistance;
  const active = m.kind === 'pullOut' || snap.arrived || snap.nextStarted || snap.progress >= from || drafts[0]?.kind === 'cancelSignal';

  let nowGiven = !active;
  const steps: CoachStep[] = drafts.map((d) => {
    let state: CoachStepState;
    if (d.done) state = 'done';
    else if (d.missed) state = 'missed';
    else if (!nowGiven) {
      state = 'now';
      nowGiven = true;
    } else state = 'todo';
    const step: CoachStep = { kind: d.kind, state };
    if (d.side) step.side = d.side;
    if (d.seconds !== undefined) step.seconds = d.seconds;
    if (d.needSeconds !== undefined) step.needSeconds = d.needSeconds;
    return step;
  });

  const warnings: CoachWarning[] = [];
  const limit = rules.speed.limit;
  if (limit !== null && Math.abs(snap.speed) * 3.6 > limit + 1) warnings.push({ kind: 'speeding', limit });
  if (snap.road && !snap.arrived && snap.road.laneOffset < -params.position.keepLeftOffset) warnings.push({ kind: 'keepLeft' });

  const target = m.kind === 'pullOver' ? m.end : m.start;
  const distance = snap.nextStarted || snap.arrived || m.kind === 'pullOut' ? null : Math.max(0, target - snap.progress);
  return { maneuver: m, distance, steps, warnings };
}
