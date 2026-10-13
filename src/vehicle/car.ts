import { createCarControls, stepCarControls, type CarControlsState, type ControlEvent, type ControlsInput } from './carControls';
import { createVehicleState, stepVehicle, type VehicleState } from './vehicle';

// The whole car for one simulation step: the driver's controls plus the resulting motion.

export interface CarState {
  motion: VehicleState;
  controls: CarControlsState;
}

export function createCar(
  overrides: { motion?: Partial<VehicleState>; controls?: Partial<CarControlsState> } = {},
): CarState {
  return {
    motion: createVehicleState(overrides.motion),
    controls: createCarControls(overrides.controls),
  };
}

export function stepCar(car: CarState, input: ControlsInput, dt: number): { car: CarState; events: ControlEvent[] } {
  const { state: controls, events } = stepCarControls(car.controls, input, car.motion, dt);
  const motion = stepVehicle(car.motion, controls, dt);
  return { car: { motion, controls }, events };
}
