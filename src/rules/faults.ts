import type { Maneuver, Side } from '../route/route';
import type { MirrorName } from '../vehicle/cockpitTypes';
import { ordinal } from '../route/instructions';
import type { FaultDraft } from './types';

// What each fault says: what happened and how it would have been right. Shown on screen during
// the drive and on the results screen.

/** "the left turn", "the roundabout", "pulling out"... */
export function maneuverPhrase(m: Maneuver): string {
  switch (m.kind) {
    case 'pullOut':
      return 'pulling out';
    case 'pullOver':
      return 'pulling over';
    case 'left':
      return 'the left turn';
    case 'right':
      return 'the right turn';
    case 'straight':
      return 'going straight through the junction';
    case 'roundabout':
      return 'the roundabout';
  }
}

/** "Left turn", "Roundabout, 2nd exit", "Pulling out"...: a heading for the results screen. */
export function maneuverName(m: Maneuver): string {
  switch (m.kind) {
    case 'pullOut':
      return 'Pulling out';
    case 'pullOver':
      return 'Pulling over';
    case 'left':
      return 'Left turn';
    case 'right':
      return 'Right turn';
    case 'straight':
      return 'Straight through';
    case 'roundabout':
      return `Roundabout, ${ordinal(m.exit ?? 1)} exit`;
  }
}

export function noSignal(m: Maneuver, side: Side): FaultDraft {
  return {
    kind: 'noSignal',
    severity: 'critical',
    maneuver: m.index,
    what: `No ${side} indicator for ${maneuverPhrase(m)}.`,
    correct: `Indicate ${side} for at least 3 seconds before ${maneuverPhrase(m)}.`,
  };
}

export function noExitSignal(m: Maneuver): FaultDraft {
  return {
    kind: 'noSignal',
    severity: 'critical',
    maneuver: m.index,
    what: 'No left indicator when leaving the roundabout.',
    correct: 'Indicate left once you pass the exit before yours.',
  };
}

export function wrongSignal(m: Maneuver, side: Side, given: Side): FaultDraft {
  return {
    kind: 'wrongSignal',
    severity: 'critical',
    maneuver: m.index,
    what: `Indicated ${given} instead of ${side} for ${maneuverPhrase(m)}.`,
    correct: `Indicate ${side} for at least 3 seconds before ${maneuverPhrase(m)}.`,
  };
}

export function lateSignal(m: Maneuver, side: Side, seconds: number): FaultDraft {
  return {
    kind: 'lateSignal',
    severity: 'minor',
    maneuver: m.index,
    what: `The ${side} indicator went on only ${seconds.toFixed(1)} s before ${maneuverPhrase(m)}.`,
    correct: `Indicate for at least 3 seconds before ${maneuverPhrase(m)}.`,
  };
}

export function lateExitSignal(m: Maneuver): FaultDraft {
  return {
    kind: 'lateSignal',
    severity: 'minor',
    maneuver: m.index,
    what: 'The left indicator went on late when leaving the roundabout.',
    correct: 'Indicate left as soon as you pass the exit before yours.',
  };
}

export function earlySignal(m: Maneuver, side: Side, previous: Maneuver): FaultDraft {
  return {
    kind: 'earlySignal',
    severity: 'minor',
    maneuver: m.index,
    what: `Indicated ${side} for ${maneuverPhrase(m)} before ${maneuverPhrase(previous)} was over.`,
    correct: 'Indicate after the previous junction, so other road users are not misled.',
  };
}

export function unneededSignal(m: Maneuver, given: Side): FaultDraft {
  return {
    kind: 'unneededSignal',
    severity: 'minor',
    maneuver: m.index,
    what: `Indicated ${given} on the approach when going straight on.`,
    correct:
      m.kind === 'roundabout'
        ? 'Going straight on at a roundabout: no signal on the approach, indicate left after passing the exit before yours.'
        : 'Going straight through a junction needs no signal.',
  };
}

export function signalNotCancelled(m: Maneuver): FaultDraft {
  return {
    kind: 'signalNotCancelled',
    severity: 'minor',
    maneuver: m.index,
    what: `The indicator was still on after ${maneuverPhrase(m)}.`,
    correct: 'Cancel the indicator once the manoeuvre is done.',
  };
}

export function noMirrorCheck(m: Maneuver, side: Side): FaultDraft {
  return {
    kind: 'noMirrorCheck',
    severity: 'minor',
    maneuver: m.index,
    what: `No mirror check before indicating ${side} for ${maneuverPhrase(m)}.`,
    correct: `Look in the rear-view or ${side} mirror (hold it until the frame turns green) just before you indicate.`,
  };
}

export function noShoulderCheck(m: Maneuver): FaultDraft {
  return {
    kind: 'noShoulderCheck',
    severity: 'minor',
    maneuver: m.index,
    what: 'No look over the right shoulder just before moving off.',
    correct: 'Mirrors, signal, then look over your right shoulder for the blind spot and move off.',
  };
}

