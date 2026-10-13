import * as THREE from 'three';
import type { RoadNetwork, Turn } from './network';
import { add, forward, leftOf, pointAt, samplePath, type Path, type Vec2 } from './path';

const COLOURS = {
  lane: 0x4aa3ff,
  junction: 0xffe14d,
  limitLine: 0xff3b30,
  turns: { left: 0x3ddc84, straight: 0xffffff, right: 0xff9f1a, uTurn: 0xff4fd8 } satisfies Record<Turn, number>,
};

/**
 * The road network drawn as lines for the debug view: lane centres with arrows for the direction
 * of travel, the paths through junctions coloured by turn (green left, white straight, orange
 * right, pink U-turn), junction outlines and limit lines. Drawn on top of everything.
 */
export class DebugGraph {
  readonly object: THREE.LineSegments;

  constructor(network: RoadNetwork) {
    const positions: number[] = [];
    const colours: number[] = [];
    const segment = (a: Vec2, b: Vec2, y: number, hex: number): void => {
      const c = new THREE.Color(hex);
      positions.push(a.x, y, a.z, b.x, y, b.z);
      colours.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const polyline = (path: Path, y: number, hex: number, step: number): void => {
      const points = samplePath(path, 0, path.length, step);
      for (let i = 1; i < points.length; i++) segment(points[i - 1] as Vec2, points[i] as Vec2, y, hex);
    };
    const arrow = (path: Path, s: number, y: number, hex: number): void => {
      const p = pointAt(path, s);
      const back = forward(p.heading);
      const side = leftOf(p.heading);
      for (const k of [-1, 1]) segment(p, add(add(p, back, -1.5), side, k * 0.8), y, hex);
    };

    for (const lane of network.lanes) {
      polyline(lane.path, 0.3, COLOURS.lane, 2);
      for (let s = 15; s < lane.path.length - 5; s += 30) arrow(lane.path, s, 0.3, COLOURS.lane);
    }
    for (const connector of network.connectors) {
      polyline(connector.path, 0.35, COLOURS.turns[connector.turn], 1);
    }
    for (const junction of network.junctions) {
      const { x, z } = junction.centre;
      const r = junction.size;
      if (junction.kind === 'roundabout') {
        const n = 48;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const b = ((i + 1) / n) * Math.PI * 2;
          segment(
            { x: x + r * Math.sin(a), z: z + r * Math.cos(a) },
            { x: x + r * Math.sin(b), z: z + r * Math.cos(b) },
            0.3,
            COLOURS.junction,
          );
        }
      } else {
        const corners = [
          { x: x - r, z: z - r },
          { x: x + r, z: z - r },
          { x: x + r, z: z + r },
          { x: x - r, z: z + r },
        ];
        corners.forEach((p, i) => segment(p, corners[(i + 1) % 4] as Vec2, 0.3, COLOURS.junction));
      }
    }
    for (const line of network.limitLines) segment(line.a, line.b, 0.4, COLOURS.limitLine);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, fog: false });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.name = 'debug graph';
    this.object.renderOrder = 10;
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
