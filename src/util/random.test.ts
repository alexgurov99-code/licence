import { describe, expect, it } from 'vitest';
import { createRandom, randomSeed } from './random';

const sequence = (seed: string, count = 20): number[] => {
  const random = createRandom(seed);
  return Array.from({ length: count }, () => random.next());
};

describe('seeded random numbers', () => {
  it('gives the same sequence for the same seed', () => {
    expect(sequence('abc')).toEqual(sequence('abc'));
  });

  it('gives different sequences for different seeds, even similar ones', () => {
    expect(sequence('abc')).not.toEqual(sequence('abd'));
    expect(sequence('seed1')[0]).not.toBeCloseTo(sequence('seed2')[0] ?? 0, 3);
  });

  it('stays within the requested ranges', () => {
    const random = createRandom('ranges');
    for (let i = 0; i < 1000; i++) {
      const x = random.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const r = random.range(-2, 3);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(3);
      const n = random.int(1, 3);
      expect([1, 2, 3]).toContain(n);
    }
  });

  it('reaches every whole number in a range and every item of a list', () => {
    const random = createRandom('coverage');
    const ints = new Set<number>();
    const picks = new Set<string>();
    for (let i = 0; i < 300; i++) {
      ints.add(random.int(0, 4));
      picks.add(random.pick(['a', 'b', 'c']));
    }
    expect([...ints].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...picks].sort()).toEqual(['a', 'b', 'c']);
  });

  it('shuffles a copy without losing or adding items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = createRandom('shuffle').shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('refuses to pick from an empty list', () => {
    expect(() => createRandom('x').pick([])).toThrow();
  });
});

describe('new map seeds', () => {
  it('are six easy-to-read characters', () => {
    const values = [0, 0.1, 0.5, 0.9, 0.999, 0.3];
    let i = 0;
    const seed = randomSeed(() => values[i++ % values.length] ?? 0);
    expect(seed).toMatch(/^[a-z2-9]{6}$/);
    expect(seed).not.toMatch(/[01lo]/);
  });
});
