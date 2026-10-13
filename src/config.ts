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
    eyeHeight: 1.26,
    eyeZ: -0.25,
    /** Steering wheel turns from centre to full lock (real cars: about 1.5). */
    steeringWheelTurns: 1.25,
  },

  /**
   * Mirror glass in car coordinates (+Z forward, +X the car's left, Y up from the ground).
   * view: where the centre of a well-adjusted mirror looks — viewYaw turns from straight back
   * towards the car's left, viewPitch tilts up (negative = down). The glass angle that gives this
   * view is worked out from the driver's eye, so it follows the seat position.
   * wideAngle: 1 = flat glass; above 1 = convex: a wider view, but things look smaller.
   */
  mirrors: {
    /** Picture resolution of each mirror, pixels across; the height follows the glass shape. */
    textureWidth: 768,
    interior: { x: 0, y: 1.36, z: 0.32, width: 0.25, height: 0.075, viewYaw: 0, viewPitch: -0.03, wideAngle: 1 },
    /** Passenger side. Far from the driver, so a flat glass would show only a narrow strip. */
    left: { x: 1.02, y: 1.03, z: 0.56, width: 0.21, height: 0.125, viewYaw: 0.07, viewPitch: -0.02, wideAngle: 2 },
    /** Driver's side, flat. */
    right: { x: -1.02, y: 1.03, z: 0.56, width: 0.21, height: 0.125, viewYaw: -0.06, viewPitch: -0.02, wideAngle: 1 },
  },

  glance: {
    /** A look in a mirror or over a shoulder counts as a check once the key has been held this long. */
    minCheckSeconds: 0.5,
    /** The head turns about the neck, which is this far behind the eyes. */
    neckOffset: 0.1,
    /** Over the shoulder: how far the head turns from straight ahead (2.45 rad ≈ 140°), and the tilt down. */
    shoulderYaw: 2.45,
    shoulderPitch: -0.1,
    /** Looking straight back the driver also twists in the seat, moving the head this far towards the middle. */
    lookBackShift: 0.3,
    lookBackPitch: -0.04,
    /** Vertical field of view of the over-the-shoulder and looking-back pictures, degrees. */
    shoulderFov: 55,
    /** Narrower, so the rear window fills more of the picture. */
    lookBackFov: 40,
    /** Shape (width / height) and resolution of those pictures. */
    aspect: 1.6,
    textureWidth: 960,
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
      pitch: -0.17,
    },
  },

  world: {
    /** The grass plane; larger than the town so its edge stays hidden in the fog. */
    groundSize: 1400,
    fogNear: 150,
    fogFar: 700,

    /** The town is a square grid of tiles. Each tile holds a straight, a bend, a junction or a roundabout. */
    tilesPerSide: 5,
    tileSize: 120,

    /** One lane each way. */
    laneWidth: 3.5,
    /** Sealed strip outside each edge line where a car can stop or park. */
    shoulderWidth: 2.5,
    /** Radius of the middle of the road on bend tiles. */
    bendRadius: 20,
    /** T and cross junctions: the lanes (and the limit lines) end this far from the middle of the junction. */
    junctionHalfSize: 9,

    roundabout: {
      /** Raised central island. */
      islandRadius: 7,
      /** Outer edge of the circulating road. */
      outerRadius: 13,
      /** Middle of the circulating lane. */
      laneRadius: 10,
      /** Radius of the curves that lead from an approach lane onto the circle and off it again. */
      entryCurveRadius: 10,
      /** Approach lanes end this far from the middle; the curves onto the circle start after that. */
      approachRadius: 18,
    },

    /** Speed limits, km/h. */
    speedLimits: {
      normal: 50,
      /** Sometimes one main road has a higher limit along its whole length... */
      fastMainRoad: 60,
      /** ...and one side street a lower one. */
      slowStreet: 40,
    },

    generation: {
      /** Share of side-street links removed at random (the town always stays connected, with no dead ends). */
      minRemovedShare: 0.15,
      maxRemovedShare: 0.3,
      /** Chance of a second main road parallel to one of the first two. */
      extraMainRoadChance: 0.35,
      /** Chance that one crossing of two side streets becomes a roundabout too. */
      extraRoundaboutChance: 0.3,
      /** Share of controlled junctions with Stop signs; the rest get Give Way. */
      stopChance: 0.3,
      fastMainRoadChance: 0.5,
      slowStreetChance: 0.5,
      /** Every map has at least this many of each (and at least one roundabout). */
      minTees: 3,
      minCrosses: 2,
      /** A map that misses the minimums is built again from the same seed with an attempt number. */
      maxAttempts: 40,
    },

    /** Road markings (NZ: white broken centre line, white edge lines, 300 mm limit lines). */
    markings: {
      lineWidth: 0.1,
      centreDash: 3,
      centreGap: 7,
      /** The centre line stops this far short of a junction. */
      centreLineEndGap: 2,
      limitLineWidth: 0.3,
      /** Painted STOP or give-way triangle: distance from the limit line to its middle. */
      symbolBeforeLimitLine: 6,
      stopTextLength: 2.5,
      stopTextWidth: 2.2,
      triangleLength: 3.6,
      triangleWidth: 1.6,
    },

    signs: {
      /** Height of the middle of a sign above the road. */
      height: 2.0,
      /** Sideways gap between the outer edge of the shoulder and the post. */
      verge: 0.8,
      /** Stop and give-way signs stand this far before the limit line. */
      beforeLimitLine: 1.5,
      /** Speed limit signs stand this far into the road after a junction (NZ: within 20 m of the change). */
      speedSignAfterJunction: 10,
      /** Sizes across: Stop octagon, Give Way triangle side, speed limit disc. */
      stopSize: 0.75,
      giveWaySize: 0.9,
      speedLimitSize: 0.6,
      postWidth: 0.07,
    },

    houses: {
      /** Distance between neighbouring houses along a road, centre to centre. */
      minSpacing: 15,
      maxSpacing: 22,
      /** Width along the road, depth away from it, wall height. */
      minWidth: 7,
      maxWidth: 12,
      minDepth: 8,
      maxDepth: 12,
      minHeight: 2.8,
      maxHeight: 5.5,
      /** Front yard: from the outer edge of the shoulder to the front wall. */
      minSetback: 5,
      maxSetback: 10,
      /** No houses this close to the middle of a junction, so drivers can see along the side roads. */
      junctionClearance: 26,
      /** Smallest gap between a house and any road's shoulder, and between two houses. */
      clearance: 2,
    },

    start: {
      /** The car starts parked on the left shoulder, this far from its outer edge. */
      kerbGap: 0.3,
      /** At least this much straight road ahead of the start position. */
      minRoomAhead: 50,
    },
  },

  route: {
    /** Junctions on a route; pulling out at the start and pulling over at the end come on top. */
    minManeuvers: 6,
    maxManeuvers: 10,
    /** How often each way is picked at a junction, relative to each other. */
    turnWeights: { left: 1, straight: 0.6, right: 1 },
    /**
     * A route is planned again (same seed, next attempt) until it has a left turn, a right turn
     * and a roundabout (if the town has one); after this many attempts the best one is taken.
     */
    maxAttempts: 30,

    /**
     * NZ Road Code: signal for at least 3 seconds before turning, pulling out or pulling over.
     * The indicator must be on from this many seconds before the manoeuvre at the speed limit.
     */
    minSignalSeconds: 3,
    /** After a manoeuvre the indicator must be off within this distance. */
    signalOffDistance: 20,
    /** Pulling out: the car has moved off once it is this far along, and is in the lane by the end. */
    pullOutStart: 0.5,
    pullOutLength: 20,
    /** Pulling over: the car moves towards the kerb over this distance before the stopping place. */
    pullOverLength: 15,
    /** Length of the stopping place by the kerb. */
    stopBoxLength: 12,
    /** The stopping place is on a straight, at least this far before the next junction (NZ: no parking within 6 m of an intersection)... */
    finishBeforeJunction: 15,
    /** ...and with this much road after the junction behind it before the pull-over signal is due. */
    finishAfterJunction: 15,

    tracking: {
      /** The car is looked for on the route this far behind and ahead of where it was a moment ago. */
      searchBehind: 10,
      searchAhead: 40,
      /** Further than this from the middle of the route's lane... */
      offRouteDistance: 6,
      /** ...or facing more than this away from the route (about 100 degrees) while driving forwards... */
      offRouteHeading: 1.75,
      /** ...for this long, and the car is off the route. A new way back is found once it is on a road. */
      offRouteSeconds: 1,
      /** Below this speed the direction the car faces does not matter (e.g. turning the wheel while stopped). */
      headingCheckSpeed: 1,
      /** Arrived: stopped in the stopping place at least this far left of the middle of the lane (near the kerb). */
      finishMinOffset: 1.5,
    },
  },

  audio: {
    /** Loudness of the indicator relay click, 0..1. */
    indicatorVolume: 0.8,
  },

  ui: {
    /** How long a hint message stays on screen. */
    messageSeconds: 3,
    /** Windows that pop up while a look key is held. Sizes are shares of the screen width. */
    popups: {
      interiorMirrorWidth: 0.42,
      sideMirrorWidth: 0.27,
      lookBackWidth: 0.4,
      shoulderWidth: 0.34,
      /** No window gets taller than this share of the screen height. */
      maxHeight: 0.42,
      /** Gap to the screen edge, pixels. */
      margin: 16,
      /** Vertical centre of the side windows, as a share of the screen height from the top. */
      sideCentre: 0.47,
      /** The always-on mirror windows in the view from behind, as a share of the full size. */
      smallScale: 0.55,
      /** Time to open or close a window. */
      openSeconds: 0.12,
    },
  },

  minimap: {
    /** Side of the map in the corner, CSS pixels. */
    size: 230,
    /** Metres of town across the corner map. */
    metresAcross: 200,
    /** The car sits this far down the corner map (share of its height), so more of the road ahead shows. */
    carPosition: 0.66,
    /** The big map (M) fills this share of the shorter side of the screen. */
    largeShare: 0.86,
    /** Navigation hints: closer than this, the distance is no longer said ("Turn left"). */
    nowDistance: 20,
    /** Distances are rounded to this step, and to the coarser step from `coarseFrom` on. */
    distanceStep: 10,
    coarseStep: 50,
    coarseFrom: 300,
    /** Two manoeuvres closer together than this are said together ("Turn left, then turn right"). */
    thenDistance: 60,
  },

  debug: {
    /** How often the debug panel text is refreshed. */
    refreshIntervalSeconds: 0.1,
    /** Time window over which FPS is averaged. */
    fpsWindowSeconds: 0.5,
    /** How many recent events (controls, glances, route) the debug panel lists. */
    recentEvents: 10,
  },
} as const;

type NumberFields<T> = { readonly [K in keyof T]: number };
/** The same shape as a config section, with any number allowed (tests use smaller or tweaked values). */
type Widen<T> = { readonly [K in keyof T]: T[K] extends number ? number : Widen<T[K]> };

export type VehicleParams = NumberFields<typeof CONFIG.vehicle>;
export type ControlsParams = NumberFields<typeof CONFIG.controls>;
export type IndicatorParams = NumberFields<typeof CONFIG.indicators>;
export type CabinParams = NumberFields<typeof CONFIG.cabin>;
export type ChaseCameraParams = NumberFields<typeof CONFIG.camera.chase>;
export type FirstPersonCameraParams = NumberFields<typeof CONFIG.camera.firstPerson>;
export type MirrorSpec = NumberFields<typeof CONFIG.mirrors.left>;
export type GlanceParams = NumberFields<typeof CONFIG.glance>;
export type PopupParams = NumberFields<typeof CONFIG.ui.popups>;
export type WorldParams = Widen<typeof CONFIG.world>;
export type RouteParams = Widen<typeof CONFIG.route>;
export type MinimapParams = NumberFields<typeof CONFIG.minimap>;
