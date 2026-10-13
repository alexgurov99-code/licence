import { CONFIG, type MinimapParams } from '../config';
import type { Turn } from '../world/network';
import type { Maneuver, ManeuverKind } from './route';
import type { RouteTracker } from './tracker';

// What the satnav says: the next manoeuvre in words ("In 120 m turn left") and which picture to
// show next to it. Pure logic.

export type InstructionIcon = ManeuverKind | 'bend' | 'finish' | 'reroute';

export interface Instruction {
  icon: InstructionIcon;
  /** Roundabouts: which way the exit goes, and its number, for the picture. Bends: which way the road goes. */
  turn: Turn | null;
  exit: number | null;
  text: string;
}

export function currentInstruction(tracker: RouteTracker, params: MinimapParams = CONFIG.minimap): Instruction {
  if (tracker.arrived) return { icon: 'finish', turn: null, exit: null, text: 'Route complete' };
  if (tracker.offRoute) return { icon: 'reroute', turn: null, exit: null, text: 'Off the route: finding a way back…' };
  const { maneuvers } = tracker.route;
  let index = tracker.next;
  let m = maneuvers[index];
  if (!m) return { icon: 'finish', turn: null, exit: null, text: 'Route complete' };
  if (m.kind === 'pullOut') {
    if (!tracker.nextStarted) return { icon: 'pullOut', turn: null, exit: null, text: 'Pull out from the kerb when it is safe' };
    // Moving off: already say what comes next.
    index += 1;
    m = maneuvers[index];
    if (!m) return { icon: 'finish', turn: null, exit: null, text: 'Route complete' };
  }
  const started = index === tracker.next && tracker.nextStarted;
  const target = m.kind === 'pullOver' ? m.end : m.start;
  const away = target - tracker.progress;

  // A bend of the road before the manoeuvre looks like a turn on the map: say it first.
  const bend = started
    ? undefined
    : tracker.route.bends.find(
        (b) => b.to > tracker.progress && b.from - tracker.progress < params.bendAnnounceDistance && b.to <= m.start,
      );
  if (bend) {
    const toBend = bend.from - tracker.progress;
    let text =
      toBend <= 0
        ? `Follow the road round to the ${bend.side}`
        : toBend > params.nowDistance
          ? `In ${roundDistance(toBend, params)} m the road bends ${bend.side}`
          : `The road bends ${bend.side}`;
    if (m.kind !== 'pullOver' && m.start - bend.to < params.thenDistance) text += `, then ${phrase(m, false)}`;
    return { icon: 'bend', turn: bend.side, exit: null, text };
  }

  let text = phrase(m, started);
  text = !started && away > params.nowDistance ? `In ${roundDistance(away, params)} m ${text}` : capitalise(text);
  const after = maneuvers[index + 1];
  if (after && after.kind !== 'pullOver' && after.start - m.end < params.thenDistance) text += `, then ${phrase(after, false)}`;
  return { icon: m.kind, turn: m.turn, exit: m.exit, text };
}

function phrase(m: Maneuver, started: boolean): string {
  switch (m.kind) {
    case 'pullOut':
      return 'pull out from the kerb';
    case 'left':
      return 'turn left';
    case 'right':
      return 'turn right';
    case 'straight':
      return 'go straight on';
    case 'roundabout':
      return `${started ? '' : 'at the roundabout '}take the ${ordinal(m.exit ?? 1)} exit`;
    case 'pullOver':
      return 'pull over on the left and stop';
  }
}

/** Rounded like a satnav: to 10 m, and to 50 m from 300 m on. */
export function roundDistance(metres: number, params: MinimapParams = CONFIG.minimap): number {
  const step = metres >= params.coarseFrom ? params.coarseStep : params.distanceStep;
  return Math.max(step, Math.round(metres / step) * step);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
