// Seeded random numbers for Monte Carlo: the same seed gives the same trials.
// ignidash's SeededRandom (glibc LCG) multiplies in floating point beyond 2^53 and loses precision,
// so the generator here is mulberry32 (public domain), exact in 32-bit integer arithmetic. The
// Box–Muller transform is as in ignidash (github.com/schelskedevco/ignidash, commit a0d4f3a,
// src/lib/calc/returns-providers/seeded-random.ts, AGPL-3.0).

/** Uniform numbers in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal number by the Box–Muller transform. */
export function gaussian(next: () => number): number {
  let u1 = next();
  while (u1 === 0) u1 = next();
  const u2 = next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Seed of trial i of a run: the run's seed and the index mixed by the murmur3 finalizer, so that
 * neighbouring trials do not start from neighbouring states.
 */
export function trialSeed(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
