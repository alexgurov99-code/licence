import * as THREE from 'three';
import { GLANCE_TARGETS, isLookTarget, type GlanceTarget, type LookTarget } from '../camera/glance';
import type { MirrorId } from '../camera/mirrorOptics';
import { CONFIG, type PopupParams } from '../config';
import { lerp, moveTowards } from '../util/math';

// On-screen windows with the picture of a glance: a mirror, looking back or over a shoulder.
// A real mirror is a few centimetres across, far too small to read on a monitor, so while a look
// key is held its picture pops up big. In the view from behind the car the three mirrors are
// always on screen as small windows, and the one being looked at grows.
//
// The pictures are drawn with WebGL on top of the 3D view; the frames and labels are HTML
// elements laid over the same rectangles.

export type ScreenView = 'firstPerson' | 'chase';

/** CSS pixels, from the top-left corner of the screen. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Slot = 'top' | 'left' | 'right';

export interface PanelSpec {
  slot: Slot;
  /** Share of the screen width. */
  widthShare: number;
  /** Width / height of the picture. */
  aspect: number;
  label: string;
  /** For mirror windows: which mirror. */
  mirror: MirrorId | null;
}

export function panelSpecs(
  params: PopupParams = CONFIG.ui.popups,
  mirrors = CONFIG.mirrors,
  lookAspect: number = CONFIG.glance.aspect,
): Record<GlanceTarget, PanelSpec> {
  const mirror = (id: MirrorId, slot: Slot, widthShare: number, label: string): PanelSpec => ({
    slot,
    widthShare,
    aspect: mirrors[id].width / mirrors[id].height,
    label,
    mirror: id,
  });
  const look = (slot: Slot, widthShare: number, label: string): PanelSpec => ({
    slot,
    widthShare,
    aspect: lookAspect,
    label,
    mirror: null,
  });
  return {
    interiorMirror: mirror('interior', 'top', params.interiorMirrorWidth, 'Rear-view mirror'),
    leftMirror: mirror('left', 'left', params.sideMirrorWidth, 'Left mirror'),
    rightMirror: mirror('right', 'right', params.sideMirrorWidth, 'Right mirror'),
    back: look('top', params.lookBackWidth, 'Looking back'),
    leftShoulder: look('left', params.shoulderWidth, 'Over the left shoulder'),
    rightShoulder: look('right', params.shoulderWidth, 'Over the right shoulder'),
  };
}

/** Full-size window: at the top centre, or at the left or right edge a little above the middle. */
export function popupRect(spec: PanelSpec, screenWidth: number, screenHeight: number, params: PopupParams): Rect {
  const width = Math.min(spec.widthShare * screenWidth, params.maxHeight * screenHeight * spec.aspect);
  const height = width / spec.aspect;
  const y = spec.slot === 'top' ? params.margin : params.sideCentre * screenHeight - height / 2;
  const x =
    spec.slot === 'top'
      ? (screenWidth - width) / 2
      : spec.slot === 'left'
        ? params.margin
        : screenWidth - params.margin - width;
  return { x, y, width, height };
}

/** Scales a window, keeping it attached to its screen edge. */
export function scaleRect(rect: Rect, slot: Slot, scale: number): Rect {
  const width = rect.width * scale;
  const height = rect.height * scale;
  const x =
    slot === 'top' ? rect.x + (rect.width - width) / 2 : slot === 'left' ? rect.x : rect.x + rect.width - width;
  const y = slot === 'top' ? rect.y : rect.y + (rect.height - height) / 2;
  return { x, y, width, height };
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
  };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

interface Panel {
  spec: PanelSpec;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  frame: HTMLDivElement;
  /** 0 = closed, 1 = fully open. */
  open: number;
  /** Last rectangle written to the frame's style, to skip needless page layout work. */
  frameStyle: string;
}

export interface GlanceTextures {
  mirrors: Readonly<Record<MirrorId, THREE.Texture>>;
  look: THREE.Texture;
}

export class GlancePopups {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly panels: Record<GlanceTarget, Panel>;
  private screenWidth = 1;
  private screenHeight = 1;
  private anyVisible = false;
  private hudTop = '';

