import type { RulesParams } from '../config';
import type { RouteEvent } from '../route/tracker';
import { giveWayTooFast, missedStop, rollingStop } from './faults';
import type { FaultDraft, RulesSnapshot } from './types';

// Stop and Give Way lines. Stop: the car must stand still with its front just before the line.
// Give Way (no traffic yet): the car must slow down enough to look both ways before the line.

export interface JunctionState {
  /** Per line zone of the current route: the slowest the car went (m/s) with its front in the window before the line. */
  slowest: Readonly<Record<number, number>>;
}

export function createJunctionState(): JunctionState {
  return { slowest: {} };
}

export function stepJunctions(
  state: JunctionState,
  snap: RulesSnapshot,
  events: readonly RouteEvent[],
  params: RulesParams['junction'],
  frontOffset: number,
): { state: JunctionState; faults: FaultDraft[] } {
  const faults: FaultDraft[] = [];
  const slowest = { ...state.slowest };
  const speed = Math.abs(snap.speed);
  const front = snap.progress + frontOffset;
  if (!snap.offRoute) {
    for (const zone of snap.route.zones) {
      if (zone.kind !== 'stopLine' && zone.kind !== 'giveWayLine') continue;
      const window = zone.kind === 'stopLine' ? params.stopWindow : params.giveWayWindow;
      const ahead = zone.from - front;
      if (ahead >= 0 && ahead <= window) slowest[zone.id] = Math.min(slowest[zone.id] ?? Infinity, speed);
    }
  }

  for (const event of events) {
    if (event.type !== 'lineCrossed') continue;
    const { zone } = event;
    const m = snap.route.maneuvers[zone.maneuver];
    if (!m) continue;
    const kmh = Math.min(slowest[zone.id] ?? Infinity, speed) * 3.6;
    if (zone.kind === 'stopLine') {
      if (kmh > params.rollingStopKmh) faults.push(missedStop(m));
      else if (kmh > params.stopSpeedKmh) faults.push(rollingStop(m));
    } else if (zone.kind === 'giveWayLine' && kmh > params.giveWayKmh) {
      faults.push(giveWayTooFast(m, kmh));
    }
  }
  return { state: { slowest }, faults };
}
