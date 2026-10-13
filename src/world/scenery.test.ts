import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { planRoute } from '../route/planner';
import { buildRoute, type Route } from '../route/route';
import { buildNetwork, type RoadNetwork } from './network';
import { distance, project } from './path';
import { outlinePoints, polygonsOverlap } from './polygon';
import { placeScenery, type Scenery } from './scenery';

const W = CONFIG.world;
const S = W.scenery;
const ROAD_HALF = W.laneWidth + W.shoulderWidth;

interface Town {
  network: RoadNetwork;
  route: Route;
  scenery: Scenery;
}

function town(seed: string): Town {
  const network = buildNetwork(seed);
  const route = buildRoute(network, planRoute(network));
  const routeRoads = new Set(route.plan.lanes.map((id) => network.lanes[id]?.roadId ?? -1));
  return { network, route, scenery: placeScenery(network, { routeRoads, keepClear: [network.start, route.finish] }) };
}

const towns = Array.from({ length: 8 }, (_, i) => town(`scenery-${i}`));

function forEachTown(check: (t: Town) => void): void {
  for (const t of towns) {
    try {
      check(t);
    } catch (error) {
      throw new Error(`seed "${t.network.seed}": ${(error as Error).message}`, { cause: error });
    }
  }
}

const roadDistance = (network: RoadNetwork, poly: readonly { x: number; z: number }[]): number =>
  Math.min(...outlinePoints(poly, 1).flatMap((p) => network.roads.map((r) => project(r.centreline, p).distance)));

