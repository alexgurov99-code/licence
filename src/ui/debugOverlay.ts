import type { GlanceEvent, GlanceState, GlanceTarget } from '../camera/glance';
import { CONFIG } from '../config';
import { keyLabel } from '../input/keymap';
import type { Maneuver, Zone } from '../route/route';
import type { RouteEvent, RouteTracker } from '../route/tracker';
import type { RulesState } from '../rules/engine';
import { LEARNER, type TrafficState } from '../traffic/traffic';
import type { TrafficView } from '../traffic/types';
import { summarizeFaults, type Fault, type Severity } from '../rules/types';
import type { CarState } from '../vehicle/car';
import type { ControlEvent } from '../vehicle/carControls';
import type { Whereabouts } from '../world/locate';
import type { RoadNetwork } from '../world/network';
import type { Scenery } from '../world/scenery';

export interface DebugInfo {
  fps: number;
  seed: string | null;
  /** One line about the town (see describeMap). */
  map: string;
  /** Where the car is on the road network. */
  location: Whereabouts;
  view: string;
  /** Simulation time, seconds. */
  simTime: number;
  car: CarState;
  glance: GlanceState;
  route: RouteTracker;
  rules: RulesState;
  traffic: TrafficState;
  trafficView: TrafficView;
  /** Seat and mirror adjustment (see ui/adjustPanel describeCockpit). */
  cockpit: string;
  /** Newest last. */
  recentEvents: readonly string[];
  drawCalls: number;
  triangles: number;
}

/** Developer panel in the top-left corner. Hidden by default, toggled with the debug key. */
export class DebugOverlay {
  private readonly element: HTMLPreElement;
  private visible = false;
  private sinceRefresh = Infinity;

  constructor(
    parent: HTMLElement,
    private readonly refreshIntervalSeconds: number,
  ) {
    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
    this.sinceRefresh = Infinity;
  }

  update(frameSeconds: number, info: DebugInfo): void {
    if (!this.visible) return;
    this.sinceRefresh += frameSeconds;
    if (this.sinceRefresh < this.refreshIntervalSeconds) return;
    this.sinceRefresh = 0;
    this.element.textContent = formatDebugInfo(info);
  }
}

export function formatDebugInfo(info: DebugInfo): string {
  const { motion: v, controls: c } = info.car;
  const headingDeg = (((v.heading * 180) / Math.PI) + 360) % 360;
  const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
  const onOff = (value: boolean): string => (value ? 'on' : 'off');
  const indicator = c.indicators.lever ?? 'off';
  return [
    `FPS      ${info.fps.toFixed(0)}`,
    `seed     ${info.seed ?? '-'}   (${keyLabel('newMap')}: new map)`,
    `map      ${info.map}`,
    `where    ${formatLocation(info.location)}`,
    `view     ${info.view}`,
    `speed    ${(v.speed * 3.6).toFixed(1)} km/h`,
    `pos      x ${v.x.toFixed(1)}  z ${v.z.toFixed(1)} m`,
    `heading  ${headingDeg.toFixed(0)} deg`,
    `steer    ${percent(v.steer)}`,
    `pedals   gas ${percent(c.throttle)}  brake ${percent(c.brake)}`,
    `gear     ${c.gear}   engine ${onOff(c.engineOn)}`,
    `handbr.  ${onOff(c.handbrake)}   belt ${c.beltFastened ? 'fastened' : 'off'}`,
    `indic.   ${indicator}   hazard ${onOff(c.indicators.hazard)}`,
    `cockpit  ${info.cockpit}`,
    ...formatGlance(info.glance, info.simTime),
    ...formatRoute(info.route),
    ...formatRules(info.rules, info.simTime),
    ...formatTraffic(info.traffic, info.trafficView),
    `draws    ${info.drawCalls}  tris ${info.triangles}`,
    'events',
    ...info.recentEvents.map((line) => `  ${line}`),
  ].join('\n');
}

/** Road / lane / offset from the middle of the lane / speed limit, or the junction the car is in. */
export function formatLocation(where: Whereabouts): string {
  switch (where.kind) {
    case 'road': {
      const size = Math.abs(where.offset);
      const offset = size < 0.005 ? 'centred' : `${size.toFixed(2)} m ${where.offset > 0 ? 'left' : 'right'}`;
      const place = where.place === 'shoulder' ? ' (shoulder)' : where.place === 'oncoming' ? ' (ONCOMING SIDE)' : '';
      return `road ${where.roadId} ${where.roadClass} / lane ${where.laneId} / ${offset}${place} / ${where.speedLimit} km/h`;
    }
    case 'junction':
      return `junction ${where.junctionId} (${where.junctionKind})`;
    case 'offRoad':
      return 'off road';
  }
}

