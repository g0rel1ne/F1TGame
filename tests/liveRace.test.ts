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
import { replayLiveRaceAudit } from "../src/engine/liveAudit";
import { getCircuitProfile } from "../src/engine/trackProfile";

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

  it("projects independent sub-lap positions, speeds and brake zones", () => {
    const { bundle, teamId } = playerBundle();
    const { engine } = makeEngine(bundle, teamId);
    engine.step();
    engine.step();

    const snap = engine.broadcastSnapshot(0.5);
    expect(snap.lapFraction).toBe(0.5);
    expect(snap.safetyCarProgress).toBeNull();
    expect(snap.cars).toHaveLength(engine.cars.length);
    expect(new Set(snap.cars.map((c) => c.trackProgress.toFixed(4))).size).toBeGreaterThan(1);
    const braking = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
      .flatMap((u) => engine.broadcastSnapshot(u).cars)
      .some((c) => c.braking);
    expect(braking).toBe(true);
    expect(snap.cars.every((c) => c.trackProgress >= 0 && c.trackProgress <= 1)).toBe(true);
    expect(snap.cars.every((c) => Number.isFinite(c.elevationMetres))).toBe(true);
    expect(snap.cars.map((c) => c.position)).toEqual(snap.cars.map((_, i) => i + 1));
  });

  it("builds a real speed profile with straights, braking zones and corner direction", () => {
    const { bundle } = playerBundle();
    const prep = prepareRace(bundle);
    const profile = getCircuitProfile(prep.circuit);
    const speeds = Array.from({ length: 240 }, (_, i) => profile.speedAt(i / 240));
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(0.25);

    let left = 0;
    let right = 0;
    for (let i = 0; i < 240; i++) {
      const d = profile.directionAt(i / 240);
      if (d < 0) left++;
      if (d > 0) right++;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it("projects different corner techniques, not just a constant tow", () => {
    const { bundle, teamId } = playerBundle();
    const { engine } = makeEngine(bundle, teamId);
    engine.step();
    engine.step();

    const modes = new Set<string>();
    for (let i = 1; i < 100; i++) {
      for (const c of engine.broadcastSnapshot(i / 100).cars) modes.add(c.overtakeMode);
    }
    expect(modes.has("slipstream")).toBe(true);
    expect(modes.has("dive")).toBe(true);
    expect(modes.has("outside")).toBe(true);
    expect(modes.has("switchback")).toBe(true);
    expect(modes.has("defend")).toBe(true);
  });

  it("animates a pit entry, stationary stop and pit exit", () => {
    const { bundle, teamId } = playerBundle();
    const { engine, controlled } = makeEngine(bundle, teamId);
    const me = controlled[0];
    engine.step();
    engine.setCommand(me, { pitRequest: true, pitCompound: "hard" });

    const stop = engine.broadcastSnapshot(0.999).cars.find((c) => c.driverId === me);
    expect(stop?.pitPhase).toBe("stop");

    engine.step();

    const exit = engine.broadcastSnapshot(0.02).cars.find((c) => c.driverId === me);
    expect(exit?.pitPhase).toBe("exit");
    expect(exit?.pitProgress).toBeGreaterThan(0);
    expect(exit?.lastPitStopSeconds).toBeGreaterThan(1);
  });

  it("lines the field up in qualifying order before the start", () => {
    const { bundle, teamId } = playerBundle();
    const prep = prepareRace(bundle);
    const { engine } = makeEngine(bundle, teamId);

    const snap = engine.broadcastSnapshot(0);
    const expected = [...prep.entrants]
      .sort((a, b) => a.gridPosition - b.gridPosition)
      .map((e) => e.driverId);
    expect(snap.cars.map((c) => c.driverId)).toEqual(expected);
    expect(snap.cars[0].driverId).toBe(prep.poleDriverId);
    expect(new Set(snap.cars.map((c) => c.trackProgress.toFixed(3))).size).toBe(snap.cars.length);
    expect(snap.cars[1].gapAhead).toBeGreaterThan(0);
  });

  it("suspends the race clock for a red flag and restarts from the grid", () => {
    const { bundle, teamId } = playerBundle();
    const { engine } = makeEngine(bundle, teamId);
    engine.step();
    const lap = engine.lap;
    const laps = engine.laps.length;

    engine.flag = "red-flag";
    (engine as unknown as { neutralisedLaps: number }).neutralisedLaps = 2;
    engine.step();
    expect(engine.lap).toBe(lap);
    expect(engine.laps).toHaveLength(laps);
    expect(engine.flag).toBe("red-flag");

    const events = engine.resumeFromRedFlag();
    expect(engine.flag).toBe("green");
    expect(engine.lap).toBe(lap);
    expect(events.some((e) => e.kind === "flag")).toBe(true);
  });

  it("applies fuel and ERS commands to the broadcast and the next lap", () => {
    const { bundle, teamId } = playerBundle();
    const { engine, controlled } = makeEngine(bundle, teamId);
    const me = controlled[0];
    engine.setCommand(me, { fuelMode: "lean", ers: "high" });
    const car = engine.snapshot().cars.find((c) => c.driverId === me);
    expect(car?.fuelMode).toBe("lean");
    expect(car?.ers).toBe("high");

    const before = engine.snapshot().cars.find((c) => c.driverId === me)?.ersCharge ?? 0;
    engine.step();
    const after = engine.snapshot().cars.find((c) => c.driverId === me)?.ersCharge ?? 0;
    expect(after).toBeLessThan(before);
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

  it("hands a disconnected principal's cars to the AI and refuses human commands", () => {
    const { bundle, teamId } = playerBundle();
    const { engine, controlled } = makeEngine(bundle, teamId);
    const driverId = controlled[0];
    expect(engine.setCommand(driverId, { pace: "push" })?.kind).toBe("radio");
    expect(engine.setControlMode(driverId, "ai")?.kind).toBe("radio");
    expect(engine.snapshot().cars.find((c) => c.driverId === driverId)?.controlMode).toBe("ai");
    expect(engine.setCommand(driverId, { pace: "conserve" })).toBeNull();
    runToEnd(engine);
    expect(engine.finalize().result.classification.find((c) => c.driverId === driverId)).toBeTruthy();
  });

  it("replays the command and handover audit to the same official result", () => {
    const { bundle, teamId } = playerBundle();
    const { engine, controlled } = makeEngine(bundle, teamId);
    engine.setCommand(controlled[0], { pace: "push" });
    engine.step();
    engine.step();
    engine.setControlMode(controlled[1], "ai");
    engine.setCommand(controlled[0], { pitRequest: true, pitCompound: "hard" });
    engine.step();
    engine.setControlMode(controlled[1], "human");
    runToEnd(engine);

    const finished = engine.finalize();
    const replayed = replayLiveRaceAudit(bundle, finished.audit);
    const ordered = (result: typeof finished.result) =>
      result.classification.map((c) => `${c.position}:${c.driverId}:${c.timeSeconds}:${c.bestLap}:${c.pits}`);

    expect(replayed.result.classification).toHaveLength(finished.result.classification.length);
    expect(ordered(replayed.result)).toEqual(ordered(finished.result));
    expect(replayed.result.winnerDriverId).toBe(finished.result.winnerDriverId);
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
