import type { DamageState } from "./types";
import { clamp } from "./rng";

export function initDamage(): DamageState {
  return {
    frontWing: 0,
    rearWing: 0,
    floor: 0,
    sidepod: 0,
    suspension: 0,
    steering: 0,
    brakes: 0,
    chassis: 0,
    cooling: 0,
    gearbox: 0,
    engine: 0,
    tire: 0,
  };
}

export function applyDamage(current: DamageState, partial: Partial<DamageState>): DamageState {
  const next: DamageState = { ...current };
  for (const key of Object.keys(partial) as (keyof DamageState)[]) {
    next[key] = clamp((next[key] ?? 0) + (partial[key] ?? 0), 0, 1);
  }
  return next;
}

export function totalDamage(damage: DamageState): number {
  return (Object.values(damage) as number[]).reduce((a, b) => a + b, 0);
}

/** Damage level 0..1 that is likely to end a race. */
export function isTerminal(damage: DamageState): string | null {
  if (damage.chassis >= 0.85) return "Chassis damage beyond safe repair";
  if (damage.engine >= 0.92) return "Power unit failure";
  if (damage.gearbox >= 0.9) return "Gearbox failure";
  if (damage.suspension >= 0.85) return "Suspension damage";
  if (damage.steering >= 0.8) return "Steering failure";
  if (damage.brakes >= 0.9) return "Brake failure";
  if (damage.cooling >= 0.9) return "Overheating — cooling system failure";
  return null;
}

/** Estimated cost (USD) to repair a damage state at the factory. */
export function repairCost(damage: DamageState, facilityLevel: number): number {
  const COSTS: Record<keyof DamageState, number> = {
    frontWing: 120_000,
    rearWing: 150_000,
    floor: 220_000,
    sidepod: 90_000,
    suspension: 180_000,
    steering: 140_000,
    brakes: 70_000,
    chassis: 900_000,
    cooling: 110_000,
    gearbox: 700_000,
    engine: 950_000,
    tire: 8_000,
  };
  let total = 0;
  for (const key of Object.keys(damage) as (keyof DamageState)[]) {
    total += COSTS[key] * (damage[key] ?? 0);
  }
  // Better factories reduce labour cost.
  const discount = 1 - clamp(facilityLevel, 0, 5) * 0.06;
  return Math.round(total * discount);
}

/** Spare parts likely consumed by a given damage profile. */
export function sparePartsNeeded(damage: DamageState): string[] {
  const parts: string[] = [];
  if (damage.frontWing > 0.2) parts.push("front-wing");
  if (damage.rearWing > 0.2) parts.push("rear-wing");
  if (damage.floor > 0.2) parts.push("floor");
  if (damage.sidepod > 0.2) parts.push("sidepod");
  if (damage.suspension > 0.2) parts.push("suspension");
  return parts;
}
