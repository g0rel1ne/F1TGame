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
import { getCircuitProfile, type CircuitProfile } from "./trackProfile";

export type Pace = "conserve" | "normal" | "push";
export type FuelMode = "lean" | "standard" | "rich";
export type ErsMode = "off" | "medium" | "high";
export type PitPhase = "none" | "entry" | "stop" | "exit";

export interface DriverCommand {
  pace: Pace;
  /** Ask to pit at the end of the current lap. */
  pitRequest: boolean;
  /** Compound to fit when boxing, or null to let the pit wall choose. */
  pitCompound: Compound | null;
  /** Fuel mixture: lean saves fuel, rich releases performance. */
  fuelMode: FuelMode;
  /** ERS deployment level for the next lap. */
  ers: ErsMode;
}

export type LiveControlMode = "human" | "ai";

/**
 * Every state-changing instruction applied to a live session, in delivery
 * order. Replaying this log against the same career and seed reproduces the
 * race exactly, so the server can validate a result instead of trusting the
 * host's finishing order.
 */
export type LiveAuditEntry =
  | { afterLap: number; type: "command"; driverId: string; patch: Partial<DriverCommand> }
  | { afterLap: number; type: "control"; driverId: string; mode: LiveControlMode };

export interface LiveRaceAudit {
  sessionId: string;
  raceId: string;
  entries: LiveAuditEntry[];
}

const ALL_COMPOUNDS: Compound[] = ["soft", "medium", "hard", "intermediate", "wet"];

/** Only a tiny, well-understood set of fields may be set remotely or replayed. */
export function sanitizeDriverCommand(patch: Partial<DriverCommand>): Partial<DriverCommand> {
  const out: Partial<DriverCommand> = {};
  if (patch.pace === "conserve" || patch.pace === "normal" || patch.pace === "push") out.pace = patch.pace;
  if (patch.pitCompound && ALL_COMPOUNDS.includes(patch.pitCompound)) out.pitCompound = patch.pitCompound;
  if (typeof patch.pitRequest === "boolean") out.pitRequest = patch.pitRequest;
  if (patch.fuelMode === "lean" || patch.fuelMode === "standard" || patch.fuelMode === "rich") out.fuelMode = patch.fuelMode;
  if (patch.ers === "off" || patch.ers === "medium" || patch.ers === "high") out.ers = patch.ers;
  return out;
}

export type LiveEventKind =
  | "start" | "overtake" | "pit" | "flag" | "incident"
  | "radio" | "retire" | "lead" | "fastest" | "finish" | "weather";

/** A visible sub-lap battle technique, derived from the circuit profile. */
export type OvertakeMode = "none" | "slipstream" | "dive" | "outside" | "switchback" | "defend";

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
  /** Stationary time of the most recent stop, in seconds. */
  lastPitStopSeconds: number;
  pace: Pace;
  fuelMode: FuelMode;
  ers: ErsMode;
  ersCharge: number;
  fuelLaps: number;
  damagePct: number;
  /** The principal owns this car, whether or not they currently have control. */
  controlled: boolean;
  controlMode: LiveControlMode;
  /** Fraction of the current lap, following the corner-speed profile. */
  trackProgress: number;
  /** Laps completed at the last timing line. */
  lapsCompleted: number;
  /** Current local speed, 0..1 of a flat-out straight. */
  speed: number;
  /** Braking force 0..1, used for brake-light intensity and deceleration. */
  brake: number;
  /** Throttle opening 0..1 out of the corner. */
  throttle: number;
  braking: boolean;
  /** Dirty-air tow from the car ahead, 0..1. */
  tow: number;
  /** Lateral racing-line offset in track pixels, used for side-by-side battles. */
  laneOffset: number;
  overtakeMode: OvertakeMode;
  overtakeTargetId: string | null;
  defending: boolean;
  drs: boolean;
  blueFlag: boolean;
  penaltyCount: number;
  penaltySeconds: number;
  pitPhase: PitPhase;
  /** 0..1 progress through the pit lane while `pitPhase` is active. */
  pitProgress: number;
  /** Wheel-to-wheel contact risk, used for sparks and side-by-side rendering. */
  contact: number;
  /** Track height at the car's current position, relative to the lap minimum. */
  elevationMetres: number;
}

