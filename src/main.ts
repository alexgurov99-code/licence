import * as THREE from 'three';
import { IndicatorSound } from './audio/indicatorSound';
import { ChaseCamera } from './camera/chaseCamera';
import { FirstPersonCamera } from './camera/firstPersonCamera';
import { createGlanceState, NO_GLANCE_KEYS, stepGlance, type GlanceTarget } from './camera/glance';
import { LookCamera } from './camera/lookCamera';
import { MirrorCameras } from './camera/mirrors';
import { CONFIG } from './config';
import { GEAR_ACTIONS, readGlanceKeys, readHeldKeys, takeCommands } from './input/carInput';
import { Keyboard } from './input/keyboard';
import { keyLabel } from './input/keymap';
import { currentInstruction } from './route/instructions';
import { planRoute } from './route/planner';
import { buildRoute, type Route } from './route/route';
import { RouteMesh } from './route/routeMesh';
import { createTracker, stepTracker } from './route/tracker';
import { createRulesState, stepRules } from './rules/engine';
import { rulesSnapshot } from './rules/snapshot';
import { driveResults, extendTrail, immediateFailTime } from './rules/results';
import type { RulesSnapshot } from './rules/types';
import './style.css';
import {
  DebugOverlay,
  describeEvent,
  describeFault,
  describeGlanceEvent,
  describeMap,
  describeRouteEvent,
} from './ui/debugOverlay';
import { coach, createCoachState } from './rules/coach';
import { CoachPanel } from './ui/coachPanel';
import { FaultFeed } from './ui/faultFeed';
import { FpsCounter } from './ui/fpsCounter';
import { GlancePopups } from './ui/glancePopups';
import { clusterReadout, InstrumentCluster } from './ui/instrumentCluster';
import { eventMessage, MessageBanner, stuckHint } from './ui/messages';
import { townMap } from './ui/mapDrawing';
import { Minimap } from './ui/minimap';
import { ResultsScreen } from './ui/resultsScreen';
import { randomSeed } from './util/random';
import { AdjustPanel, adjustText, describeCockpit } from './ui/adjustPanel';
import { CabinMesh } from './vehicle/cabinMesh';
import { adjust, eyeFor, misadjustedCockpit, nextAdjustItem, readiness, type Cockpit } from './vehicle/cockpit';
import type { AdjustItem } from './vehicle/cockpitTypes';
import { createCar, stepCar } from './vehicle/car';
import type { ControlCommand } from './vehicle/carControls';
import { indicatorLamps, isFlasherLit } from './vehicle/indicators';
import { interpolatePose } from './vehicle/vehicle';
import { VehicleMesh } from './vehicle/vehicleMesh';
import { DebugGraph } from './world/debugGraph';
import { locate } from './world/locate';
import { buildNetwork, type RoadNetwork } from './world/network';
import { placeScenery, type Scenery } from './world/scenery';
import { DETAIL_LAYER, SceneryMesh } from './world/sceneryMesh';
import { WorldMesh } from './world/worldMesh';

const SKY_COLOR = 0xbcd6ea;

type CameraView = 'firstPerson' | 'chase';
const VIEW_NAMES: Record<CameraView, string> = { firstPerson: 'driver seat', chase: 'behind the car' };

