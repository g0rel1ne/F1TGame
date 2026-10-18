import { describe, expect, it } from "vitest";
import {
  addPlayerTeam,
  createCareerBundle,
  runPracticeSession,
  runRaceWeekend,
  processRaceResult,
  signDriver,
  type CareerBundle,
  type CareerSettings,
} from "../src/engine/season";
import { computeStandings } from "../src/engine/standings";
import { constructorsPrize, raceFinishPrize } from "../src/engine/finance";
import { convergeSetup, deriveAxes, hasDetailedSetup, idealSetup, sanitizeSetup, setupBreakdown, setupPenalty, wingFromAxes } from "../src/engine/car";
import { initDamage, isTerminal } from "../src/engine/damage";
import { acceptanceProbability, expectedSalary, type ContractOffer } from "../src/engine/drivermarket";
import { getCircuit } from "../src/data/circuits";

const SETTINGS: CareerSettings = {
  aiDifficulty: "normal",
  raceDistancePct: 50,
  simSpeed: 5,
  startingSeason: 2026,
  incidentSeverity: "realistic",
  driverAvailability: false,
  seasonLength: 6,
  startBudget: 100_000_000,
};

function newBundle(): CareerBundle {
  return createCareerBundle({ careerId: "career-test", lobbyId: "lobby-test", name: "Test Career", settings: SETTINGS });
}

function withPlayerTeam(base: CareerBundle): { bundle: CareerBundle; teamId: string } {
  const created = addPlayerTeam(base, {
    userId: "user-1",
    name: "Apex Test Racing",
    shortName: "Apex",
    abbreviation: "APX",
    nationality: "British",
    colors: { primary: "#e10600", secondary: "#0f1115", accent: "#ffd700" },
    headquarters: "London, UK",
    engineSupplier: "Aurora Power",
    philosophy: "Balanced development",
    numberStyle: "classic",
    budget: SETTINGS.startBudget,
  });

  const freeAgents = [...created.bundle.drivers]
    .filter((d) => d.teamId === null)
    .sort((a, b) => b.attributes.pace - a.attributes.pace)
    .slice(0, 2);

  let bundle = created.bundle;
  for (const d of freeAgents) {
    bundle = signDriver(bundle, {
      driverId: d.id,
      teamId: created.teamId,
      salary: d.salaryDemand,
      signingBonus: 0,
      winBonus: 0,
      podiumBonus: 0,
      years: 2,
      performanceClausePosition: null,
    });
  }
  return { bundle, teamId: created.teamId };
}

function signature(bundle: CareerBundle) {
  return bundle.results[0].classification.map((c) => [c.driverId, c.position, c.status, c.timeSeconds, c.points]);
}

describe("career creation", () => {
  it("builds a complete deterministic grid", () => {
    const bundle = newBundle();
    expect(bundle.season.calendar).toHaveLength(6);
    expect(bundle.teams.length).toBeGreaterThanOrEqual(10);
    expect(bundle.cars.length).toBe(bundle.teams.length);
    expect(bundle.drivers.filter((d) => d.teamId).length).toBeGreaterThanOrEqual(20);
    expect(bundle.weekend.raceIndex).toBe(0);
    expect(bundle.career.phase).toBe("setup");
  });

  it("is deterministic for the same career id", () => {
    const a = newBundle();
    const b = newBundle();
    expect(a.season.calendar).toEqual(b.season.calendar);
    expect(a.weekend.weather).toEqual(b.weekend.weather);
    expect(a.cars.map((c) => c.aeroEfficiency)).toEqual(b.cars.map((c) => c.aeroEfficiency));
  });

  it("rejects duplicate team names and abbreviations", () => {
    const { bundle } = withPlayerTeam(newBundle());
    expect(() =>
      addPlayerTeam(bundle, {
        userId: "user-2",
        name: "apex test racing",
        shortName: "Apex 2",
        abbreviation: "APX",
        nationality: "Italian",
        colors: { primary: "#000000", secondary: "#ffffff", accent: "#00ff00" },
        headquarters: "Maranello, Italy",
        engineSupplier: "Ferrari",
        philosophy: "Aero-first attack",
        numberStyle: "classic",
        budget: 100_000_000,
      }),
    ).toThrow(/already in use/i);
  });
});