/** Junction counts and size of the town, e.g. "T 7 / cross 3 / roundabout 2 / 16 roads / 120 houses". */
export function describeMap(network: RoadNetwork, scenery?: Scenery): string {
  const count = (kind: string): number => network.junctions.filter((j) => j.kind === kind).length;
  const retried = network.layout.attempt > 0 ? ` (retry ${network.layout.attempt})` : '';
  const houses = scenery ? ` / ${scenery.items.filter((i) => i.kind === 'section').length} houses` : '';
  return `T ${count('tee')} / cross ${count('cross')} / roundabout ${count('roundabout')} / ${network.roads.length} roads${houses}${retried}`;
}

/** One-line description of a control event for the debug panel. */
export function describeEvent(event: ControlEvent): string {
  switch (event.type) {
    case 'engineStarted':
      return 'engine started';
    case 'engineStopped':
      return 'engine stopped';
    case 'engineStartRefused':
      return `engine start refused (${event.reason})`;
    case 'engineStopRefused':
      return `engine stop refused (${event.reason})`;
    case 'beltFastened':
      return 'belt fastened';
    case 'beltUnfastened':
      return 'belt unfastened';
    case 'handbrakeApplied':
      return 'handbrake on';
    case 'handbrakeReleased':
      return 'handbrake off';
    case 'gearSelected':
      return `gear ${event.previous} -> ${event.gear}`;
    case 'gearRefused':
      return `gear ${event.gear} refused (${event.reason})`;
    case 'indicatorOn':
      return `indicator ${event.side} on`;
    case 'indicatorOff':
      return `indicator ${event.side} off`;
    case 'hazardOn':
      return 'hazards on';
    case 'hazardOff':
      return 'hazards off';
  }
}

const GLANCE_NAMES: Record<GlanceTarget, string> = {
  interiorMirror: 'rear-view mirror',
  leftMirror: 'left mirror',
  rightMirror: 'right mirror',
  back: 'look back',
  leftShoulder: 'left shoulder',
  rightShoulder: 'right shoulder',
};

/** The current glance and how long ago each check was last done. */
export function formatGlance(glance: GlanceState, simTime: number): string[] {
  const ago = (target: GlanceTarget): string => {
    const time = glance.lastChecked[target];
    return time === null ? '-' : `${(simTime - time).toFixed(1)}s`;
  };
  const current = glance.target
    ? `${GLANCE_NAMES[glance.target]} ${glance.seconds.toFixed(1)}s${glance.counted ? ' (counted)' : ''}`
    : '-';
  return [
    `glance   ${current}`,
    `checked  (seconds ago)`,
    `  mirror   rear ${ago('interiorMirror')}  L ${ago('leftMirror')}  R ${ago('rightMirror')}`,
    `  shoulder L ${ago('leftShoulder')}  R ${ago('rightShoulder')}  back ${ago('back')}`,
  ];
}

/** One-line description of a glance event for the debug panel, or null if not worth listing. */
export function describeGlanceEvent(event: GlanceEvent): string | null {
  switch (event.type) {
    case 'glanceCounted':
      return `${GLANCE_NAMES[event.target]} check counted`;
    case 'glanceEnded':
      return event.counted ? null : `${GLANCE_NAMES[event.target]} too short (${event.seconds.toFixed(1)}s)`;
    case 'glanceStarted':
      return null;
  }
}

/** The next manoeuvre, progress along the route and the zones the car is in. */
export function formatRoute(tracker: RouteTracker): string[] {
  const { route } = tracker;
  const total = tracker.completed + route.maneuvers.length - tracker.next;
  const m = route.maneuvers[tracker.next];
  let next = 'arrived';
  if (tracker.offRoute) next = 'OFF ROUTE (waiting to be on a road)';
  else if (m) {
    const target = m.kind === 'pullOver' ? m.end : m.start;
    const where = tracker.nextStarted
      ? 'now'
      : m.kind === 'pullOut'
        ? '(parked)'
        : `in ${Math.max(0, target - tracker.progress).toFixed(0)} m`;
    next = `${tracker.completed + 1}/${total} ${maneuverName(m)} ${where}`;
  }
  const side = tracker.offset >= 0 ? 'L' : 'R';
  const zones = tracker.inside.map((id) => route.zones[id]).filter((z): z is Zone => !!z);
  return [
    `route    ${next}`,
    `         ${tracker.progress.toFixed(0)} / ${route.finishS.toFixed(0)} m · ${Math.abs(tracker.offset).toFixed(1)} m ${side} of line · reroutes ${tracker.reroutes}`,
    `zones    ${zones.length > 0 ? zones.map(zoneName).join(', ') : '-'}`,
  ];
}