function start(container: HTMLElement): void {
  const renderer = createRenderer();
  if (!renderer) {
    showError(container, 'WebGL is not available in this browser.');
    return;
  }
  container.appendChild(renderer.domElement);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  // Each frame is drawn in several passes (mirrors, main view, windows); count them all together.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, CONFIG.world.fogNear, CONFIG.world.fogFar);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6b4a, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  // Shadows are only needed around the car; the sun follows it every frame.
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = shadowCamera.bottom = -15;
  shadowCamera.right = shadowCamera.top = 15;
  shadowCamera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  // The town comes from the seed in the address (?seed=abc); without one, a new seed is made up
  // and written into the address, so reloading the page or sharing the link gives the same town.
  let network: RoadNetwork = buildNetwork(seedFromAddress() ?? randomSeed());
  showSeedInAddress(network.seed);
  let world = new WorldMesh(network, maxAnisotropy);
  let debugGraph = new DebugGraph(network);
  // The test route comes from the same seed as the town, and so does the scenery along the roads.
  let route = buildRoute(network, planRoute(network));
  let routeMesh = new RouteMesh(route);
  scene.add(routeMesh.root, routeMesh.debug);
  let scenery = sceneryFor(network, route);
  let sceneryMesh = new SceneryMesh(scenery);
  let mapSummary = describeMap(network, scenery);
  scene.add(world.root, debugGraph.object, sceneryMesh.root);

  const vehicleMesh = new VehicleMesh();
  scene.add(vehicleMesh.root);

  // Cockpit drill: the seat and mirrors start out of adjustment (the same way for the same seed).
  // The seat moves the driver's eye; the mirror pictures are worked out from the eye and the glass angles.
  let cockpit: Cockpit = misadjustedCockpit(network.seed);
  let appliedCockpit: Cockpit | null = null;
  let eye = eyeFor(cockpit.seat);
  /** What the arrows adjust now (Tab), or null: the arrows look into the mirrors as usual. */
  let adjusting: AdjustItem | null = null;
  const mirrorCameras = new MirrorCameras(vehicleMesh.root);
  const lookCamera = new LookCamera(vehicleMesh.root);

  // The instruments are drawn once and shown twice: on the dashboard and as an on-screen panel.
  const cluster = new InstrumentCluster();
  container.appendChild(cluster.canvas);
  const cabin = new CabinMesh(cluster.canvas, maxAnisotropy, mirrorCameras.textures);
  vehicleMesh.root.add(cabin.root);

  const chaseCamera = new ChaseCamera(
    new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far),
  );
  const firstPerson = new FirstPersonCamera(vehicleMesh.root);
  // Small details of the scenery are drawn in the main view only, not in the mirrors.
  for (const camera of [chaseCamera.camera, firstPerson.camera]) camera.layers.enable(DETAIL_LAYER);
  let view: CameraView = 'firstPerson';
  const applyView = (): void => {
    cluster.canvas.hidden = view === 'firstPerson';
  };
  applyView();

  const keyboard = new Keyboard(window);
  const indicatorSound = new IndicatorSound();
  window.addEventListener('keydown', () => indicatorSound.unlock());
  const debugOverlay = new DebugOverlay(container, CONFIG.debug.refreshIntervalSeconds);
  const fpsCounter = new FpsCounter(CONFIG.debug.fpsWindowSeconds);
  const popups = new GlancePopups(container, { mirrors: mirrorCameras.textures, look: lookCamera.texture });
  const messages = new MessageBanner(container);
  const faultFeed = new FaultFeed(container);
  const coachPanel = new CoachPanel(container);
  const adjustPanel = new AdjustPanel(container);
  // Learner mode (hints) is on until switched to exam mode; the choice is remembered.
  let learner = readLearnerMode();
  const minimap = new Minimap(container);
  minimap.setNetwork(network, scenery);
  minimap.setRoute(route);
  addControlsHint(container);
  // The route as planned at the start (a wrong turn makes a new one): the results map shows it.
  let plannedRoute = route;
  const results = new ResultsScreen(container, {
    retry: () => loadDrive(network.seed),
    newRoute: () => loadDrive(randomSeed()),
  });
  // After a wrong turn the satnav finds a new route; the flag, zones and map follow it.
  const showRoute = (next: Route): void => {
    scene.remove(routeMesh.root, routeMesh.debug);
    routeMesh.dispose();
    route = next;
    routeMesh = new RouteMesh(route);
    scene.add(routeMesh.root, routeMesh.debug);
    minimap.setRoute(route);
  };

  const resize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height);
    for (const camera of [chaseCamera.camera, firstPerson.camera]) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    popups.resize(width, height);
  };
  window.addEventListener('resize', resize);
  resize();

  const step = CONFIG.simulation.fixedStepSeconds;
  const parkedAtStart = (): ReturnType<typeof createCar> =>
    createCar({ motion: { x: network.start.x, z: network.start.z, heading: network.start.heading } });
  let car = parkedAtStart();
  let previousMotion = car.motion;
  let glance = createGlanceState();
  let tracker = createTracker(route, car.motion);
  let rules = createRulesState();
  let lastSnapshot: RulesSnapshot | null = null;
  let coachState = createCoachState();
  // Key presses wait here until a physics step uses them (a fast monitor can draw frames with no step).
  let pendingCommands: ControlCommand[] = [];
  const recentEvents: string[] = [];
  // The way the car went and how far, for the results; when an immediate fail ended the test.
  let trail: { x: number; z: number }[] = [];
  let metres = 0;
  let testOverAt: number | null = null;
  let simTime = 0;
  let accumulator = 0;
  let lastTime: number | null = null;

  chaseCamera.snapTo(car.motion);

  /** Starts the drive again from the kerb: the same town and route for the same seed, a new town for a new one. */
  function loadDrive(seed: string): void {
    if (seed !== network.seed) {
      scene.remove(world.root, debugGraph.object, sceneryMesh.root);
      world.dispose();
      debugGraph.dispose();
      sceneryMesh.dispose();
      network = buildNetwork(seed);
      showSeedInAddress(network.seed);
      world = new WorldMesh(network, maxAnisotropy);
      debugGraph = new DebugGraph(network);
      showRoute(buildRoute(network, planRoute(network)));
      scenery = sceneryFor(network, route);
      sceneryMesh = new SceneryMesh(scenery);
      mapSummary = describeMap(network, scenery);
      scene.add(world.root, debugGraph.object, sceneryMesh.root);
      minimap.setNetwork(network, scenery);
      recentEvents.length = 0;
      recentEvents.push(`new map, seed ${network.seed}`);
    } else {
      showRoute(plannedRoute);
      recentEvents.length = 0;
      recentEvents.push(`same route again, seed ${network.seed}`);
    }
    plannedRoute = route;
    car = parkedAtStart();
    cockpit = misadjustedCockpit(network.seed);
    adjusting = null;
    previousMotion = car.motion;
    glance = createGlanceState();
    tracker = createTracker(route, car.motion);
    rules = createRulesState();
    lastSnapshot = null;
    coachState = createCoachState();
    faultFeed.clear();
    pendingCommands = [];
    // Times start from zero again: fault times on the results screen are drive times.
    simTime = 0;
    accumulator = 0;
    trail = [];
    metres = 0;
    testOverAt = null;
    results.hide();
    chaseCamera.snapTo(car.motion);
  }

  function showResults(endedEarly: boolean): void {
    const summary = driveResults({
      faults: rules.faults,
      maxCriticalErrors: CONFIG.rules.maxCriticalErrors,
      seconds: simTime,
      metres,
      endedEarly,
    });
    results.show(
      summary,
      { town: townMap(network, scenery), route: plannedRoute, trail, start: network.start, finish: plannedRoute.finish },
      network.seed,
    );
    if (minimap.isLarge) minimap.toggleLarge();
  }

  renderer.setAnimationLoop((time: number) => {
    // Cap long pauses (background tab, breakpoint) so the car does not jump.
    const frameSeconds = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.25);
    lastTime = time;

    if (keyboard.takePressed('toggleDebug')) debugOverlay.toggle();
    // N: a new town in debug mode or on the results screen; R on the results screen: the same route again.
    const newMapPressed = keyboard.takePressed('newMap');
    const retryPressed = keyboard.takePressed('retry');
    if (newMapPressed && (debugOverlay.isVisible || results.isOpen)) loadDrive(randomSeed());
    else if (retryPressed && results.isOpen) loadDrive(network.seed);
    if (keyboard.takePressed('toggleMap')) minimap.toggleLarge();
    if (keyboard.takePressed('toggleLearner')) {
      learner = !learner;
      saveLearnerMode(learner);
      messages.show(learner ? 'Learner mode: hints show what to do next' : 'Exam mode: no hints');
    }
    if (keyboard.takePressed('toggleView')) {
      view = view === 'firstPerson' ? 'chase' : 'firstPerson';
      applyView();
      if (view === 'chase') chaseCamera.snapTo(car.motion);
    }
    if (keyboard.takePressed('adjust')) {
      adjusting = nextAdjustItem(adjusting);
      if (adjusting === 'seat' && view === 'chase') messages.show(`Switch to the driver's seat view (${keyLabel('toggleView')}) to see the seat move`);
    }
    if (keyboard.takePressed('adjustDone')) adjusting = null;
    pendingCommands.push(...takeCommands(keyboard));
    // Driving keys do nothing while the results are on screen.
    if (results.isOpen) pendingCommands = [];

    // The results screen pauses the drive.
    accumulator = results.isOpen ? 0 : accumulator + frameSeconds;
    let steps = 0;
    while (accumulator >= step && steps < CONFIG.simulation.maxStepsPerFrame) {
      const result = stepCar(car, { held: readHeldKeys(keyboard), commands: pendingCommands }, step);
      pendingCommands = [];
      previousMotion = car.motion;
      car = result.car;
      simTime += step;
      for (const event of result.events) {
        recentEvents.push(`${simTime.toFixed(1)}s  ${describeEvent(event)}`);
        const message = eventMessage(event);
        if (message) messages.show(message);
      }
      const routeResult = stepTracker(tracker, car.motion, step, network);
      tracker = routeResult.tracker;
      for (const event of routeResult.events) {
        recentEvents.push(`${simTime.toFixed(1)}s  ${describeRouteEvent(event)}`);
        if (event.type === 'rerouted') {
          showRoute(event.route);
          messages.show('New route: follow the map');
        }
      }
      // While adjusting, the arrows move the seat or the mirror instead of looking.
      const arrows = readGlanceKeys(keyboard);
      const arrowHeld = arrows.up || arrows.down || arrows.left || arrows.right;
      if (adjusting) cockpit = adjust(cockpit, adjusting, arrows, step);
      const glanceResult = stepGlance(glance, adjusting ? NO_GLANCE_KEYS : arrows, simTime, step, CONFIG.glance);
      glance = glanceResult.state;
      for (const event of glanceResult.events) {
        const text = describeGlanceEvent(event);
        if (text) recentEvents.push(`${simTime.toFixed(1)}s  ${text}`);
      }
      // The rules engine judges this step: the car, the glances and where it is on the route and the road.
      const where = locate(network, car.motion, car.motion.heading);
      const snapshot = rulesSnapshot(simTime, car, glance, tracker, where, {
        readiness: readiness(cockpit),
        adjusting: adjusting !== null && arrowHeld,
      });
      metres += extendTrail(trail, car.motion, CONFIG.ui.trailStep);
      // After an immediate fail nothing more is judged: the examiner has ended the test.
      if (testOverAt === null) {
        const rulesResult = stepRules(rules, snapshot, routeResult.events);
        rules = rulesResult.state;
        for (const fault of rulesResult.faults) {
          recentEvents.push(`${simTime.toFixed(1)}s  ${describeFault(fault)}`);
          faultFeed.show(fault, learner);
        }
        if (!rules.finished && immediateFailTime(rules.faults) !== null) {
          testOverAt = simTime;
          messages.show('Test over: immediate fail. Pull over safely.', CONFIG.ui.resultsAfterFailSeconds);
        }
      }
      lastSnapshot = snapshot;
      const over = rules.finished || (testOverAt !== null && simTime - testOverAt >= CONFIG.ui.resultsAfterFailSeconds);
      if (over && !results.isOpen) {
        showResults(testOverAt !== null);
        break;
      }
      accumulator -= step;
      steps += 1;
    }
    if (steps === CONFIG.simulation.maxStepsPerFrame) accumulator = 0;
    recentEvents.splice(0, recentEvents.length - CONFIG.debug.recentEvents);

    const { controls } = car;
    const pose = interpolatePose(previousMotion, car.motion, accumulator / step);
    vehicleMesh.update(pose);
    vehicleMesh.setLamps({
      ...indicatorLamps(controls.indicators),
      brake: controls.brake > 0,
      reverse: controls.gear === 'R',
    });
    cabin.update(pose.steer);
    if (cluster.update(clusterReadout(car))) cabin.refreshCluster();
    indicatorSound.update(isFlasherLit(controls.indicators));

    if (cockpit !== appliedCockpit) {
      eye = eyeFor(cockpit.seat);
      firstPerson.camera.position.copy(eye);
      mirrorCameras.aim(cockpit.aims, eye);
      cabin.setMirrorAims(cockpit.aims);
      appliedCockpit = cockpit;
    }
    const ready = readiness(cockpit);
    adjustPanel.update(adjusting ? adjustText(adjusting, cockpit, ready) : null);

    const hint = stuckHint(car);
    if (hint) messages.show(hint);
    messages.update(frameSeconds);
    faultFeed.update(frameSeconds);

    if (view === 'chase') chaseCamera.update(pose, frameSeconds);
    sun.position.set(pose.x + 20, 40, pose.z + 10);
    sun.target.position.set(pose.x, 0, pose.z);

    // The mirror being adjusted shows big, its frame green once it is right.
    const shownGlance = adjusting && adjusting !== 'seat' ? { target: ADJUST_GLANCE[adjusting], counted: ready[adjusting] } : glance;
    popups.update(view, shownGlance, frameSeconds);
    minimap.update(pose, tracker, currentInstruction(tracker));
    if (lastSnapshot) {
      const coached = coach(lastSnapshot, rules, coachState);
      coachState = coached.state;
      // While adjusting, the adjust panel lists the parts and the rear-view mirror window needs the top of the screen.
      coachPanel.update(learner && !adjusting ? coached.coaching : null);
    } else {
      coachPanel.update(null);
    }

    renderer.info.reset();
    // Shadows are worked out once, in the first pass, and reused by the other passes of the frame.
    renderer.shadowMap.needsUpdate = true;
    // The debug lines and zones are only drawn in the main view, never in the mirrors.
    debugGraph.object.visible = false;
    routeMesh.debug.visible = false;
    // The rear-view mirror looks through the cabin; the door mirrors see the car from outside.
    cabin.setMirrorGlassVisible(false);
    mirrorCameras.render(renderer, scene, (id) => vehicleMesh.setInteriorView(id === 'interior'));
    cabin.setMirrorGlassVisible(true);
    const look = popups.visibleLook();
    if (look) {
      vehicleMesh.setInteriorView(true);
      lookCamera.render(renderer, scene, look, eye);
    }
    vehicleMesh.setInteriorView(view === 'firstPerson');
    const camera = view === 'chase' ? chaseCamera.camera : firstPerson.camera;
    debugGraph.object.visible = debugOverlay.isVisible;
    routeMesh.debug.visible = debugOverlay.isVisible;
    renderer.render(scene, camera);
    debugGraph.object.visible = false;
    routeMesh.debug.visible = false;
    popups.render(renderer);

    fpsCounter.tick(frameSeconds);
    debugOverlay.update(frameSeconds, {
      fps: fpsCounter.fps,
      seed: network.seed,
      map: mapSummary,
      location: locate(network, pose, pose.heading),
      view: VIEW_NAMES[view],
      simTime,
      car,
      glance,
      route: tracker,
      rules,
      cockpit: `${describeCockpit(cockpit, ready)}${adjusting ? ` · adjusting ${adjusting}` : ''}`,
      recentEvents,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
  });
}