export function noObservation(m: Maneuver): FaultDraft {
  return {
    kind: 'noObservation',
    severity: 'critical',
    maneuver: m.index,
    what: 'Moved off without checking the mirrors or over the shoulder.',
    correct: 'Mirrors, signal, then look over your right shoulder for the blind spot and move off.',
  };
}

export function missedStop(m: Maneuver): FaultDraft {
  return {
    kind: 'missedStop',
    severity: 'immediateFail',
    maneuver: m.index,
    what: 'Did not stop at the Stop sign.',
    correct: 'Come to a complete stop at the Stop line, then go when it is clear.',
  };
}

export function rollingStop(m: Maneuver): FaultDraft {
  return {
    kind: 'rollingStop',
    severity: 'critical',
    maneuver: m.index,
    what: 'Rolled over the Stop line without stopping completely.',
    correct: 'Stop completely (the car must stand still) at the Stop line.',
  };
}

export function giveWayTooFast(m: Maneuver, kmh: number): FaultDraft {
  return {
    kind: 'giveWayTooFast',
    severity: 'minor',
    maneuver: m.index,
    what: `Came up to the Give Way line at ${Math.round(kmh)} km/h.`,
    correct:
      m.kind === 'roundabout'
        ? 'Slow down approaching the roundabout to look and give way to traffic from your right.'
        : 'Slow down approaching a Give Way so you can look both ways and give way.',
  };
}

export function speeding(severity: FaultDraft['severity'], kmh: number, limit: number, episode: string): FaultDraft {
  return {
    kind: 'speeding',
    severity,
    maneuver: null,
    what: `${Math.round(kmh)} km/h where the limit is ${limit} km/h.`,
    correct: `Keep to ${limit} km/h or less.`,
    episode,
  };
}

export function tooSlow(kmh: number, limit: number): FaultDraft {
  return {
    kind: 'tooSlow',
    severity: 'minor',
    maneuver: null,
    what: `${Math.round(kmh)} km/h in a ${limit} km/h zone for no reason.`,
    correct: 'Keep up with the traffic and the speed limit when the road is clear.',
  };
}

export function keepLeft(): FaultDraft {
  return {
    kind: 'keepLeft',
    severity: 'minor',
    maneuver: null,
    what: 'Drove too far right in the lane.',
    correct: 'Keep to the left of your lane.',
  };
}

export function centreLine(): FaultDraft {
  return {
    kind: 'centreLine',
    severity: 'minor',
    maneuver: null,
    what: 'The car went over the centre line.',
    correct: 'Stay left of the centre line.',
  };
}

export function wrongSide(): FaultDraft {
  return {
    kind: 'wrongSide',
    severity: 'critical',
    maneuver: null,
    what: 'Drove on the wrong side of the road.',
    correct: 'Keep to the left side of the road.',
  };
}

export function cutCorner(m: Maneuver): FaultDraft {
  return {
    kind: 'cutCorner',
    severity: 'minor',
    maneuver: m.index,
    what: `Cut the corner on ${maneuverPhrase(m)}.`,
    correct:
      m.kind === 'right'
        ? 'Turning right, go round the middle of the junction and into the left lane of the new road.'
        : 'Turning left, follow the kerb round the corner instead of cutting across.',
  };
}

const MIRROR_NAMES: Record<MirrorName, string> = { interior: 'rear-view', left: 'left', right: 'right' };

export function noBelt(): FaultDraft {
  return {
    kind: 'noBelt',
    severity: 'critical',
    maneuver: null,
    what: 'Drove without the seat belt fastened.',
    correct: 'Fasten the seat belt before starting the engine.',
  };
}

export function seatNotAdjusted(): FaultDraft {
  return {
    kind: 'seatNotAdjusted',
    severity: 'minor',
    maneuver: null,
    what: 'Moved off without adjusting the seat.',
    correct: 'Adjust the seat before the drive, while the car is parked.',
  };
}

export function mirrorsNotAdjusted(mirrors: readonly MirrorName[]): FaultDraft {
  const names = mirrors.map((id) => MIRROR_NAMES[id]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return {
    kind: 'mirrorsNotAdjusted',
    severity: 'minor',
    maneuver: null,
    what: `Moved off with the ${list} mirror${names.length > 1 ? 's' : ''} not adjusted.`,
    correct: 'Adjust all three mirrors after the seat, before starting the engine.',
  };
}

export function adjustedWhileMoving(): FaultDraft {
  return {
    kind: 'adjustedWhileMoving',
    severity: 'minor',
    maneuver: null,
    what: 'Adjusted the seat or a mirror while driving.',
    correct: 'Adjust the seat and mirrors only while the car is parked.',
  };
}

export function drillOrder(): FaultDraft {
  return {
    kind: 'drillOrder',
    severity: 'minor',
    maneuver: null,
    what: 'Started the engine before the cockpit drill was done.',
    correct: 'Seat, mirrors and seat belt first, then start the engine.',
  };
}

export function notSecured(m: Maneuver): FaultDraft {
  return {
    kind: 'notSecured',
    severity: 'minor',
    maneuver: m.index,
    what: 'Did not secure the car after pulling over.',
    correct: 'Once stopped at the kerb, apply the handbrake and select P.',
  };
}
