import type { RulesParams } from '../config';
import type { Maneuver, Route, Side, Zone } from '../route/route';
import type { RouteEvent } from '../route/tracker';
import {
  earlySignal,
  lateExitSignal,
  lateSignal,
  noExitSignal,
  noMirrorCheck,
  noSignal,
  signalNotCancelled,
  unneededSignal,
  wrongSignal,
} from './faults';
import { mirrorChecked, pullOutLooks } from './observation';
import type { FaultDraft, RulesSnapshot } from './types';

// Indicators against the route's zones (route/route.ts): on the right side, at least 3 seconds
// before each manoeuvre but not before the previous one is over, left before leaving a
// roundabout, off again afterwards; and the mirror check before signalling.

export interface SignalState {
  /** The indicator now, when it went on (or off) and the route distance there. */
  side: Side | null;
  since: number;
  sinceProgress: number;
  /** Per manoeuvre of the current route: whether the mirrors were checked before its indicator went on. */
  mirrorBeforeSignal: Readonly<Record<number, boolean>>;
  /** Manoeuvres already faulted for signalling too early. */
  early: readonly number[];
  /** When the car entered each zone of the current route. */
  zoneEnteredAt: Readonly<Record<number, number>>;
  /** Roundabout exit signal zones: how far along (share) the left indicator was first seen on. */
  exitSignalShare: Readonly<Record<number, number>>;
  /** Route distance of the car at the previous step on this route. */
  progress: number | null;
}

export function createSignalState(): SignalState {
  return {
    side: null,
    since: 0,
    sinceProgress: -Infinity,
    mirrorBeforeSignal: {},
    early: [],
    zoneEnteredAt: {},
    exitSignalShare: {},
    progress: null,
  };
}

/** A new route (after a wrong turn): its zones and manoeuvres start afresh; the indicator stays as it is. */
export function signalStateForNewRoute(state: SignalState): SignalState {
  return { ...createSignalState(), side: state.side, since: state.since };
}

const EPSILON = 1e-6;

export function stepSignals(
  state: SignalState,
  snap: RulesSnapshot,
  events: readonly RouteEvent[],
  params: RulesParams,
  minSignalSeconds: number,
): { state: SignalState; faults: FaultDraft[] } {
  const { route, time, progress } = snap;
  const faults: FaultDraft[] = [];
  const s = {
    ...state,
    mirrorBeforeSignal: { ...state.mirrorBeforeSignal },
    early: [...state.early],
    zoneEnteredAt: { ...state.zoneEnteredAt },
    exitSignalShare: { ...state.exitSignalShare },
  };

  const allowedSince = (m: Maneuver): number | undefined => {
    const times = route.zones
      .filter((z) => z.maneuver === m.index && (z.kind === 'mirror' || isApproachSignal(m, z)))
      .map((z) => s.zoneEnteredAt[z.id])
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.min(...times) : undefined;
  };

  if (snap.indicator !== s.side) {
    s.side = snap.indicator;
    s.since = time;
    s.sinceProgress = progress;
    const side = snap.indicator;
    if (side && !snap.offRoute) {
      const active = snap.nextStarted ? route.maneuvers[snap.next] : undefined;
      const candidate = route.maneuvers[snap.nextStarted ? snap.next + 1 : snap.next];
      // A signal for the manoeuvre under way (e.g. left to leave a roundabout) is not for the next one.
      const forActive = !!active && (active.signal === side || (side === 'left' && !!exitZoneOf(route, active)));
      if (!forActive && candidate && candidate.signal === side) {
        if (s.mirrorBeforeSignal[candidate.index] === undefined) {
          // Any check of the right mirror shortly before, even still in the previous junction.
          const windowStart = time - params.observation.mirrorMaxAgeSeconds;
          s.mirrorBeforeSignal[candidate.index] = mirrorChecked(snap.lastChecked, side, windowStart);
        }
        const previous = route.maneuvers[candidate.index - 1];
        const earliest = previous ? previous.end : -Infinity;
        if (previous && progress < earliest - params.signal.earlyToleranceDistance && !s.early.includes(candidate.index)) {
          s.early.push(candidate.index);
          faults.push(earlySignal(candidate, side, previous));
        }
      }
    }
  }

  // Leaving a roundabout: note how soon the left indicator went on.
  if (snap.indicator === 'left' && !snap.offRoute) {
    for (const zone of route.zones) {
      if (zone.kind !== 'signal' || s.exitSignalShare[zone.id] !== undefined) continue;
      if (progress < zone.from || progress >= zone.to) continue;
      const m = route.maneuvers[zone.maneuver];
      if (m && exitZoneOf(route, m) === zone) s.exitSignalShare[zone.id] = (progress - zone.from) / (zone.to - zone.from);
    }
  }

  // Zones the car leaves because it went off the route are not judged.
  const leftRoute = events.some((e) => e.type === 'leftRoute');
  for (const event of events) {
    switch (event.type) {
      case 'zoneEntered':
        s.zoneEnteredAt[event.zone.id] = time;
        break;
      case 'maneuverStarted':
        faults.push(...startFaults(event.maneuver, s, snap, params, minSignalSeconds, allowedSince(event.maneuver)));
        break;
      case 'zoneLeft': {
        const m = route.maneuvers[event.zone.maneuver];
        if (leftRoute || !m || exitZoneOf(route, m) !== event.zone) break;
        const share = s.exitSignalShare[event.zone.id];
        if (share === undefined) faults.push(noExitSignal(m));
        else if (share > params.signal.exitSignalShare) faults.push(lateExitSignal(m));
        break;
      }
      default:
        break;
    }
  }

  // The indicator must be off by the time the middle of the car is just past the "indicator off" line.
  const before = s.progress;
  const grace = params.signal.cancelGraceDistance;
  s.progress = snap.offRoute ? null : progress;
  if (before !== null && s.progress !== null) {
    for (const zone of route.zones) {
      if (zone.kind !== 'signalOff' || zone.from + grace <= before || zone.from + grace > progress) continue;
      const m = route.maneuvers[zone.maneuver];
      if (!m || !s.side || s.sinceProgress >= m.end - EPSILON) continue;
      // Two manoeuvres close together needing the same indicator: it may stay on.
      const following = route.maneuvers[m.index + 1];
      const first = following ? firstSignalOf(route, following) : null;
      if (first && first.side === s.side && first.from <= zone.from + EPSILON) continue;
      faults.push(signalNotCancelled(m));
    }
  }

  return { state: s, faults };
}