const ADJUST_GLANCE: Record<Exclude<AdjustItem, 'seat'>, GlanceTarget> = {
  interior: 'interiorMirror',
  left: 'leftMirror',
  right: 'rightMirror',
};

/** Houses, trees and parked cars for the town; nothing parked along the route or by the start and finish. */
function sceneryFor(network: RoadNetwork, route: Route): Scenery {
  const routeRoads = new Set(route.plan.lanes.map((id) => network.lanes[id]?.roadId ?? -1));
  return placeScenery(network, { routeRoads, keepClear: [network.start, route.finish] });
}

function createRenderer(): THREE.WebGLRenderer | null {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Updated by hand once per frame (see the animation loop), not on every pass.
    renderer.shadowMap.autoUpdate = false;
    return renderer;
  } catch {
    return null;
  }
}

function addControlsHint(container: HTMLElement): void {
  const k = keyLabel;
  const hint = document.createElement('div');
  hint.className = 'controls-hint';
  hint.textContent = [
    `${k('throttle')} gas · ${k('brake')} brake · ${k('steerLeft')} ${k('steerRight')} steer · ` +
      `${k(GEAR_ACTIONS.P)} ${k(GEAR_ACTIONS.R)} ${k(GEAR_ACTIONS.N)} ${k(GEAR_ACTIONS.D)} gears P R N D`,
    `${k('adjust')} adjust seat / mirrors (arrows, ${k('adjustDone')} done) · ${k('belt')} belt · ` +
      `${k('engine')} engine (in P, hold brake) · ${k('handbrake')} handbrake`,
    `${k('indicatorLeft')} ${k('indicatorRight')} indicators · ${k('hazard')} hazards · ` +
      `${k('toggleView')} view · ${k('toggleMap')} map · ${k('toggleLearner')} learner / exam mode · ` +
      `${k('toggleDebug')} debug (${k('newMap')} new map)`,
    `hold ${k('lookUp')} ${k('lookLeft')} ${k('lookRight')} mirrors · ${k('lookDown')} look back · ` +
      `${k('lookDown')}+${k('lookLeft')} ${k('lookDown')}+${k('lookRight')} over the shoulder`,
  ].join('\n');
  container.appendChild(hint);
}

const LEARNER_KEY = 'nz-driving.learnerMode';

/** Browser storage may be unavailable (private window): learner mode is then simply on. */
function readLearnerMode(): boolean {
  try {
    return window.localStorage.getItem(LEARNER_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveLearnerMode(on: boolean): void {
  try {
    window.localStorage.setItem(LEARNER_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered; nothing else to do.
  }
}

function seedFromAddress(): string | null {
  const seed = new URLSearchParams(window.location.search).get('seed')?.trim();
  return seed ? seed : null;
}

/** Puts the seed into the address bar without reloading, so the page can be reloaded or shared. */
function showSeedInAddress(seed: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seed);
  window.history.replaceState(null, '', url);
}

function showError(container: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'fatal-error';
  box.textContent = message;
  container.appendChild(box);
}

const app = document.getElementById('app');
if (app) start(app);
