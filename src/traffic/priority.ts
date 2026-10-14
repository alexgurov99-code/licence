import { opposite, rightTurnOf, type Control, type Dir } from '../world/layout';
import type { JunctionKind, RoadNetwork, Turn } from '../world/network';

// Who gives way to whom at a junction, by the NZ Road Code (nzta.govt.nz/roadcode, "The give way
// rules", and the 2012 rule changes):
// - signs first: a driver facing a Stop or Give Way sign gives way to all traffic without one;
// - at a T without signs, the driver on the stem (the terminating road) gives way;
// - a driver turning gives way to all traffic not turning;
// - a driver turning right gives way to a driver coming the other way and turning left;
// - roundabouts: give way to traffic from the right: already on the roundabout, or about to come
//   onto it at the arm to the right;
// - when nothing else decides, give way to traffic coming from the right.
// Pure logic: the other cars drive by it and the rules engine judges the learner by it.

/** How a driver goes through a junction. */
export interface Movement {
  junctionKind: JunctionKind;
  /** The arm the driver arrives along (direction from the middle of the junction), and its sign. */
  arm: Dir;
  control: Control;
  turn: Turn;
  /** Roundabouts: already past the give-way line, on the circle. */
  onRing: boolean;
  /** T junctions: arriving along the stem. */
  fromStem: boolean;
}

const isTurning = (turn: Turn): boolean => turn !== 'straight';
const isSigned = (control: Control): boolean => control === 'stop' || control === 'giveWay';

/** Must the driver making movement `me` give way to the one making `other` (at the same junction, where their paths meet)? */
export function mustGiveWay(me: Movement, other: Movement): boolean {
  // On a roundabout traffic comes from the right: the car already on it, or the one arriving at the arm to the right.
  if (me.junctionKind === 'roundabout') return !me.onRing && (other.onRing || other.arm === rightTurnOf(opposite(me.arm)));
  if (me.arm === other.arm) return false;
  if (isSigned(me.control) !== isSigned(other.control)) return isSigned(me.control);
  if (me.junctionKind === 'tee' && me.fromStem !== other.fromStem) return me.fromStem;
  if (isTurning(me.turn) !== isTurning(other.turn)) return isTurning(me.turn);
  const facing = other.arm === opposite(me.arm);
  if (facing && me.turn === 'right' && other.turn === 'left') return true;
  if (facing && me.turn === 'left' && other.turn === 'right') return false;
  // Traffic from the right: it arrives along the arm to the right of the way the driver is going.
  return other.arm === rightTurnOf(opposite(me.arm));
}

/** The movement of a junction path, with whether the driver is past the give-way line yet. */
export function movementOf(network: RoadNetwork, connectorId: number, onRing: boolean): Movement {
  const connector = network.connectors[connectorId];
  const junction = connector && network.junctions[connector.junctionId];
  const arm = junction?.arms.find((a) => a.inLane === connector?.fromLane);
  if (!connector || !junction || !arm) throw new Error(`No junction path ${connectorId}`);
  return {
    junctionKind: junction.kind,
    arm: arm.dir,
    control: arm.control,
    turn: connector.turn,
    onRing,
    fromStem: junction.kind === 'tee' && !junction.arms.some((a) => a.dir === opposite(arm.dir)),
  };
}
