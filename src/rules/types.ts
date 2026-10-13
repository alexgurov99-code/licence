import type { GlanceTarget } from '../camera/glance';
import type { Route, Side } from '../route/route';
import type { Gear } from '../vehicle/gearbox';
import type { RoadPlace } from '../world/locate';
import type { Vec2 } from '../world/path';

// Shared data of the rules engine. Pure logic, no Three.js.

/**
 * Levels of fault, as on the NZ restricted licence test:
 * - immediateFail: the test is over (e.g. did not stop at a Stop sign, far over the speed limit);
 * - critical: a "critical error"; a few are allowed (CONFIG.rules.maxCriticalErrors);
 * - minor: does not fail the test, but is worth fixing.
 */
export type Severity = 'immediateFail' | 'critical' | 'minor';

export const SEVERITIES: readonly Severity[] = ['immediateFail', 'critical', 'minor'];

export type FaultKind =
  | 'noSignal'
  | 'wrongSignal'
  | 'lateSignal'
  | 'earlySignal'
  | 'unneededSignal'
  | 'signalNotCancelled'
  | 'noMirrorCheck'
  | 'noShoulderCheck'
  | 'noObservation'
  | 'missedStop'
  | 'rollingStop'
  | 'giveWayTooFast'
  | 'speeding'
  | 'tooSlow'
  | 'keepLeft'
  | 'centreLine'
  | 'wrongSide'
  | 'cutCorner';

export interface Fault {
  id: number;
  kind: FaultKind;
  severity: Severity;
  /** Simulation time and the car's position when it happened. */
  time: number;
  at: Vec2;
  /** Index of the route manoeuvre it belongs to, if any. */
  maneuver: number | null;
  /** What happened, and how it should have been done: one sentence each. */
  what: string;
  correct: string;
}

/**
 * A fault as a rule reports it; the engine adds the id, time and place. Faults with the same
 * `episode` replace each other: a speeding episode that gets worse keeps only its worst fault.
 */
export interface FaultDraft {
  kind: FaultKind;
  severity: Severity;
  maneuver: number | null;
  what: string;
  correct: string;
  episode?: string;
}

/** Everything the rules look at, once per physics step. */
export interface RulesSnapshot {
  /** Simulation time, seconds. */
  time: number;
  position: Vec2;
  /** m/s, negative when reversing. */
  speed: number;
  /** Controls (the cockpit drill and parking at the end). */
  gear: Gear;
  handbrake: boolean;
  engineOn: boolean;
  beltFastened: boolean;
  /** The indicator that is signalling a turn: hazard lights are not a signal. */
  indicator: Side | null;
  /** When each mirror and shoulder check was last being done (see camera/glance). */
  lastChecked: Readonly<Record<GlanceTarget, number | null>>;
  /** The route the car is following and where it is on it (see route/tracker). */
  route: Route;
  progress: number;
  /** Sideways from the route line, positive = left. */
  routeOffset: number;
  offRoute: boolean;
  /** The first manoeuvre not completed yet, and whether the car has begun it. */
  next: number;
  nextStarted: boolean;
  arrived: boolean;
  /** On a road (not in a junction or off the road): where in it, and the speed limit (km/h). */
  road: { place: RoadPlace; laneOffset: number; speedLimit: number } | null;
  inJunction: boolean;
}

export interface FaultSummary {
  immediateFail: number;
  critical: number;
  minor: number;
  passed: boolean;
}

export function summarizeFaults(faults: readonly Fault[], maxCriticalErrors: number): FaultSummary {
  const count = (severity: Severity): number => faults.filter((f) => f.severity === severity).length;
  const immediateFail = count('immediateFail');
  const critical = count('critical');
  return { immediateFail, critical, minor: count('minor'), passed: immediateFail === 0 && critical <= maxCriticalErrors };
}
