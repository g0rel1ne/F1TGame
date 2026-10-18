import type { AiDifficulty, AiProfile, CarSpec, TeamSpec, UpgradeArea } from "../engine/types";
import { Rng, clamp, round } from "../engine/rng";
import { emptyInstalled } from "../engine/development";

/**
 * AI competitor teams.
 *
 * Real-world team names are used to identify the competitors on the grid. They
 * carry NO official logos or liveries: colours are original approximations and
 * the car is a generic single-seater. Real names should only be used where a
 * season's licensing permits — swap this roster for fictional teams freely.
 */
export type TeamTier = "top" | "upper" | "mid" | "lower";

export interface TeamSeed {
  name: string;
  shortName: string;
  abbreviation: string;
  nationality: string;
  tier: TeamTier;
  colors: { primary: string; secondary: string; accent: string };
  headquarters: string;
  engine: string;
  philosophy: string;
  focus: "aero" | "mechanical" | "power" | "balanced";
}

export const TEAM_SEEDS: TeamSeed[] = [
  {
    name: "Red Bull Racing",
    shortName: "Red Bull",
    abbreviation: "RBR",
    nationality: "Austrian",
    tier: "top",
    colors: { primary: "#1e2a78", secondary: "#f5c518", accent: "#e10600" },
    headquarters: "Milton Keynes, UK",
    engine: "RB Powertrains",
    philosophy: "Aggressive aero development, race-pace focused.",
    focus: "aero",
  },
  {
    name: "Ferrari",
    shortName: "Ferrari",
    abbreviation: "FER",
    nationality: "Italian",
    tier: "top",
    colors: { primary: "#c8102e", secondary: "#0b0b0b", accent: "#ffd700" },
    headquarters: "Maranello, Italy",
    engine: "Ferrari",
    philosophy: "Strong race pace and confident driver line-up.",
    focus: "balanced",
  },
  {
    name: "Mercedes",
    shortName: "Mercedes",
    abbreviation: "MER",
    nationality: "German",
    tier: "top",
    colors: { primary: "#00a19b", secondary: "#111111", accent: "#c0c0c0" },
    headquarters: "Brackley, UK",
    engine: "Mercedes",
    philosophy: "Balanced development with relentless reliability.",
    focus: "balanced",
  },
  {
    name: "McLaren",
    shortName: "McLaren",
    abbreviation: "MCL",
    nationality: "British",
    tier: "top",
    colors: { primary: "#ff8000", secondary: "#0b0f1a", accent: "#00d2be" },
    headquarters: "Woking, UK",
    engine: "Mercedes",
    philosophy: "Optimise consistency and clever strategy calls.",
    focus: "aero",
  },
  {
    name: "Aston Martin",
    shortName: "Aston Martin",
    abbreviation: "AMR",
    nationality: "British",
    tier: "upper",
    colors: { primary: "#00594f", secondary: "#1a1a1a", accent: "#d4ff00" },
    headquarters: "Silverstone, UK",
    engine: "Honda",
    philosophy: "Big-budget push to close the gap to the front.",
    focus: "aero",
  },
  {
    name: "Williams",
    shortName: "Williams",
    abbreviation: "WIL",
    nationality: "British",
    tier: "mid",
    colors: { primary: "#1868db", secondary: "#0a0f1e", accent: "#00c2ff" },
    headquarters: "Grove, UK",
    engine: "Mercedes",
    philosophy: "Straight-line speed and efficient low-drag concepts.",
    focus: "power",
  },
  {
    name: "Alpine",
    shortName: "Alpine",
    abbreviation: "ALP",
    nationality: "French",
    tier: "mid",
    colors: { primary: "#0033a0", secondary: "#e6005c", accent: "#00b0ff" },
    headquarters: "Enstone, UK",
    engine: "Mercedes",
    philosophy: "Rebuild around a balanced, reliable package.",
    focus: "balanced",
  },
  {
    name: "Racing Bulls",
    shortName: "Racing Bulls",
    abbreviation: "RCB",
    nationality: "Italian",
    tier: "mid",
    colors: { primary: "#1338be", secondary: "#e8e8e8", accent: "#ff2d55" },
    headquarters: "Faenza, Italy",
    engine: "RB Powertrains",
    philosophy: "Develop young talent with a nimble, efficient car.",
    focus: "mechanical",
  },
  {
    name: "Haas",
    shortName: "Haas",
    abbreviation: "HAS",
    nationality: "American",
    tier: "lower",
    colors: { primary: "#b6b6b6", secondary: "#e10600", accent: "#222222" },
    headquarters: "Kannapolis, USA",
    engine: "Ferrari",
    philosophy: "Punch above its weight with smart, frugal engineering.",
    focus: "mechanical",
  },
  {
    name: "Audi",
    shortName: "Audi",
    abbreviation: "AUD",
    nationality: "German",
    tier: "lower",
    colors: { primary: "#bb0a30", secondary: "#101010", accent: "#ffffff" },
    headquarters: "Hinwil, Switzerland",
    engine: "Audi",
    philosophy: "A long-term works project building towards a new era.",
    focus: "power",
  },
];

