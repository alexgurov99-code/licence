import { CONFIG } from '../config';
import type { VehicleControls } from './vehicle';

// Stage 0 only: maps W/S/A/D straight to pedals without a gearbox.
// S brakes while rolling forwards and reverses once the car has stopped (and W does the mirror
// image). Stage 1 replaces this with the automatic gearbox (P/R/N/D).

export interface DrivingKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export function arcadeControls(
  keys: DrivingKeys,
  speed: number,
  standstillSpeed: number = CONFIG.arcadeControls.standstillSpeed,
): VehicleControls {
  const steerInput = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  const movingForward = speed > standstillSpeed;
  const movingBackward = speed < -standstillSpeed;

  let throttle = 0;
  let brake = 0;
  let direction: 1 | -1 = 1;

  if (keys.forward && !keys.back) {
    if (movingBackward) brake = 1;
    else throttle = 1;
  } else if (keys.back && !keys.forward) {
    if (movingForward) {
      brake = 1;
    } else {
      throttle = 1;
      direction = -1;
    }
  } else if (keys.forward && keys.back) {
    brake = 1;
  }

  return { throttle, brake, direction, steerInput };
}
