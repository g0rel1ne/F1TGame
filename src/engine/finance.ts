import type {
  DriverContract,
  Facility,
  Sponsor,
  SponsorContract,
  StaffMember,
  Transaction,
} from "./types";

/** Per-race prize money by finishing position (USD). Falls back to a floor. */
const RACE_PRIZE = [
  1_200_000, 950_000, 800_000, 700_000, 620_000, 560_000, 510_000, 470_000, 430_000, 400_000,
  370_000, 340_000, 315_000, 290_000, 270_000, 250_000, 235_000, 220_000, 205_000, 190_000,
];

/** Season-end constructors' prize money by championship position (USD). */
const CONSTRUCTORS_PRIZE = [
  60_000_000, 48_000_000, 40_000_000, 34_000_000, 29_000_000, 25_000_000, 21_000_000, 18_000_000,
  15_500_000, 13_000_000,
];

export interface FinanceContext {
  careerId: string;
  teamId: string;
  season: number;
  raceIndex: number;
}

let txnCounter = 0;
function nextId(prefix: string): string {
  txnCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${txnCounter.toString(36)}`;
}

export function makeTxn(
  ctx: FinanceContext,
  category: Transaction["category"],
  amount: number,
  description: string,
): Transaction {
  return {
    id: nextId("txn"),
    careerId: ctx.careerId,
    teamId: ctx.teamId,
    season: ctx.season,
    raceIndex: ctx.raceIndex,
    category,
    amount,
    description,
    createdAt: Date.now(),
  };
}

export function raceFinishPrize(position: number): number {
  return RACE_PRIZE[position - 1] ?? 120_000;
}

export function constructorsPrize(position: number): number {
  return CONSTRUCTORS_PRIZE[position - 1] ?? 9_000_000;
}

export function sponsorUpfront(sponsor: Sponsor): number {
  return sponsor.upfront;
}

export function sponsorPerRace(sponsor: Sponsor): number {
  return sponsor.perRace;
}

export function canAfford(balance: number, amount: number, reserve = 0): boolean {
  return balance - amount >= reserve;
}

/**
 * Season salary cost for a driver is paid pro-rata per race so teams feel the
 * burn each weekend. Rounded to whole dollars.
 */
export function perRaceDriverSalary(contract: DriverContract, racesInSeason: number): number {
  const total = contract.salary + (contract.signingBonus ?? 0);
  return Math.round(total / Math.max(1, racesInSeason));
}

export function perRaceStaffCost(staff: StaffMember[], racesInSeason: number): number {
  const total = staff.reduce((sum, s) => sum + s.wage, 0);
  return Math.round(total / Math.max(1, racesInSeason));
}

export function facilityUpkeepPerRace(facilities: Facility[], racesInSeason: number): number {
  const annual = facilities.reduce((sum, f) => sum + facilityUpkeep(f), 0);
  return Math.round(annual / Math.max(1, racesInSeason));
}

export function facilityUpkeep(facility: Facility): number {
  const BASE: Record<string, number> = {
    factory: 4_000_000,
    "design-office": 3_000_000,
    "wind-tunnel": 6_000_000,
    simulator: 3_500_000,
    "driver-academy": 2_000_000,
    "pit-crew": 2_500_000,
    commercial: 2_000_000,
    "reliability-lab": 3_000_000,
    hospitality: 1_500_000,
  };
  return (BASE[facility.kind] ?? 2_000_000) * (1 + facility.level * 0.55);
}

export interface RaceWeekendFinanceInput {
  ctx: FinanceContext;
  balance: number;
  raceFinishPositions: Array<{ driverId: string; position: number; points: number }>;
  constructorPosition: number;
  driverContracts: DriverContract[];
  staff: StaffMember[];
  facilities: Facility[];
  sponsorContracts: SponsorContract[];
  sponsors: Sponsor[];
  racesInSeason: number;
  repairCosts: number;
  travelPerRace: number;
}

/**
 * Compute every transaction for one race weekend and the resulting balance.
 * Pure and deterministic: the same inputs always produce the same ledger, which
 * is what makes idempotent processing possible (see `season.ts`).
 */
export function computeRaceWeekendFinance(input: RaceWeekendFinanceInput): {
  transactions: Transaction[];
  newBalance: number;
} {
  const txns: Transaction[] = [];
  const { ctx } = input;

  for (const r of input.raceFinishPositions) {
    txns.push(makeTxn(ctx, "prize-money", raceFinishPrize(r.position), `Race prize money (P${r.position})`));
  }

  for (const sc of input.sponsorContracts.filter((s) => s.active)) {
    const sponsor = input.sponsors.find((s) => s.id === sc.sponsorId);
    if (!sponsor) continue;
    txns.push(makeTxn(ctx, "sponsor-per-race", sponsorPerRace(sponsor), `${sponsor.name} race payment`));
  }

  txns.push(makeTxn(ctx, "driver-salary", -input.driverContracts.reduce((s, c) => s + perRaceDriverSalary(c, input.racesInSeason), 0), "Driver salaries"));
  txns.push(makeTxn(ctx, "staff-wage", -perRaceStaffCost(input.staff, input.racesInSeason), "Staff wages"));
  txns.push(makeTxn(ctx, "facility-upkeep", -facilityUpkeepPerRace(input.facilities, input.racesInSeason), "Facility upkeep"));
  txns.push(makeTxn(ctx, "travel", -input.travelPerRace, "Travel & logistics"));

  if (input.repairCosts > 0) {
    txns.push(makeTxn(ctx, "repairs", -input.repairCosts, "Crash repairs"));
  }

  const newBalance = input.balance + txns.reduce((s, t) => s + t.amount, 0);
  return { transactions: txns, newBalance };
}
