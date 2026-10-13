import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { DIRS, generateLayout, isJunctionKind, neighbour, opposite, tileCentre, type Layout } from './layout';

const SEEDS = Array.from({ length: 300 }, (_, i) => `layout-${i}`);
const layouts = SEEDS.map((seed) => generateLayout(seed));
const n = CONFIG.world.tilesPerSide;

function forEachLayout(check: (layout: Layout) => void): void {
  for (const layout of layouts) {
    try {
      check(layout);
    } catch (error) {
      throw new Error(`seed "${layout.seed}": ${(error as Error).message}`, { cause: error });
    }
  }
}

describe('town layout', () => {
  it('is the same for the same seed and different for different seeds', () => {
    expect(generateLayout('abc')).toEqual(generateLayout('abc'));
    const kinds = (seed: string): string => generateLayout(seed).tiles.map((tile) => tile.kind).join();
    expect(kinds('abc')).not.toEqual(kinds('abd'));
  });

  it('covers the town with a grid of tiles centred on the origin', () => {
    const layout = layouts[0] as Layout;
    expect(layout.tiles).toHaveLength(n * n);
    const first = tileCentre(layout, 0);
    const last = tileCentre(layout, n * n - 1);
    expect(first.x).toBeCloseTo(-last.x, 9);
    expect(first.z).toBeCloseTo(-last.z, 9);
    expect(last.x - first.x).toBeCloseTo((n - 1) * CONFIG.world.tileSize, 9);
  });

  it('has no dead ends and no road leading off the map; neighbours agree on every road', () => {
    forEachLayout((layout) => {
      for (const tile of layout.tiles) {
        const count = tile.arms.filter(Boolean).length;
        expect(count).toBeGreaterThanOrEqual(2);
        for (const d of DIRS) {
          if (!tile.arms[d]) continue;
          const other = neighbour(n, tile.index, d);
          expect(other).not.toBeNull();
          expect(layout.tiles[other as number]?.arms[opposite(d)]).toBe(true);
        }
      }
    });
  });

  it('is connected: every tile can be reached from every other', () => {
    forEachLayout((layout) => {
      const seen = new Set([0]);
      const queue = [0];
      while (queue.length > 0) {
        const tile = queue.pop() as number;
        for (const d of DIRS) {
          const other = neighbour(n, tile, d);
          if (layout.tiles[tile]?.arms[d] && other !== null && !seen.has(other)) {
            seen.add(other);
            queue.push(other);
          }
        }
      }
      expect(seen.size).toBe(n * n);
    });
  });

  it('names each tile after its roads', () => {
    forEachLayout((layout) => {
      for (const tile of layout.tiles) {
        const count = tile.arms.filter(Boolean).length;
        const expected =
          count === 2 ? (tile.arms[0] === tile.arms[2] ? ['straight'] : ['bend']) : count === 3 ? ['tee'] : ['cross', 'roundabout'];
        expect(expected).toContain(tile.kind);
      }
    });
  });

  it('always has a roundabout where main roads cross, and enough T and cross junctions', () => {
    const { minTees, minCrosses } = CONFIG.world.generation;
    forEachLayout((layout) => {
      const count = (kind: string): number => layout.tiles.filter((tile) => tile.kind === kind).length;
      expect(count('roundabout')).toBeGreaterThanOrEqual(1);
      expect(count('tee')).toBeGreaterThanOrEqual(minTees);
      expect(count('cross')).toBeGreaterThanOrEqual(minCrosses);
      for (const row of layout.mainRoads.filter((road) => road.axis === 'row')) {
        for (const col of layout.mainRoads.filter((road) => road.axis === 'col')) {
          expect(layout.tiles[row.index * n + col.index]?.kind).toBe('roundabout');
        }
      }
    });
  });

  it('keeps every main road whole, from one side of the town to the other', () => {
    forEachLayout((layout) => {
      layout.mainRoads.forEach((road, index) => {
        const links = layout.links.filter((link) => link.mainRoad === index);
        expect(links).toHaveLength(n - 1);
        for (const link of links) expect(link.roadClass).toBe('main');
        if (road.axis === 'row') expect(links.every((link) => Math.floor(link.a / n) === road.index)).toBe(true);
        else expect(links.every((link) => link.a % n === road.index)).toBe(true);
      });
    });
  });

  it('decides who gives way: the stem of a T, one pair at a cross, everyone entering a roundabout', () => {
    forEachLayout((layout) => {
      let stops = 0;
      let giveWays = 0;
      for (const tile of layout.tiles) {
        const controlled = DIRS.filter((d) => tile.controls[d] !== 'none');
        if (!isJunctionKind(tile.kind)) {
          expect(controlled).toEqual([]);
          continue;
        }
        if (tile.kind === 'roundabout') {
          for (const d of DIRS) expect(tile.controls[d]).toBe(tile.arms[d] ? 'roundabout' : 'none');
          continue;
        }
        if (tile.kind === 'tee') {
          expect(controlled).toHaveLength(1);
          const stem = controlled[0] as (typeof DIRS)[number];
          expect(tile.arms[opposite(stem)]).toBe(false);
        } else {
          expect(controlled).toHaveLength(2);
          expect(controlled[1]).toBe(opposite(controlled[0] as (typeof DIRS)[number]));
          expect(tile.controls[controlled[0] as number]).toBe(tile.controls[controlled[1] as number]);
        }
        for (const d of controlled) expect(['stop', 'giveWay']).toContain(tile.controls[d]);
        if (tile.controls.includes('stop')) stops += 1;
        if (tile.controls.includes('giveWay')) giveWays += 1;
      }
      expect(stops).toBeGreaterThanOrEqual(1);
      expect(giveWays).toBeGreaterThanOrEqual(1);
    });
  });

  it('gives main roads priority over side streets', () => {
    forEachLayout((layout) => {
      for (const link of layout.links.filter((l) => l.roadClass === 'main')) {
        for (const [tile, d] of [
          [link.a, link.dir],
          [link.b, opposite(link.dir)],
        ] as const) {
          const t = layout.tiles[tile];
          if (!t || !isJunctionKind(t.kind) || t.kind === 'roundabout') continue;
          // A main road only gives way where it ends at a T on the edge of town.
          if (t.arms[opposite(d)]) expect(t.controls[d]).toBe('none');
        }
      }
    });
  });

  it('splits the roads into streets that run from junction to junction', () => {
    forEachLayout((layout) => {
      const used = layout.streets.flatMap((street) => street.links);
      expect([...used].sort((a, b) => a - b)).toEqual(layout.links.map((_, i) => i));
      for (const street of layout.streets) {
        expect(street.dirs).toHaveLength(street.tiles.length - 1);
        const kinds = street.tiles.map((tile) => layout.tiles[tile]?.kind ?? 'none');
        expect(isJunctionKind(kinds[0] as never)).toBe(true);
        expect(isJunctionKind(kinds[kinds.length - 1] as never)).toBe(true);
        for (const kind of kinds.slice(1, -1)) expect(['straight', 'bend']).toContain(kind);
        street.dirs.forEach((d, i) => expect(neighbour(n, street.tiles[i] as number, d)).toBe(street.tiles[i + 1]));
      }
    });
  });

  it('uses the normal speed limit, a faster main road or a slower side street', () => {
    const { normal, fastMainRoad, slowStreet } = CONFIG.world.speedLimits;
    let fast = 0;
    let slow = 0;
    forEachLayout((layout) => {
      for (const street of layout.streets) {
        expect([normal, fastMainRoad, slowStreet]).toContain(street.speedLimit);
        if (street.speedLimit === fastMainRoad) expect(street.roadClass).toBe('main');
        if (street.speedLimit === slowStreet) expect(street.roadClass).toBe('minor');
      }
      if (layout.streets.some((street) => street.speedLimit === fastMainRoad)) fast += 1;
      if (layout.streets.some((street) => street.speedLimit === slowStreet)) slow += 1;
    });
    // Both kinds turn up regularly, but not on every map.
    expect(fast).toBeGreaterThan(SEEDS.length * 0.3);
    expect(fast).toBeLessThan(SEEDS.length * 0.7);
    expect(slow).toBeGreaterThan(SEEDS.length * 0.3);
  });

  it('gives up with a clear error if the minimums can never be met', () => {
    const impossible = { ...CONFIG.world, generation: { ...CONFIG.world.generation, minTees: 100, maxAttempts: 3 } };
    expect(() => generateLayout('abc', impossible)).toThrow(/abc/);
  });
});
