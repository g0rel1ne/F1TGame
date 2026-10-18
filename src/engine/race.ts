import type {
  CarSpec,
  CarRuntime,
  Circuit,
  ClassifiedEntry,
  DamageState,
  Driver,
  FlagState,
  LapRecord,
  RaceIncident,
  RaceResult,
  Ruleset,
  StrategyPlan,
  WeatherState,
} from "./types";
import { Rng, clamp, hashSeed, round } from "./rng";
import { composeLapTime, type Setup } from "./car";
import { defaultTireSpecs, evaluateTire, isSlick } from "./tire";
import { applyDamage, initDamage, isTerminal } from "./damage";
import { generateIncident, type IncidentContext, type NearbyCar } from "./incidents";
import { evolveWeather } from "./weather";

export interface RaceSimEntrant {
  driverId: string;
  teamId: string;
  car: CarSpec;
  driver: Driver;
  gridPosition: number;
  strategy: StrategyPlan;
  setup: Setup;
  /** 0..1 quality of decisions for this car. Humans ~0.9+, AI by difficulty. */
  decisionSkill: number;
}

export interface RaceSimOptions {
  raceId: string;
  seed: number;
  circuit: Circuit;
  totalLaps: number;
  ruleset: Ruleset;
  weatherStart: WeatherState;
  entrants: RaceSimEntrant[];
  severitySetting: "lenient" | "realistic" | "strict";
}

export interface RaceSimOutput {
  result: RaceResult;
  damageByDriver: Record<string, DamageState>;
  runtimeByDriver: Record<string, CarRuntime>;
  /** Grid penalties to apply to the next race, by driver id. */
  gridPenalties: Record<string, number>;
}

interface SimCar extends CarRuntime {
  car: CarSpec;
  driver: Driver;
  strategy: StrategyPlan;
  setup: Setup;
  decisionSkill: number;
  raw: number;
  pitThisLap: boolean;
  nextPitIndex: number;
  cumulativeTime: number;
  lapsCompleted: number;
}