export interface LiveSnapshot {
  lap: number;
  totalLaps: number;
  flag: FlagState;
  weather: WeatherState;
  cars: LiveCarView[];
  finished: boolean;
  /** Where the safety car sits on the lap, if one is deployed. */
  safetyCarProgress: number | null;
  /** Broadcast clock, 0..1 through the current lap. */
  lapFraction: number;
}

export interface LiveRaceInit {
  raceId: string;
  /** Stable id for one live session; used to correlate reconnects and audits. */
  sessionId?: string;
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
  /** Lap on which the last stop was made, used to animate the pit exit. */
  pitStopLap: number | null;
  lastPitStopSeconds: number;
  nextPitIndex: number;
  cumulativeTime: number;
  lapsCompleted: number;
  command: DriverCommand;
  controlled: boolean;
  controlMode: LiveControlMode;
  ersCharge: number;
  penaltyCount: number;
  pitPhase: PitPhase;
  pitProgress: number;
  contact: number;
  lapTarget: number;
  broadcastProgress: number;
  broadcastSpeed: number;
  broadcastBraking: boolean;
  broadcastDrs: boolean;
}

const PACE_DELTA: Record<Pace, number> = { conserve: 0.45, normal: 0, push: -0.4 };
const FUEL_DELTA: Record<FuelMode, number> = { lean: 0.24, standard: 0, rich: -0.16 };
const FUEL_BURN: Record<FuelMode, number> = { lean: 0.66, standard: 1, rich: 1.28 };
const ERS_DELTA: Record<ErsMode, number> = { off: 0.1, medium: -0.06, high: -0.2 };
const ERS_DRAIN: Record<ErsMode, number> = { off: 0, medium: 0.14, high: 0.32 };
const GRID_GAP_SECONDS = 0.22;

/** Stable 0..1 value for deterministic battle intent across broadcast frames. */
function stableUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Radio acknowledgements, picked by pace so the engineer feels alive. */
const PACE_ACK: Record<Pace, string[]> = {
  conserve: ["Copy, we'll manage the tyres.", "Understood — lift and coast.", "Save mode, understood."],
  normal: ["Copy, back to normal pace.", "Understood, settling into rhythm.", "Normal settings confirmed."],
  push: ["Copy, push now!", "Understood — full attack.", "Box for more performance, pushing."],
};

export class LiveRace {
  readonly raceId: string;
  readonly sessionId: string;
  readonly totalLaps: number;
  readonly circuit: Circuit;
  readonly seed: number;

  cars: LiveCar[];
  laps: LapRecord[] = [];
  incidents: RaceIncident[] = [];
  events: LiveEvent[] = [];
  auditEntries: LiveAuditEntry[] = [];
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
  private readonly profile: CircuitProfile;
  private neutralisedLaps = 0;
  private redFlagGridSet = false;
  private eventSeq = 0;
  private overallBest = Number.POSITIVE_INFINITY;
  private prevCondition: string;

