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
    /** Slow-down from the engine when the accelerator is released in D or R... */
    engineBraking: 0.35,
    /** ...fading out below this speed. There is no automatic "creep": the car moves only on the accelerator. */
    engineBrakingFadeSpeed: kmh(5),

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

  /**
   * Cockpit drill: adjusting the seat and the mirrors before the drive. The seat is right at the
   * cabin's eye point (CONFIG.cabin); a mirror is right when its glass is within the tolerance of
   * the angle that gives the view in CONFIG.mirrors from the current eye.
   */
  cockpit: {
    /** How far the seat moves from the right position, metres. */
    seatForwardRange: 0.15,
    seatHeightRange: 0.08,
    /** Moving the seat, metres per second while the key is held. */
    seatSpeed: 0.08,
    /** The seat counts as adjusted within this distance of the right position (each direction). */
    seatTolerance: 0.02,
    /** At the start the seat is off by this much at least, in one or both directions. */
    seatMisadjustMin: 0.05,
    /** Turning a mirror glass, radians per second while the key is held. */
    mirrorSpeed: 0.1,
    /** A mirror counts as adjusted within this angle of the right one, radians (yaw and pitch each). */
    mirrorTolerance: 0.02,
    /** At the start each mirror is off by this angle (from min to max), radians. */
    mirrorMisadjustMin: 0.06,
    mirrorMisadjustMax: 0.14,
    /** A mirror glass cannot turn further than this from the right angle. */
    mirrorRange: 0.35,
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

    /** Houses, trees, poles and parked cars along the roads (models from design/nz-suburb-kit.html). */
    scenery: {
      /** Grass verge between the outer edge of the shoulder and the sections. */
      vergeWidth: 3.5,
      /** At junctions, nothing tall inside the triangle between two neighbouring arms, this long along each arm from the middle. */
      sightLeg: 40,
      /** In front of every sign, nothing tall along the drivers' approach for this long... */
      signCorridorLength: 40,
      /** ...and this far either side of the line through the sign post. */
      signCorridorHalfWidth: 2,
      /** No verge items or parked cars this close to where the car starts or stops at the end. */
      startClearance: 15,
      /** Up to this height an item may stand in the sight triangles (letterboxes, bins, low shrubs). */
      lowHeight: 1.2,
      /** A sign post keeps this much room around it. */
      signClearance: 2,
      /** Lot left empty now and then, and lots with a car or a trailer in the driveway. */
      emptyLotChance: 0.08,
      driveCarChance: 0.35,
      trailerChance: 0.06,
      /** Wheelie bins out on the verge in front of a section. */
      wheelieBinChance: 0.25,
      /** Street lights along one side of every road, power poles along the other. */
      streetLightSpacing: 35,
      powerPoleSpacing: 42,
      /** Verge trees: a slot every so often, filled at this chance. */
      vergeTreeSpacing: 16,
      vergeTreeChance: 0.35,
      /** Fire hydrant markers on the verge. */
      hydrantSpacing: 70,
      /** Bus stops in the town, on the longest straight stretches. */
      busStops: 3,
      /** Share of T and cross junctions with a corner shop (at least one in town). */
      cornerShopChance: 0.3,
      /** Share of streets (off the route) with cars parked by the kerb, how many, and how far from junctions. */
      parkedStreetChance: 0.4,
      maxParkedPerStreet: 3,
      parkedFromJunction: 20,
      /** Shrubs on each roundabout island. */
      islandShrubs: 4,
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

  /**
   * The rules engine. Three levels of fault, as on the NZ restricted test: an immediate failure
   * ends the test, critical errors are allowed up to a limit, minor ones are only advice.
   */
  rules: {
    /** NZ restricted test: failed by any immediate failure error or by more than this many critical errors. */
    maxCriticalErrors: 2,
    signal: {
      /** Reaction time allowed on the 3-second rule (CONFIG.route.minSignalSeconds). */
      lateToleranceSeconds: 0.3,
      /** Indicating more than this far before the previous manoeuvre is over is too early. */
      earlyToleranceDistance: 5,
      /** Leaving a roundabout: the left indicator must be on by this share of the way from passing the exit before to leaving. */
      exitSignalShare: 0.6,
      /** The indicator must be off once the middle of the car is this far past the "indicator off" line. */
      cancelGraceDistance: 3,
    },
    observation: {
      /** A mirror check counts for a signal given within this many seconds after it. */
      mirrorMaxAgeSeconds: 10,
      /** Pulling out: the look over the right shoulder must be this recent when the car moves off. */
      shoulderMaxAgeSeconds: 5,
    },
    drill: {
      /** The car counts as moving (the drive has begun, adjusting is no longer safe) above this speed, km/h. */
      movingKmh: 2,
      /** Parked at the end: handbrake on and P within this many seconds of stopping. */
      secureSeconds: 8,
    },
    junction: {
      /** Stop sign: the car must stop (front of the car) within this distance before the line... */
      stopWindow: 10,
      /** ...slower than this counts as stopped (km/h)... */
      stopSpeedKmh: 1,
      /** ...and if its slowest there was below this, it was a rolling stop (critical), otherwise it did not stop (immediate failure). */
      rollingStopKmh: 10,
      /** Give Way (no traffic yet): slow to this speed (km/h) within this distance before the line, to look both ways. */
      giveWayKmh: 20,
      giveWayWindow: 20,
    },
    speed: {
      /** km/h over the limit: minor if it lasts minorOverSeconds; NZ test: 5 over is a critical error... */
      minorOverKmh: 2,
      minorOverSeconds: 3,
      criticalOverKmh: 5,
      /** ...and 10 over at any time, or 5 over for 5 seconds or more, an immediate failure. */
      immediateOverKmh: 10,
      immediateOverSeconds: 5,
      /** When the limit drops after a junction the old one still applies this long: the sign stands a few metres in. */
      limitDropGraceSeconds: 2,
      /** NZ test: 10 km/h under the limit with no reason is too slow; it counts after this many seconds. */
      tooSlowUnderKmh: 10,
      tooSlowSeconds: 8,
      /** Driving slowly is expected this close before a manoeuvre and after one. */
      slowBeforeManeuver: 50,
      slowAfterManeuver: 40,
      /** ...and this close to a bend of the road (bend tiles are tight: about 35–40 km/h at most). */
      slowAroundBend: 40,
      /** ...and behind a car closer than this (bumper to bumper), or while giving way. */
      heldUpGap: 30,
    },
    position: {
      /** The middle of the car further right than this of the middle of its lane, for keepLeftSeconds: keep left. */
      keepLeftOffset: 0.6,
      keepLeftSeconds: 3,
      /** The right side of the car this far over the centre line for centreLineSeconds: crossed the centre line. */
      centreLineTolerance: 0.2,
      centreLineSeconds: 1,
      /** The middle of the car over the centre line this long: driving on the wrong side of the road. */
      wrongSideSeconds: 0.5,
      /**
       * Turning at a T or crossroads: the middle of the car further than this from the route line
       * towards the inside of the turn, for cutCornerSeconds, cuts the corner. Lenient on purpose:
       * steering with keys is rougher than with a wheel, and a slight cut is not a fault.
       */
      cutCornerOffset: 2.3,
      cutCornerSeconds: 0.8,
    },
    /** Other traffic (stage 8). Failing to give way (another driver had to brake hard) and a collision end the test. */
    traffic: {
      /** NZ Road Code: keep at least 2 seconds behind the car ahead. Closer than this for followMinorFor: minor... */
      followMinorSeconds: 2,
      followMinorFor: 5,
      /** ...and closer than this for followCriticalFor: critical ("following too closely"). */
      followCriticalSeconds: 1,
      followCriticalFor: 3,
      /** Following distance is only judged above this speed, km/h. */
      followMinKmh: 20,
      /** A car braking hard behind the learner still counts against the pull-out this far after it. */
      pullOutGrace: 30,
      /** Learner mode: "give way" shows for a car this many seconds from where the paths meet, when the learner is this close to it. */
      hintSeconds: 6,
      hintDistance: 30,
    },
  },

  /**
   * Other cars on the roads (stage 8). They keep to their lanes and the speed limit, keep a
   * distance (a simple "intelligent driver" model), stop at Stop signs, give way by the NZ rules
   * and signal their turns. They appear and disappear out of the driver's sight.
   */
  traffic: {
    /** Cars kept driving around the learner. */
    count: 12,
    /** New cars appear between these distances from the learner... */
    spawnMinDistance: 160,
    spawnMaxDistance: 300,
    /** ...and further than this when in front of the learner (inside spawnFrontAngle of the way the car faces). */
    spawnFrontDistance: 250,
    spawnFrontAngle: 0.9,
    /** At the start of a drive the cars can be closer, but not nearer than this. */
    startMinDistance: 40,
    /** No new car this close to another car. */
    spawnGap: 25,
    /** ...and not closer than this to the junction at the end of its lane. */
    spawnBeforeJunction: 50,
    /** A car this far from the learner is taken away (and a new one appears somewhere else). */
    despawnDistance: 330,
    /** A car stuck this long (not moving) is taken away when the learner is further than stuckRemoveDistance. */
    stuckSeconds: 25,
    stuckRemoveDistance: 60,

    /** Cruising speed: this share of the limit, picked per driver between min and max. */
    cruiseShareMin: 0.9,
    cruiseShareMax: 1.0,
    /** Intelligent driver model: comfortable acceleration and braking, time gap to the car ahead, gap when stopped. */
    acceleration: 1.6,
    comfortableBraking: 2.5,
    timeGap: 1.4,
    minGap: 2.5,
    /** Gap left to a limit line when stopping for it. */
    lineGap: 0.8,
    /** Hardest braking a driver can do. */
    maxBraking: 8,
    /** Having to brake harder than this to stop in time behind the learner is "evasive action" (NZ test: failing to give way). */
    evasiveBraking: 4,
    /** Sideways acceleration drivers allow in curves and junction turns: sets their turning speed. */
    curveAcceleration: 2.2,
    /** Speed when crossing a give-way line with nobody to give way to (roundabouts and Give Way signs). */
    giveWaySpeed: 4,
    /** Standing still (slower than this) at a Stop line counts as stopped... */
    stopSpeed: 0.3,
    /** ...this close to the line; then the driver waits this long before going. */
    stopNear: 5,
    stopWaitSeconds: 1,
    /** Looking ahead along the lane for cars and curves, metres. */
    lookAhead: 70,
    /** A car ahead counts when its middle is this close to the way the driver will go. */
    corridorHalfWidth: 1.6,
    /** ...and points along that way are checked this far apart. */
    corridorStep: 2,
    /** Cars facing more than this away from the way ahead are crossing, not in the lane (unless standing still). */
    sameWayAngle: 1.1,
    /** ...but a crossing car this close ahead is braked for. */
    crossingBrakeDistance: 12,
    /** Two junction paths conflict where their middles come closer than this. */
    conflictDistance: 3,
    /** A driver waits unless a car with priority is at least this many seconds from where their paths meet. */
    giveWayGapSeconds: 4,
    /** ...or the time it needs to get through that place plus this margin, whichever is longer. */
    giveWayMarginSeconds: 1.5,
    /** ...and only cars closer to that place than this matter. */
    giveWayLookDistance: 100,
    /** Where two ways merge, a car is through once it is this far (bumper to bumper) ahead of the other in the shared stretch. */
    clearMargin: 3,
    /** After waiting this long at a line, drivers stop waiting for a car standing still that waits for nobody, or for cars in a circle of waiting. */
    impatientSeconds: 6,
    /** Indicators go on this many seconds before the junction (at least signalMinDistance before it). */
    signalSeconds: 3.5,
    signalMinDistance: 30,
    /** At a roundabout, the left indicator for the exit goes on this far before leaving. */
    exitSignalDistance: 14,
    /** How often each way is picked at a junction, relative to each other. */
    turnWeights: { left: 1, straight: 1.2, right: 1 },
  },

  audio: {
    /** Loudness of the indicator relay click, 0..1. */
    indicatorVolume: 0.8,
  },

  ui: {
    /** How long a hint message stays on screen. */
    messageSeconds: 3,
    /** Each fault shows on screen this long; at most this many at once. */
    faultSeconds: 6,
    faultsShown: 4,
    /** After an immediate fail the examiner ends the test: the results screen comes this long after. */
    resultsAfterFailSeconds: 3,
    /** The results map draws the way the car went from a point every this many metres. */
    trailStep: 4,
    /** Learner mode: the steps for the next manoeuvre light up this far before the indicator should go on. */
    coachAheadDistance: 60,
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
    /** A bend of the road closer than this (and before the next manoeuvre) is said instead: "In 80 m the road bends left". */
    bendAnnounceDistance: 120,
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
export type RulesParams = Widen<typeof CONFIG.rules>;
export type CockpitParams = NumberFields<typeof CONFIG.cockpit>;
export type TrafficParams = Widen<typeof CONFIG.traffic>;
