import type { AiProfile, Driver, TeamSpec } from "./types";
import type { Rng } from "./rng";
import { clamp } from "./rng";

export interface ContractOffer {
  salary: number;
  years: number;
  signingBonus: number;
  winBonus: number;
  podiumBonus: number;
  role: "lead" | "second" | "development";
  performanceClausePosition: number | null;
}

export function expectedSalary(driver: Driver, teamReputation: number): number {
  const base = driver.salaryDemand;
  // Better teams can offer slightly less cash but more prestige.
  const prestigeDiscount = 1 - clamp((teamReputation - 60) / 200, -0.15, 0.2);
  return Math.round(base * prestigeDiscount);
}

export function acceptanceProbability(
  driver: Driver,
  team: TeamSpec,
  offer: ContractOffer,
  teamObjective: number,
): number {
  const expected = expectedSalary(driver, team.reputation);
  const ratio = offer.salary / Math.max(1, expected);

  let p = 0.1 + (ratio - 1) * 0.85;
  p += clamp((team.reputation - 60) / 120, -0.25, 0.3);
  p += offer.role === "lead" ? 0.12 : offer.role === "development" ? -0.05 : 0.04;
  p += clamp(offer.years - 1, 0, 3) * 0.06;
  p += offer.signingBonus > expected * 0.15 ? 0.07 : 0;
  p += clamp((driver.morale - 55) / 300, -0.1, 0.12);
  // Ambitious top drivers dislike a team with a low objective (poor prospects).
  if (driver.reputation > 80) p += clamp((6 - teamObjective) / 40, -0.12, 0.12);
  if (team.isPlayerTeam) p += 0.03;

  return clamp(p, 0.01, 0.98);
}

export interface NegotiationResult {
  accepted: boolean;
  probability: number;
  counterOffer: ContractOffer | null;
  message: string;
}

/** Evaluate an offer with a possible counteroffer. Uses the race-seeded Rng. */
export function negotiate(
  rng: Rng,
  driver: Driver,
  team: TeamSpec,
  offer: ContractOffer,
  teamObjective: number,
): NegotiationResult {
  const p = acceptanceProbability(driver, team, offer, teamObjective);
  if (rng.chance(p)) {
    return { accepted: true, probability: p, counterOffer: null, message: `${driver.name} accepts the offer.` };
  }
  // Counter: bump salary toward what the driver expects.
  const expected = expectedSalary(driver, team.reputation);
  const counter: ContractOffer = {
    ...offer,
    salary: Math.round(Math.max(offer.salary * 1.12, expected * rng.range(1.02, 1.2))),
    signingBonus: Math.round(Math.max(offer.signingBonus, expected * rng.range(0.05, 0.2))),
  };
  const message =
    p < 0.25
      ? `${driver.name}'s management dismisses the offer out of hand — it is some way short of expectations.`
      : `${driver.name} is interested but wants an improved package.`;
  return { accepted: false, probability: p, counterOffer: counter, message };
}

/** How much an AI team is willing to spend given its budget and profile. */
export function aiWillingToPay(team: TeamSpec, profile: AiProfile | null): number {
  const base = team.budget * 0.22;
  const careful = profile ? 1.15 - profile.riskAppetite * 0.3 : 1;
  return Math.max(2_000_000, base * careful);
}

/** AI teams sign/replace drivers from the free-agent pool each season. */
export function aiDriverMarket(
  rng: Rng,
  teams: TeamSpec[],
  freeDrivers: Driver[],
  assigned: Set<string>,
  _teamObjectives: Record<string, number>,
): Array<{ teamId: string; driverId: string; salary: number; years: number }> {
  const signings: Array<{ teamId: string; driverId: string; salary: number; years: number }> = [];
  const pool = [...freeDrivers].sort((a, b) => b.attributes.pace + b.potential - (a.attributes.pace + a.potential));

  for (const team of teams) {
    const currentDrivers = pool.filter((d) => d.teamId === team.id);
    const needed = Math.max(0, 2 - currentDrivers.length);
    if (needed === 0) continue;
    const budgetCap = aiWillingToPay(team, team.aiProfile);
    for (let i = 0; i < needed; i++) {
      const candidates = pool.filter((d) => !assigned.has(d.id) && (d.teamId === null || d.teamId === team.id));
      if (candidates.length === 0) break;
      // Pick the best affordable driver with some randomness.
      const affordable = candidates.filter((d) => expectedSalary(d, team.reputation) <= budgetCap);
      const choice = affordable.length
        ? affordable[rng.int(0, Math.min(2, affordable.length - 1))]
        : candidates[candidates.length - 1];
      const salary = expectedSalary(choice, team.reputation);
      assigned.add(choice.id);
      signings.push({ teamId: team.id, driverId: choice.id, salary: Math.round(salary * rng.range(1, 1.3)), years: rng.int(1, 3) });
    }
  }
  return signings;
}