export function simulateRace(opts: RaceSimOptions): RaceSimOutput {
  const rng = new Rng(hashSeed(`${opts.seed}:${opts.raceId}`));
  const { circuit, totalLaps, ruleset } = opts;
  const specs = defaultTireSpecs(circuit);

  const cars: SimCar[] = opts.entrants
    .map((e) => {
      const startCompound = e.strategy.compounds[0] ?? "medium";
      return {
        driverId: e.driverId,
        teamId: e.teamId,
        damage: initDamage(),
        compound: startCompound,
        tireAgeLaps: 0,
        fuelLaps: totalLaps,
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
        raw: 0,
        pitThisLap: false,
        nextPitIndex: 0,
        cumulativeTime: 0,
        lapsCompleted: 0,
      } satisfies SimCar;
    })
    .sort((a, b) => a.trackPosition - b.trackPosition);

  const incidents: RaceIncident[] = [];
  const laps: LapRecord[] = [];
  const gridPenalties: Record<string, number> = {};

  let weather = opts.weatherStart;
  let flag: FlagState = "green";
  let neutralisedLaps = 0;
  let safetyCarDeployments = 0;
  let virtualSafetyCarPeriods = 0;
  let redFlags = 0;

  // Formation lap: compress the field slightly.
  for (const c of cars) c.cumulativeTime = c.trackPosition * 0.7;

  const envFor = (c: SimCar, push: "conserve" | "normal" | "push") => ({
    trackWetness: weather.trackWetness,
    trackTempC: weather.trackTempC,
    driverTyreManagement: c.driver.attributes.tireManagement / 100,
    carTyreFriendliness: c.car.tireFriendliness / 100,
    circuit,
    push,
  });

  const running = () => cars.filter((c) => !c.retired);
  const order = () => [...running()].sort((a, b) => a.cumulativeTime - b.cumulativeTime);

  for (let lap = 1; lap <= totalLaps; lap++) {
    weather = evolveWeather(rng, weather, circuit, lap);

    const neutralised = neutralisedLaps > 0;
    const liveOrder = order();

    // ---- Pace calculation -------------------------------------------------
    for (const c of liveOrder) {
      const tire = evaluateTire(specs[c.compound], c.tireAgeLaps, envFor(c, c.strategy.pushLevel));
      c.raw = composeLapTime({
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
        wetness: weather.trackWetness,
      });
    }

    let lapPitLoss = 0;

    if (neutralised) {
      // No overtaking; bunched field. Red flag fully suspends lap times.
      const base = flag === "red-flag" ? 0 : circuit.referenceLapSeconds * 1.5;
      liveOrder.forEach((c, i) => {
        c.raw = base;
        if (flag === "safety-car") {
          c.cumulativeTime = liveOrder[0].cumulativeTime + i * 0.8;
        } else if (flag === "virtual-safety-car") {
          c.cumulativeTime += 0;
        }
      });
    } else {
      applyTraffic(rng, liveOrder, circuit, weather);
      handlePits(rng, liveOrder, lap, totalLaps, weather, circuit, specs, false, (loss) => {
        lapPitLoss += loss;
      });
    }

    if (neutralised && (flag === "safety-car" || flag === "virtual-safety-car")) {
      // Opportunity stops still happen under neutralisation.
      handlePits(rng, liveOrder, lap, totalLaps, weather, circuit, specs, true, (loss) => {
        lapPitLoss += loss;
      });
    }

    // ---- Incidents --------------------------------------------------------
    const currentOrder = order();
    for (const c of currentOrder) {
      if (c.retired) continue;
      const idx = currentOrder.indexOf(c);
      const nearby: NearbyCar[] = [];
      for (let j = Math.max(0, idx - 2); j <= Math.min(currentOrder.length - 1, idx + 2); j++) {
        if (j === idx) continue;
        const other = currentOrder[j];
        const gap = other.cumulativeTime - c.cumulativeTime; // + means other is behind
        nearby.push({
          driverId: other.driverId,
          gap: -gap,
          aggression: other.driver.attributes.aggression,
          skill: other.decisionSkill,
          defending: false,
        });
      }

      const ctx: IncidentContext = {
        driverId: c.driverId,
        driver: c.driver,
        carReliability: c.car.reliability,
        damage: c.damage,
        circuit,
        weather,
        lap,
        totalLaps,
        isFirstLap: lap === 1,
        isRestart: neutralisedLaps === 1,
        isPitEntry: c.pitThisLap,
        strategyRisk: c.strategy.risk,
        compound: c.compound,
        tireAge: c.tireAgeLaps,
        tireGrip: evaluateTire(specs[c.compound], c.tireAgeLaps, envFor(c, c.strategy.pushLevel)).gripFactor,
        fuelLaps: c.fuelLaps,
        nearby,
        severitySetting: opts.severitySetting,
        decisionSkill: c.decisionSkill,
      };

      const inc = generateIncident(rng, ctx, opts.raceId);
      if (inc) {
        incidents.push(inc);
        applyIncident(inc, cars, gridPenalties);
        if (inc.neutralisation === "safety-car" && ruleset.safetyCars) {
          flag = "safety-car";
          neutralisedLaps = Math.max(neutralisedLaps, rng.int(3, 5));
          safetyCarDeployments++;
        } else if (inc.neutralisation === "virtual-safety-car" && ruleset.virtualSafetyCars) {
          flag = "virtual-safety-car";
          neutralisedLaps = Math.max(neutralisedLaps, rng.int(2, 3));
          virtualSafetyCarPeriods++;
        } else if (inc.neutralisation === "red-flag" && ruleset.redFlags) {
          flag = "red-flag";
          neutralisedLaps = Math.max(neutralisedLaps, rng.int(3, 6));
          redFlags++;
        } else if (inc.neutralisation === "yellow" && neutralisedLaps === 0) {
          // Brief local yellow only; no full neutralisation bookkeeping.
        }
      }
    }

    // ---- Accumulate a lap -------------------------------------------------
    const afterOrder = order();
    const pittedThisLap: Record<string, boolean> = {};
    for (const c of afterOrder) {
      pittedThisLap[c.driverId] = c.pitThisLap;
      if (flag === "red-flag") {
        // Suspended: no distance completed this lap.
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

      // Spontaneous mechanical retirements (reliability-driven).
      const reliabilityRisk = (1 - clamp(c.car.reliability / 100, 0, 1)) * 0.0009;
      const damageRisk = (c.damage.engine + c.damage.gearbox + c.damage.cooling) * 0.004;
      if (!c.retired && rng.chance(reliabilityRisk + damageRisk)) {
        c.retired = true;
        c.retiredReason = isTerminal(c.damage) ?? "Mechanical failure";
        incidents.push({
          id: `${opts.raceId}:ret:${lap}:${c.driverId}`,
          raceId: opts.raceId,
          lap,
          trackPosition: c.trackProgress,
          corner: `Turn ${rng.int(1, circuit.corners)}`,
          kind: "mechanical",
          severity: 3,
          involvedDriverIds: [c.driverId],
          responsibility: "mechanical",
          responsibleDriverId: null,
          damage: { [c.driverId]: {} },
          narrative: `${c.driver.name} pulls off the circuit with a mechanical failure.`,
          factors: ["mechanical reliability"],
          penalty: null,
          neutralisation: "none",
        });
      }
    }

    // ---- Record the lap ---------------------------------------------------
    const leader = afterOrder[0];
    laps.push({
      lap,
      entries: afterOrder.map((c, i) => {
        c.trackPosition = i + 1;
        c.gapToLeader = leader ? round(c.cumulativeTime - leader.cumulativeTime, 3) : 0;
        return {
          driverId: c.driverId,
          position: i + 1,
          lapTime: flag === "red-flag" ? 0 : round(c.raw, 3),
          compound: c.compound,
          tireAge: c.tireAgeLaps,
          gapToLeader: c.gapToLeader,
          pit: pittedThisLap[c.driverId] ?? false,
          flag,
          retired: c.retired,
        };
      }),
    });

    if (neutralised) {
      neutralisedLaps -= 1;
      if (neutralisedLaps <= 0) flag = "green";
    }

    // End early if too few cars remain.
    if (running().length < 2) break;
  }

  // ---- Classify -----------------------------------------------------------
  const finishers = [...cars].sort((a, b) => {
    if (a.retired !== b.retired) return a.retired ? 1 : -1;
    if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
    return a.cumulativeTime - b.cumulativeTime;
  });

  const leaderTime = finishers.find((c) => !c.retired)?.cumulativeTime ?? 0;
  const bestLapOverall = Math.min(...cars.filter((c) => c.bestLapTime !== null).map((c) => c.bestLapTime as number));
  const fastestDriver = cars.find((c) => c.bestLapTime === bestLapOverall && !c.retired) ?? cars.find((c) => c.bestLapTime === bestLapOverall)!;

  const classification: ClassifiedEntry[] = finishers.map((c, i) => {
    const position = i + 1;
    let points = 0;
    if (!c.retired && position - 1 < ruleset.racePoints.length) points = ruleset.racePoints[position - 1];
    // Retired cars that completed <90% of the distance are not classified for points.
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
      gap:
        c.retired
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
      gridPosition: opts.entrants.find((e) => e.driverId === c.driverId)?.gridPosition ?? position,
      penalties: 0,
    };
  });

  const damageByDriver: Record<string, DamageState> = {};
  const runtimeByDriver: Record<string, CarRuntime> = {};
  for (const c of cars) {
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
    id: opts.raceId,
    careerId: "",
    season: 0,
    raceIndex: 0,
    circuitId: circuit.id,
    session: "race",
    seed: opts.seed,
    weatherStart: opts.weatherStart.condition,
    classification,
    qualifying: [],
    incidents,
    laps,
    safetyCarDeployments,
    virtualSafetyCarPeriods,
    redFlags,
    fastestLapDriverId: fastestDriver?.driverId ?? null,
    poleDriverId: null,
    winnerDriverId: classification[0]?.driverId ?? null,
    processed: false,
    createdAt: Date.now(),
  };

  return { result, damageByDriver, runtimeByDriver, gridPenalties };
}