  constructor(
    private readonly container: HTMLElement,
    textures: GlanceTextures,
    private readonly params: PopupParams = CONFIG.ui.popups,
  ) {
    const specs = panelSpecs(params);
    const quad = new THREE.PlaneGeometry(1, 1);
    const make = (target: GlanceTarget): Panel => {
      const spec = specs[target];
      const material = new THREE.MeshBasicMaterial({
        map: spec.mirror ? textures.mirrors[spec.mirror] : textures.look,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(quad, material);
      mesh.visible = false;
      this.scene.add(mesh);
      const frame = document.createElement('div');
      frame.className = 'glance-frame';
      frame.hidden = true;
      const label = document.createElement('span');
      label.className = 'glance-label';
      label.textContent = spec.label;
      frame.appendChild(label);
      container.appendChild(frame);
      return { spec, mesh, material, frame, open: 0, frameStyle: '' };
    };
    this.panels = {
      interiorMirror: make('interiorMirror'),
      leftMirror: make('leftMirror'),
      rightMirror: make('rightMirror'),
      back: make('back'),
      leftShoulder: make('leftShoulder'),
      rightShoulder: make('rightShoulder'),
    };
  }

  resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.updateProjectionMatrix();
  }

  update(view: ScreenView, glance: { target: GlanceTarget | null; counted: boolean }, frameSeconds: number): void {
    const { params, screenWidth, screenHeight } = this;
    this.anyVisible = false;
    let hudTop = params.margin;

    for (const target of GLANCE_TARGETS) {
      const panel = this.panels[target];
      panel.open = moveTowards(panel.open, glance.target === target ? 1 : 0, frameSeconds / params.openSeconds);
    }

    for (const target of GLANCE_TARGETS) {
      const panel = this.panels[target];
      const { spec } = panel;
      const active = glance.target === target;
      const eased = smoothstep(panel.open);

      const full = popupRect(spec, screenWidth, screenHeight, params);
      // Mirror windows stay on screen in the view from behind; everything else pops up and fades.
      const pinned = view === 'chase' && spec.mirror !== null;
      const rect = pinned
        ? lerpRect(scaleRect(full, spec.slot, params.smallScale), full, eased)
        : scaleRect(full, spec.slot, lerp(0.9, 1, eased));
      const opacity = pinned ? 1 : eased;
      const visible = opacity > 0.001;
      if (pinned && spec.slot === 'top') hudTop = rect.y + rect.height + params.margin / 2;

      panel.mesh.visible = visible;
      panel.material.opacity = opacity;
      // Opening windows are drawn over the others.
      panel.mesh.renderOrder = eased;
      panel.mesh.position.set(rect.x + rect.width / 2, screenHeight - rect.y - rect.height / 2, 0);
      panel.mesh.scale.set(rect.width, rect.height, 1);
      this.anyVisible ||= visible;

      // The pictures are drawn below all the HTML, so a frame would show through a window opened
      // over it: hide frames that another, more open window in the same place covers.
      const covered = GLANCE_TARGETS.some(
        (other) => other !== target && this.panels[other].spec.slot === spec.slot && this.panels[other].open > panel.open,
      );
      panel.frame.hidden = !visible || covered;
      if (panel.frame.hidden) continue;
      const style = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;opacity:${opacity};z-index:${1 + Math.round(eased * 10)}`;
      if (style !== panel.frameStyle) {
        panel.frame.style.cssText = style;
        panel.frameStyle = style;
      }
      panel.frame.classList.toggle('small', pinned && eased < 0.5);
      panel.frame.classList.toggle('looking', active);
      panel.frame.classList.toggle('counted', active && glance.counted);
    }

    // Hint messages go just below the top window in the view from behind.
    const top = `${Math.round(hudTop)}px`;
    if (top !== this.hudTop) {
      this.container.style.setProperty('--hud-top', top);
      this.hudTop = top;
    }
  }

  /** The looking-back or over-the-shoulder window on screen, if any: its picture has to be drawn this frame. */
  visibleLook(): LookTarget | null {
    let shown: LookTarget | null = null;
    for (const target of GLANCE_TARGETS) {
      if (!isLookTarget(target)) continue;
      const { open } = this.panels[target];
      if (open > 0 && (shown === null || open > this.panels[shown].open)) shown = target;
    }
    return shown;
  }

  /** Draws the windows over the frame that is already on screen. */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.anyVisible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
