import * as THREE from 'three';
import { ChaseCamera } from './camera/chaseCamera';
import { CONFIG } from './config';
import { Keyboard } from './input/keyboard';
import './style.css';
import { DebugOverlay } from './ui/debugOverlay';
import { FpsCounter } from './ui/fpsCounter';
import { arcadeControls } from './vehicle/arcadeControls';
import { createVehicleState, interpolatePose, NO_CONTROLS, stepVehicle, type VehicleControls } from './vehicle/vehicle';
import { VehicleMesh } from './vehicle/vehicleMesh';
import { createGround } from './world/ground';

const SKY_COLOR = 0xbcd6ea;

function start(container: HTMLElement): void {
  const renderer = createRenderer();
  if (!renderer) {
    showError(container, 'WebGL is not available in this browser.');
    return;
  }
  container.appendChild(renderer.domElement);

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

  scene.add(createGround(renderer.capabilities.getMaxAnisotropy()));
  const vehicleMesh = new VehicleMesh();
  scene.add(vehicleMesh.root);

  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far);
  const chaseCamera = new ChaseCamera(camera);

  const keyboard = new Keyboard(window);
  const debugOverlay = new DebugOverlay(container, CONFIG.debug.refreshIntervalSeconds);
  const fpsCounter = new FpsCounter(CONFIG.debug.fpsWindowSeconds);
  addControlsHint(container);

  const resize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const step = CONFIG.simulation.fixedStepSeconds;
  let state = createVehicleState();
  let previousState = state;
  let controls: VehicleControls = NO_CONTROLS;
  let accumulator = 0;
  let lastTime: number | null = null;

  chaseCamera.snapTo(state);

  renderer.setAnimationLoop((time: number) => {
    // Cap long pauses (background tab, breakpoint) so the car does not jump.
    const frameSeconds = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.25);
    lastTime = time;

    if (keyboard.takePressed('toggleDebug')) debugOverlay.toggle();

    accumulator += frameSeconds;
    let steps = 0;
    while (accumulator >= step && steps < CONFIG.simulation.maxStepsPerFrame) {
      controls = arcadeControls(
        {
          forward: keyboard.isDown('throttle'),
          back: keyboard.isDown('brake'),
          left: keyboard.isDown('steerLeft'),
          right: keyboard.isDown('steerRight'),
        },
        state.speed,
      );
      previousState = state;
      state = stepVehicle(state, controls, step);
      accumulator -= step;
      steps += 1;
    }
    if (steps === CONFIG.simulation.maxStepsPerFrame) accumulator = 0;

    const pose = interpolatePose(previousState, state, accumulator / step);
    vehicleMesh.update(pose);
    chaseCamera.update(pose, frameSeconds);
    sun.position.set(pose.x + 20, 40, pose.z + 10);
    sun.target.position.set(pose.x, 0, pose.z);

    renderer.render(scene, camera);

    fpsCounter.tick(frameSeconds);
    debugOverlay.update(frameSeconds, {
      fps: fpsCounter.fps,
      seed: null,
      vehicle: state,
      controls,
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
  const hint = document.createElement('div');
  hint.className = 'controls-hint';
  hint.textContent = 'W gas · S brake / reverse · A D steer · ` debug';
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
