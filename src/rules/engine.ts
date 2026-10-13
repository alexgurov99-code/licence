import { CONFIG, type RulesParams } from '../config';
import type { Route } from '../route/route';
import type { RouteEvent } from '../route/tracker';
import { createJunctionState, stepJunctions, type JunctionState } from './junctions';
import { createPositionState, stepPosition, type PositionState } from './position';
import { createSignalState, signalStateForNewRoute, stepSignals, type SignalState } from './signals';
import { createSpeedState, stepSpeed, type SpeedState } from './speed';
import type { Fault, FaultDraft, RulesSnapshot } from './types';

// The rules engine. Every physics step it gets a snapshot of the car and the driver (see
// snapshot.ts) and the route events of that step, and returns the faults found. Pure logic, no
// Three.js: tests feed it recorded drives.

export interface RulesState {
  /** The route the zone checks belong to; a new one (after a wrong turn) resets them. */
  route: Route | null;
  /** All faults so far, oldest first. */
  faults: readonly Fault[];
  nextId: number;
  /** Fault id by episode, for faults that get replaced by a worse one (speeding). */
  episodes: Readonly<Record<string, number>>;
  signals: SignalState;
  junctions: JunctionState;
  speed: SpeedState;
  position: PositionState;
  /** The car has arrived: the drive is over and nothing more is judged. */
  finished: boolean;
}

export interface RulesOptions {
  params: RulesParams;
  minSignalSeconds: number;
  laneWidth: number;
  carWidth: number;
  /** From the middle of the car to its front bumper. */
  frontOffset: number;
}

const DEFAULT_OPTIONS: RulesOptions = {
  params: CONFIG.rules,
  minSignalSeconds: CONFIG.route.minSignalSeconds,
  laneWidth: CONFIG.world.laneWidth,
  carWidth: CONFIG.vehicle.width,
  frontOffset: CONFIG.vehicle.length / 2,
};

export function createRulesState(): RulesState {
  return {
    route: null,
    faults: [],
    nextId: 0,
    episodes: {},
    signals: createSignalState(),
    junctions: createJunctionState(),
    speed: createSpeedState(),
    position: createPositionState(),
    finished: false,
  };
}

/** One physics step. `faults` are the new ones (a worse speeding fault replaces the earlier one in `state.faults`). */
export function stepRules(
  state: RulesState,
  snap: RulesSnapshot,
  events: readonly RouteEvent[],
  options: RulesOptions = DEFAULT_OPTIONS,
): { state: RulesState; faults: Fault[] } {
  if (state.finished) return { state, faults: [] };
  const { params } = options;
  const newRoute = state.route !== snap.route;

  const signals = stepSignals(
    newRoute && state.route ? signalStateForNewRoute(state.signals) : state.signals,
    snap,
    events,
    params,
    options.minSignalSeconds,
  );
  const junctions = stepJunctions(newRoute ? createJunctionState() : state.junctions, snap, events, params.junction, options.frontOffset);
  const speed = stepSpeed(state.speed, snap, params.speed);
  const position = stepPosition(
    newRoute ? { ...state.position, cutCorners: [] } : state.position,
    snap,
    params.position,
    options,
  );

  const drafts: FaultDraft[] = [...signals.faults, ...junctions.faults, ...speed.faults, ...position.faults];
  let faults = state.faults;
  let nextId = state.nextId;
  let episodes = state.episodes;
  const added: Fault[] = [];
  for (const { episode, ...draft } of drafts) {
    const fault: Fault = { ...draft, id: nextId, time: snap.time, at: { ...snap.position } };
    nextId += 1;
    if (episode !== undefined) {
      const replaced = episodes[episode];
      if (replaced !== undefined) faults = faults.filter((f) => f.id !== replaced);
      episodes = { ...episodes, [episode]: fault.id };
    }
    faults = [...faults, fault];
    added.push(fault);
  }

  return {
    state: {
      route: snap.route,
      faults,
      nextId,
      episodes,
      signals: signals.state,
      junctions: junctions.state,
      speed: speed.state,
      position: position.state,
      finished: snap.arrived,
    },
    faults: added,
  };
}
