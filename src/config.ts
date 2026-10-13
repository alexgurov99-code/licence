// All tunable numbers live here. Units: metres, seconds, radians, m/s unless stated otherwise.

const kmh = (value: number): number => value / 3.6;

export const CONFIG = {
  simulation: {
    /** Physics runs at a fixed rate so results do not depend on the monitor's refresh rate. */
    fixedStepSeconds: 1 / 60,
    /** Upper bound on catch-up steps per frame (e.g. after the tab was in the background). */
    maxStepsPerFrame: 5,
  },

  vehicle: {
    /** Body size of a typical small hatchback. */
    length: 4.3,
    width: 1.8,
    height: 1.45,
    wheelbase: 2.6,
    wheelRadius: 0.32,
    wheelWidth: 0.22,

    maxForwardSpeed: kmh(110),
    maxReverseSpeed: kmh(15),
    /** Full-throttle acceleration (about 0–100 km/h in 9 s). */
    acceleration: 3.0,
    /** Full-brake deceleration (~0.75 g, a firm stop on dry asphalt). */
    brakeDeceleration: 7.5,
    /** Slow-down when coasting with no pedals pressed. */
    rollingDeceleration: 0.5,

    /** Front wheel angle at full lock. */
    maxSteerAngle: 0.55,
    /** How fast the steering moves towards full lock while a key is held (full lock per second). */
    steerRate: 1.6,
    /** How fast the steering self-centres after the key is released (full lock per second). */
    steerReturnRate: 2.5,
  },

  /** Stage 0 only: below this speed the S key switches from braking to reversing. */
  arcadeControls: {
    standstillSpeed: 0.05,
  },

  camera: {
    fov: 60,
    near: 0.1,
    far: 1500,
    chase: {
      distance: 7.5,
      height: 2.8,
      lookHeight: 1.0,
      lookAhead: 4.0,
      /** Higher = camera catches up with the car faster. */
      stiffness: 6.0,
    },
  },

  world: {
    groundSize: 1000,
    gridCellSize: 10,
    fogNear: 150,
    fogFar: 700,
  },

  debug: {
    /** How often the debug panel text is refreshed. */
    refreshIntervalSeconds: 0.1,
    /** Time window over which FPS is averaged. */
    fpsWindowSeconds: 0.5,
  },
} as const;

type NumberFields<T> = { readonly [K in keyof T]: number };

export type VehicleParams = NumberFields<typeof CONFIG.vehicle>;
export type ChaseCameraParams = NumberFields<typeof CONFIG.camera.chase>;
