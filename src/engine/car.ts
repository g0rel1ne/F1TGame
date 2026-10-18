import type { CarSpec, Circuit, DamageState, Driver, UpgradeArea } from "./types";
import { clamp } from "./rng";

export interface EffectiveCar {
  aeroEfficiency: number;
  downforce: number;
  drag: number;
  cornering: number;
  straightLine: number;
  braking: number;
  mechanicalGrip: number;
  tireFriendliness: number;
  fuelEfficiency: number;
  reliability: number;
  cooling: number;
  wetPerformance: number;
  weight: number;
}

/**
 * Apply installed upgrade points to the baseline car. Upgrades are additive
 * points; the mapping mirrors which subsystems each part actually influences.
 */
export function effectiveCar(car: CarSpec): EffectiveCar {
  const p = (a: UpgradeArea) => car.installed[a] ?? 0;
  const aeroPts = p("front-wing") + p("rear-wing") + p("floor") + p("sidepods");
  const mechPts = p("suspension") + p("chassis");

  return {
    aeroEfficiency: car.aeroEfficiency + aeroPts * 0.45,
    downforce: car.downforce + aeroPts * 0.62,
    // Upgrades add downforce with a small drag penalty; efficient teams add less drag.
    drag: car.drag - aeroPts * 0.1,
    cornering: car.cornering + mechPts * 0.5 + aeroPts * 0.12,
    straightLine: car.straightLine + p("engine") * 0.7 + p("gearbox") * 0.2,
    braking: car.braking + p("brakes") * 0.85 + mechPts * 0.1,
    mechanicalGrip: car.mechanicalGrip + mechPts * 0.55,
    tireFriendliness: car.tireFriendliness + mechPts * 0.25,
    fuelEfficiency: car.fuelEfficiency + p("engine") * 0.45,
    reliability: car.reliability + p("reliability") * 0.8 + p("engine") * 0.1,
    cooling: car.cooling + p("cooling") * 0.9,
    wetPerformance: car.wetPerformance + aeroPts * 0.08,
    weight: Math.max(680, car.weight - mechPts * 1.5 - aeroPts * 0.3),
  };
}

/** Circuit-weighted car performance index, roughly 0..100. */
export function carPerformanceAtCircuit(car: CarSpec, circuit: Circuit): number {
  const e = effectiveCar(car);
  const aero = e.aeroEfficiency * 0.5 + e.downforce * 0.5 - e.drag * 0.3;
  const mech = e.mechanicalGrip * 0.6 + e.cornering * 0.25 + e.braking * 0.15;
  const power = e.straightLine * 0.85 + e.fuelEfficiency * 0.15;

  const wA = clamp(circuit.aeroDemand, 0.05, 0.9);
  const wT = clamp(circuit.tractionDemand, 0.05, 0.9);
  const wB = clamp(circuit.brakingDemand, 0.05, 0.9);
  const wP = clamp(1.4 - wA - wT - wB, 0.15, 0.7);

  const total = wA + wT + wB + wP;
  return (aero * wA + mech * wT + e.braking * wB + power * wP) / total;
}

/** A driver-independent reference performance level, so deltas are meaningful. */
export const CAR_REFERENCE = 78;

/** Seconds of lap time gained per performance point relative to reference. */
export const CAR_TIME_SCALE = 0.00075;

export interface Setup {
  /** 1 (low) .. 5 (high) downforce trim. Derived from the wing angles when those are set. */
  downforce: number;
  /** -2 (oversteer) .. +2 (understeer) balance. Derived from the wing angles when those are set. */
  balance: number;
  /** Front wing flap angle / aero load, 0 (minimum trim) .. 10 (maximum). */
  frontWing?: number;
  /** Rear wing flap angle / aero load, 0 .. 10. */
  rearWing?: number;
  /** Ride height, 0 (low, aggressive aero) .. 10 (high, compliant). */
  rideHeight?: number;
  /** Front brake bias, percent, 50 .. 70. */
  brakeBias?: number;
  /** Differential locking, 0 (open) .. 10 (locked). */
  differential?: number;
}

/** Editable aero/mechanical parts on the car. */
export type SetupPart = "frontWing" | "rearWing" | "rideHeight" | "brakeBias" | "differential";

export const SETUP_RANGES: Record<SetupPart, { min: number; max: number; step: number }> = {
  frontWing: { min: 0, max: 10, step: 1 },
  rearWing: { min: 0, max: 10, step: 1 },
  rideHeight: { min: 0, max: 10, step: 1 },
  brakeBias: { min: 50, max: 70, step: 1 },
  differential: { min: 0, max: 10, step: 1 },
};

/** Neutral baseline used when no detailed setup has been chosen yet. */
export const NEUTRAL_SETUP: Setup = {
  downforce: 3,
  balance: 0,
  frontWing: 5,
  rearWing: 5,
  rideHeight: 5,
  brakeBias: 58,
  differential: 5,
};