// ---------------------------------------------------------------------------

function applyTraffic(rng: Rng, liveOrder: SimCar[], circuit: Circuit, weather: WeatherState): void {
  for (let i = 1; i < liveOrder.length; i++) {
    const attacker = liveOrder[i];
    const defender = liveOrder[i - 1];
    const gap = attacker.cumulativeTime - defender.cumulativeTime;

    const drsAvailable =
      circuit.drsZones.length > 0 && gap < 1.0 && weather.trackWetness < 0.35;

    if (gap < 1.4) {
      const paceAdvantage = defender.raw - attacker.raw; // positive => attacker faster
      // Dirty-air penalty scales with how close and how aero-dependent the track is.
      const dirty = (1.4 - gap) * 0.12 * (0.6 + circuit.aeroDemand);
      attacker.raw += dirty;

      if (paceAdvantage > 0.05) {
        const passScore =
          circuit.overtaking * 0.5 +
          (attacker.driver.attributes.overtaking / 100) * 0.3 +
          (drsAvailable ? 0.18 : 0) +
          clamp(paceAdvantage * 0.15, 0, 0.15) -
          (defender.driver.attributes.defending / 100) * 0.12;
        if (rng.chance(clamp(passScore * 0.55, 0, 0.92))) {
          // Pass succeeds: attacker keeps its pace, defender loses a little.
          defender.raw += rng.range(0.05, 0.3);
        } else {
          // Held up behind.
          attacker.raw = defender.raw + rng.range(0.03, 0.25);
        }
      }
    }
  }
}