describe("driver contracts", () => {
  it("caps a team at three contracted drivers", () => {
    const { bundle, teamId } = withPlayerTeam(newBundle());
    const free = bundle.drivers.filter((d) => d.teamId === null);
    const third = free[0];
    const withThird = signDriver(bundle, {
      driverId: third.id,
      teamId,
      salary: 1_000_000,
      signingBonus: 0,
      winBonus: 0,
      podiumBonus: 0,
      years: 1,
      performanceClausePosition: null,
    });
    const fourth = free[1];
    expect(() =>
      signDriver(withThird, {
        driverId: fourth.id,
        teamId,
        salary: 1_000_000,
        signingBonus: 0,
        winBonus: 0,
        podiumBonus: 0,
        years: 1,
        performanceClausePosition: null,
      }),
    ).toThrow(/at most three/i);
  });

  it("pays signing bonuses immediately and records a transaction", () => {
    const { bundle, teamId } = withPlayerTeam(newBundle());
    const free = bundle.drivers.find((d) => d.teamId === null)!;
    const before = bundle.finances.find((f) => f.teamId === teamId)!.balance;
    const after = signDriver(bundle, {
      driverId: free.id,
      teamId,
      salary: 2_000_000,
      signingBonus: 5_000_000,
      winBonus: 0,
      podiumBonus: 0,
      years: 1,
      performanceClausePosition: null,
    });
    expect(after.finances.find((f) => f.teamId === teamId)!.balance).toBe(before - 5_000_000);
    expect(after.transactions.some((t) => t.category === "driver-salary" && t.amount === -5_000_000)).toBe(true);
  });

  it("increases acceptance probability with a bigger offer", () => {
    const { bundle, teamId } = withPlayerTeam(newBundle());
    const team = bundle.teams.find((t) => t.id === teamId)!;
    const driver = bundle.drivers.find((d) => d.teamId === null)!;
    const expected = expectedSalary(driver, team.reputation);
    const low: ContractOffer = { salary: expected * 0.7, years: 1, signingBonus: 0, winBonus: 0, podiumBonus: 0, role: "second", performanceClausePosition: null };
    const high: ContractOffer = { ...low, salary: expected * 1.4 };
    expect(acceptanceProbability(driver, team, high, 10)).toBeGreaterThan(acceptanceProbability(driver, team, low, 10));
    expect(expectedSalary(driver, 90)).toBeLessThanOrEqual(expectedSalary(driver, 50));
  });
});

describe("practice and setup", () => {
  it("produces shared practice data and a suggested setup", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const { bundle: after, result } = runPracticeSession(bundle, 1);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.suggestedSetup.downforce).toBeGreaterThanOrEqual(1);
    expect(result.suggestedSetup.downforce).toBeLessThanOrEqual(5);
    expect(after.practice).toHaveLength(1);
    expect(after.weekend.session).toBe("practice-1");
  });

  it("has zero setup penalty at the ideal setup", () => {
    for (const circuit of [getCircuit("monza"), getCircuit("monaco")]) {
      expect(setupPenalty(idealSetup(circuit), circuit)).toBeCloseTo(0, 6);
    }
  });
});