/** True when every mechanical part has an explicit value (the Garage model). */
export function hasDetailedSetup(setup: Setup): boolean {
  return (
    typeof setup.frontWing === "number" &&
    typeof setup.rearWing === "number" &&
    typeof setup.rideHeight === "number" &&
    typeof setup.brakeBias === "number" &&
    typeof setup.differential === "number"
  );
}

/**
 * Convert wing angles into the coarse downforce/balance axes the simulation
 * reasons about, so the detailed Garage model stays consistent with the
 * two-axis model used by qualifying, practice and the race engine.
 */
export function deriveAxes(frontWing: number, rearWing: number): { downforce: number; balance: number } {
  return {
    downforce: clamp(Math.round(1 + (frontWing + rearWing) / 5), 1, 5),
    balance: clamp(Math.round((frontWing - rearWing) / 2.5), -2, 2),
  };
}

/** Reverse of `deriveAxes`: pick wing angles for a coarse downforce/balance. */
export function wingFromAxes(downforce: number, balance: number): { frontWing: number; rearWing: number } {
  const total = (clamp(downforce, 1, 5) - 1) * 5;
  const diff = clamp(balance, -2, 2) * 2.5;
  return {
    frontWing: clamp(Math.round((total + diff) / 2), 0, 10),
    rearWing: clamp(Math.round((total - diff) / 2), 0, 10),
  };
}

/** Clamp an arbitrary setup payload into legal ranges, discarding junk. */
export function sanitizeSetup(raw: Partial<Setup> | null | undefined): Setup {
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : fallback;
  };
  const detailed =
    !!raw &&
    (raw.frontWing !== undefined || raw.rearWing !== undefined || raw.rideHeight !== undefined || raw.brakeBias !== undefined || raw.differential !== undefined);
  const base: Setup = {
    downforce: num(raw?.downforce, 1, 5, 3),
    balance: num(raw?.balance, -2, 2, 0),
  };
  if (!detailed) return base;
  const frontWing = num(raw?.frontWing, 0, 10, 5);
  const rearWing = num(raw?.rearWing, 0, 10, 5);
  return {
    ...base,
    ...deriveAxes(frontWing, rearWing),
    frontWing,
    rearWing,
    rideHeight: num(raw?.rideHeight, 0, 10, 5),
    brakeBias: num(raw?.brakeBias, 50, 70, 58),
    differential: num(raw?.differential, 0, 10, 5),
  };
}

export interface IdealSetup extends Setup {
  frontWing: number;
  rearWing: number;
  rideHeight: number;
  brakeBias: number;
  differential: number;
}

/** The ideal setup a circuit rewards; practice feedback converges players onto it. */
export function idealSetup(circuit: Circuit): IdealSetup {
  const aeroDemand = clamp(circuit.aeroDemand, 0, 1);
  const df = clamp(Math.round(1 + 4 * aeroDemand), 1, 5);
  const bal = clamp(Math.round((circuit.tractionDemand - 0.5) * 3), -2, 2);
  const totalWing = (df - 1) * 5;
  const diff = bal * 2.5;
  return {
    downforce: df,
    balance: bal,
    frontWing: clamp(Math.round((totalWing + diff) / 2), 0, 10),
    rearWing: clamp(Math.round((totalWing - diff) / 2), 0, 10),
    rideHeight: clamp(Math.round(10 - aeroDemand * 8), 2, 9),
    brakeBias: clamp(Math.round(54 + circuit.brakingDemand * 12), 50, 70),
    differential: clamp(Math.round(3 + circuit.tractionDemand * 8), 0, 10),
  };
}

const RIDE_SECONDS = 0.8;
const BRAKE_SECONDS = 0.5;
const DIFF_SECONDS = 0.5;

/** Penalty in seconds for a given setup at a circuit (0 == perfect). */
export function setupPenalty(setup: Setup, circuit: Circuit): number {
  const ideal = idealSetup(circuit);
  const axes = hasDetailedSetup(setup) ? deriveAxes(setup.frontWing!, setup.rearWing!) : { downforce: setup.downforce, balance: setup.balance };

  const dfErr = Math.abs(axes.downforce - ideal.downforce) / 4;
  const balErr = Math.abs(axes.balance - ideal.balance) / 4;
  let penalty = dfErr * 1.6 + balErr * 1.1;

  if (hasDetailedSetup(setup)) {
    penalty += (Math.abs(setup.rideHeight! - ideal.rideHeight) / 10) * RIDE_SECONDS;
    penalty += (Math.abs(setup.brakeBias! - ideal.brakeBias) / 20) * BRAKE_SECONDS;
    penalty += (Math.abs(setup.differential! - ideal.differential) / 10) * DIFF_SECONDS;
  }
  return penalty;
}

export interface SetupBreakdownRow {
  part: "aero" | SetupPart;
  label: string;
  value: number;
  ideal: number;
  seconds: number;
}