/** Judged as the manoeuvre begins: the approach signal, the mirror check and, pulling out, the shoulder check. */
function startFaults(
  m: Maneuver,
  s: SignalState,
  snap: RulesSnapshot,
  params: RulesParams,
  minSignalSeconds: number,
  allowedSince: number | undefined,
): FaultDraft[] {
  const faults: FaultDraft[] = [];
  const { time } = snap;
  if (m.signal) {
    if (s.side === m.signal) {
      const onFor = time - s.since;
      // If the zone began less than 3 seconds before the manoeuvre, signalling from its start is enough.
      const needed = Math.min(minSignalSeconds, allowedSince === undefined ? Infinity : time - allowedSince);
      if (onFor < needed - params.signal.lateToleranceSeconds) faults.push(lateSignal(m, m.signal, onFor));
      if (m.kind !== 'pullOut' && s.mirrorBeforeSignal[m.index] === false) faults.push(noMirrorCheck(m, m.signal));
    } else if (s.side) {
      faults.push(wrongSignal(m, m.signal, s.side));
    } else {
      faults.push(noSignal(m, m.signal));
    }
  } else if (s.side) {
    // An indicator left on from the previous manoeuvre is faulted at its "indicator off" line instead.
    const previousEnd = snap.route.maneuvers[m.index - 1]?.end ?? -Infinity;
    if (s.sinceProgress >= previousEnd - EPSILON) faults.push(unneededSignal(m, s.side));
  }
  if (m.kind === 'pullOut') {
    const signalOnSince = s.side === 'right' ? s.since : null;
    const fault = pullOutLooks(m, time, signalOnSince, s.mirrorBeforeSignal[m.index] ?? null, snap.lastChecked, params.observation);
    if (fault) faults.push(fault);
  }
  return faults;
}

function isApproachSignal(m: Maneuver, zone: Zone): boolean {
  return zone.kind === 'signal' && zone.maneuver === m.index && zone.side === m.signal && zone.from < m.start + EPSILON;
}

/** Roundabouts, except the first exit: the left signal zone from passing the exit before to leaving. */
export function exitZoneOf(route: Route, m: Maneuver): Zone | undefined {
  if (m.kind !== 'roundabout') return undefined;
  return route.zones.find((z) => z.kind === 'signal' && z.maneuver === m.index && z.from > m.start + EPSILON);
}

/** The first indicator a manoeuvre needs, and where. */
function firstSignalOf(route: Route, m: Maneuver): { side: Side; from: number } | null {
  const zone = route.zones.find((z) => z.kind === 'signal' && z.maneuver === m.index);
  return zone?.side ? { side: zone.side, from: zone.from } : null;
}