describe('scenery', () => {
  it('is the same for the same seed', () => {
    expect(JSON.stringify(town('repeat').scenery)).toBe(JSON.stringify(town('repeat').scenery));
    expect(JSON.stringify(town('repeat').scenery.items)).not.toBe(JSON.stringify(town('repeat2').scenery.items));
  });

  it('fills the town: houses, a corner shop, street lights, poles, trees, bus stops and parked cars', () => {
    forEachTown(({ scenery }) => {
      const count = (kind: string): number => scenery.items.filter((i) => i.kind === kind).length;
      expect(count('section')).toBeGreaterThan(100);
      expect(count('cornerShop')).toBeGreaterThan(0);
      expect(count('streetLight')).toBeGreaterThan(20);
      expect(count('powerPole')).toBeGreaterThan(20);
      expect(count('tree')).toBeGreaterThan(20);
      expect(count('busStop')).toBeGreaterThan(0);
      expect(count('car')).toBeGreaterThan(0);
    });
  });

  it('puts nothing on the roads or in the junctions (parked cars only on the shoulder)', () => {
    forEachTown(({ network, scenery }) => {
      for (const item of scenery.items) {
        if (item.kind === 'shrub' && item.y > 0) continue; // roundabout islands, checked below
        const nearest = roadDistance(network, item.footprint);
        if (item.kind === 'car') {
          // On the shoulder: clear of the lane, inside the edge of the seal.
          expect(nearest).toBeGreaterThan(W.laneWidth + 0.05);
          expect(nearest).toBeLessThan(ROAD_HALF);
        } else if (item.kind === 'crossing') {
          expect(nearest).toBeGreaterThanOrEqual(ROAD_HALF - 1e-6);
        } else {
          expect([item.kind, nearest > ROAD_HALF]).toEqual([item.kind, true]);
        }
        for (const j of network.junctions) {
          const inside = item.footprint.some((p) =>
            j.kind === 'roundabout' ? distance(p, j.centre) < j.size : Math.abs(p.x - j.centre.x) < j.size && Math.abs(p.z - j.centre.z) < j.size,
          );
          expect([item.kind, inside]).toEqual([item.kind, false]);
        }
      }
    });
  });

  it('keeps the sight triangles at junctions free of anything taller than a letterbox', () => {
    forEachTown(({ scenery }) => {
      expect(scenery.sightTriangles.length).toBeGreaterThan(10);
      for (const item of scenery.items) {
        if (item.height <= S.lowHeight) continue;
        const reach = item.canopy ?? item.footprint;
        const blocked = scenery.sightTriangles.some((t) => polygonsOverlap(reach, t));
        expect([item.kind, blocked]).toEqual([item.kind, false]);
      }
    });
  });

  it('leaves every sign in view: nothing tall in front of it, nothing right beside the post', () => {
    forEachTown(({ network, scenery }) => {
      expect(scenery.signCorridors.length).toBe(network.signs.length);
      for (const item of scenery.items) {
        if (item.height > S.lowHeight) {
          const reach = item.canopy ?? item.footprint;
          const hidden = scenery.signCorridors.some((c) => polygonsOverlap(reach, c));
          expect([item.kind, hidden]).toEqual([item.kind, false]);
        }
        for (const sign of network.signs) {
          if (item.kind === 'section' || item.kind === 'cornerShop') continue;
          const close = item.footprint.some((p) => distance(p, sign) < S.signClearance - 1e-6);
          expect([item.kind, close]).toEqual([item.kind, false]);
        }
      }
    });
  });

  it('keeps the start, the finish and the route clear of parked cars and roadside items', () => {
    forEachTown(({ network, route, scenery }) => {
      const routeRoads = new Set(route.plan.lanes.map((id) => network.lanes[id]?.roadId));
      for (const item of scenery.items) {
        // Houses stand well back from the road, and driveway crossings are flat.
        if (item.kind === 'section' || item.kind === 'cornerShop' || item.kind === 'crossing') continue;
        for (const spot of [network.start, route.finish]) {
          const near = item.footprint.some((p) => distance(p, spot) < S.startClearance - 1e-6);
          expect([item.kind, near]).toEqual([item.kind, false]);
        }
        if (item.kind === 'car') {
          const where = network.roads.reduce((best, r) => {
            const d = project(r.centreline, item).distance;
            return d < best.d ? { d, id: r.id } : best;
          }, { d: Infinity, id: -1 });
          expect(routeRoads.has(where.id)).toBe(false);
        }
      }
    });
  });

  it('puts only low shrubs inside roundabouts, on the island', () => {
    forEachTown(({ network, scenery }) => {
      for (const j of network.junctions.filter((x) => x.kind === 'roundabout')) {
        const inside = scenery.items.filter((i) => distance(i, j.centre) < W.roundabout.outerRadius + 1);
        expect(inside.length).toBe(S.islandShrubs);
        for (const item of inside) {
          expect(item.kind).toBe('shrub');
          expect(item.height).toBeLessThanOrEqual(S.lowHeight);
          expect(distance(item, j.centre)).toBeLessThan(W.roundabout.islandRadius - 1);
        }
      }
    });
  });

  it('does not overlap houses, shops and roadside items with each other', () => {
    forEachTown(({ scenery }) => {
      const solid = scenery.items.filter((i) => !(i.kind === 'shrub' && i.y > 0));
      for (let a = 0; a < solid.length; a++) {
        for (let b = a + 1; b < solid.length; b++) {
          const x = solid[a];
          const y = solid[b];
          if (!x || !y || distance(x, y) > 40) continue;
          expect([x.kind, y.kind, polygonsOverlap(x.footprint, y.footprint)]).toEqual([x.kind, y.kind, false]);
        }
      }
    });
  });

  it('faces houses and shops towards the road', () => {
    forEachTown(({ network, scenery }) => {
      for (const item of scenery.items.filter((i) => i.kind === 'section' || i.kind === 'cornerShop')) {
        const ahead = { x: item.x + Math.sin(item.heading) * 10, z: item.z + Math.cos(item.heading) * 10 };
        const behind = { x: item.x - Math.sin(item.heading) * 10, z: item.z - Math.cos(item.heading) * 10 };
        const d = (p: { x: number; z: number }): number => Math.min(...network.roads.map((r) => project(r.centreline, p).distance));
        expect(d(ahead)).toBeLessThan(d(behind));
      }
    });
  });
});
