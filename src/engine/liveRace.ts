/**
 * Interactive live-race engine.
 *
 * This is the same deterministic model as `simulateRace`, but exposed as a
 * step-by-step session so a human principal can radio instructions to their own
 * drivers between laps. Anything the player changes (pace, when to pit, which
 * tyre) feeds straight back into the simulation, so what the driver is told is
 * exactly what the driver does.
 */

import type {
  CarRuntime,
  CarSpec,
  Circuit,
  ClassifiedEntry,
  Compound,
  DamageState,
  Driver,
  FlagState,
  LapRecord,
  QualifyingResultRow,
  RaceIncident,
  RaceResult,
  Ruleset,
  StrategyPlan,
  WeatherState,
} from "./types";
import { Rng, clamp, round } from "./rng";
import { composeLapTime, type Setup } from "./car";
import { defaultTireSpecs, evaluateTire, isSlick, type TireSpec } from "./tire";
import { applyDamage, initDamage, isTerminal, totalDamage } from "./damage";
import { generateIncident, type IncidentContext, type NearbyCar } from "./incidents";
import { evolveWeather } from "./weather";
import { circuitIqWeight, racerSkill } from "./driverIq";
import type { RaceSimEntrant } from "./race";

export type Pace = "conserve" | "normal" | "push";

export interface DriverCommand {
  pace: Pace;
  /** Ask to pit at the end of the current lap. */
  pitRequest: boolean;
  /** Compound to fit when boxing, or null to let the pit wall choose. */
  pitCompound: Compound | null;
}

export type LiveEventKind =
  | "start" | "overtake" | "pit" | "flag" | "incident"
  | "radio" | "retire" | "lead" | "fastest" | "finish" | "weather";

export interface LiveEvent {
  id: string;
  lap: number;
  kind: LiveEventKind;
  text: string;
  driverId?: string;
  tone: "info" | "good" | "warn" | "bad";
  color?: string;
}

export interface LiveCarView {
  driverId: string;
  teamId: string;
  position: number;
  compound: Compound;
  tireAge: number;
  gapToLeader: number;
  gapAhead: number | null;
  lastLapTime: number | null;
  bestLapTime: number | null;
  /** True on the lap the stop is actually made. */
  pit: boolean;
  /** True once the pit wall has been told to box at the end of this lap. */
  pitRequest: boolean;
  pitCompound: Compound | null;
  retired: boolean;
  pits: number;
  pace: Pace;
  fuelLaps: number;
  damagePct: number;
  controlled: boolean;
  trackProgress: number;
}

export interface LiveSnapshot {
  lap: number;
  totalLaps: number;
  flag: FlagState;
  weather: WeatherState;
  cars: LiveCarView[];
  finished: boolean;
}

export interface LiveRaceInit {
  raceId: string;
  seed: number;
  circuit: Circuit;
  totalLaps: number;
  ruleset: Ruleset;
  weatherStart: WeatherState;
  entrants: RaceSimEntrant[];
  severitySetting: "lenient" | "realistic" | "strict";
  /** Driver ids the local principal can command. */
  controlledDriverIds: string[];
  /** Qualifying classification carried into the committed result. */
  qualifying?: QualifyingResultRow[];
  /** Pole sitter carried into the committed result. */
  poleDriverId?: string | null;
}

interface LiveCar extends CarRuntime {
  car: CarSpec;
  driver: Driver;
  strategy: StrategyPlan;
  setup: Setup;
  decisionSkill: number;
  gridPosition: number;
  raw: number;
  pitThisLap: boolean;
  nextPitIndex: number;
  cumulativeTime: number;
  lapsCompleted: number;
  command: DriverCommand;
  controlled: boolean;
}

const PACE_DELTA: Record<Pace, number> = { conserve: 0.45, normal: 0, push: -0.4 };

/** Radio acknowledgements, picked by pace so the engineer feels alive. */
const PACE_ACK: Record<Pace, string[]> = {
  conserve: ["Copy, we'll manage the tyres.", "Understood — lift and coast.", "Save mode, understood."],
  normal: ["Copy, back to normal pace.", "Understood, settling into rhythm.", "Normal settings confirmed."],
  push: ["Copy, push now!", "Understood — full attack.", "Box for more performance, pushing."],
};

export class LiveRace {
  readonly raceId: string;
  readonly totalLaps: number;
  readonly circuit: Circuit;
  readonly seed: number;

