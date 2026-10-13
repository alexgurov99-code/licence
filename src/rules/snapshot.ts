import type { GlanceState } from '../camera/glance';
import type { RouteTracker } from '../route/tracker';
import type { CarState } from '../vehicle/car';
import { COCKPIT_READY, type CockpitReadiness } from '../vehicle/cockpitTypes';
import type { Whereabouts } from '../world/locate';
import type { RulesSnapshot } from './types';

// Builds the rules engine's snapshot from the car, the glances, the route tracker and where the
// car is on the road network. Pure logic.

export function rulesSnapshot(
  time: number,
  car: CarState,
  glance: GlanceState,
  tracker: RouteTracker,
  where: Whereabouts,
  cockpit: { readiness: CockpitReadiness; adjusting: boolean } = { readiness: COCKPIT_READY, adjusting: false },
): RulesSnapshot {
  const { motion, controls } = car;
  const { indicators } = controls;
  return {
    time,
    position: { x: motion.x, z: motion.z },
    speed: motion.speed,
    gear: controls.gear,
    handbrake: controls.handbrake,
    engineOn: controls.engineOn,
    beltFastened: controls.beltFastened,
    cockpit: cockpit.readiness,
    adjusting: cockpit.adjusting,
    // With the hazard lights on, both sides flash: that is not a signal to turn.
    indicator: indicators.hazard ? null : indicators.lever,
    lastChecked: glance.lastChecked,
    route: tracker.route,
    progress: tracker.progress,
    routeOffset: tracker.offset,
    offRoute: tracker.offRoute,
    next: tracker.next,
    nextStarted: tracker.nextStarted,
    arrived: tracker.arrived,
    road: where.kind === 'road' ? { place: where.place, laneOffset: where.offset, speedLimit: where.speedLimit } : null,
    inJunction: where.kind === 'junction',
  };
}
