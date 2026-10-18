import { describe, expect, it } from "vitest";
import {
  addPlayerTeam,
  commitRaceResult,
  createCareerBundle,
  prepareRace,
  signDriver,
  type CareerBundle,
  type CareerSettings,
} from "../src/engine/season";
import { LiveRace } from "../src/engine/liveRace";

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

function playerBundle(): { bundle: CareerBundle; teamId: string } {
  const created = addPlayerTeam(
    createBundle(),
    {
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
    },
  );
  let bundle = created.bundle;
  const freeAgents = [...bundle.drivers].filter((d) => d.teamId === null).sort((a, b) => b.attributes.pace - a.attributes.pace).slice(0, 2);
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

function createBundle(): CareerBundle {
  return createCareerBundle({ careerId: "career-live", lobbyId: "lobby-live", name: "Live Test", settings: SETTINGS });
}

function makeEngine(bundle: CareerBundle, teamId: string) {
  const prep = prepareRace(bundle);
  const controlled = bundle.drivers.filter((d) => d.teamId === teamId).map((d) => d.id);
  const engine = new LiveRace({
    raceId: prep.raceId,
    seed: prep.seed,
    circuit: prep.circuit,
    totalLaps: prep.totalLaps,
    ruleset: prep.ruleset,
    weatherStart: prep.weatherStart,
    entrants: prep.entrants,
    severitySetting: bundle.settings.incidentSeverity,
    controlledDriverIds: controlled,
    qualifying: prep.qualifying,
    poleDriverId: prep.poleDriverId,
  });
  return { engine, controlled };
}

function runToEnd(engine: LiveRace, max = 200) {
  let guard = 0;
  while (!engine.finished && guard < max) {
    engine.step();
    guard++;
  }
}

describe("interactive live race", () => {
  it("runs a full race and classifies every entrant", () => {
    const { bundle, teamId } = playerBundle();
    const { engine } = makeEngine(bundle, teamId);
    runToEnd(engine);

    expect(engine.finished).toBe(true);
    expect(engine.laps.length).toBeGreaterThanOrEqual(5);

    const out = engine.finalize();
    const entrants = prepareRace(bundle).entrants.length;
    expect(out.result.classification).toHaveLength(entrants);
    expect(out.result.classification[0].position).toBe(1);
    expect(out.result.winnerDriverId).toBe(out.result.classification[0].driverId);
    expect(out.result.laps).toBe(engine.laps);
  });

  it("acknowledges radio instructions and changes the driver's pace", () => {
    const { bundle, teamId } = playerBundle();
    const { engine, controlled } = makeEngine(bundle, teamId);
    const ack = engine.setCommand(controlled[0], { pace: "push" });
    expect(ack?.kind).toBe("radio");
    const car = engine.snapshot().cars.find((c) => c.driverId === controlled[0]);
    expect(car?.pace).toBe("push");
  });

  it("boxing fits the requested compound and records a pit stop", () => {
    const { bundle, teamId } = playerBundle();
    const { engine, controlled } = makeEngine(bundle, teamId);
    const me = controlled[0];
    // Run a couple of laps, then ask to pit onto hards.
    engine.step();
    engine.step();
    engine.setCommand(me, { pitRequest: true, pitCompound: "hard" });
    engine.step();

    const car = engine.snapshot().cars.find((c) => c.driverId === me);
    expect(car?.compound).toBe("hard");
    runToEnd(engine);
    const classified = engine.finalize().result.classification.find((c) => c.driverId === me);
    expect(classified?.pits).toBeGreaterThanOrEqual(1);
  });

  it("pushing a stint is faster on the clock than managing it", () => {
    const { bundle, teamId } = playerBundle();
    const a = makeEngine(bundle, teamId);
    const b = makeEngine(bundle, teamId);
    const meA = a.controlled[0];
    const meB = b.controlled[0];
    for (let i = 0; i < 8; i++) {
      a.engine.setCommand(meA, { pace: "push" });
      b.engine.setCommand(meB, { pace: "conserve" });
      a.engine.step();
      b.engine.step();
    }
    const sum = (engine: LiveRace, id: string) =>
      engine.laps.slice(0, 8).reduce((acc, lap) => {
        const e = lap.entries.find((x) => x.driverId === id);
        return acc + (e && e.lapTime > 0 ? e.lapTime : 0);
      }, 0);
    expect(sum(a.engine, meA)).toBeLessThan(sum(b.engine, meB) - 2);
  });

  it("preserves qualifying, pole and grid positions in the final result", () => {
    const { bundle, teamId } = playerBundle();
    const prep = prepareRace(bundle);
    const { engine } = makeEngine(bundle, teamId);
    runToEnd(engine);

    const result = engine.finalize().result;
    expect(result.qualifying).toHaveLength(prep.qualifying.length);
    expect(result.poleDriverId).toBe(prep.poleDriverId);
    expect(result.seed).toBe(prep.seed);

    const gridByDriver = new Map(prep.entrants.map((e) => [e.driverId, e.gridPosition]));
    for (const c of result.classification) {
      expect(c.gridPosition).toBe(gridByDriver.get(c.driverId));
    }
    // Grid order is not simply the finishing order.
    expect(result.classification.some((c) => c.gridPosition !== c.position)).toBe(true);
  });

  it("commits a live result into the career exactly once", () => {
    const { bundle, teamId } = playerBundle();
    const prep = prepareRace(bundle);
    const { engine, controlled } = makeEngine(bundle, teamId);
    engine.setCommand(controlled[0], { pace: "push" });
    runToEnd(engine);

    const result = {
      ...engine.finalize().result,
      careerId: bundle.career.id,
      season: bundle.season.number,
      raceIndex: bundle.weekend.raceIndex,
      qualifying: prep.qualifying,
      poleDriverId: prep.poleDriverId,
    };

    const committed = commitRaceResult(bundle, result);
    expect(committed.bundle.weekend.resultId).toBe(result.id);
    expect(committed.bundle.results.some((r) => r.id === result.id)).toBe(true);

    // Re-committing the same weekend is a no-op.
    const again = commitRaceResult(committed.bundle, result);
    expect(again.alreadyProcessed).toBe(true);
    expect(again.bundle.results.filter((r) => r.id === result.id)).toHaveLength(1);
  });
});