const TIER_CAR: Record<TeamTier, { mu: number; spread: number }> = {
  top: { mu: 89, spread: 2 },
  upper: { mu: 83, spread: 2 },
  mid: { mu: 79, spread: 2 },
  lower: { mu: 74, spread: 2 },
};

function carFromTier(rng: Rng, tier: TeamTier, focus: TeamSeed["focus"]): CarSpec {
  const { mu, spread } = TIER_CAR[tier];
  const a = (o = 0) => round(clamp(mu + o + rng.gaussian(0, spread), 55, 99));
  const reliability = clamp(mu - 2 + rng.gaussian(0, spread), 55, 99);
  return {
    teamId: "",
    season: 1,
    aeroEfficiency: a(focus === "aero" ? 4 : 0),
    downforce: a(focus === "aero" ? 4 : 0),
    drag: round(clamp(100 - mu + (focus === "power" ? -6 : 0) + rng.gaussian(0, spread), 5, 60)),
    cornering: a(focus === "aero" ? 3 : 0),
    straightLine: a(focus === "power" ? 5 : 0),
    braking: a(),
    mechanicalGrip: a(focus === "mechanical" ? 5 : 0),
    tireFriendliness: a(),
    fuelEfficiency: a(),
    reliability: round(reliability),
    cooling: a(),
    wetPerformance: a(),
    weight: round(clamp(800 - (mu - 75) * 4 + rng.gaussian(0, 6), 700, 830)),
    installed: emptyInstalled(),
  };
}

export function difficultyProfile(difficulty: AiDifficulty, seed: Rng): AiProfile {
  const base: Record<AiDifficulty, number> = { beginner: 0.3, normal: 0.5, expert: 0.7, elite: 0.9 };
  const q = base[difficulty];
  return {
    difficulty,
    focusAero: clamp(seed.range(0.4, 0.9), 0, 1),
    focusMechanical: clamp(seed.range(0.3, 0.8), 0, 1),
    focusReliability: clamp(seed.range(0.3, 0.8), 0, 1),
    riskAppetite: clamp(q + seed.gaussian(0, 0.1), 0.05, 0.95),
    strategyIQ: clamp(q + seed.gaussian(0, 0.08), 0.1, 0.98),
    developmentEfficiency: clamp(0.5 + q * 0.5 + seed.gaussian(0, 0.06), 0.2, 0.99),
  };
}

const UPGRADE_POOL: UpgradeArea[] = [
  "front-wing", "rear-wing", "floor", "sidepods", "suspension", "chassis", "brakes", "cooling", "engine", "gearbox", "reliability",
];

export function buildAiTeam(
  seed: TeamSeed,
  index: number,
  careerId: string,
  difficulty: AiDifficulty,
): { team: TeamSpec; car: CarSpec } {
  const rng = new Rng(`team:${seed.abbreviation}:${difficulty}`);
  const id = `ai-team-${index}`;
  const profile = difficultyProfile(difficulty, rng);
  const budgetByTier: Record<TeamTier, number> = { top: 145_000_000, upper: 135_000_000, mid: 120_000_000, lower: 105_000_000 };
  const repByTier: Record<TeamTier, number> = { top: 88, upper: 76, mid: 66, lower: 58 };

  const team: TeamSpec = {
    id,
    careerId,
    name: seed.name,
    shortName: seed.shortName,
    abbreviation: seed.abbreviation,
    nationality: seed.nationality,
    isPlayerTeam: false,
    ownerUserId: null,
    colors: seed.colors,
    livery: {
      nose: seed.colors.primary,
      frontWing: seed.colors.secondary,
      sidepod: seed.colors.primary,
      engineCover: seed.colors.primary,
      rearWing: seed.colors.secondary,
      accentStripe: seed.colors.accent,
      halo: seed.colors.secondary,
    },
    numberStyle: "classic",
    logo: { symbol: "wing", background: seed.colors.primary },
    headquarters: seed.headquarters,
    engineSupplier: seed.engine,
    philosophy: seed.philosophy,
    budget: budgetByTier[seed.tier],
    reputation: repByTier[seed.tier],
    objective: TIER_OBJECTIVE[seed.tier],
    aiProfile: profile,
  };

  const car = carFromTier(rng, seed.tier, seed.focus);
  car.teamId = id;
  // Give AI teams a couple of pre-installed development points so the grid is not uniform.
  const picks = rng.shuffle(UPGRADE_POOL).slice(0, 2 + (seed.tier === "top" ? 1 : 0));
  for (const area of picks) car.installed[area] = round(rng.range(0.5, 2.0), 2);

  return { team, car };
}

const TIER_OBJECTIVE: Record<TeamTier, number> = { top: 1, upper: 4, mid: 7, lower: 10 };
