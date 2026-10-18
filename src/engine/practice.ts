import type { CarSpec, Circuit, Driver, WeatherState } from "./types";
import type { Rng } from "./rng";
import { composeLapTime, convergeSetup, idealSetup, setupPenalty, type Setup } from "./car";
import { defaultTireSpecs, evaluateTire } from "./tire";
import { initDamage } from "./damage";
import { clamp } from "./rng";

export type PracticeProgram = "setup" | "long-run" | "quali-sim" | "tire-test" | "reliability";

export interface PracticeEntrant {
  driverId: string;
  teamId: string;
  car: CarSpec;
  driver: Driver;
  program: PracticeProgram;
}

export interface PracticeEntry {
  driverId: string;
  bestLap: number;
  sectorTimes: [number, number, number];
  longRunPace: number | null;
  tireWearPerLap: number | null;
  fuelEffect: number;
  feedback: string;
  setupHint: string;
  reliabilityConcern: string | null;
}

export interface PracticeResult {
  session: number;
  weather: WeatherState;
  entries: PracticeEntry[];
  /** Suggested setup after the session (players may still adjust). */
  suggestedSetup: Setup;
}

/**
 * Simulate a practice session. Programs give different information: setup work
 * narrows the ideal setup, long runs reveal tyre degradation, quali sims reveal
 * one-lap pace, reliability checks surface mechanical concerns.
 */
export function simulatePractice(
  rng: Rng,
  params: {
    session: number;
    circuit: Circuit;
    weather: WeatherState;
    entrants: PracticeEntrant[];
    currentSetup: Setup;
  },
): PracticeResult {
  const { circuit, weather, session } = params;
  const specs = defaultTireSpecs(circuit);
  const ideal = idealSetup(circuit);
  const entries: PracticeEntry[] = [];

  for (const e of params.entrants) {
    const compound = weather.trackWetness > 0.6 ? "wet" : weather.trackWetness > 0.25 ? "intermediate" : "medium";
    const tire = evaluateTire(specs[compound], 3, {
      trackWetness: weather.trackWetness,
      trackTempC: weather.trackTempC,
      driverTyreManagement: e.driver.attributes.tireManagement / 100,
      carTyreFriendliness: e.car.tireFriendliness / 100,
      circuit,
      push: "normal",
    });

    const base = composeLapTime({
      circuit,
      car: e.car,
      driver: e.driver,
      blockTimeDelta: 0,
      tireDelta: tire.delta,
      fuelLaps: e.program === "quali-sim" ? 3 : 30,
      fuelCapacityLaps: circuit.laps,
      setup: params.currentSetup,
      damage: initDamage(),
      noiseSeconds: rng.gaussian(0, 0.35),
      wetness: weather.trackWetness,
    });

    const bestLap = base + (e.program === "quali-sim" ? -0.6 : 0.4);
    const s1 = bestLap * rng.range(0.3, 0.34);
    const s3 = bestLap * rng.range(0.28, 0.33);
    const s2 = bestLap - s1 - s3;

    const longRunPace =
      e.program === "long-run" ? base + rng.range(0.4, 1.0) : null;

    const tireWearPerLap =
      e.program === "long-run" || e.program === "tire-test"
        ? clamp(specs[compound].degRate * (0.7 + circuit.tyreWear * 0.7) * (1.15 - e.driver.attributes.tireManagement / 300), 0.01, 0.2)
        : null;

    const setupHint = describeSetupHint(params.currentSetup, ideal, circuit);
    const reliabilityConcern =
      e.program === "reliability" && rng.chance(clamp(0.35 - e.car.reliability / 300, 0.02, 0.4))
        ? rng.pick(["Gearbox temperature running high", "Hydraulic pressure fluctuation detected", "Brake wear above expected", "Power unit running hot in traffic", "Suspension pick-up showing fatigue"])
        : null;

    entries.push({
      driverId: e.driverId,
      bestLap,
      sectorTimes: [s1, s2, s3],
      longRunPace,
      tireWearPerLap,
      fuelEffect: rng.range(0.02, 0.04),
      feedback: feedbackFor(e.driver, params.currentSetup, ideal, circuit),
      setupHint,
      reliabilityConcern,
    });
  }

  // Setup work converges the suggestion toward ideal, faster with more sessions.
  const converge = clamp(0.35 + session * 0.15, 0, 1);
  const suggestedSetup: Setup = convergeSetup(params.currentSetup, ideal, converge);

  return { session, weather, entries, suggestedSetup };
}

function describeSetupHint(current: Setup, ideal: Setup, circuit: Circuit): string {
  const dfDiff = ideal.downforce - current.downforce;
  const balDiff = ideal.balance - current.balance;
  const parts: string[] = [];
  if (Math.abs(dfDiff) < 0.5 && Math.abs(balDiff) < 0.5) return "Setup feels well balanced — minimal changes needed.";
  if (dfDiff > 0) parts.push("add more downforce for the corners");
  else if (dfDiff < 0) parts.push("trim out some downforce for the straights");
  if (balDiff > 0) parts.push("the car is too pointy, add front stability");
  else if (balDiff < 0) parts.push("there is understeer, free up the front");
  return `Engineers suggest: ${parts.join("; ")}. (${circuit.name})`;
}

function feedbackFor(driver: Driver, current: Setup, ideal: Setup, _circuit: Circuit): string {
  const err = setupPenalty(current, _circuit) - setupPenalty(ideal, _circuit);
  const mood =
    err < 0.15 ? "happy" : err < 0.6 ? "broadly satisfied" : err < 1.2 ? "unhappy" : "very unhappy";
  const note = driver.attributes.experience > 70 ? "The car is consistent over a stint." : "Still learning the balance over a long run.";
  return `${driver.name} is ${mood} with the balance. ${note}`;
}