/** Per-part contribution to the setup penalty, for the Garage read-out. */
export function setupBreakdown(setup: Setup, circuit: Circuit): { rows: SetupBreakdownRow[]; total: number; ideal: IdealSetup } {
  const ideal = idealSetup(circuit);
  const wings = hasDetailedSetup(setup) ? { frontWing: setup.frontWing!, rearWing: setup.rearWing! } : wingFromAxes(setup.downforce, setup.balance);
  const axes = deriveAxes(wings.frontWing, wings.rearWing);
  const rideHeight = setup.rideHeight ?? ideal.rideHeight;
  const brakeBias = setup.brakeBias ?? ideal.brakeBias;
  const differential = setup.differential ?? ideal.differential;

  const rows: SetupBreakdownRow[] = [
    { part: "aero", label: "Aero load", value: axes.downforce, ideal: ideal.downforce, seconds: (Math.abs(axes.downforce - ideal.downforce) / 4) * 1.6 },
    { part: "aero", label: "Aero balance", value: axes.balance, ideal: ideal.balance, seconds: (Math.abs(axes.balance - ideal.balance) / 4) * 1.1 },
    { part: "rideHeight", label: "Ride height", value: rideHeight, ideal: ideal.rideHeight, seconds: (Math.abs(rideHeight - ideal.rideHeight) / 10) * RIDE_SECONDS },
    { part: "brakeBias", label: "Brake bias", value: brakeBias, ideal: ideal.brakeBias, seconds: (Math.abs(brakeBias - ideal.brakeBias) / 20) * BRAKE_SECONDS },
    { part: "differential", label: "Differential", value: differential, ideal: ideal.differential, seconds: (Math.abs(differential - ideal.differential) / 10) * DIFF_SECONDS },
  ];
  const total = rows.reduce((sum, r) => sum + r.seconds, 0);
  return { rows, total, ideal };
}

/** Move a setup partway toward the ideal, preserving the detailed parts when present. */
export function convergeSetup(prev: Setup, ideal: Setup, blend: number): Setup {
  const r = clamp(blend, 0, 1);
  const mix = (a: number, b: number) => a + (b - a) * r;
  const out: Setup = {
    downforce: Math.round(mix(prev.downforce, ideal.downforce)),
    balance: Math.round(mix(prev.balance, ideal.balance)),
  };
  if (hasDetailedSetup(prev) && hasDetailedSetup(ideal)) {
    const frontWing = Math.round(mix(prev.frontWing!, ideal.frontWing!));
    const rearWing = Math.round(mix(prev.rearWing!, ideal.rearWing!));
    Object.assign(out, deriveAxes(frontWing, rearWing), {
      frontWing,
      rearWing,
      rideHeight: Math.round(mix(prev.rideHeight!, ideal.rideHeight!)),
      brakeBias: Math.round(mix(prev.brakeBias!, ideal.brakeBias!)),
      differential: Math.round(mix(prev.differential!, ideal.differential!)),
    });
  }
  return out;
}

/** Additional lap-time penalty from accumulated damage. */
export function damagePenalty(damage: DamageState, circuit: Circuit): number {
  const aero = (damage.frontWing * 1.4 + damage.rearWing * 1.1 + damage.floor * 1.0 + damage.sidepod * 0.4) * (0.6 + circuit.aeroDemand);
  const mech = (damage.suspension * 1.5 + damage.steering * 1.3 + damage.brakes * 0.8) * (0.6 + circuit.tractionDemand);
  const power = damage.engine * 1.6 + damage.gearbox * 0.8;
  const tire = damage.tire * 3.0;
  return aero + mech + power + tire;
}

/** Full dry-weather lap-time composition for one car+driver at one circuit. */
export function composeLapTime(params: {
  circuit: Circuit;
  car: CarSpec;
  driver: Driver;
  blockTimeDelta: number;
  tireDelta: number;
  fuelLaps: number;
  fuelCapacityLaps: number;
  setup: Setup;
  damage: DamageState;
  noiseSeconds: number;
  wetness: number;
}): number {
  const perf = carPerformanceAtCircuit(params.car, params.circuit);
  const e = effectiveCar(params.car);

  const carDelta = (perf - CAR_REFERENCE) * CAR_TIME_SCALE * params.circuit.referenceLapSeconds;

  // Driver pace: 0..100 mapped so ~80 is reference.
  const paceSkill = params.driver.attributes.pace * 0.62 + params.driver.attributes.racecraft * 0.18 + params.driver.attributes.consistency * 0.2;
  const driverDelta = (paceSkill - 80) * 0.00042 * params.circuit.referenceLapSeconds;

  // Wet performance blends driver wet skill and car wet performance.
  const wetPenaltyBase = params.wetness > 0.15
    ? (1 - (params.driver.attributes.wet / 100) * e.wetPerformance / 100) * params.wetness * 4.0
    : 0;

  const fuelKg = params.fuelLaps * 1.7;
  const fuelPenalty = fuelKg * 0.03 * (1.05 - e.fuelEfficiency / 400);

  const lapTime =
    params.circuit.referenceLapSeconds -
    carDelta -
    driverDelta +
    params.tireDelta +
    params.blockTimeDelta +
    fuelPenalty +
    setupPenalty(params.setup, params.circuit) +
    damagePenalty(params.damage, params.circuit) +
    wetPenaltyBase +
    params.noiseSeconds;

  return lapTime;
}
