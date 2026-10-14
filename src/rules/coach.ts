import { CONFIG, type RulesParams } from '../config';
import type { Maneuver, Route, Side } from '../route/route';
import type { RulesState } from './engine';
import { mirrorChecked } from './observation';
import { exitZoneOf } from './signals';
import type { RulesSnapshot } from './types';

// Learner mode: the steps the next manoeuvre needs, in order, and which are done, following the
// same rules the engine checks. Pure logic; the UI (ui/coachPanel.ts) puts it into words and keys.
//
// The steps only show once it is time for them: close to where the signal should go on, and past
// any bend of the road before the manoeuvre. Until then just the manoeuvre is named (or the bend
// ahead), and a look in the mirror only ticks the mirror step if it comes after the steps show.

export type CoachStepKind =
  | 'seat'
  | 'adjustMirrors'
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

/**
 * steps: time to do the steps; ahead: the manoeuvre is still a way off (no steps yet);
 * bend: a bend of the road comes first, just follow it (no signal).
 */
export type CoachPhase = 'steps' | 'ahead' | 'bend';

export interface Coaching {
  /** The manoeuvre the steps are for, and how far away it is (null once under way). */
  maneuver: Maneuver;
  distance: number | null;
  phase: CoachPhase;
  /** Phase 'bend': which way the road goes. */
  bend: Side | null;
  /** Empty until the phase is 'steps', except an indicator left on that should be cancelled. */
  steps: CoachStep[];
  warnings: CoachWarning[];
}

/** Remembers when the steps of the current manoeuvre first showed. */
export interface CoachState {
  route: Route | null;
  maneuver: number;
  stepsSince: number | null;
}

export function createCoachState(): CoachState {
  return { route: null, maneuver: -1, stepsSince: null };
}

export interface CoachOptions {
  params: RulesParams;
  minSignalSeconds: number;
  /** Steps start to light up this far before where the signal should go on. */
  aheadDistance: number;
  /** A bend of the road closer than this is named instead of the manoeuvre after it. */
  bendDistance: number;
}

const DEFAULT_OPTIONS: CoachOptions = {
  params: CONFIG.rules,
  minSignalSeconds: CONFIG.route.minSignalSeconds,
  aheadDistance: CONFIG.ui.coachAheadDistance,
  bendDistance: CONFIG.minimap.bendAnnounceDistance,
};

interface Draft {
  kind: CoachStepKind;
  done: boolean;
  missed?: boolean;
  side?: Side;
  seconds?: number;
  needSeconds?: number;
  /** An indicator left on from the previous manoeuvre: shown even before it is time for the steps. */
  leftover?: boolean;
}

export function coach(
  snap: RulesSnapshot,
  rules: RulesState,
  state: CoachState,
  options: CoachOptions = DEFAULT_OPTIONS,
): { coaching: Coaching | null; state: CoachState } {
  if (snap.offRoute) return { coaching: null, state };
  const { params } = options;
  const { route, time } = snap;
  const s = rules.signals;
  const last = route.maneuvers[route.maneuvers.length - 1];
  const m = snap.arrived ? last : route.maneuvers[snap.next];
  if (!m) return { coaching: null, state };

  // Is it time for the steps? Close to where the signal should go on, and past any bend before the manoeuvre.
  const firstZone = route.zones.find((z) => z.maneuver === m.index && (z.kind === 'signal' || z.kind === 'stopLine' || z.kind === 'giveWayLine'));
  const from = Math.min(firstZone?.from ?? m.start, m.start) - options.aheadDistance;
  const bendAhead = snap.nextStarted ? undefined : route.bends.find((b) => b.to > snap.progress && b.to <= m.start);
  const inTime = m.kind === 'pullOut' || snap.arrived || snap.nextStarted || (snap.progress >= from && !bendAhead);
  const phase: CoachPhase = inTime ? 'steps' : bendAhead && bendAhead.from - snap.progress < options.bendDistance ? 'bend' : 'ahead';
  let next = state.route === route && state.maneuver === m.index ? state : { route, maneuver: m.index, stepsSince: null };
  if (inTime && next.stepsSince === null) next = { ...next, stepsSince: m.kind === 'pullOut' ? -Infinity : time };
  const stepsSince = next.stepsSince ?? Infinity;

  const drafts: Draft[] = [];
  const previous = route.maneuvers[m.index - 1];
  // An indicator left on from the previous manoeuvre, not wanted for this one.
  if (!snap.arrived && snap.indicator && snap.indicator !== m.signal && previous && s.sinceProgress < previous.end) {
    drafts.push({ kind: 'cancelSignal', done: false, leftover: true });
  }

  const mirrorStep = (side: Side): Draft => {
    const before = s.mirrorBeforeSignal[m.index];
    // Only a look since the steps showed: an early one (e.g. before a bend) does not tick it.
    const since = Math.max(stepsSince, time - params.observation.mirrorMaxAgeSeconds);
    const recent = mirrorChecked(snap.lastChecked, side, since);
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
    const moved = rules.drill.movedOff;
    drafts.push(
      { kind: 'seat', done: snap.cockpit.seat || moved },
      { kind: 'adjustMirrors', done: (snap.cockpit.interior && snap.cockpit.left && snap.cockpit.right) || moved },
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

  // Before it is time, only an indicator left on from the previous manoeuvre is worth a step.
  const shown = inTime ? drafts : drafts.filter((d) => d.leftover);
  let nowGiven = false;
  const steps: CoachStep[] = shown.map((d) => {
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
  return { coaching: { maneuver: m, distance, phase, bend: phase === 'bend' ? (bendAhead?.side ?? null) : null, steps, warnings }, state: next };
}