function handlePits(
  rng: Rng,
  liveOrder: SimCar[],
  lap: number,
  totalLaps: number,
  weather: WeatherState,
  circuit: Circuit,
  specs: ReturnType<typeof defaultTireSpecs>,
  underNeutralisation: boolean,
  addLoss: (s: number) => void,
): void {
  for (const c of liveOrder) {
    if (c.retired) continue;
    const planned = c.strategy.pitLaps[c.nextPitIndex];
    const spec = specs[c.compound];
    const worn = c.tireAgeLaps > spec.lifeLaps * 1.05;
    const wrongTires =
      (weather.trackWetness > 0.62 && isSlick(c.compound)) ||
      (weather.trackWetness < 0.18 && !isSlick(c.compound));
    const lapsLeft = totalLaps - lap;

    const plannedNow =
      planned !== undefined && lap >= planned && lapsLeft > 1 && c.nextPitIndex < c.strategy.compounds.length - 1;
    const emergency = (worn || wrongTires) && lapsLeft > 1 && c.nextPitIndex < c.strategy.compounds.length - 1;
    const aiWantsStop = emergency && rng.chance(0.5 + c.decisionSkill * 0.4);
    const shouldStop = plannedNow || aiWantsStop || (underNeutralisation && c.nextPitIndex < c.strategy.compounds.length - 1 && rng.chance(0.35 + c.decisionSkill * 0.3));

    if (!shouldStop) continue;

    let next = c.strategy.compounds[Math.min(c.nextPitIndex + 1, c.strategy.compounds.length - 1)];
    if (weather.trackWetness > 0.62) next = "wet";
    else if (weather.trackWetness > 0.22) next = "intermediate";
    else if (!isSlick(next)) next = "medium";

    const pitLoss = circuit.pitLossSeconds * (underNeutralisation ? 0.55 : 1) + rng.gaussian(0, 1.2) + c.driver.attributes.concentration * -0.01;
    const stopTime = clamp(pitLoss, 14, 40);
    c.raw += stopTime;
    addLoss(stopTime);

    c.compound = next;
    c.tireAgeLaps = 0;
    c.nextPitIndex += 1;
    c.pitThisLap = true;
  }
}

function applyIncident(
  inc: RaceIncident,
  cars: SimCar[],
  gridPenalties: Record<string, number>,
): void {
  for (const [driverId, partial] of Object.entries(inc.damage)) {
    const c = cars.find((x) => x.driverId === driverId);
    if (!c || c.retired) continue;
    c.damage = applyDamage(c.damage, partial);

    const terminal = isTerminal(c.damage);
    if (inc.severity >= 4 || terminal) {
      c.retired = true;
      c.retiredReason = inc.severity >= 4 ? `${inc.kind} (${inc.corner})` : (terminal as string);
    }
  }

  if (inc.penalty) {
    const c = cars.find((x) => x.driverId === inc.penalty!.driverId);
    if (!c) return;
    if (inc.penalty.type === "time") c.penaltySeconds += inc.penalty.seconds;
    else if (inc.penalty.type === "drive-through") c.penaltySeconds += 20;
    else if (inc.penalty.type === "stop-go") c.penaltySeconds += 10 + inc.penalty.seconds;
    else if (inc.penalty.type === "grid") gridPenalties[c.driverId] = (gridPenalties[c.driverId] ?? 0) + inc.penalty.places;
  }
}