  cars: LiveCar[];
  laps: LapRecord[] = [];
  incidents: RaceIncident[] = [];
  events: LiveEvent[] = [];
  flag: FlagState = "green";
  lap = 0;
  weather: WeatherState;
  finished = false;
  safetyCarDeployments = 0;
  virtualSafetyCarPeriods = 0;
  redFlags = 0;

  private readonly rng: Rng;
  private readonly specs: Record<Compound, TireSpec>;
  private readonly ruleset: Ruleset;
  private readonly severitySetting: "lenient" | "realistic" | "strict";
  private readonly qualifying: QualifyingResultRow[];
  private readonly poleDriverId: string | null;
  private neutralisedLaps = 0;
  private eventSeq = 0;
  private overallBest = Number.POSITIVE_INFINITY;
  private prevCondition: string;

  constructor(opts: LiveRaceInit) {
    this.raceId = opts.raceId;
    this.totalLaps = opts.totalLaps;
    this.circuit = opts.circuit;
    this.seed = opts.seed;
    this.ruleset = opts.ruleset;
    this.severitySetting = opts.severitySetting;
    this.qualifying = opts.qualifying ?? [];
    this.poleDriverId = opts.poleDriverId ?? null;
    this.weather = opts.weatherStart;
    this.prevCondition = opts.weatherStart.condition;
    this.rng = new Rng(`${opts.seed}:live`);
    this.specs = defaultTireSpecs(opts.circuit);

    const controlled = new Set(opts.controlledDriverIds);
    this.cars = opts.entrants
      .map((e) => {
        const startCompound = e.strategy.compounds[0] ?? "medium";
        return {
          driverId: e.driverId,
          teamId: e.teamId,
          damage: initDamage(),
          compound: startCompound,
          tireAgeLaps: 0,
          fuelLaps: opts.totalLaps,
          pitsMade: 0,
          penaltySeconds: 0,
          retired: false,
          retiredReason: null,
          gapToLeader: 0,
          trackPosition: e.gridPosition,
          lastLapTime: null,
          bestLapTime: null,
          lapTimes: [],
          trackProgress: 0,
          outOfRace: false,
          car: e.car,
          driver: e.driver,
          strategy: e.strategy,
          setup: e.setup,
          decisionSkill: e.decisionSkill,
          gridPosition: e.gridPosition,
          raw: 0,
          pitThisLap: false,
          nextPitIndex: 0,
          cumulativeTime: e.gridPosition * 0.7,
          lapsCompleted: 0,
          controlled: controlled.has(e.driverId),
          command: { pace: "normal", pitRequest: false, pitCompound: null },
        } satisfies LiveCar;
      })
      .sort((a, b) => a.trackPosition - b.trackPosition);

    this.pushEvent(0, "start", "Lights out and away we go!", "#34d399", "info");
  }

  // -- public API -----------------------------------------------------------

  setCommand(driverId: string, patch: Partial<DriverCommand>): LiveEvent | null {
    const c = this.cars.find((x) => x.driverId === driverId);
    if (!c || !c.controlled || c.retired) return null;
    const before = c.command;
    c.command = { ...before, ...patch };

    if (patch.pace && patch.pace !== before.pace) {
      const ack = PACE_ACK[patch.pace][this.eventSeq % PACE_ACK[patch.pace].length];
      return this.pushEvent(this.lap, "radio", ack, "#93c5fd", "info", driverId);
    }
    if (patch.pitRequest && !before.pitRequest) {
      return this.pushEvent(this.lap, "radio", "Box this lap, box — confirmed.", "#93c5fd", "info", driverId);
    }
    if (patch.pitRequest === false && before.pitRequest) {
      return this.pushEvent(this.lap, "radio", "Stay out, stay out — cancel the stop.", "#93c5fd", "info", driverId);
    }
    return null;
  }

