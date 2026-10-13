// Seeded random numbers: the same seed always gives the same sequence, so the seed in the
// address rebuilds exactly the same town.

export interface Random {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Whole number from min to max, both included. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy; the original is left as it was. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRandom(seed: string): Random {
  const next = mulberry32(hashString(seed));
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int,
    chance: (probability) => next() < probability,
    pick<T>(items: readonly T[]): T {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new Error('Cannot pick from an empty list');
      return item;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = int(0, i);
        [result[i], result[j]] = [result[j] as T, result[i] as T];
      }
      return result;
    },
  };
}

const SEED_LETTERS = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A short new seed such as "k3x9q2" (no 0/o or 1/l, so it is easy to read out and type). */
export function randomSeed(source: () => number = Math.random): string {
  let seed = '';
  for (let i = 0; i < 6; i++) seed += SEED_LETTERS[Math.floor(source() * SEED_LETTERS.length)];
  return seed;
}

/** Turns any text into a 32-bit number (FNV-1a with a final mix so similar seeds differ a lot). */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small, fast generator with a good spread; plenty for building maps. */
function mulberry32(state: number): () => number {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
