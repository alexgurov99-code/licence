// The driver's glances: into the mirrors, over a shoulder and straight back. Pure logic, no
// Three.js. The rules engine (stage 5) counts mirror and blind-spot checks from these events and
// from `lastChecked`, so a glance only counts once it has lasted long enough.
//
// Keys (held): ↑ rear-view mirror, ← left mirror, → right mirror, ↓ look back through the rear
// window, ↓ together with ← or → over that shoulder. If several are held, the newest press wins.

export type GlanceTarget = 'interiorMirror' | 'leftMirror' | 'rightMirror' | 'back' | 'leftShoulder' | 'rightShoulder';

export const GLANCE_TARGETS: readonly GlanceTarget[] = [
  'interiorMirror',
  'leftMirror',
  'rightMirror',
  'back',
  'leftShoulder',
  'rightShoulder',
];

export type LookTarget = Extract<GlanceTarget, 'back' | 'leftShoulder' | 'rightShoulder'>;

export function isLookTarget(target: GlanceTarget): target is LookTarget {
  return target === 'back' || target === 'leftShoulder' || target === 'rightShoulder';
}

export type GlanceKey = 'up' | 'down' | 'left' | 'right';
export type GlanceKeys = Readonly<Record<GlanceKey, boolean>>;

export const NO_GLANCE_KEYS: GlanceKeys = { up: false, down: false, left: false, right: false };

export interface GlanceState {
  /** Look keys being held, in the order they were pressed (newest last). */
  held: readonly GlanceKey[];
  target: GlanceTarget | null;
  /** How long the current glance has lasted, seconds. */
  seconds: number;
  /** The current glance has lasted long enough to count as a check. */
  counted: boolean;
  /** Simulation time of the last moment each check was being done (a counted glance), or null if never. */
  lastChecked: Readonly<Record<GlanceTarget, number | null>>;
}

export type GlanceEvent =
  | { type: 'glanceStarted'; target: GlanceTarget }
  | { type: 'glanceCounted'; target: GlanceTarget }
  | { type: 'glanceEnded'; target: GlanceTarget; seconds: number; counted: boolean };

export function createGlanceState(): GlanceState {
  return {
    held: [],
    target: null,
    seconds: 0,
    counted: false,
    lastChecked: {
      interiorMirror: null,
      leftMirror: null,
      rightMirror: null,
      back: null,
      leftShoulder: null,
      rightShoulder: null,
    },
  };
}

/** Order used when several keys go down in the same step. */
const KEY_ORDER: readonly GlanceKey[] = ['up', 'down', 'left', 'right'];

/** Keeps the press order: released keys drop out, newly pressed ones go to the end. */
export function updateHeldKeys(held: readonly GlanceKey[], keys: GlanceKeys): GlanceKey[] {
  const stillHeld = held.filter((key) => keys[key]);
  const newlyPressed = KEY_ORDER.filter((key) => keys[key] && !held.includes(key));
  return [...stillHeld, ...newlyPressed];
}

/** What the driver is looking at, given the held look keys in press order. */
export function glanceTarget(held: readonly GlanceKey[]): GlanceTarget | null {
  const newest = held[held.length - 1];
  if (newest === undefined) return null;
  if (newest === 'up') return 'interiorMirror';
  if (newest === 'down') {
    const side = [...held].reverse().find((key) => key === 'left' || key === 'right');
    if (side === 'left') return 'leftShoulder';
    if (side === 'right') return 'rightShoulder';
    return 'back';
  }
  if (held.includes('down')) return newest === 'left' ? 'leftShoulder' : 'rightShoulder';
  return newest === 'left' ? 'leftMirror' : 'rightMirror';
}

/** Allows for rounding when adding up fixed steps (30 × 1/60 s is not exactly 0.5 s). */
const TIME_EPSILON = 1e-9;

/** One simulation step. `now` is the simulation time at the end of the step. */
export function stepGlance(
  state: GlanceState,
  keys: GlanceKeys,
  now: number,
  dt: number,
  params: { minCheckSeconds: number },
): { state: GlanceState; events: GlanceEvent[] } {
  const events: GlanceEvent[] = [];
  const held = updateHeldKeys(state.held, keys);
  const target = glanceTarget(held);

  let { seconds, counted } = state;
  if (target !== state.target) {
    if (state.target) {
      events.push({ type: 'glanceEnded', target: state.target, seconds: state.seconds, counted: state.counted });
    }
    if (target) events.push({ type: 'glanceStarted', target });
    seconds = 0;
    counted = false;
  } else if (target) {
    seconds += dt;
  }

  let { lastChecked } = state;
  if (target) {
    if (!counted && seconds >= params.minCheckSeconds - TIME_EPSILON) {
      counted = true;
      events.push({ type: 'glanceCounted', target });
    }
    if (counted) lastChecked = { ...lastChecked, [target]: now };
  }

  return { state: { held, target, seconds, counted, lastChecked }, events };
}
