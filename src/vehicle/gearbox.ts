import { CONFIG, type VehicleParams } from '../config';
import { clamp } from '../util/math';

// Automatic gearbox: which gear changes are allowed, and how hard the engine pushes the car.
// Pure logic, no Three.js.

export type Gear = 'P' | 'R' | 'N' | 'D';

export const GEARS: readonly Gear[] = ['P', 'R', 'N', 'D'];

/** Why a gear change was refused. */
export type ShiftRefusal = 'engineOff' | 'brakeRequired' | 'stopRequired';

export interface ShiftConditions {
  /** Signed speed along the car's heading, m/s. */
  speed: number;
  brakePressed: boolean;
  engineOn: boolean;
}

/**
 * Checks a gear change the way a real automatic does. Returns null when it is allowed.
 * - Leaving P needs the engine running and the brake pressed (the "shift lock").
 * - P needs the car stopped; R cannot be selected while rolling forwards, D while rolling backwards.
 * - N can be selected at any time.
 */
export function shiftRefusal(
  from: Gear,
  to: Gear,
  conditions: ShiftConditions,
  standstillSpeed: number = CONFIG.controls.standstillSpeed,
): ShiftRefusal | null {
  if (from === to) return null;
  if (from === 'P') {
    if (!conditions.engineOn) return 'engineOff';
    if (!conditions.brakePressed) return 'brakeRequired';
  }
  const { speed } = conditions;
  if (to === 'P' && Math.abs(speed) > standstillSpeed) return 'stopRequired';
  if (to === 'R' && speed > standstillSpeed) return 'stopRequired';
  if (to === 'D' && speed < -standstillSpeed) return 'stopRequired';
  return null;
}

/**
 * Acceleration the engine gives the car along its heading (m/s², signed), before brakes and resistance.
 *
 * - Engine off, P or N: nothing.
 * - D / R with the accelerator released: the idling engine "creeps" the car up to creep speed
 *   and gently holds it back (engine braking) above that.
 * - Accelerator pressed: blends from idle towards full power, which fades out at top speed.
 */
export function driveAcceleration(
  gear: Gear,
  engineOn: boolean,
  throttle: number,
  speed: number,
  params: VehicleParams = CONFIG.vehicle,
): number {
  if (!engineOn || (gear !== 'D' && gear !== 'R')) return 0;

  const direction = gear === 'D' ? 1 : -1;
  const topSpeed = gear === 'D' ? params.maxForwardSpeed : params.maxReverseSpeed;
  // Speed in the direction this gear drives (negative if the car rolls the other way).
  const v = speed * direction;

  const power = params.acceleration * Math.max(0, 1 - (Math.max(0, v) / topSpeed) ** 2);
  // At exactly creep speed the idle push equals rolling resistance, so the car settles at creepSpeed.
  const maxIdle = params.rollingDeceleration + params.creepAcceleration;
  const idle = clamp(
    params.rollingDeceleration + params.creepAcceleration * (1 - v / params.creepSpeed),
    -params.engineBraking,
    maxIdle,
  );

  const t = clamp(throttle, 0, 1);
  return direction * (t * power + (1 - t) * idle);
}