  /** Advance exactly one lap. Returns the events produced by that lap. */
  step(): LiveEvent[] {
    if (this.finished) return [];
    const firstNew = this.events.length;
    const lap = this.lap + 1;
    this.lap = lap;
    const { circuit, totalLaps, specs, rng } = this;

    this.weather = evolveWeather(rng, this.weather, circuit, lap);
    if (this.weather.condition !== this.prevCondition) {
      this.prevCondition = this.weather.condition;
      this.pushEvent(lap, "weather", `Conditions are now ${this.weather.condition.replace("-", " ")}.`, "#38bdf8", "info");
    }

    const neutralised = this.neutralisedLaps > 0;
    const liveOrder = this.order();

    for (const c of liveOrder) {
      const tire = evaluateTire(specs[c.compound], c.tireAgeLaps, this.envFor(c));
      c.raw =
        composeLapTime({
          circuit,
          car: c.car,
          driver: c.driver,
          blockTimeDelta: 0,
          tireDelta: tire.delta,
          fuelLaps: c.fuelLaps,
          fuelCapacityLaps: totalLaps,
          setup: c.setup,
          damage: c.damage,
          noiseSeconds: rng.gaussian(0, 0.22),
          wetness: this.weather.trackWetness,
        }) + PACE_DELTA[c.command.pace];
    }

    if (neutralised) {
      const base = this.flag === "red-flag" ? 0 : circuit.referenceLapSeconds * 1.5;
      liveOrder.forEach((c, i) => {
        c.raw = base;
        if (this.flag === "safety-car") c.cumulativeTime = liveOrder[0].cumulativeTime + i * 0.8;
      });
    } else {
      this.applyTraffic(rng, liveOrder);
      this.handlePits(rng, liveOrder, lap, false);
    }

    if (neutralised && (this.flag === "safety-car" || this.flag === "virtual-safety-car")) {
      this.handlePits(rng, liveOrder, lap, true);
    }

    // ---- Incidents --------------------------------------------------------
    const currentOrder = this.order();
    for (const c of currentOrder) {
      if (c.retired) continue;
      const idx = currentOrder.indexOf(c);
      const nearby: NearbyCar[] = [];
      for (let j = Math.max(0, idx - 2); j <= Math.min(currentOrder.length - 1, idx + 2); j++) {
        if (j === idx) continue;
        const other = currentOrder[j];
        const gap = other.cumulativeTime - c.cumulativeTime;
        nearby.push({
          driverId: other.driverId,
          gap: -gap,
          aggression: other.driver.attributes.aggression,
          skill: clamp(other.decisionSkill * 0.5 + racerSkill(other.driver).iq * 0.5, 0, 1),
          defending: false,
        });
      }

      const ctx: IncidentContext = {
        driverId: c.driverId,
        driver: c.driver,
        carReliability: c.car.reliability,
        damage: c.damage,
        circuit,
        weather: this.weather,
        lap,
        totalLaps,
        isFirstLap: lap === 1,
        isRestart: this.neutralisedLaps === 1,
        isPitEntry: c.pitThisLap,
        strategyRisk: c.command.pace === "push" ? "high" : c.command.pace === "conserve" ? "low" : c.strategy.risk,
        compound: c.compound,
        tireAge: c.tireAgeLaps,
        tireGrip: evaluateTire(specs[c.compound], c.tireAgeLaps, this.envFor(c)).gripFactor,
        fuelLaps: c.fuelLaps,
        nearby,
        severitySetting: this.severitySetting,
        // Mistakes are a driver trait first and a strategy-crew trait second.
        decisionSkill: clamp(c.decisionSkill * 0.45 + racerSkill(c.driver).iq * 0.55, 0, 1),
      };

      const inc = generateIncident(rng, ctx, this.raceId);
      if (inc) {
        this.incidents.push(inc);
        this.applyIncident(inc);
        this.pushEvent(lap, "incident", inc.narrative, inc.severity >= 3 ? "#f87171" : "#fbbf24", inc.severity >= 3 ? "bad" : "warn", inc.involvedDriverIds[0]);

        if (inc.neutralisation === "safety-car" && this.ruleset.safetyCars) {
          this.flag = "safety-car";
          this.neutralisedLaps = Math.max(this.neutralisedLaps, rng.int(3, 5));
          this.safetyCarDeployments++;
          this.pushEvent(lap, "flag", "Safety Car deployed.", "#fbbf24", "warn");
        } else if (inc.neutralisation === "virtual-safety-car" && this.ruleset.virtualSafetyCars) {
          this.flag = "virtual-safety-car";
          this.neutralisedLaps = Math.max(this.neutralisedLaps, rng.int(2, 3));
          this.virtualSafetyCarPeriods++;
          this.pushEvent(lap, "flag", "Virtual Safety Car.", "#fbbf24", "warn");
        } else if (inc.neutralisation === "red-flag" && this.ruleset.redFlags) {
          this.flag = "red-flag";
          this.neutralisedLaps = Math.max(this.neutralisedLaps, rng.int(3, 6));
          this.redFlags++;
          this.pushEvent(lap, "flag", "Red flag — session suspended.", "#f87171", "bad");
        }
      }
    }

    // ---- Accumulate -------------------------------------------------------
    const afterOrder = this.order();
    const pittedThisLap: Record<string, boolean> = {};
    for (const c of afterOrder) {
      pittedThisLap[c.driverId] = c.pitThisLap;
      if (this.flag === "red-flag") {
        c.pitThisLap = false;
        continue;
      }
      c.cumulativeTime += c.raw + c.penaltySeconds;
      c.penaltySeconds = 0;
      c.lapsCompleted += 1;
      c.lastLapTime = round(c.raw, 3);
      if (c.bestLapTime === null || c.raw < c.bestLapTime) c.bestLapTime = round(c.raw, 3);
      c.lapTimes.push(round(c.raw, 3));
      c.trackProgress = (lap / totalLaps) % 1;
      if (c.pitThisLap) c.pitsMade += 1;
      c.pitThisLap = false;
      c.fuelLaps = Math.max(0, c.fuelLaps - 1);
      c.tireAgeLaps += 1;

      if (c.lastLapTime && c.lastLapTime < this.overallBest && this.flag === "green") {
        if (this.overallBest < Number.POSITIVE_INFINITY) {
          this.pushEvent(lap, "fastest", `${c.driver.name} sets the fastest lap: ${this.fmt(c.lastLapTime)}.`, "#a78bfa", "good", c.driverId);
        }
        this.overallBest = c.lastLapTime;
      }

      const reliabilityRisk = (1 - clamp(c.car.reliability / 100, 0, 1)) * 0.0009;
      const damageRisk = (c.damage.engine + c.damage.gearbox + c.damage.cooling) * 0.004;
      if (!c.retired && rng.chance(reliabilityRisk + damageRisk)) {
        c.retired = true;
        c.retiredReason = isTerminal(c.damage) ?? "Mechanical failure";
        this.pushEvent(lap, "retire", `${c.driver.name} stops with a mechanical problem.`, "#f87171", "bad", c.driverId);
      }
    }

    this.recordLap(afterOrder, pittedThisLap, lap);

    // Radio reminder if a controlled car's tyres are past their prime.
    for (const c of afterOrder) {
      if (!c.controlled || c.retired) continue;
      const spec = specs[c.compound];
      if (c.tireAgeLaps > spec.lifeLaps * 0.95 && !c.command.pitRequest) {
        this.pushEvent(lap, "radio", `${c.driver.name}'s tyres are going off — consider boxing.`, "#fbbf24", "warn", c.driverId);
      }
    }

    if (neutralised) {
      this.neutralisedLaps -= 1;
      if (this.neutralisedLaps <= 0) {
        this.flag = "green";
        this.pushEvent(lap, "flag", "Track is green again.", "#34d399", "good");
      }
    }

    if (lap >= totalLaps || this.running().length < 2) {
      this.finished = true;
      this.flag = "chequered";
      this.pushEvent(lap, "finish", "Chequered flag! Race complete.", "#e5e7eb", "good");
    }

    return this.events.slice(firstNew);
  }