export function maneuverName(m: Maneuver): string {
  const sign = m.control === 'stop' ? ' (Stop)' : m.control === 'giveWay' ? ' (Give Way)' : '';
  switch (m.kind) {
    case 'pullOut':
      return 'pull out';
    case 'pullOver':
      return 'pull over';
    case 'straight':
      return `straight on${sign}`;
    case 'roundabout':
      return `roundabout exit ${m.exit} (${m.turn === 'uTurn' ? 'U-turn' : m.turn})`;
    default:
      return `${m.kind} turn${sign}`;
  }
}

function zoneName(zone: Zone): string {
  switch (zone.kind) {
    case 'mirror':
      return 'mirror check';
    case 'signal':
      return `signal ${zone.side}`;
    case 'signalOff':
      return 'indicator-off line';
    case 'stopLine':
      return 'stop line';
    case 'giveWayLine':
      return 'give-way line';
    case 'stopBox':
      return 'stopping place';
  }
}

/** One-line description of a route event for the debug panel. */
export function describeRouteEvent(event: RouteEvent): string {
  switch (event.type) {
    case 'zoneEntered':
      return `in: ${zoneName(event.zone)} (#${event.zone.maneuver})`;
    case 'zoneLeft':
      return `out: ${zoneName(event.zone)} (#${event.zone.maneuver})`;
    case 'lineCrossed':
      return `crossed ${zoneName(event.zone)} (#${event.zone.maneuver})`;
    case 'maneuverStarted':
      return `#${event.maneuver.index} ${maneuverName(event.maneuver)} started`;
    case 'maneuverCompleted':
      return `#${event.maneuver.index} ${maneuverName(event.maneuver)} done`;
    case 'leftRoute':
      return 'left the route';
    case 'rerouted':
      return `new route, ${event.route.maneuvers.length} manoeuvres`;
    case 'arrived':
      return 'arrived';
  }
}

const SEVERITY_NAMES: Record<Severity, string> = { immediateFail: 'IMMEDIATE FAIL', critical: 'CRITICAL', minor: 'minor' };

/** The faults so far, what the rules engine is waiting on, and the latest faults. */
export function formatRules(rules: RulesState, simTime: number, maxCriticalErrors: number = CONFIG.rules.maxCriticalErrors): string[] {
  const summary = summarizeFaults(rules.faults, maxCriticalErrors);
  const { signals, speed } = rules;
  const indicator = signals.side ? `${signals.side} on ${(simTime - signals.since).toFixed(1)}s` : 'off';
  const limit = speed.limit === null ? '-' : `${speed.limit}${speed.dropSince !== null ? ' (dropping)' : ''}`;
  const mirrors = Object.entries(signals.mirrorBeforeSignal).map(([m, ok]) => `#${m} ${ok ? 'ok' : 'NO'}`);
  return [
    `rules    ${summary.passed ? 'PASS' : 'FAIL'} · fail ${summary.immediateFail} / critical ${summary.critical} / minor ${summary.minor}${rules.finished ? ' · finished' : ''}`,
    `         indicator ${indicator} · limit ${limit} · mirror before signal ${mirrors.length > 0 ? mirrors.slice(-3).join(' ') : '-'}`,
    ...rules.faults.slice(-3).map((f) => `  ${f.time.toFixed(1)}s ${describeFault(f)}`),
  ];
}

/** The other cars: how many, who is giving way to whom, and the cars whose way meets the learner's. */
export function formatTraffic(traffic: TrafficState, view: TrafficView): string[] {
  const who = (id: number): string => (id === LEARNER ? 'you' : `#${id}`);
  const waiting = traffic.cars.filter((c) => c.givingWayTo.length > 0).map((c) => `#${c.id}→${c.givingWayTo.map(who).join(',')}`);
  const conflicts = view.conflicts.map(
    (c) =>
      `#${c.carId} ${c.from} ${c.learnerGivesWay ? 'you give way' : 'has to wait'} (car ${c.carClear ? 'through' : `${c.carTo.toFixed(0)} m`}, you ${c.learnerClear ? 'through' : `${c.learnerTo.toFixed(0)} m`})`,
  );
  const ahead = view.ahead ? `#${view.ahead.carId} ${view.ahead.gap.toFixed(0)} m ahead` : 'none ahead';
  return [
    `traffic  ${traffic.cars.length} cars · ${ahead}${view.evasive.length > 0 ? ` · BRAKING FOR YOU: ${view.evasive.map(who).join(',')}` : ''}`,
    `         giving way: ${waiting.length > 0 ? waiting.slice(0, 6).join(' ') : '-'}`,
    ...conflicts.slice(0, 3).map((c) => `         ${c}`),
  ];
}

/** One-line description of a fault, e.g. "CRITICAL #3: No left indicator for the left turn." */
export function describeFault(fault: Fault): string {
  const where = fault.maneuver === null ? '' : ` #${fault.maneuver}`;
  return `${SEVERITY_NAMES[fault.severity]}${where}: ${fault.what}`;
}
