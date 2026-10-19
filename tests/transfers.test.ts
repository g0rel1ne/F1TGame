import { describe, expect, it } from "vitest";
import {
  addPlayerTeam,
  advanceCalendar,
  createCareerBundle,
  respondTransferOffer,
  runAiTransferWindow,
  signDriver,
  transferFeeFor,
  type CareerBundle,
  type CareerSettings,
} from "../src/engine/season";
import type { TransferOffer } from "../src/engine/types";

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
  return createCareerBundle({ careerId: "career-transfer", lobbyId: "lobby-transfer", name: "Transfer Test", settings: SETTINGS });
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

function offerFor(bundle: CareerBundle, driverId: string, fromTeamId: string, fee: number): TransferOffer {
  return {
    id: "to-test",
    careerId: bundle.career.id,
    season: bundle.season.number,
    raceIndex: bundle.season.currentRaceIndex,
    driverId,
    fromTeamId,
    fee,
    salary: 6_000_000,
    years: 2,
    status: "open",
    createdAt: 0,
  };
}

describe("AI transfer market", () => {
  it("fills an empty AI seat from the free-agent pool", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const aiTeam = bundle.teams.find((t) => !t.isPlayerTeam)!;
    const aiDriver = bundle.drivers.find((d) => d.teamId === aiTeam.id)!;
    const emptied = { ...bundle, drivers: bundle.drivers.map((d) => (d.id === aiDriver.id ? { ...d, teamId: null } : d)) };

    const after = runAiTransferWindow(emptied);
    expect(after.drivers.filter((d) => d.teamId === aiTeam.id)).toHaveLength(2);
  });

  it("is deterministic for identical input", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const a = runAiTransferWindow(bundle);
    const b = runAiTransferWindow(bundle);
    expect(a.drivers.map((d) => d.teamId)).toEqual(b.drivers.map((d) => d.teamId));
    const shape = (x: CareerBundle) => x.transferOffers.map((o) => [o.id, o.driverId, o.fromTeamId, o.fee, o.salary, o.years, o.status]);
    expect(shape(a)).toEqual(shape(b));
  });

  it("never moves a player-team driver without an accepted offer", () => {
    const { bundle, teamId } = withPlayerTeam(newBundle());
    const after = runAiTransferWindow(bundle);
    const mine = after.drivers.filter((d) => d.teamId === teamId);
    expect(mine.length).toBe(2);
    expect(after.transferOffers.every((o) => o.status === "open")).toBe(true);
  });

  it("rejecting an offer keeps the driver and records the decision", () => {
    const { bundle, teamId } = withPlayerTeam(newBundle());
    const driver = bundle.drivers.find((d) => d.teamId === teamId)!;
    const aiTeam = bundle.teams.find((t) => !t.isPlayerTeam)!;
    const offer = offerFor(bundle, driver.id, aiTeam.id, 20_000_000);

    const after = respondTransferOffer({ ...bundle, transferOffers: [offer] }, offer.id, false);
    expect(after.drivers.find((d) => d.id === driver.id)!.teamId).toBe(teamId);
    expect(after.transferOffers.find((o) => o.id === offer.id)!.status).toBe("rejected");
  });

  it("accepting moves the driver, frees a seat if needed and settles the fee", () => {
    const { bundle, teamId } = withPlayerTeam(newBundle());
    const driver = bundle.drivers.find((d) => d.teamId === teamId)!;
    const aiTeam = bundle.teams.find((t) => !t.isPlayerTeam)!;
    const fee = transferFeeFor(driver);
    const offer = offerFor(bundle, driver.id, aiTeam.id, fee);

    const buyerBefore = bundle.finances.find((f) => f.teamId === aiTeam.id)!.balance;
    const sellerBefore = bundle.finances.find((f) => f.teamId === teamId)!.balance;
    const after = respondTransferOffer({ ...bundle, transferOffers: [offer] }, offer.id, true);

    expect(after.drivers.find((d) => d.id === driver.id)!.teamId).toBe(aiTeam.id);
    expect(after.drivers.filter((d) => d.teamId === aiTeam.id)).toHaveLength(2);
    expect(after.drivers.filter((d) => d.teamId === teamId)).toHaveLength(1);
    expect(after.finances.find((f) => f.teamId === aiTeam.id)!.balance).toBe(buyerBefore - fee);
    expect(after.finances.find((f) => f.teamId === teamId)!.balance).toBe(sellerBefore + fee);
    expect(after.driverContracts.some((c) => c.driverId === driver.id && c.teamId === aiTeam.id && c.active)).toBe(true);
    expect(after.transferOffers.find((o) => o.id === offer.id)!.status).toBe("accepted");
  });

  it("advancing the calendar runs a transfer round and keeps the bundle consistent", () => {
    const { bundle } = withPlayerTeam(newBundle());
    const after = advanceCalendar(bundle);
    expect(after.season.currentRaceIndex).toBe(1);
    expect(Array.isArray(after.transferOffers)).toBe(true);
    for (const team of after.teams.filter((t) => !t.isPlayerTeam)) {
      expect(after.drivers.filter((d) => d.teamId === team.id).length).toBeLessThanOrEqual(2);
    }
  });
});