  snapshot(): LiveSnapshot {
    const sorted = [...this.cars].sort((a, b) => a.trackPosition - b.trackPosition);
    const cars: LiveCarView[] = sorted.map((c, i) => ({
      driverId: c.driverId,
      teamId: c.teamId,
      position: i + 1,
      compound: c.compound,
      tireAge: c.tireAgeLaps,
      gapToLeader: c.gapToLeader,
      gapAhead: null,
      lastLapTime: c.lastLapTime,
      bestLapTime: c.bestLapTime,
      pit: c.pitThisLap,
      pitRequest: c.command.pitRequest,
      pitCompound: c.command.pitCompound,
      retired: c.retired,
      pits: c.pitsMade,
      pace: c.command.pace,
      fuelLaps: c.fuelLaps,
      damagePct: clamp(totalDamage(c.damage) / 3, 0, 1),
      controlled: c.controlled,
      trackProgress: c.trackProgress,
    }));
    for (let i = 1; i < cars.length; i++) {
      cars[i].gapAhead = round(Math.max(0, cars[i].gapToLeader - cars[i - 1].gapToLeader), 3);
    }
    return {
      lap: this.lap,
      totalLaps: this.totalLaps,
      flag: this.flag,
      weather: this.weather,
      cars,
      finished: this.finished,
    };
  }

