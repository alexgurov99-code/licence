import * as THREE from 'three';
import { IndicatorSound } from './audio/indicatorSound';
import { ChaseCamera } from './camera/chaseCamera';
import { driverEye, FirstPersonCamera } from './camera/firstPersonCamera';
import { createGlanceState, stepGlance } from './camera/glance';
import { LookCamera } from './camera/lookCamera';
import { defaultMirrorAims } from './camera/mirrorOptics';
import { MirrorCameras } from './camera/mirrors';
import { CONFIG } from './config';
import { GEAR_ACTIONS, readGlanceKeys, readHeldKeys, takeCommands } from './input/carInput';
import { Keyboard } from './input/keyboard';
import { keyLabel } from './input/keymap';
import './style.css';
import { DebugOverlay, describeEvent, describeGlanceEvent, describeMap } from './ui/debugOverlay';
import { FpsCounter } from './ui/fpsCounter';
import { GlancePopups } from './ui/glancePopups';
import { clusterReadout, InstrumentCluster } from './ui/instrumentCluster';
import { eventMessage, MessageBanner, stuckHint } from './ui/messages';
import { randomSeed } from './util/random';
import { CabinMesh } from './vehicle/cabinMesh';
import { createCar, stepCar } from './vehicle/car';
import type { ControlCommand } from './vehicle/carControls';
import { indicatorLamps, isFlasherLit } from './vehicle/indicators';
import { interpolatePose } from './vehicle/vehicle';
import { VehicleMesh } from './vehicle/vehicleMesh';
import { DebugGraph } from './world/debugGraph';
import { locate } from './world/locate';
import { buildNetwork, type RoadNetwork } from './world/network';
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
  let mapSummary = describeMap(network);
  scene.add(world.root, debugGraph.object);

  const vehicleMesh = new VehicleMesh();
  scene.add(vehicleMesh.root);

  // Mirrors are worked out from the driver's eye. For now they start well adjusted; adjusting the
  // seat and mirrors is part of the cockpit drill (stage 6).
  const eye = driverEye();
  const mirrorAims = defaultMirrorAims(eye);
  const mirrorCameras = new MirrorCameras(vehicleMesh.root);
  mirrorCameras.aim(mirrorAims, eye);
  const lookCamera = new LookCamera(vehicleMesh.root);

  // The instruments are drawn once and shown twice: on the dashboard and as an on-screen panel.
  const cluster = new InstrumentCluster();
  container.appendChild(cluster.canvas);
  const cabin = new CabinMesh(cluster.canvas, maxAnisotropy, mirrorCameras.textures);
  cabin.setMirrorAims(mirrorAims);
  vehicleMesh.root.add(cabin.root);

  const chaseCamera = new ChaseCamera(
    new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far),
  );
  const firstPerson = new FirstPersonCamera(vehicleMesh.root);
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
  addControlsHint(container);

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
  // Key presses wait here until a physics step uses them (a fast monitor can draw frames with no step).
  let pendingCommands: ControlCommand[] = [];
  const recentEvents: string[] = [];
  let simTime = 0;
  let accumulator = 0;
  let lastTime: number | null = null;

  chaseCamera.snapTo(car.motion);

  renderer.setAnimationLoop((time: number) => {
    // Cap long pauses (background tab, breakpoint) so the car does not jump.
    const frameSeconds = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.25);
    lastTime = time;

    if (keyboard.takePressed('toggleDebug')) debugOverlay.toggle();
    if (keyboard.takePressed('newMap') && debugOverlay.isVisible) {
      scene.remove(world.root, debugGraph.object);
      world.dispose();
      debugGraph.dispose();
      network = buildNetwork(randomSeed());
      showSeedInAddress(network.seed);
      world = new WorldMesh(network, maxAnisotropy);
      debugGraph = new DebugGraph(network);
      mapSummary = describeMap(network);
      scene.add(world.root, debugGraph.object);
      car = parkedAtStart();
      previousMotion = car.motion;
      pendingCommands = [];
      chaseCamera.snapTo(car.motion);
      recentEvents.push(`${simTime.toFixed(1)}s  new map, seed ${network.seed}`);
    }
    if (keyboard.takePressed('toggleView')) {
      view = view === 'firstPerson' ? 'chase' : 'firstPerson';
      applyView();
      if (view === 'chase') chaseCamera.snapTo(car.motion);
    }
    pendingCommands.push(...takeCommands(keyboard));

    accumulator += frameSeconds;
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
      const glanceResult = stepGlance(glance, readGlanceKeys(keyboard), simTime, step, CONFIG.glance);
      glance = glanceResult.state;
      for (const event of glanceResult.events) {
        const text = describeGlanceEvent(event);
        if (text) recentEvents.push(`${simTime.toFixed(1)}s  ${text}`);
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

    const hint = stuckHint(car);
    if (hint) messages.show(hint);
    messages.update(frameSeconds);

    if (view === 'chase') chaseCamera.update(pose, frameSeconds);
    sun.position.set(pose.x + 20, 40, pose.z + 10);
    sun.target.position.set(pose.x, 0, pose.z);

    popups.update(view, glance, frameSeconds);

    renderer.info.reset();
    // Shadows are worked out once, in the first pass, and reused by the other passes of the frame.
    renderer.shadowMap.needsUpdate = true;
    // The debug lines are only drawn in the main view, never in the mirrors.
    debugGraph.object.visible = false;
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
    renderer.render(scene, camera);
    debugGraph.object.visible = false;
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
      recentEvents,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
  });
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
    `${k('engine')} engine (in P, hold brake) · ${k('handbrake')} handbrake · ${k('belt')} belt`,
    `${k('indicatorLeft')} ${k('indicatorRight')} indicators · ${k('hazard')} hazards · ` +
      `${k('toggleView')} view · ${k('toggleDebug')} debug (${k('newMap')} new map)`,
    `hold ${k('lookUp')} ${k('lookLeft')} ${k('lookRight')} mirrors · ${k('lookDown')} look back · ` +
      `${k('lookDown')}+${k('lookLeft')} ${k('lookDown')}+${k('lookRight')} over the shoulder`,
  ].join('\n');
  container.appendChild(hint);
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
