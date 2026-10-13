import * as THREE from 'three';
import { CONFIG } from '../config';
import { MIRROR_IDS, mirrorView, type MirrorAims, type MirrorId } from './mirrorOptics';

type MirrorSpecs = Pick<typeof CONFIG.mirrors, MirrorId | 'textureWidth'>;

interface Mirror {
  camera: THREE.Camera;
  target: THREE.WebGLRenderTarget;
}

/**
 * Live mirror pictures. Each mirror has a camera at the driver's eye reflected in its glass
 * (see mirrorOptics.ts) that draws into a texture every frame. The textures go on the glass in
 * the cabin and into the on-screen mirror windows.
 */
export class MirrorCameras {
  private readonly mirrors: Record<MirrorId, Mirror>;

  constructor(
    car: THREE.Object3D,
    private readonly specs: MirrorSpecs = CONFIG.mirrors,
  ) {
    const make = (id: MirrorId): Mirror => {
      const { width, height } = specs[id];
      const pixelsWide = specs.textureWidth;
      const target = new THREE.WebGLRenderTarget(pixelsWide, Math.round((pixelsWide * height) / width), {
        samples: 4,
        colorSpace: THREE.SRGBColorSpace,
      });
      // The camera sees the scene through the glass from behind, so left and right are swapped
      // compared with what the driver sees in the mirror. Flip the picture back.
      target.texture.repeat.set(-1, 1);
      target.texture.offset.set(1, 0);
      // A plain camera: its frame is set directly from the glass shape, never from a field of view.
      const camera = new THREE.Camera();
      camera.name = `${id} mirror`;
      car.add(camera);
      return { camera, target };
    };
    this.mirrors = { interior: make('interior'), left: make('left'), right: make('right') };
  }

  get textures(): Record<MirrorId, THREE.Texture> {
    const { interior, left, right } = this.mirrors;
    return { interior: interior.target.texture, left: left.target.texture, right: right.target.texture };
  }

  /** Call when the driver's eye or a mirror angle changes. */
  aim(aims: MirrorAims, eye: THREE.Vector3): void {
    for (const id of MIRROR_IDS) {
      const view = mirrorView(this.specs[id], aims[id], eye, CONFIG.camera.far);
      const { camera } = this.mirrors[id];
      camera.position.copy(view.position);
      camera.quaternion.copy(view.quaternion);
      camera.projectionMatrix.copy(view.projection);
      camera.projectionMatrixInverse.copy(view.projection).invert();
    }
  }

  /** Draws all three mirror pictures. `prepare` runs before each one (e.g. to show or hide parts of the car). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, prepare: (id: MirrorId) => void): void {
    const previous = renderer.getRenderTarget();
    for (const id of MIRROR_IDS) {
      prepare(id);
      renderer.setRenderTarget(this.mirrors[id].target);
      renderer.render(scene, this.mirrors[id].camera);
    }
    renderer.setRenderTarget(previous);
  }
}
