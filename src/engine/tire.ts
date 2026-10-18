import type { Circuit, Compound } from "./types";
import { clamp } from "./rng";

export interface TireSpec {
  compound: Compound;
  /** Base lap-time offset in seconds vs the neutral reference (soft negative). */
  offset: number;
  /** Degradation rate in seconds per lap at a reference-wear circuit. */
  degRate: number;
  /** Nominal usable life in laps before the cliff. */
  lifeLaps: number;
  /** Dry-track suitability, 0..1 (slicks ~1, wets ~0). */
  drySuitability: number;
}

export interface TireEnvironment {
  trackWetness: number; // 0..1
  trackTempC: number;
  /** Driver tyre-management skill normalised 0..1. */
  driverTyreManagement: number;
  /** Car Friendliness to tyres normalised 0..1. */
  carTyreFriendliness: number;
  circuit: Circuit;
  push: "conserve" | "normal" | "push";
}

export function defaultTireSpecs(circuit: Circuit): Record<Compound, TireSpec> {
  const wearScale = 0.7 + circuit.tyreWear * 0.7;
  return {
    soft: { compound: "soft", offset: -0.55, degRate: 0.055 * wearScale, lifeLaps: Math.round(16 / wearScale), drySuitability: 1 },
    medium: { compound: "medium", offset: 0.0, degRate: 0.036 * wearScale, lifeLaps: Math.round(25 / wearScale), drySuitability: 1 },
    hard: { compound: "hard", offset: 0.5, degRate: 0.024 * wearScale, lifeLaps: Math.round(34 / wearScale), drySuitability: 1 },
    intermediate: { compound: "intermediate", offset: 3.5, degRate: 0.06 * wearScale, lifeLaps: Math.round(20 / wearScale), drySuitability: 0.35 },
    wet: { compound: "wet", offset: 8.0, degRate: 0.07 * wearScale, lifeLaps: Math.round(24 / wearScale), drySuitability: 0.05 },
  };
}

const PUSH_FACTOR = { conserve: 0.78, normal: 1, push: 1.18 } as const;

/**
 * Lap-time delta (seconds) and grip factor (0..1) for a tyre at a given age.
 * Positive delta == slower. Grip factor multiplies cornering/overtaking ability.
 */
export function evaluateTire(
  spec: TireSpec,
  age: number,
  env: TireEnvironment,
): { delta: number; gripFactor: number } {
  const wearScale =
    (0.75 + env.circuit.tyreWear * 0.6) *
    (1.18 - env.driverTyreManagement * 0.3) *
    (1.12 - env.carTyreFriendliness * 0.22) *
    PUSH_FACTOR[env.push];

  const effectiveAge = age * wearScale;

  // Base deg accumulates linearly, then a cliff past the usable life.
  let deg = spec.degRate * effectiveAge;
  if (effectiveAge > spec.lifeLaps) {
    deg += (effectiveAge - spec.lifeLaps) * spec.degRate * 2.2;
  }

  // Temperature window: soft hates excessive heat, all tyres suffer cold graining.
  const tempDelta = clamp(Math.abs(env.trackTempC - 38) / 40, 0, 1);

  // Wetness interaction. Slicks lose huge grip in the wet, wets lose grip when dry.
  const wet = env.trackWetness;
  let wetDelta: number;
  if (spec.drySuitability > 0.9) {
    wetDelta = Math.pow(wet, 1.4) * 7.5; // slicks in the wet
  } else if (spec.compound === "intermediate") {
    wetDelta = Math.abs(wet - 0.5) * 6.0 - 1.5; // best around 0.5 wetness
  } else {
    wetDelta = Math.abs(wet - 0.95) * 7.0; // full wets need a wet track
  }

  const delta = spec.offset + deg + tempDelta * 0.4 + Math.max(0, wetDelta);
  const gripFactor = clamp(1 - deg * 0.045 - tempDelta * 0.03 - Math.max(0, wetDelta) * 0.03, 0.55, 1.02);
  return { delta, gripFactor };
}

/** Whether a compound is legal to start a dry race on (top-10 qualifiers rule). */
export function isSlick(compound: Compound): boolean {
  return compound === "soft" || compound === "medium" || compound === "hard";
}