  finalize(): { result: RaceResult; damageByDriver: Record<string, DamageState>; runtimeByDriver: Record<string, CarRuntime> } {
    const { circuit, ruleset } = this;
    const finishers = [...this.cars].sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
      return a.cumulativeTime - b.cumulativeTime;
    });

    const leaderTime = finishers.find((c) => !c.retired)?.cumulativeTime ?? 0;
    const timed = this.cars.filter((c) => c.bestLapTime !== null);
    const bestLapOverall = timed.length > 0 ? Math.min(...timed.map((c) => c.bestLapTime as number)) : 0;
    const fastestDriver = this.cars.find((c) => c.bestLapTime === bestLapOverall && !c.retired) ?? this.cars.find((c) => c.bestLapTime === bestLapOverall);

    const classification: ClassifiedEntry[] = finishers.map((c, i) => {
      const position = i + 1;
      let points = 0;
      if (!c.retired && position - 1 < ruleset.racePoints.length) points = ruleset.racePoints[position - 1];
      const isFastest = c.driverId === fastestDriver?.driverId && !c.retired;
      if (isFastest && ruleset.fastestLapPoints > 0 && position <= ruleset.fastestLapTopN) {
        points += ruleset.fastestLapPoints;
      }
      const gapSeconds = c.retired ? null : round(c.cumulativeTime - leaderTime, 3);
      return {
        position,
        driverId: c.driverId,
        teamId: c.teamId,
        laps: c.lapsCompleted,
        timeSeconds: c.retired ? null : round(c.cumulativeTime, 3),
        gap: c.retired
          ? "DNF"
          : position === 1
            ? "WINNER"
            : gapSeconds !== null && gapSeconds < circuit.referenceLapSeconds
              ? `+${gapSeconds.toFixed(3)}`
              : `+${((gapSeconds ?? 0) / (circuit.referenceLapSeconds || 90)).toFixed(3)} lap`,
        bestLap: c.bestLapTime,
        points,
        status: c.retired ? "dnf" : "finished",
        pits: c.pitsMade,
        fastestLap: isFastest,
        gridPosition: c.gridPosition,
        penalties: 0,
      };
    });

    const damageByDriver: Record<string, DamageState> = {};
    const runtimeByDriver: Record<string, CarRuntime> = {};
    for (const c of this.cars) {
      damageByDriver[c.driverId] = c.damage;
      runtimeByDriver[c.driverId] = {
        driverId: c.driverId,
        teamId: c.teamId,
        damage: c.damage,
        compound: c.compound,
        tireAgeLaps: c.tireAgeLaps,
        fuelLaps: c.fuelLaps,
        pitsMade: c.pitsMade,
        penaltySeconds: 0,
        retired: c.retired,
        retiredReason: c.retiredReason,
        gapToLeader: c.gapToLeader,
        trackPosition: c.trackPosition,
        lastLapTime: c.lastLapTime,
        bestLapTime: c.bestLapTime,
        lapTimes: c.lapTimes,
        trackProgress: c.trackProgress,
        outOfRace: c.retired,
      };
    }

    const result: RaceResult = {
      id: this.raceId,
      careerId: "",
      season: 0,
      raceIndex: 0,
      circuitId: circuit.id,
      session: "race",
      seed: this.seed,
      weatherStart: this.weather.condition,
      classification,
      qualifying: this.qualifying,
      incidents: this.incidents,
      laps: this.laps,
      safetyCarDeployments: this.safetyCarDeployments,
      virtualSafetyCarPeriods: this.virtualSafetyCarPeriods,
      redFlags: this.redFlags,
      fastestLapDriverId: fastestDriver?.driverId ?? null,
      poleDriverId: this.poleDriverId,
      winnerDriverId: classification[0]?.driverId ?? null,
      finalDamage: damageByDriver,
      processed: false,
      createdAt: Date.now(),
    };

    return { result, damageByDriver, runtimeByDriver };
  }

  // -- internals ------------------------------------------------------------

  private running(): LiveCar[] {
    return this.cars.filter((c) => !c.retired);
  }

  private order(): LiveCar[] {
    return [...this.running()].sort((a, b) => a.cumulativeTime - b.cumulativeTime);
  }

  private envFor(c: LiveCar) {
    return {
      trackWetness: this.weather.trackWetness,
      trackTempC: this.weather.trackTempC,
      driverTyreManagement: c.driver.attributes.tireManagement / 100,
      carTyreFriendliness: c.car.tireFriendliness / 100,
      circuit: this.circuit,
      push: c.command.pace,
    };
  }

  private autoCompound(c: LiveCar): Compound {
    if (this.weather.trackWetness > 0.62) return "wet";
    if (this.weather.trackWetness > 0.22) return "intermediate";
    return c.strategy.compounds[Math.min(c.nextPitIndex + 1, c.strategy.compounds.length - 1)] ?? "medium";
  }

  private applyTraffic(rng: Rng, liveOrder: LiveCar[]): void {
    const { circuit } = this;
    const iqWeight = circuitIqWeight(circuit);
    for (let i = 1; i < liveOrder.length; i++) {
      const attacker = liveOrder[i];
      const defender = liveOrder[i - 1];
      const gap = attacker.cumulativeTime - defender.cumulativeTime;
      const drsAvailable = circuit.drsZones.length > 0 && gap < 1.0 && this.weather.trackWetness < 0.35;

      if (gap < 1.4) {
        const atk = racerSkill(attacker.driver);
        const def = racerSkill(defender.driver);
        const paceAdvantage = defender.raw - attacker.raw;
        // A smart driver loses less time in dirty air - they manage the aero wash.
        const dirty = (1.4 - gap) * 0.12 * (0.6 + circuit.aeroDemand) * (1.15 - atk.iq * 0.3);
        attacker.raw += dirty;

        if (paceAdvantage > 0.05) {
          // Driver IQ turns a pace advantage into a pass: late braking into a
          // heavy braking zone, a read on where the defender will cover.
          const passScore =
            circuit.overtaking * 0.42 +
            atk.attack * 0.28 +
            (drsAvailable ? 0.16 : 0) +
            clamp(paceAdvantage * 0.15, 0, 0.15) +
            (atk.iq - def.iq) * 0.12 +
            circuit.brakingDemand * atk.attack * 0.08 * iqWeight -
            def.defend * 0.16;
          if (rng.chance(clamp(passScore * 0.55, 0, 0.92))) {
            defender.raw += rng.range(0.05, 0.3);
          } else {
            attacker.raw = defender.raw + rng.range(0.03, 0.25);
          }
        }
      }
    }
  }

  private handlePits(rng: Rng, liveOrder: LiveCar[], lap: number, underNeutralisation: boolean): void {
    const { circuit, totalLaps, specs } = this;
    for (const c of liveOrder) {
      if (c.retired) continue;
      const lapsLeft = totalLaps - lap;
      if (lapsLeft < 1) continue;

      let shouldStop = false;
      let next: Compound;

      if (c.controlled) {
        if (!c.command.pitRequest) continue;
        shouldStop = true;
        next = c.command.pitCompound ?? this.autoCompound(c);
      } else {
        const planned = c.strategy.pitLaps[c.nextPitIndex];
        const spec = specs[c.compound];
        const worn = c.tireAgeLaps > spec.lifeLaps * 1.05;
        const wrongTires =
          (this.weather.trackWetness > 0.62 && isSlick(c.compound)) ||
          (this.weather.trackWetness < 0.18 && !isSlick(c.compound));
        const plannedNow = planned !== undefined && lap >= planned && c.nextPitIndex < c.strategy.compounds.length - 1;
        const emergency = (worn || wrongTires) && c.nextPitIndex < c.strategy.compounds.length - 1;
        const aiWantsStop = emergency && rng.chance(0.5 + c.decisionSkill * 0.4);
        shouldStop =
          plannedNow ||
          aiWantsStop ||
          (underNeutralisation && c.nextPitIndex < c.strategy.compounds.length - 1 && rng.chance(0.35 + c.decisionSkill * 0.3));
        next = c.strategy.compounds[Math.min(c.nextPitIndex + 1, c.strategy.compounds.length - 1)];
        if (this.weather.trackWetness > 0.62) next = "wet";
        else if (this.weather.trackWetness > 0.22) next = "intermediate";
        else if (!isSlick(next)) next = "medium";
      }

      if (!shouldStop) continue;

      const pitLoss = circuit.pitLossSeconds * (underNeutralisation ? 0.55 : 1) + rng.gaussian(0, 1.2) + c.driver.attributes.concentration * -0.01;
      const stopTime = clamp(pitLoss, 14, 40);
      c.raw += stopTime;

      c.compound = next;
      c.tireAgeLaps = 0;
      c.nextPitIndex = Math.min(c.nextPitIndex + 1, c.strategy.compounds.length);
      c.pitThisLap = true;
      if (c.controlled) {
        c.command.pitRequest = false;
        c.command.pitCompound = null;
      }
      this.pushEvent(lap, "pit", `${c.driver.name} pits for ${next} tyres.`, "#60a5fa", "info", c.driverId);
    }
  }

  private applyIncident(inc: RaceIncident): void {
    for (const [driverId, partial] of Object.entries(inc.damage)) {
      const c = this.cars.find((x) => x.driverId === driverId);
      if (!c || c.retired) continue;
      c.damage = applyDamage(c.damage, partial);
      const terminal = isTerminal(c.damage);
      if (inc.severity >= 4 || terminal) {
        c.retired = true;
        c.retiredReason = inc.severity >= 4 ? `${inc.kind} (${inc.corner})` : (terminal as string);
      }
    }
    if (inc.penalty) {
      const c = this.cars.find((x) => x.driverId === inc.penalty!.driverId);
      if (!c) return;
      if (inc.penalty.type === "time") c.penaltySeconds += inc.penalty.seconds;
      else if (inc.penalty.type === "drive-through") c.penaltySeconds += 20;
      else if (inc.penalty.type === "stop-go") c.penaltySeconds += 10 + inc.penalty.seconds;
    }
  }

  private recordLap(afterOrder: LiveCar[], pittedThisLap: Record<string, boolean>, lap: number): void {
    const prevPositions = new Map<string, number>();
    if (this.laps.length > 0) {
      for (const e of this.laps[this.laps.length - 1].entries) prevPositions.set(e.driverId, e.position);
    }
    const prevLeader = this.laps.length > 0 ? this.laps[this.laps.length - 1].entries[0]?.driverId : null;

    const leader = afterOrder[0];
    const entries = afterOrder.map((c, i) => {
      c.trackPosition = i + 1;
      c.gapToLeader = leader ? round(c.cumulativeTime - leader.cumulativeTime, 3) : 0;
      return {
        driverId: c.driverId,
        position: i + 1,
        lapTime: this.flag === "red-flag" ? 0 : round(c.raw, 3),
        compound: c.compound,
        tireAge: c.tireAgeLaps,
        gapToLeader: c.gapToLeader,
        pit: pittedThisLap[c.driverId] ?? false,
        flag: this.flag,
        retired: c.retired,
      };
    });
    this.laps.push({ lap, entries });

    if (lap < 2) return;

    // Lead change.
    const newLeader = entries[0]?.driverId;
    if (prevLeader && newLeader && newLeader !== prevLeader) {
      const d = this.cars.find((c) => c.driverId === newLeader);
      if (d) this.pushEvent(lap, "lead", `${d.driver.name} takes the lead!`, "#34d399", "good", newLeader);
    }

    // Overtakes (ignoring position swings caused by pit stops).
    for (const e of entries) {
      const was = prevPositions.get(e.driverId);
      if (was === undefined || e.position >= was) continue;
      if (e.pit) continue;
      const passed = entries.find((o) => o.position > e.position && (prevPositions.get(o.driverId) ?? 999) < was && !o.pit);
      if (!passed) continue;
      const a = this.cars.find((c) => c.driverId === e.driverId);
      const b = this.cars.find((c) => c.driverId === passed.driverId);
      if (a && b) this.pushEvent(lap, "overtake", `${a.driver.name} passes ${b.driver.name} for P${e.position}.`, "#93c5fd", "info", e.driverId);
    }
  }

  private pushEvent(lap: number, kind: LiveEventKind, text: string, color: string, tone: LiveEvent["tone"], driverId?: string): LiveEvent {
    const ev: LiveEvent = { id: `${this.raceId}:ev:${this.eventSeq++}`, lap, kind, text, driverId, tone, color };
    this.events.push(ev);
    if (this.events.length > 240) this.events.splice(0, this.events.length - 240);
    return ev;
  }

  private fmt(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }
}
