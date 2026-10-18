import type { Circuit, Compound, Ruleset, StrategyPlan, Weather } from "./types";
import { clamp } from "./rng";

export interface PlannedStrategy {
  compounds: Compound[];
  pitLaps: number[];
}

/** Choose a sensible default strategy (stops, compounds, pit windows). */
export function defaultStrategy(
  totalLaps: number,
  circuit: Circuit,
  ruleset: Ruleset,
  startCompound?: Compound,
): PlannedStrategy {
  const wet = startCompound === "wet" || startCompound === "intermediate";
  if (wet) {
    const stop = Math.max(1, Math.round(totalLaps / 2));
    return { compounds: [startCompound as Compound, startCompound as Compound], pitLaps: [stop] };
  }

  const stops = clamp(Math.round(circuit.tyreWear * 2 + totalLaps / 45), ruleset.mandatoryPitStop ? 1 : 0, 3);
  const effectiveStops = Math.max(stops, ruleset.mandatoryPitStop ? 1 : 0);

  if (effectiveStops <= 0) return { compounds: [startCompound ?? "medium"], pitLaps: [] };

  const stint = Math.floor(totalLaps / (effectiveStops + 1));
  const pitLaps: number[] = [];
  for (let i = 1; i <= effectiveStops; i++) {
    pitLaps.push(clamp(i * stint + (i === 1 ? 1 : 0), 3, totalLaps - 3));
  }

  // Compound ladder: soft -> medium -> hard, reversed when starting on softs.
  const ladder: Compound[] = ["soft", "medium", "hard"];
  const start = startCompound ?? (circuit.tyreWear > 0.65 ? "medium" : totalLaps < 40 ? "soft" : "medium");
  const startIndex = ladder.indexOf(start);
  const compounds: Compound[] = [start];
  for (let i = 1; i <= effectiveStops; i++) {
    compounds.push(ladder[Math.min(startIndex + i, ladder.length - 1)]);
  }

  return { compounds, pitLaps };
}

export function strategyForWeather(base: PlannedStrategy, weather: Weather): PlannedStrategy {
  if (weather === "heavy-rain") return { compounds: ["wet", "wet"], pitLaps: base.pitLaps.slice(0, 1) };
  if (weather === "light-rain") return { compounds: ["intermediate", "intermediate"], pitLaps: base.pitLaps.slice(0, 1) };
  return base;
}

export function makeStrategyPlan(driverId: string, planned: PlannedStrategy): StrategyPlan {
  return {
    driverId,
    compounds: planned.compounds,
    pitLaps: planned.pitLaps,
    pushLevel: "normal",
    risk: "medium",
  };
}
