import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import {
  createVehicleState,
  interpolatePose,
  NO_CONTROLS,
  normalizeAngle,
  stepVehicle,
  type VehicleControls,
  type VehicleState,
} from './vehicle';

const DT = CONFIG.simulation.fixedStepSeconds;
const params = CONFIG.vehicle;

function run(state: VehicleState, controls: VehicleControls, seconds: number): VehicleState {
  let s = state;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) s = stepVehicle(s, controls, DT);
  return s;
}

const GAS: VehicleControls = { ...NO_CONTROLS, throttle: 1 };
const REVERSE_GAS: VehicleControls = { ...NO_CONTROLS, throttle: 1, direction: -1 };
const BRAKE: VehicleControls = { ...NO_CONTROLS, brake: 1 };

describe('stepVehicle', () => {
  it('stays put with no input', () => {
    const s = run(createVehicleState(), NO_CONTROLS, 5);
    expect(s).toEqual(createVehicleState());
  });

  it('accelerates forwards along +Z when heading is 0', () => {
    const s = run(createVehicleState(), GAS, 2);
    expect(s.speed).toBeGreaterThan(4);
    expect(s.z).toBeGreaterThan(3);
    expect(s.x).toBeCloseTo(0, 9);
  });

  it('never exceeds the forward or reverse speed limit', () => {
    expect(run(createVehicleState(), GAS, 120).speed).toBeCloseTo(params.maxForwardSpeed, 9);
    expect(run(createVehicleState(), REVERSE_GAS, 60).speed).toBeCloseTo(-params.maxReverseSpeed, 9);
  });

  it('coasts to a gradual stop without pedals', () => {
    const moving = createVehicleState({ speed: 10 });
    const after1s = run(moving, NO_CONTROLS, 1);
    expect(after1s.speed).toBeLessThan(10);
    expect(after1s.speed).toBeGreaterThan(9);
    expect(run(moving, NO_CONTROLS, 60).speed).toBe(0);
  });

  it('brakes to a full stop and does not roll backwards', () => {
    const s = run(createVehicleState({ speed: kmh(50) }), BRAKE, 10);
    expect(s.speed).toBe(0);
  });

  it('has a realistic braking distance from 50 km/h', () => {
    // v^2 / (2a) with ~7.5 m/s^2 => roughly 13 m (excluding reaction time).
    let s = createVehicleState({ speed: kmh(50) });
    while (s.speed > 0) s = stepVehicle(s, BRAKE, DT);
    expect(s.z).toBeGreaterThan(10);
    expect(s.z).toBeLessThan(16);
  });

  it('does not rotate on the spot when steering at standstill', () => {
    const s = run(createVehicleState(), { ...NO_CONTROLS, steerInput: 1 }, 2);
    expect(s.heading).toBe(0);
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
    expect(s.steer).toBe(1);
  });

  it('turns left with positive steering when going forwards', () => {
    const s = run(createVehicleState({ speed: 5 }), { ...NO_CONTROLS, steerInput: 1 }, 1);
    expect(s.heading).toBeGreaterThan(0);
    expect(s.x).toBeGreaterThan(0); // left of a car facing +Z is +X
  });

  it('swings the nose the other way when reversing with the same steering', () => {
    const s = run(createVehicleState({ speed: -3 }), { ...REVERSE_GAS, steerInput: 1 }, 1);
    expect(s.heading).toBeLessThan(0);
  });

  it('moves the steering smoothly and re-centres it when released', () => {
    const turning = stepVehicle(createVehicleState(), { ...NO_CONTROLS, steerInput: 1 }, DT);
    expect(turning.steer).toBeGreaterThan(0);
    expect(turning.steer).toBeLessThan(0.1);

    const fullLock = createVehicleState({ steer: 1 });
    expect(run(fullLock, NO_CONTROLS, 0.2).steer).toBeGreaterThan(0);
    expect(run(fullLock, NO_CONTROLS, 1).steer).toBe(0);
  });

  it('drives a circle whose radius matches the wheelbase and steering angle', () => {
    const expectedRadius = params.wheelbase / Math.tan(params.maxSteerAngle);
    let s = createVehicleState({ speed: 3, steer: 1 });
    const holdSpeed: VehicleControls = { ...NO_CONTROLS, steerInput: 1 };
    let maxX = 0;
    for (let i = 0; i < 2000; i++) {
      s = stepVehicle({ ...s, speed: 3 }, holdSpeed, DT);
      maxX = Math.max(maxX, s.x);
    }
    // Turning left from the origin the circle's centre is at (R, 0), so the far side is at 2R.
    expect(maxX).toBeCloseTo(2 * expectedRadius, 1);
  });

  it('is deterministic', () => {
    const inputs: VehicleControls[] = [GAS, { ...GAS, steerInput: 1 }, BRAKE, { ...NO_CONTROLS, steerInput: -1 }];
    const replay = (): VehicleState => {
      let s = createVehicleState();
      for (let i = 0; i < 600; i++) s = stepVehicle(s, inputs[Math.floor(i / 150)] ?? NO_CONTROLS, DT);
      return s;
    };
    expect(replay()).toEqual(replay());
  });
});

describe('interpolatePose', () => {
  it('blends position halfway', () => {
    const a = createVehicleState({ x: 0, z: 0 });
    const b = createVehicleState({ x: 2, z: 4 });
    const mid = interpolatePose(a, b, 0.5);
    expect(mid.x).toBe(1);
    expect(mid.z).toBe(2);
  });

  it('takes the short way round across the +-PI seam', () => {
    const a = createVehicleState({ heading: Math.PI - 0.1 });
    const b = createVehicleState({ heading: -Math.PI + 0.1 });
    expect(Math.abs(interpolatePose(a, b, 0.5).heading)).toBeCloseTo(Math.PI, 9);
  });
});

describe('normalizeAngle', () => {
  it('wraps into (-PI, PI]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
  });
});

function kmh(value: number): number {
  return value / 3.6;
}
