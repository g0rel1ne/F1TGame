import type { Circuit, CarSpec, Driver, QualifyingResultRow, Ruleset, WeatherState } from "./types";
import type { Rng } from "./rng";
import { composeLapTime, idealSetup, type Setup } from "./car";
import { defaultTireSpecs, evaluateTire } from "./tire";
import { initDamage } from "./damage";

export interface QualiEntrant {
  driverId: string;
  teamId: string;
  car: CarSpec;
  driver: Driver;
}

export interface QualiOptions {
  circuit: Circuit;
  entries: QualiEntrant[];
  weather: WeatherState;
  ruleset: Ruleset;
  setupFor: (teamId: string) => Setup;
}

function qualiLap(rng: Rng, e: QualiEntrant, opts: QualiOptions): number {
  const specs = defaultTireSpecs(opts.circuit);
  const compound = opts.weather.trackWetness > 0.6 ? "wet" : opts.weather.trackWetness > 0.25 ? "intermediate" : "soft";
  const tire = evaluateTire(specs[compound], 1, {
    trackWetness: opts.weather.trackWetness,
    trackTempC: opts.weather.trackTempC,
    driverTyreManagement: e.driver.attributes.tireManagement / 100,
    carTyreFriendliness: e.car.tireFriendliness / 100,
    circuit: opts.circuit,
    push: "push",
  });

  // Qualifying skill is a larger share than race pace.
  const qSkill = e.driver.attributes.qualifying * 0.6 + e.driver.attributes.pace * 0.4;
  const qDelta = (qSkill - 80) * 0.0005 * opts.circuit.referenceLapSeconds;

  const blockTime = rng.chance(0.16) ? rng.range(0.15, 0.55) : 0;

  const time =
    composeLapTime({
      circuit: opts.circuit,
      car: e.car,
      driver: e.driver,
      blockTimeDelta: blockTime,
      tireDelta: tire.delta,
      fuelLaps: 3,
      fuelCapacityLaps: opts.circuit.laps,
      setup: opts.setupFor(e.teamId),
      damage: initDamage(),
      noiseSeconds: rng.gaussian(0, 0.18),
      wetness: opts.weather.trackWetness,
    }) - qDelta;

  return time;
}

/**
 * Full Q1/Q2/Q3 knockout qualifying. Elimination counts come from the ruleset;
 * a ruleset with zero eliminations produces a single-shot session.
 */
export function simulateQualifying(rng: Rng, opts: QualiOptions): QualifyingResultRow[] {
  const { weather, ruleset } = opts;
  const rows = new Map<string, QualifyingResultRow>();
  for (const e of opts.entries) {
    rows.set(e.driverId, {
      position: 0,
      driverId: e.driverId,
      teamId: e.teamId,
      q1: null,
      q2: null,
      q3: null,
      best: null,
      eliminated: "none",
    });
  }

  const byBest = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const ta = rows.get(a)!.best ?? Number.POSITIVE_INFINITY;
      const tb = rows.get(b)!.best ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });

  let remaining = opts.entries.map((e) => e.driverId);

  const setSession = (ids: string[], key: "q1" | "q2" | "q3") => {
    for (const id of ids) {
      const e = opts.entries.find((x) => x.driverId === id)!;
      // Two attempts, take the best.
      const t1 = qualiLap(rng, e, opts);
      const t2 = qualiLap(rng, e, opts);
      const t = Math.min(t1, t2);
      const row = rows.get(id)!;
      row[key] = t;
      row.best = row.best === null ? t : Math.min(row.best, t);
    }
  };

  const singleShot = ruleset.q1Eliminated + ruleset.q2Eliminated === 0;

  if (singleShot) {
    setSession(remaining, weather.trackWetness > 0.5 ? "q1" : "q1");
    remaining = byBest(remaining);
  } else {
    // Q1
    setSession(remaining, "q1");
    let order = byBest(remaining);
    const q1Out = order.slice(order.length - ruleset.q1Eliminated);
    for (const id of q1Out) rows.get(id)!.eliminated = "q1";
    remaining = order.slice(0, order.length - ruleset.q1Eliminated);

    // Q2
    setSession(remaining, "q2");
    order = byBest(remaining);
    const q2Out = order.slice(order.length - ruleset.q2Eliminated);
    for (const id of q2Out) rows.get(id)!.eliminated = "q2";
    remaining = order.slice(0, order.length - ruleset.q2Eliminated);

    // Q3
    setSession(remaining, "q3");
    remaining = byBest(remaining);
  }

  // Final ordering: classified drivers by best time; eliminated by their best.
  const all = [...rows.keys()].sort((a, b) => {
    const ta = rows.get(a)!.best ?? Number.POSITIVE_INFINITY;
    const tb = rows.get(b)!.best ?? Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  all.forEach((id, i) => {
    rows.get(id)!.position = i + 1;
  });

  return [...rows.values()].sort((a, b) => a.position - b.position);
}

export function defaultSetup(): Setup {
  return { downforce: 3, balance: 0 };
}

export { idealSetup };
