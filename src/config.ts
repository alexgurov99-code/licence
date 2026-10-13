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

    /** Engine power fades out towards this speed; with rolling and air resistance the car tops out at about 120 km/h. */
    maxForwardSpeed: kmh(130),
    /** Same for reverse: the car tops out at about 14 km/h. */
    maxReverseSpeed: kmh(15),
    /** Full-throttle acceleration from a standstill (0–100 km/h in about 11 s). */
    acceleration: 3.9,
    /** Full-brake deceleration (~0.75 g, a firm stop on dry asphalt). */
    brakeDeceleration: 7.5,
    /** The handbrake only works on the rear wheels, so it is weaker than the foot brake, but still holds the car against full throttle. */
    handbrakeDeceleration: 4.0,
    /** In P the gearbox locks the wheels. */
    parkLockDeceleration: 10,
    /** Tyre rolling resistance: the slow-down when coasting in N. */
    rollingDeceleration: 0.3,
    /** Air resistance: slow-down = airDrag × speed². About 0.2 m/s² at 100 km/h. */
    airDrag: 0.0003,
    /** Slow-down from the engine when the accelerator is released in D or R above walking pace. */
    engineBraking: 0.35,
    /** Automatic "creep": with the engine running in D or R and no pedals pressed, the car rolls at this speed. */
    creepSpeed: kmh(6),
    /** How briskly the car picks up creep speed from a standstill. */
    creepAcceleration: 1.2,

    /** Front wheel angle at full lock. */
    maxSteerAngle: 0.55,
    /** How fast the steering moves towards full lock while a key is held (full lock per second), when parking. */
    steerRate: 1.6,
    /** Keyboard steering gets slower with speed so that small corrections stay small: at this speed it moves half as fast. */
    steerHalfRateSpeed: kmh(40),
    /** How fast the steering self-centres after the key is released (full lock per second). */
    steerReturnRate: 2.5,
    /** Most sideways acceleration the tyres allow (~0.6 g). This is why the car cannot turn as tightly at speed. */
    maxLateralAcceleration: 6.0,
  },

  controls: {
    /** Time to push a pedal all the way down while its key is held. A short tap gives a light press. */
    throttleFullSeconds: 0.8,
    brakeFullSeconds: 0.4,
    /** Time for a pedal to come back up after its key is released. */
    pedalReleaseSeconds: 0.15,
    /** Below this speed the car counts as stopped: needed for P, R (when rolling forwards) and switching the engine off. */
    standstillSpeed: kmh(2),
  },

  indicators: {
    /** One full on + off cycle. 0.7 s is about 85 flashes per minute (the allowed range for cars is 60–120). */
    flashPeriodSeconds: 0.7,
    /** Self-cancel: the steering must first turn at least this far towards the signalled side (share of full lock)... */
    selfCancelArmSteer: 0.3,
    /** ...and then come back to within this much of the centre. Smaller steering, e.g. a lane change, does not cancel. */
    selfCancelReleaseSteer: 0.08,
  },

  cabin: {
    /** NZ cars are right-hand drive: the driver sits on the right, which is -X in car coordinates. */
    driverX: -0.37,
    /** Driver's eye point, relative to the ground under the car's centre. */
    eyeHeight: 1.2,
    eyeZ: -0.25,
    /** Steering wheel turns from centre to full lock (real cars: about 1.5). */
    steeringWheelTurns: 1.25,
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
    firstPerson: {
      fov: 62,
      near: 0.05,
      /** Slight downward tilt so the road, bonnet and instruments are all in view. */
      pitch: -0.12,
    },
  },

  world: {
    groundSize: 1000,
    gridCellSize: 10,
    fogNear: 150,
    fogFar: 700,
  },

  audio: {
    /** Loudness of the indicator relay click, 0..1. */
    indicatorVolume: 0.8,
  },

  ui: {
    /** How long a hint message stays on screen. */
    messageSeconds: 3,
  },

  debug: {
    /** How often the debug panel text is refreshed. */
    refreshIntervalSeconds: 0.1,
    /** Time window over which FPS is averaged. */
    fpsWindowSeconds: 0.5,
    /** How many recent control events the debug panel lists. */
    recentEvents: 6,
  },
} as const;

type NumberFields<T> = { readonly [K in keyof T]: number };

export type VehicleParams = NumberFields<typeof CONFIG.vehicle>;
export type ControlsParams = NumberFields<typeof CONFIG.controls>;
export type IndicatorParams = NumberFields<typeof CONFIG.indicators>;
export type CabinParams = NumberFields<typeof CONFIG.cabin>;
export type ChaseCameraParams = NumberFields<typeof CONFIG.camera.chase>;
export type FirstPersonCameraParams = NumberFields<typeof CONFIG.camera.firstPerson>;