  constructor(opts: LiveRaceInit) {
    this.raceId = opts.raceId;
    this.sessionId = opts.sessionId ?? opts.raceId;
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
    this.profile = getCircuitProfile(opts.circuit);

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
          pitStopLap: null,
          lastPitStopSeconds: 0,
          nextPitIndex: 0,
          cumulativeTime: e.gridPosition * GRID_GAP_SECONDS,
          lapsCompleted: 0,
          controlled: controlled.has(e.driverId),
          controlMode: controlled.has(e.driverId) ? "human" : "ai",
          command: { pace: "normal", pitRequest: false, pitCompound: null, fuelMode: "standard", ers: "medium" },
          ersCharge: 0.72,
          penaltyCount: 0,
          pitPhase: "none",
          pitProgress: 0,
          contact: 0,
          lapTarget: composeLapTime({
            circuit: opts.circuit,
            car: e.car,
            driver: e.driver,
            blockTimeDelta: 0,
            tireDelta: 0,
            fuelLaps: opts.totalLaps,
            fuelCapacityLaps: opts.totalLaps,
            setup: e.setup,
            damage: initDamage(),
            noiseSeconds: 0,
            wetness: opts.weatherStart.trackWetness,
          }),
          broadcastProgress: 0,
          broadcastSpeed: 0.4,
          broadcastBraking: false,
          broadcastDrs: false,
        } satisfies LiveCar;
      })
      .sort((a, b) => a.trackPosition - b.trackPosition);

    this.pushEvent(0, "start", "Lights out and away we go!", "#34d399", "info");
  }

  // -- public API -----------------------------------------------------------

  setCommand(driverId: string, patch: Partial<DriverCommand>): LiveEvent | null {
    const c = this.cars.find((x) => x.driverId === driverId);
    if (!c || !c.controlled || c.controlMode !== "human" || c.retired) return null;
    const clean = sanitizeDriverCommand(patch);
    if (Object.keys(clean).length === 0) return null;
    const before = c.command;
    c.command = { ...before, ...clean };
    this.auditEntries.push({ afterLap: this.lap, type: "command", driverId, patch: { ...clean } });

    if (clean.pace && clean.pace !== before.pace) {
      const ack = PACE_ACK[clean.pace][this.eventSeq % PACE_ACK[clean.pace].length];
      return this.pushEvent(this.lap, "radio", ack, "#93c5fd", "info", driverId);
    }
    if (clean.pitRequest && !before.pitRequest) {
      return this.pushEvent(this.lap, "radio", "Box this lap, box — confirmed.", "#93c5fd", "info", driverId);
    }
    if (clean.pitRequest === false && before.pitRequest) {
      return this.pushEvent(this.lap, "radio", "Stay out, stay out — cancel the stop.", "#93c5fd", "info", driverId);
    }
    return null;
  }

  /**
   * Hand a principal's cars to the AI when they disconnect and back when they
   * reconnect. The log makes the handover part of the deterministic replay.
   */
  setControlMode(driverId: string, mode: LiveControlMode): LiveEvent | null {
    const c = this.cars.find((x) => x.driverId === driverId);
    if (!c || !c.controlled || c.retired || c.controlMode === mode) return null;
    c.controlMode = mode;
    c.command = { pace: "normal", pitRequest: false, pitCompound: null, fuelMode: "standard", ers: "medium" };
    this.auditEntries.push({ afterLap: this.lap, type: "control", driverId, mode });
    return this.pushEvent(
      this.lap,
      "radio",
      mode === "ai"
        ? `${c.driver.name} — connection lost. The pit wall is taking over.`
        : `${c.driver.name} — connection restored. You have the car.`,
      "#93c5fd",
      mode === "ai" ? "warn" : "good",
      driverId,
    );
  }

  /**
   * End a red-flag suspension. The neutralised steps are deterministic, so the
   * audit replay reaches the same state even though the host held the clock.
   */
  resumeFromRedFlag(): LiveEvent[] {
    if (this.flag !== "red-flag") return [];
    const firstNew = this.events.length;
    let guard = 0;
    while (this.flag === "red-flag" && guard < 20) {
      this.step();
      guard++;
    }
    this.neutralisedLaps = 0;
    this.flag = "green";
    this.redFlagGridSet = false;
    return this.events.slice(firstNew);
  }

  /** Advance exactly one lap. Returns the events produced by that lap. */
  step(): LiveEvent[] {
    if (this.finished) return [];
    const firstNew = this.events.length;

    // A red flag suspends the race clock instead of consuming race laps.
    // The host can hold the broadcast here while the field regroups; the
    // deterministic audit replay simply steps through the same suspension.
    if (this.flag === "red-flag") {
      this.neutralisedLaps = Math.max(0, this.neutralisedLaps - 1);
      if (this.neutralisedLaps === 0) {
        this.flag = "green";
        this.redFlagGridSet = false;
        for (const c of this.cars) {
          c.broadcastProgress = 0;
          c.broadcastSpeed = 0;
          c.broadcastBraking = false;
          c.broadcastDrs = false;
          c.contact = 0;
        }
        this.pushEvent(this.lap, "flag", "Race restarted from the grid.", "#34d399", "good");
      }
      return this.events.slice(firstNew);
    }

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

    const ersAvailable = (c: LiveCar) => c.ersCharge > 0.08;
    for (const c of liveOrder) {
      const tire = evaluateTire(specs[c.compound], c.tireAgeLaps, this.envFor(c));
      const ersDelta = ersAvailable(c) ? ERS_DELTA[c.command.ers] : ERS_DELTA.off;
      c.lapTarget =
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
        }) + PACE_DELTA[c.command.pace] + FUEL_DELTA[c.command.fuelMode] + ersDelta;
      // Running dry is a genuine emergency, not a subtle pace offset.
      if (c.fuelLaps <= 0.15) c.lapTarget += 18;
      c.raw = c.lapTarget;
    }

    if (neutralised) {
      const base = circuit.referenceLapSeconds * 1.5;
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

      // Track limits: pushing hard and running rich makes a mistake more likely,
      // especially at a high-commitment circuit. The penalty is real time added
      // to the car's race total, not just a banner.
      if (!neutralised && rng.chance(
        0.0025 +
        (c.command.pace === "push" ? 0.0045 : 0) +
        (c.command.fuelMode === "rich" ? 0.0015 : 0) +
        circuit.brakingDemand * 0.003,
      )) {
        c.penaltySeconds += 5;
        c.penaltyCount += 1;
        this.pushEvent(lap, "incident", `${c.driver.name} exceeds track limits — five-second penalty.`, "#fbbf24", "warn", c.driverId);
      }

      c.cumulativeTime += c.raw + c.penaltySeconds;
      c.penaltySeconds = 0;
      c.lapsCompleted += 1;
      c.lastLapTime = round(c.raw, 3);
      if (c.bestLapTime === null || c.raw < c.bestLapTime) c.bestLapTime = round(c.raw, 3);
      c.lapTimes.push(round(c.raw, 3));
      c.trackProgress = (c.lapsCompleted / totalLaps) % 1;
      if (c.pitThisLap) c.pitsMade += 1;
      c.pitThisLap = false;
      const burn = FUEL_BURN[c.command.fuelMode];
      c.fuelLaps = Math.max(0, c.fuelLaps - burn);
      c.ersCharge = clamp(c.ersCharge + 0.16 - (ersAvailable(c) ? ERS_DRAIN[c.command.ers] : 0), 0, 1);
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

    // A red flag stops the lap before it is completed: the race clock rolls
    // back so the interrupted lap is re-run after the standing restart.
    if (this.flag === "red-flag") {
      this.lap = lap - 1;
      if (!this.redFlagGridSet) {
        this.prepareRestartGrid(afterOrder);
        this.redFlagGridSet = true;
      }
      return this.events.slice(firstNew);
    }

    this.recordLap(afterOrder, pittedThisLap, lap);

    // Radio reminder if a controlled car's tyres are past their prime.
    for (const c of afterOrder) {
      if (!c.controlled || c.controlMode !== "human" || c.retired) continue;
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
    return this.broadcastSnapshot(0);
  }

  /**
   * Sub-lap broadcast state. The official classification still comes from the
   * deterministic lap model, but this projects every car along the circuit's
   * corner-speed profile, so the broadcast shows braking, acceleration,
   * side-by-side battles and live position changes.
   */
  broadcastSnapshot(lapFraction: number): LiveSnapshot {
    const u = this.finished ? 1 : clamp(lapFraction, 0, 1);
    const running = this.cars.filter((c) => !c.retired);
    const ordered = [...running].sort((a, b) => a.cumulativeTime - b.cumulativeTime);
    const leader = ordered[0] ?? null;
    const leaderLaps = Math.max(0, ...this.cars.map((c) => c.lapsCompleted));
    const leaderTarget = leader?.lapTarget ?? this.circuit.referenceLapSeconds;

    const projected = this.cars.map((c) => {
      const target = Math.max(45, c.lapTarget || this.circuit.referenceLapSeconds);
      const gapToLeader = c.cumulativeTime - (leader?.cumulativeTime ?? 0);
      const elapsed = u * leaderTarget - gapToLeader;
      let distance = leaderLaps + elapsed / target;
      let timeFraction = (elapsed / target) % 1;
      if (timeFraction < 0) timeFraction += 1;

      if (this.flag === "red-flag") {
        distance = c.lapsCompleted + c.broadcastProgress;
        timeFraction = c.broadcastProgress;
      }
      if (this.finished) {
        distance = c.lapsCompleted;
        timeFraction = 1;
      }

      const progress = this.finished ? 1 : this.profile.progressAtTime(timeFraction);
      const profileSpeed = this.profile.speedAt(progress);
      const speed = this.finished || this.flag === "red-flag" ? 0 : profileSpeed * (this.circuit.referenceLapSeconds / target);
      const cornerNow = this.profile.cornerAt(progress);
      const cornerAhead = this.profile.cornerAt((progress + 0.045) % 1);
      let cornerSpeed = profileSpeed;
      for (let ahead = 0.004; ahead <= 0.075; ahead += 0.004) {
        cornerSpeed = Math.min(cornerSpeed, this.profile.speedAt((progress + ahead) % 1));
      }
      const brake = !this.finished && this.flag !== "red-flag"
        ? clamp((profileSpeed - cornerSpeed) / 0.22 + Math.max(0, profileSpeed - this.profile.speedAt((progress - 0.012 + 1) % 1)) * 0.2, 0, 1)
        : 0;
      const braking = brake > 0.08 || (cornerNow !== null && profileSpeed < 0.8) || (cornerAhead !== null && cornerAhead !== cornerNow);
      const throttle = this.finished || this.flag !== "green" ? 0 : clamp((profileSpeed - 0.3) / 0.7, 0, 1);
      const direction = this.profile.directionAt((progress + 0.018) % 1) || this.profile.directionAt(progress) || (c.gridPosition % 2 === 0 ? 1 : -1);
      const drsZone = this.circuit.drsZones.some((z) => {
        const span = (z.end - z.start + 1) % 1;
        const rel = (progress - z.start + 1) % 1;
        return rel <= (span || 1);
      });
      return {
        c, target, distance, progress, timeFraction, speed, braking, brake, throttle, direction, drsZone,
        overtakeMode: "none" as OvertakeMode,
        laneOffset: 0,
        tow: 0,
        defending: false,
        overtakeTargetId: null as string | null,
      };
    });

    // Safety-car queue: the leader controls the pace and the field closes up.
    if (this.flag === "safety-car" && leader && ordered.length > 0) {
      const leaderProjection = projected.find((p) => p.c === leader)!;
      ordered.forEach((c, i) => {
        const p = projected.find((x) => x.c === c)!;
        p.progress = (leaderProjection.progress - i * 0.012 + 1) % 1;
        p.distance = leaderProjection.distance - i * 0.009;
        p.timeFraction = this.profile.timeAt(p.progress);
        p.speed = this.profile.speedAt(p.progress);
      });
    }

    const sorted = [...projected].sort((a, b) => {
      if (a.c.retired !== b.c.retired) return a.c.retired ? 1 : -1;
      return b.distance - a.distance;
    });
    const leaderDistance = sorted[0]?.distance ?? 0;

    // Corner-by-corner battle intent. A car close enough to the car ahead
    // chooses a real technique: sit in the tow, lunge up the inside under
    // braking, go around the outside, or switch back after the apex. The
    // defender covers the inside if their racecraft says they saw it coming.
    if (this.flag === "green" && !this.finished && this.lap > 0) {
      for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i];
        const ahead = sorted[i - 1];
        if (p.c.retired || ahead.c.retired) continue;
        const gap = Math.max(0, (ahead.distance - p.distance) * p.target);
        if (gap > 1.1) continue;

        const corner = this.profile.cornerAt((p.progress + 0.03) % 1);
        const cornerKey = corner ?? Math.round(((p.progress + 0.03) % 1) * 10);
        const brakingZone = p.brake > 0.16 || this.profile.speedAt((p.progress + 0.035) % 1) < p.speed * 0.95;
        const drsUsable = p.drsZone && gap < 1 && this.weather.trackWetness < 0.35;
        const paceDelta = ahead.c.lapTarget - p.c.lapTarget;
        const attackSkill = (p.c.driver.attributes.overtaking + p.c.driver.attributes.aggression * 100) / 2;
        const intent = stableUnit(`${this.seed}:attack:${this.lap}:${p.c.driverId}:${cornerKey}`);
        const late = intent > 0.5;
        const inside = p.direction || (p.c.gridPosition % 2 === 0 ? 1 : -1);

        let mode: OvertakeMode = "none";
        let lane = 0;
        if (brakingZone && gap < 0.55 && (late || attackSkill > 62)) {
          mode = "dive";
          lane = inside * 1.55;
        } else if (drsUsable && gap < 0.9) {
          mode = "slipstream";
        } else if (brakingZone && gap < 0.9 && intent > 0.42) {
          mode = "outside";
          lane = -inside * 1.35;
        } else if (gap < 0.7 && paceDelta > 0 && intent > 0.52) {
          mode = "slipstream";
        } else {
          continue;
        }

        if (ahead.overtakeMode === "none" && !ahead.defending) {
          const defence = ahead.c.driver.attributes.defending;
          const cover = stableUnit(`${this.seed}:defend:${this.lap}:${ahead.c.driverId}:${cornerKey}`) * 100 < defence + 18;
          if (cover) {
            ahead.overtakeMode = "defend";
            ahead.defending = true;
            ahead.overtakeTargetId = p.c.driverId;
            ahead.laneOffset = (ahead.direction || inside) * 1.35;
          }
        }

        if (ahead.defending && lane !== 0 && Math.sign(ahead.laneOffset) === Math.sign(lane)) {
          mode = mode === "dive" ? "switchback" : "outside";
          lane = -inside * 1.35;
        }

        p.overtakeMode = mode;
        p.laneOffset = lane;
        p.tow = clamp(1 - gap / 1.1, 0, 1) * (drsUsable ? 1 : 0.62);
        p.overtakeTargetId = ahead.c.driverId;
      }
    }

    const cars: LiveCarView[] = sorted.map((p, i) => {
      const c = p.c;
      // Pit animation follows the broadcast clock so every car gets a clear
      // entry, stationary stop and exit, even when its own lap is offset.
      const plannedPitLap = c.strategy.pitLaps[c.nextPitIndex];
      const aiPitNow =
        !c.controlled &&
        !c.retired &&
        plannedPitLap !== undefined &&
        plannedPitLap === this.lap + 1 &&
        c.nextPitIndex < c.strategy.compounds.length - 1;
      const pitRequestWindow = (c.command.pitRequest || aiPitNow) && !c.retired && !this.finished && u > 0.9;
      const pitExitWindow = !c.retired && !this.finished && c.pitStopLap === this.lap && u < 0.08;
      const inPitWindow = pitRequestWindow || pitExitWindow;
      const pitPhase: PitPhase = !inPitWindow
        ? "none"
        : pitExitWindow
          ? "exit"
          : u > 0.965
            ? "stop"
            : "entry";
      const pitProgress = !inPitWindow
        ? 0
        : pitRequestWindow
          ? u > 0.965
            ? 1
            : clamp((u - 0.9) / 0.065, 0, 1)
          : clamp(1 - u / 0.08, 0, 1);
      const ahead = sorted[i - 1];
      const gapAhead = ahead ? Math.max(0, (ahead.distance - p.distance) * p.target) : null;
      const gapToLeader = Math.max(0, (leaderDistance - p.distance) * p.target);
      const blueFlag = !c.retired && leaderDistance - p.distance > 0.78 && leaderDistance - p.distance < 1.2;
      const lateralGap = ahead ? Math.abs(p.laneOffset - ahead.laneOffset) : 99;
      const contact = ahead && gapAhead !== null && gapAhead < 0.42 && lateralGap < 1.15 && !c.retired && !ahead.c.retired
        ? clamp((1 - gapAhead / 0.42) * (1 - lateralGap / 1.15), 0, 1)
        : 0;
      const drs = !!ahead && p.drsZone && gapAhead !== null && gapAhead < 1.0 && this.weather.trackWetness < 0.35;

      c.broadcastProgress = p.progress;
      c.broadcastSpeed = p.speed;
      c.broadcastBraking = p.braking;
      c.broadcastDrs = drs;
      c.contact = contact;

      return {
        driverId: c.driverId,
        teamId: c.teamId,
        position: i + 1,
        compound: c.compound,
        tireAge: c.tireAgeLaps,
        gapToLeader: round(gapToLeader, 3),
        gapAhead: gapAhead === null ? null : round(gapAhead, 3),
        lastLapTime: c.lastLapTime,
        bestLapTime: c.bestLapTime,
        pit: inPitWindow,
        pitRequest: c.command.pitRequest,
        pitCompound: c.command.pitCompound,
        retired: c.retired,
        pits: c.pitsMade,
        lastPitStopSeconds: round(c.lastPitStopSeconds, 2),
        pace: c.command.pace,
        fuelMode: c.command.fuelMode,
        ers: c.command.ers,
        ersCharge: round(c.ersCharge, 3),
        fuelLaps: c.fuelLaps,
        damagePct: clamp(totalDamage(c.damage) / 3, 0, 1),
        controlled: c.controlled,
        controlMode: c.controlMode,
        trackProgress: p.progress,
        lapsCompleted: c.lapsCompleted,
        speed: round(p.speed, 3),
        brake: round(p.brake, 3),
        throttle: round(p.throttle, 3),
        braking: p.braking,
        tow: round(p.tow, 3),
        laneOffset: p.laneOffset,
        overtakeMode: p.overtakeMode,
        overtakeTargetId: p.overtakeTargetId,
        defending: p.defending,
        drs,
        blueFlag,
        penaltyCount: c.penaltyCount,
        penaltySeconds: c.penaltySeconds,
        pitPhase,
        pitProgress,
        contact,
        elevationMetres: round(this.profile.elevationAt(p.progress), 1),
      } satisfies LiveCarView;
    });

    return {
      lap: this.lap,
      totalLaps: this.totalLaps,
      flag: this.flag,
      weather: this.weather,
      cars,
      finished: this.finished,
      safetyCarProgress: this.flag === "safety-car" ? this.profile.progressAtTime((u + 0.035) % 1) : null,
      lapFraction: u,
    };
  }

  audit(): LiveRaceAudit {
    return {
      sessionId: this.sessionId,
      raceId: this.raceId,
      entries: this.auditEntries.map((e) =>
        e.type === "command"
          ? { ...e, patch: { ...e.patch } }
          : { ...e },
      ),
    };
  }

  finalize(): {
    result: RaceResult;
    damageByDriver: Record<string, DamageState>;
    runtimeByDriver: Record<string, CarRuntime>;
    audit: LiveRaceAudit;
  } {
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
        penalties: c.penaltyCount,
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

    return { result, damageByDriver, runtimeByDriver, audit: this.audit() };
  }

  // -- internals ------------------------------------------------------------

  private running(): LiveCar[] {
    return this.cars.filter((c) => !c.retired);
  }

  private order(): LiveCar[] {
    return [...this.running()].sort((a, b) => a.cumulativeTime - b.cumulativeTime);
  }

  /** Line the field up in current order with the gaps erased, as after a red flag. */
  private prepareRestartGrid(order: LiveCar[]): void {
    const leader = order[0];
    if (!leader) return;
    const base = leader.cumulativeTime;
    order.forEach((c, i) => {
      const lapsDown = leader.lapsCompleted - c.lapsCompleted;
      c.cumulativeTime = base + lapsDown * this.circuit.referenceLapSeconds + i * GRID_GAP_SECONDS;
      c.raw = 0;
      c.pitThisLap = false;
      c.pitStopLap = null;
      c.broadcastProgress = 0;
    });
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

      if (gap < 1.5) {
        const atk = racerSkill(attacker.driver);
        const def = racerSkill(defender.driver);
        const paceAdvantage = defender.raw - attacker.raw;
        // A smart driver loses less time in dirty air - they manage the aero wash.
        const dirty = (1.5 - gap) * 0.12 * (0.6 + circuit.aeroDemand) * (1.15 - atk.iq * 0.3);
        attacker.raw += dirty;

        // DRS and a good tow can create an attempt even without a clear pace
        // advantage; the pass itself still has to be completed on track.
        const canAttack = drsAvailable || paceAdvantage > -0.35;
        if (canAttack) {
          const technique =
            circuit.brakingDemand > 0.58 && atk.attack > 0.52
              ? "late lunge"
              : drsAvailable
                ? "slipstream"
                : "switchback";
          const techniqueBonus =
            technique === "late lunge" ? circuit.brakingDemand * 0.1
              : technique === "slipstream" ? 0.08
                : 0.05;
          const passScore =
            circuit.overtaking * 0.38 +
            atk.attack * 0.26 +
            (drsAvailable ? 0.12 : 0) +
            clamp(paceAdvantage * 0.15, 0, 0.14) +
            (atk.iq - def.iq) * 0.12 +
            techniqueBonus * iqWeight -
            def.defend * 0.17;
          if (rng.chance(clamp(passScore * 0.6, 0.04, 0.9))) {
            defender.raw += rng.range(0.05, 0.3);
          } else {
            attacker.raw = Math.max(attacker.raw, defender.raw + rng.range(0.02, 0.22));
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

      if (c.controlled && c.controlMode === "human") {
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

      const laneLoss = circuit.pitLossSeconds * (underNeutralisation ? 0.55 : 1) + rng.gaussian(0, 1.2) + c.driver.attributes.concentration * -0.01;
      const stationary = clamp(2.2 + rng.gaussian(0, 0.42) + (100 - c.driver.attributes.concentration) * 0.012, 1.8, 4.8);
      const pitLoss = clamp(laneLoss + stationary, 14, 42);
      c.raw += pitLoss;
      c.pitStopLap = lap;
      c.lastPitStopSeconds = stationary;

      c.compound = next;
      c.tireAgeLaps = 0;
      c.nextPitIndex = Math.min(c.nextPitIndex + 1, c.strategy.compounds.length);
      c.pitThisLap = true;
      if (c.controlled && c.controlMode === "human") {
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
      if (a && b) {
        const moves = ["late lunge", "move around the outside", "switchback"];
        const technique = moves[Math.floor(stableUnit(`${this.seed}:move:${lap}:${e.driverId}`) * moves.length)] ?? moves[0];
        this.pushEvent(lap, "overtake", `${a.driver.name} passes ${b.driver.name} with a ${technique} for P${e.position}.`, "#93c5fd", "info", e.driverId);
      }
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
