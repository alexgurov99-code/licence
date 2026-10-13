import { CONFIG, type VehicleParams } from '../config';

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

export interface VehicleControls {
  /** Accelerator pedal, 0..1. */
  throttle: number;
  /** Brake pedal, 0..1. */
  brake: number;
  /** Which way the throttle drives the car: +1 forwards, -1 backwards. */
  direction: 1 | -1;
  /** Steering keys: -1 right, 0 none, +1 left. */
  steerInput: number;
}

export const NO_CONTROLS: VehicleControls = { throttle: 0, brake: 0, direction: 1, steerInput: 0 };

export function createVehicleState(overrides: Partial<VehicleState> = {}): VehicleState {
  return { x: 0, z: 0, heading: 0, speed: 0, steer: 0, ...overrides };
}

export function stepVehicle(
  state: VehicleState,
  controls: VehicleControls,
  dt: number,
  params: VehicleParams = CONFIG.vehicle,
): VehicleState {
  const steer = stepSteering(state.steer, controls.steerInput, dt, params);
  const speed = stepSpeed(state.speed, controls, dt, params);

  // Kinematic "bicycle" model: the car turns around a point on its rear axle line,
  // so it cannot rotate on the spot and turns tighter the more the wheels are turned.
  const averageSpeed = (state.speed + speed) / 2;
  const steerAngle = steer * params.maxSteerAngle;
  const yawRate = (averageSpeed / params.wheelbase) * Math.tan(steerAngle);
  const headingChange = yawRate * dt;
  const midHeading = state.heading + headingChange / 2;

  return {
    x: state.x + Math.sin(midHeading) * averageSpeed * dt,
    z: state.z + Math.cos(midHeading) * averageSpeed * dt,
    heading: normalizeAngle(state.heading + headingChange),
    speed,
    steer,
  };
}

function stepSteering(current: number, input: number, dt: number, params: VehicleParams): number {
  const target = clamp(input, -1, 1);
  const returningToCentre = target === 0 || Math.sign(target) !== Math.sign(current);
  const rate = returningToCentre ? params.steerReturnRate : params.steerRate;
  return moveTowards(current, target, rate * dt);
}

function stepSpeed(speed: number, controls: VehicleControls, dt: number, params: VehicleParams): number {
  const throttle = clamp(controls.throttle, 0, 1);
  const brake = clamp(controls.brake, 0, 1);

  // Engine pushes in the chosen direction; brakes and rolling resistance only ever slow the car
  // down towards zero and never push it the other way.
  const driven = speed + controls.direction * throttle * params.acceleration * dt;
  const resistance = (brake * params.brakeDeceleration + params.rollingDeceleration) * dt;
  const slowed = moveTowards(driven, 0, resistance);

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

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a <= -Math.PI) a += twoPi;
  if (a > Math.PI) a -= twoPi;
  return a;
}

function moveTowards(value: number, target: number, maxDelta: number): number {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
