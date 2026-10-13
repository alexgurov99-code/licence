import { CONFIG, type VehicleParams } from '../config';
import { clamp, lerp, moveTowards, normalizeAngle } from '../util/math';
import { driveAcceleration, type Gear } from './gearbox';

export { normalizeAngle };

// Pure vehicle motion: no Three.js, no DOM. Same input sequence always gives the same result.
//
// Coordinates: ground is the X/Z plane, Y is up.
// heading = 0 means the car faces +Z; a positive heading change is a turn to the left
// (counter-clockwise when seen from above). Forward direction is (sin(heading), cos(heading)).

export interface VehicleState {
  /** Position of the car's centre on the ground, metres. */
  x: number;
  z: number;
  /** Radians, normalised to (-PI, PI]. */
  heading: number;
  /** Signed speed along the heading, m/s. Negative = moving backwards. */
  speed: number;
  /** Steering position from -1 (full right) to +1 (full left). Moves smoothly towards the input. */
  steer: number;
}

/** What the physics needs to know about the driver's controls. */
export interface VehicleControls {
  /** Accelerator pedal, 0..1. */
  throttle: number;
  /** Brake pedal, 0..1. */
  brake: number;
  handbrake: boolean;
  gear: Gear;
  engineOn: boolean;
  /** Steering keys: -1 right, 0 none, +1 left. */
  steerInput: number;
}

/** Engine off, in neutral, nothing pressed: the car just rolls. */
export const NO_CONTROLS: VehicleControls = {
  throttle: 0,
  brake: 0,
  handbrake: false,
  gear: 'N',
  engineOn: false,
  steerInput: 0,
};

export function createVehicleState(overrides: Partial<VehicleState> = {}): VehicleState {
  return { x: 0, z: 0, heading: 0, speed: 0, steer: 0, ...overrides };
}

export function stepVehicle(
  state: VehicleState,
  controls: VehicleControls,
  dt: number,
  params: VehicleParams = CONFIG.vehicle,
): VehicleState {
  const steer = stepSteering(state.steer, controls.steerInput, state.speed, dt, params);
  const speed = stepSpeed(state.speed, controls, dt, params);

  // Kinematic "bicycle" model: the car turns around a point on its rear axle line,
  // so it cannot rotate on the spot and turns tighter the more the wheels are turned.
  const averageSpeed = (state.speed + speed) / 2;
  const steerAngle = steer * params.maxSteerAngle;
  const curvature = limitCurvature(Math.tan(steerAngle) / params.wheelbase, averageSpeed, params);
  const headingChange = averageSpeed * curvature * dt;
  const midHeading = state.heading + headingChange / 2;

  return {
    x: state.x + Math.sin(midHeading) * averageSpeed * dt,
    z: state.z + Math.cos(midHeading) * averageSpeed * dt,
    heading: normalizeAngle(state.heading + headingChange),
    speed,
    steer,
  };
}

function stepSteering(current: number, input: number, speed: number, dt: number, params: VehicleParams): number {
  const target = clamp(input, -1, 1);
  const returningToCentre = target === 0 || (current !== 0 && Math.sign(target) !== Math.sign(current));
  const turnRate = params.steerRate / (1 + Math.abs(speed) / params.steerHalfRateSpeed);
  const rate = returningToCentre ? params.steerReturnRate : turnRate;
  return moveTowards(current, target, rate * dt);
}

/**
 * Turning tightness (1 / radius) is capped by tyre grip: sideways acceleration speed² / radius
 * cannot exceed the limit. At parking speeds the wheels decide; at road speeds grip does.
 */
function limitCurvature(curvature: number, speed: number, params: VehicleParams): number {
  const speedSquared = speed * speed;
  if (speedSquared < 1e-6) return curvature;
  const limit = params.maxLateralAcceleration / speedSquared;
  return clamp(curvature, -limit, limit);
}

function stepSpeed(speed: number, controls: VehicleControls, dt: number, params: VehicleParams): number {
  const throttle = clamp(controls.throttle, 0, 1);
  const brake = clamp(controls.brake, 0, 1);

  // The engine pushes in the gear's direction; brakes and resistance only ever slow the car
  // down towards zero and never push it the other way.
  const drive = driveAcceleration(controls.gear, controls.engineOn, throttle, speed, params);
  const braking =
    brake * params.brakeDeceleration +
    (controls.handbrake ? params.handbrakeDeceleration : 0) +
    (controls.gear === 'P' ? params.parkLockDeceleration : 0);
  const resistance = params.rollingDeceleration + params.airDrag * speed * speed;
  const slowed = moveTowards(speed + drive * dt, 0, (braking + resistance) * dt);

  return clamp(slowed, -params.maxReverseSpeed, params.maxForwardSpeed);
}

/** Pose blended between two physics steps, used only for drawing smoothly on fast monitors. */
export function interpolatePose(previous: VehicleState, current: VehicleState, alpha: number): VehicleState {
  const t = clamp(alpha, 0, 1);
  const headingDelta = normalizeAngle(current.heading - previous.heading);
  return {
    x: lerp(previous.x, current.x, t),
    z: lerp(previous.z, current.z, t),
    heading: normalizeAngle(previous.heading + headingDelta * t),
    speed: lerp(previous.speed, current.speed, t),
    steer: lerp(previous.steer, current.steer, t),
  };
}
