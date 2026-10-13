import type * as THREE from 'three';
import { driverEye } from '../camera/firstPersonCamera';
import { aimMirror, type MirrorAim, type MirrorAims, type MirrorId } from '../camera/mirrorOptics';
import { CONFIG, type CabinParams, type CockpitParams, type MirrorSpec } from '../config';
import { clamp } from '../util/math';
import { createRandom } from '../util/random';
import { ADJUST_ITEMS, type AdjustItem, type CockpitReadiness } from './cockpitTypes';

// The cockpit drill's adjustable parts: the seat (moves the driver's eye) and the angle of each
// mirror glass. Rendering-free maths (Three.js vectors only), so it can be tested without a browser.
//
// At the start of a drive the seat and the mirrors are off by a random amount (the same for the
// same seed): the driver has to adjust them. The seat is right at the cabin's eye point; a mirror
// is right when its glass is close to the angle that shows its view (CONFIG.mirrors) from the eye
// where it is now, so moving the seat can put the mirrors out again, like in a real car.

/** Seat offset from the right position, metres: +forward, +up. */
export interface Seat {
  forward: number;
  height: number;
}

export interface Cockpit {
  seat: Seat;
  aims: MirrorAims;
}


/** Arrow keys held while adjusting. */
export interface AdjustKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}


type MirrorSpecs = Readonly<Record<MirrorId, MirrorSpec>>;

export function eyeFor(seat: Seat, cabin: CabinParams = CONFIG.cabin): THREE.Vector3 {
  const eye = driverEye(cabin);
  eye.y += seat.height;
  eye.z += seat.forward;
  return eye;
}

/** Seat and mirrors all set right. */
export function adjustedCockpit(specs: MirrorSpecs = CONFIG.mirrors): Cockpit {
  const seat = { forward: 0, height: 0 };
  const eye = eyeFor(seat);
  return { seat, aims: idealAims(eye, specs) };
}

function idealAims(eye: THREE.Vector3, specs: MirrorSpecs): MirrorAims {
  return { interior: aimMirror(specs.interior, eye), left: aimMirror(specs.left, eye), right: aimMirror(specs.right, eye) };
}

/** Seat and mirrors off by random amounts, the same for the same seed. */
export function misadjustedCockpit(
  seed: string,
  params: CockpitParams = CONFIG.cockpit,
  specs: MirrorSpecs = CONFIG.mirrors,
): Cockpit {
  const random = createRandom(`${seed}/cockpit`);
  const sign = (): number => (random.chance(0.5) ? 1 : -1);
  const off = (range: number): number => sign() * random.range(params.seatMisadjustMin, range);
  // The seat is off in one direction or both.
  const which = random.int(0, 2);
  const seat = {
    forward: which !== 1 ? off(params.seatForwardRange) : 0,
    height: which !== 0 ? off(params.seatHeightRange) : 0,
  };
  const right = idealAims(eyeFor({ forward: 0, height: 0 }), specs);
  const turned = (aim: MirrorAim): MirrorAim => {
    const angle = random.range(params.mirrorMisadjustMin, params.mirrorMisadjustMax);
    const direction = random.range(0, Math.PI * 2);
    return { yaw: aim.yaw + angle * Math.cos(direction), pitch: aim.pitch + angle * Math.sin(direction) };
  };
  return { seat, aims: { interior: turned(right.interior), left: turned(right.left), right: turned(right.right) } };
}

/** How far a mirror is from its right angle, radians, for the current seat. */
export function mirrorError(cockpit: Cockpit, id: MirrorId, specs: MirrorSpecs = CONFIG.mirrors): MirrorAim {
  const ideal = aimMirror(specs[id], eyeFor(cockpit.seat));
  const aim = cockpit.aims[id];
  return { yaw: aim.yaw - ideal.yaw, pitch: aim.pitch - ideal.pitch };
}

export function readiness(
  cockpit: Cockpit,
  params: CockpitParams = CONFIG.cockpit,
  specs: MirrorSpecs = CONFIG.mirrors,
): CockpitReadiness {
  const { seat } = cockpit;
  const mirrorOk = (id: MirrorId): boolean => {
    const error = mirrorError(cockpit, id, specs);
    return Math.abs(error.yaw) <= params.mirrorTolerance && Math.abs(error.pitch) <= params.mirrorTolerance;
  };
  return {
    seat: Math.abs(seat.forward) <= params.seatTolerance && Math.abs(seat.height) <= params.seatTolerance,
    interior: mirrorOk('interior'),
    left: mirrorOk('left'),
    right: mirrorOk('right'),
  };
}

/**
 * One step of adjusting `item` with the arrow keys. Seat: ← back, → forward, ↑ up, ↓ down.
 * Mirror: ← / → turn the view left / right, ↑ / ↓ tilt it up / down.
 */
export function adjust(
  cockpit: Cockpit,
  item: AdjustItem,
  keys: AdjustKeys,
  dt: number,
  params: CockpitParams = CONFIG.cockpit,
  specs: MirrorSpecs = CONFIG.mirrors,
): Cockpit {
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const y = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  if (x === 0 && y === 0) return cockpit;
  if (item === 'seat') {
    const step = params.seatSpeed * dt;
    return {
      ...cockpit,
      seat: {
        forward: clamp(cockpit.seat.forward + x * step, -params.seatForwardRange, params.seatForwardRange),
        height: clamp(cockpit.seat.height + y * step, -params.seatHeightRange, params.seatHeightRange),
      },
    };
  }
  // The view in a mirror turns twice as fast as the glass, so the glass turns half the key's way.
  // +yaw turns the reflecting side of the glass towards the car's right, and the view with it.
  const step = (params.mirrorSpeed * dt) / 2;
  const centre = aimMirror(specs[item], eyeFor({ forward: 0, height: 0 }));
  const aim = cockpit.aims[item];
  const limit = (value: number, middle: number): number => clamp(value, middle - params.mirrorRange, middle + params.mirrorRange);
  const turned = { yaw: limit(aim.yaw + x * step, centre.yaw), pitch: limit(aim.pitch + y * step, centre.pitch) };
  return { ...cockpit, aims: { ...cockpit.aims, [item]: turned } };
}

export function nextAdjustItem(item: AdjustItem | null): AdjustItem {
  if (item === null) return 'seat';
  return ADJUST_ITEMS[(ADJUST_ITEMS.indexOf(item) + 1) % ADJUST_ITEMS.length] as AdjustItem;
}
