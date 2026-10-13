import * as THREE from 'three';
import { IndicatorSound } from './audio/indicatorSound';
import { ChaseCamera } from './camera/chaseCamera';
import { FirstPersonCamera } from './camera/firstPersonCamera';
import { CONFIG } from './config';
import { GEAR_ACTIONS, readHeldKeys, takeCommands } from './input/carInput';
import { Keyboard } from './input/keyboard';
import { keyLabel } from './input/keymap';
import './style.css';
import { DebugOverlay, describeEvent } from './ui/debugOverlay';
import { FpsCounter } from './ui/fpsCounter';
import { clusterReadout, InstrumentCluster } from './ui/instrumentCluster';
import { eventMessage, MessageBanner, stuckHint } from './ui/messages';
import { CabinMesh } from './vehicle/cabinMesh';
import { createCar, stepCar } from './vehicle/car';
import type { ControlCommand } from './vehicle/carControls';
import { indicatorLamps, isFlasherLit } from './vehicle/indicators';
import { interpolatePose } from './vehicle/vehicle';
import { VehicleMesh } from './vehicle/vehicleMesh';
import { createGround } from './world/ground';

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

  scene.add(createGround(maxAnisotropy));
  const vehicleMesh = new VehicleMesh();
  scene.add(vehicleMesh.root);

  // The instruments are drawn once and shown twice: on the dashboard and as an on-screen panel.
  const cluster = new InstrumentCluster();
  container.appendChild(cluster.canvas);
  const cabin = new CabinMesh(cluster.canvas, maxAnisotropy);
  vehicleMesh.root.add(cabin.root);

  const chaseCamera = new ChaseCamera(
    new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far),
  );
  const firstPerson = new FirstPersonCamera(vehicleMesh.root);
  let view: CameraView = 'firstPerson';
  const applyView = (): void => {
    vehicleMesh.setInteriorView(view === 'firstPerson');
    cluster.canvas.hidden = view === 'firstPerson';
  };
  applyView();

  const keyboard = new Keyboard(window);
  const indicatorSound = new IndicatorSound();
  window.addEventListener('keydown', () => indicatorSound.unlock());
  const debugOverlay = new DebugOverlay(container, CONFIG.debug.refreshIntervalSeconds);
  const fpsCounter = new FpsCounter(CONFIG.debug.fpsWindowSeconds);
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
  };
  window.addEventListener('resize', resize);
  resize();

  const step = CONFIG.simulation.fixedStepSeconds;
  let car = createCar();
  let previousMotion = car.motion;
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

    const camera = view === 'chase' ? chaseCamera.camera : firstPerson.camera;
    renderer.render(scene, camera);

    fpsCounter.tick(frameSeconds);
    debugOverlay.update(frameSeconds, {
      fps: fpsCounter.fps,
      seed: null,
      view: VIEW_NAMES[view],
      car,
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
      `${k('toggleView')} view · ${k('toggleDebug')} debug`,
  ].join('\n');
  container.appendChild(hint);
}

function showError(container: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'fatal-error';
  box.textContent = message;
  container.appendChild(box);
}

const app = document.getElementById('app');
if (app) start(app);
