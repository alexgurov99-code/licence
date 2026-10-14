import type { Vec2 } from '../world/path';
import { summarizeFaults, type Fault, type FaultKind, type FaultSummary } from './types';

// What the results screen shows when the drive is over: passed or failed and why, and every fault
// in the order it happened, numbered like its mark on the map. Pure logic, no Three.js or DOM.

export interface ResultItem {
  /** Number of the fault in the list and on the map, from 1. */
  number: number;
  fault: Fault;
  /** "Left turn", "Cockpit drill", "On the road". */
  place: string;
  /** Drive time when it happened, "3:07". */
  clock: string;
}

export interface DriveResults {
  passed: boolean;
  summary: FaultSummary;
  /** One sentence on why: the immediate fail, too many critical errors, or the counts. */
  reason: string;
  /** "0 immediate fail · 1 critical · 3 minor". */
  counts: string;
  /** The test was stopped by an immediate fail before the route was finished. */
  endedEarly: boolean;
  /** "7:42 · 3.1 km". */
  drive: string;
  items: ResultItem[];
}

const DRILL_KINDS: ReadonlySet<FaultKind> = new Set(['noBelt', 'seatNotAdjusted', 'mirrorsNotAdjusted', 'adjustedWhileMoving', 'drillOrder']);

export interface ResultsInput {
  faults: readonly Fault[];
  maxCriticalErrors: number;
  /** Seconds and metres driven. */
  seconds: number;
  metres: number;
  endedEarly: boolean;
}

export function driveResults(input: ResultsInput): DriveResults {
  const { faults, maxCriticalErrors } = input;
  const summary = summarizeFaults(faults, maxCriticalErrors);
  // A speeding fault that got worse replaced the earlier one later on: order by when they happened.
  const ordered = [...faults].sort((a, b) => a.time - b.time || a.id - b.id);
  const items = ordered.map((fault, i) => ({ number: i + 1, fault, place: placeOf(fault), clock: clock(fault.time) }));
  return {
    passed: summary.passed,
    summary,
    reason: reasonFor(ordered, summary, maxCriticalErrors),
    counts: `${summary.immediateFail} immediate fail · ${summary.critical} critical · ${summary.minor} minor`,
    endedEarly: input.endedEarly,
    drive: `${clock(input.seconds)} · ${(input.metres / 1000).toFixed(1)} km`,
    items,
  };
}

function placeOf(fault: Fault): string {
  if (fault.place) return fault.place;
  return DRILL_KINDS.has(fault.kind) ? 'Cockpit drill' : 'On the road';
}

function reasonFor(faults: readonly Fault[], summary: FaultSummary, maxCritical: number): string {
  const firstFail = faults.find((f) => f.severity === 'immediateFail');
  if (firstFail) return `Immediate fail: ${firstFail.what}`;
  const critical = plural(summary.critical, 'critical error');
  if (!summary.passed) return `${critical}: no more than ${maxCritical} are allowed.`;
  if (summary.critical === 0 && summary.minor === 0) return 'A clean drive: no faults at all.';
  return `${critical} (up to ${maxCritical} allowed) and ${plural(summary.minor, 'minor fault')}.`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Seconds as "m:ss". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Simulation time of the first immediate fail: the examiner ends the test there. */
export function immediateFailTime(faults: readonly Fault[]): number | null {
  let first: number | null = null;
  for (const f of faults) if (f.severity === 'immediateFail' && (first === null || f.time < first)) first = f.time;
  return first;
}

/**
 * The way the car actually went, for the results map: a point each time it has moved `step`
 * metres from the last one, so a long drive stays a few thousand points. Adds to `trail` and
 * returns the metres driven since the last point that was kept (0 when no point was added).
 */
export function extendTrail(trail: Vec2[], p: Vec2, step: number): number {
  const last = trail[trail.length - 1];
  if (!last) {
    trail.push({ x: p.x, z: p.z });
    return 0;
  }
  const moved = Math.hypot(p.x - last.x, p.z - last.z);
  if (moved < step) return 0;
  trail.push({ x: p.x, z: p.z });
  return moved;
}