describe("detailed car setup", () => {
  it("maps coarse axes to wing angles within range and back approximately", () => {
    for (let df = 1; df <= 5; df++) {
      for (let bal = -2; bal <= 2; bal++) {
        const wings = wingFromAxes(df, bal);
        expect(wings.frontWing).toBeGreaterThanOrEqual(0);
        expect(wings.frontWing).toBeLessThanOrEqual(10);
        expect(wings.rearWing).toBeGreaterThanOrEqual(0);
        expect(wings.rearWing).toBeLessThanOrEqual(10);
        const axes = deriveAxes(wings.frontWing, wings.rearWing);
        expect(Math.abs(axes.downforce - df)).toBeLessThanOrEqual(1);
        expect(Math.abs(axes.balance - bal)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("clamps junk and keeps the legacy two-axis payload compact", () => {
    const legacy = sanitizeSetup({ downforce: 9, balance: 5 });
    expect(legacy.downforce).toBe(5);
    expect(legacy.balance).toBe(2);
    expect(hasDetailedSetup(legacy)).toBe(false);

    const detailed = sanitizeSetup({ frontWing: 99, rearWing: -3, rideHeight: 4, brakeBias: 100, differential: -1 });
    expect(detailed.frontWing).toBe(10);
    expect(detailed.rearWing).toBe(0);
    expect(detailed.rideHeight).toBe(4);
    expect(detailed.brakeBias).toBe(70);
    expect(detailed.differential).toBe(0);
    expect(detailed.downforce).toBe(3);
    expect(detailed.balance).toBe(2);
    expect(hasDetailedSetup(detailed)).toBe(true);
  });

  it("produces a fully detailed ideal setup with no penalty", () => {
    for (const circuit of [getCircuit("monza"), getCircuit("monaco"), getCircuit("silverstone")]) {
      const ideal = idealSetup(circuit);
      expect(hasDetailedSetup(ideal)).toBe(true);
      expect(setupPenalty(ideal, circuit)).toBeCloseTo(0, 6);
    }
  });

  it("charges mechanical parts on top of the aero penalty", () => {
    const circuit = getCircuit("monza");
    const ideal = idealSetup(circuit);
    const off = { ...ideal, rideHeight: ideal.rideHeight > 5 ? ideal.rideHeight - 5 : ideal.rideHeight + 5 };
    expect(setupPenalty(off, circuit)).toBeGreaterThan(setupPenalty(ideal, circuit));
    expect(setupPenalty(off, circuit)).toBeCloseTo(0.4, 6);
  });

  it("converges a setup toward the ideal and reaches it at full blend", () => {
    const circuit = getCircuit("monza");
    const ideal = idealSetup(circuit);
    const start = sanitizeSetup({ ...wingFromAxes(1, 0), downforce: 1, balance: 0 });
    const half = convergeSetup(start, ideal, 0.5);
    const full = convergeSetup(start, ideal, 1);
    expect(hasDetailedSetup(half)).toBe(true);
    expect(full.frontWing).toBe(ideal.frontWing);
    expect(full.rearWing).toBe(ideal.rearWing);
    expect(full.rideHeight).toBe(ideal.rideHeight);
    expect(full.brakeBias).toBe(ideal.brakeBias);
    expect(full.differential).toBe(ideal.differential);
    expect(full.downforce).toBe(ideal.downforce);
  });

  it("reports a breakdown whose total matches the setup penalty", () => {
    for (const circuit of [getCircuit("monza"), getCircuit("monaco")]) {
      for (const setup of [sanitizeSetup(null), sanitizeSetup({ frontWing: 2, rearWing: 8, rideHeight: 1, brakeBias: 68, differential: 9 })]) {
        expect(setupBreakdown(setup, circuit).total).toBeCloseTo(setupPenalty(setup, circuit), 6);
      }
    }
  });
});

describe("race weekend", () => {
  it("is deterministic for the same race id", () => {
    const a = withPlayerTeam(newBundle()).bundle;
    const b = withPlayerTeam(newBundle()).bundle;
    const ra = runRaceWeekend(a);
    const rb = runRaceWeekend(b);
    expect(signature(ra.bundle)).toEqual(signature(rb.bundle));
    expect(ra.result.qualifying.map((q) => q.driverId)).toEqual(rb.result.qualifying.map((q) => q.driverId));
  });

  it("records qualifying, classification, incidents and laps", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const { result, bundle: after } = runRaceWeekend(bundle);
    const entrants = bundle.drivers.filter((d) => d.teamId).length;
    expect(result.classification).toHaveLength(entrants);
    expect(result.qualifying).toHaveLength(entrants);
    expect(result.laps.length).toBeGreaterThan(0);
    expect(result.classification.some((c) => c.points > 0)).toBe(true);
    expect(after.weekend.resultId).toBe(result.id);
    expect(after.results).toHaveLength(1);
    expect(after.results[0].processed).toBe(true);
  });

  it("is idempotent when the same result is processed again", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const { result, bundle: after } = runRaceWeekend(bundle);
    const pointsBefore = after.standings.drivers.map((d) => [d.driverId, d.points]);
    const balanceBefore = after.finances.map((f) => [f.teamId, f.balance]);
    const txnsBefore = after.transactions.length;

    const reprocessed = processRaceResult(after, result.id);
    expect(reprocessed.applied).toBe(false);
    expect(reprocessed.bundle).toBe(after);
    expect(reprocessed.bundle.standings.drivers.map((d) => [d.driverId, d.points])).toEqual(pointsBefore);
    expect(reprocessed.bundle.finances.map((f) => [f.teamId, f.balance])).toEqual(balanceBefore);
    expect(reprocessed.bundle.transactions).toHaveLength(txnsBefore);
  });

  it("does not re-simulate an already completed weekend", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const first = runRaceWeekend(bundle);
    const second = runRaceWeekend(first.bundle);
    expect(second.result.id).toBe(first.result.id);
    expect(second.bundle.results).toHaveLength(1);
  });

  it("keeps championship points equal to the sum of classified points", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const { result, bundle: after } = runRaceWeekend(bundle);
    const total = result.classification.reduce((s, c) => s + c.points, 0);
    const standingsTotal = after.standings.drivers.reduce((s, r) => s + r.points, 0);
    expect(standingsTotal).toBe(total);
    expect(after.standings.constructors.reduce((s, r) => s + r.points, 0)).toBe(total);
  });
});

describe("standings", () => {
  it("ranks by points and is stable for ties", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const { result } = runRaceWeekend(bundle);
    const standings = computeStandings([result], 1);
    for (let i = 1; i < standings.drivers.length; i++) {
      expect(standings.drivers[i - 1].points).toBeGreaterThanOrEqual(standings.drivers[i].points);
      expect(standings.drivers[i].position).toBe(i + 1);
    }
    const winner = standings.drivers[0];
    expect(winner.points).toBeGreaterThan(0);
  });

  it("returns empty tables with no results", () => {
    const standings = computeStandings([], 1);
    expect(standings.drivers).toEqual([]);
    expect(standings.constructors).toEqual([]);
  });
});

describe("finance and damage", () => {
  it("pays more for better finishes and constructors' positions", () => {
    expect(raceFinishPrize(1)).toBeGreaterThan(raceFinishPrize(10));
    expect(constructorsPrize(1)).toBeGreaterThan(constructorsPrize(5));
    expect(constructorsPrize(5)).toBeGreaterThan(constructorsPrize(10));
  });

  it("flags terminal damage at the documented thresholds", () => {
    expect(isTerminal(initDamage())).toBeNull();
    expect(isTerminal({ ...initDamage(), engine: 0.95 })).toMatch(/power unit/i);
    expect(isTerminal({ ...initDamage(), chassis: 0.9 })).toMatch(/chassis/i);
    expect(isTerminal({ ...initDamage(), frontWing: 0.9 })).toBeNull();
  });
});
