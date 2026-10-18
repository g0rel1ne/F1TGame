/**
 * Deterministic, seedable pseudo-random number generators.
 *
 * The entire race simulation is driven from a single numeric seed so that
 * replaying a saved race with the same seed and the same inputs produces the
 * same outcome on every machine. Never use Math.random() in engine code.
 */

/** Hash an arbitrary string into a 32-bit unsigned integer seed. */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seedable RNG with convenient typed helpers. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  }

  /** Raw float in [0, 1). */
  next(): number {
    // mulberry32
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller. Mean 0, stddev 1. */
  normal(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal with mean and standard deviation. */
  gaussian(mean: number, stddev: number): number {
    return mean + this.normal() * stddev;
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** Weighted pick. Weights need not be normalised. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i]);
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Fisher-Yates shuffle producing a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Derive a child RNG, e.g. per-driver or per-lap streams. Keeps determinism. */
  fork(label: string): Rng {
    return new Rng(hashSeed(`${this.state}:${label}`));
  }

  /** Current internal state, so a simulation can persist/resume mid-race. */
  getState(): number {
    return this.state >>> 0;
  }
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const round = (v: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
