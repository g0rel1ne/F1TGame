var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/data/teams.ts
var teams_exports = {};
__export(teams_exports, {
  TEAM_SEEDS: () => TEAM_SEEDS,
  buildAiTeam: () => buildAiTeam,
  difficultyProfile: () => difficultyProfile
});
module.exports = __toCommonJS(teams_exports);

// src/engine/rng.ts
function hashSeed(input) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var Rng = class _Rng {
  state;
  constructor(seed) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed >>> 0) || 2654435769;
  }
  /** Raw float in [0, 1). */
  next() {
    this.state |= 0;
    this.state = this.state + 1831565813 | 0;
    let t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }
  /** Standard normal via Box-Muller. Mean 0, stddev 1. */
  normal() {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Normal with mean and standard deviation. */
  gaussian(mean, stddev) {
    return mean + this.normal() * stddev;
  }
  /** Pick a random element. */
  pick(items) {
    return items[this.int(0, items.length - 1)];
  }
  /** Weighted pick. Weights need not be normalised. */
  weighted(items, weights) {
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i]);
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }
  /** Fisher-Yates shuffle producing a new array. */
  shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  /** Derive a child RNG, e.g. per-driver or per-lap streams. Keeps determinism. */
  fork(label) {
    return new _Rng(hashSeed(`${this.state}:${label}`));
  }
  /** Current internal state, so a simulation can persist/resume mid-race. */
  getState() {
    return this.state >>> 0;
  }
};
var clamp = (v, min, max) => Math.max(min, Math.min(max, v));
var round = (v, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

// src/engine/development.ts
function emptyInstalled() {
  return {
    "front-wing": 0,
    "rear-wing": 0,
    floor: 0,
    sidepods: 0,
    suspension: 0,
    chassis: 0,
    brakes: 0,
    cooling: 0,
    engine: 0,
    gearbox: 0,
    reliability: 0
  };
}

// src/data/teams.ts
var TEAM_SEEDS = [
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
    focus: "aero"
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
    focus: "balanced"
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
    focus: "balanced"
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
    focus: "aero"
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
    focus: "aero"
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
    focus: "power"
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
    focus: "balanced"
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
    focus: "mechanical"
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
    focus: "mechanical"
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
    focus: "power"
  }
];
var TIER_CAR = {
  top: { mu: 89, spread: 2 },
  upper: { mu: 83, spread: 2 },
  mid: { mu: 79, spread: 2 },
  lower: { mu: 74, spread: 2 }
};
function carFromTier(rng, tier, focus) {
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
    installed: emptyInstalled()
  };
}
function difficultyProfile(difficulty, seed) {
  const base = { beginner: 0.3, normal: 0.5, expert: 0.7, elite: 0.9 };
  const q = base[difficulty];
  return {
    difficulty,
    focusAero: clamp(seed.range(0.4, 0.9), 0, 1),
    focusMechanical: clamp(seed.range(0.3, 0.8), 0, 1),
    focusReliability: clamp(seed.range(0.3, 0.8), 0, 1),
    riskAppetite: clamp(q + seed.gaussian(0, 0.1), 0.05, 0.95),
    strategyIQ: clamp(q + seed.gaussian(0, 0.08), 0.1, 0.98),
    developmentEfficiency: clamp(0.5 + q * 0.5 + seed.gaussian(0, 0.06), 0.2, 0.99)
  };
}
var UPGRADE_POOL = [
  "front-wing",
  "rear-wing",
  "floor",
  "sidepods",
  "suspension",
  "chassis",
  "brakes",
  "cooling",
  "engine",
  "gearbox",
  "reliability"
];
function buildAiTeam(seed, index, careerId, difficulty) {
  const rng = new Rng(`team:${seed.abbreviation}:${difficulty}`);
  const id = `ai-team-${index}`;
  const profile = difficultyProfile(difficulty, rng);
  const budgetByTier = { top: 145e6, upper: 135e6, mid: 12e7, lower: 105e6 };
  const repByTier = { top: 88, upper: 76, mid: 66, lower: 58 };
  const team = {
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
      halo: seed.colors.secondary
    },
    numberStyle: "classic",
    logo: { symbol: "wing", background: seed.colors.primary },
    headquarters: seed.headquarters,
    engineSupplier: seed.engine,
    philosophy: seed.philosophy,
    budget: budgetByTier[seed.tier],
    reputation: repByTier[seed.tier],
    objective: TIER_OBJECTIVE[seed.tier],
    aiProfile: profile
  };
  const car = carFromTier(rng, seed.tier, seed.focus);
  car.teamId = id;
  const picks = rng.shuffle(UPGRADE_POOL).slice(0, 2 + (seed.tier === "top" ? 1 : 0));
  for (const area of picks) car.installed[area] = round(rng.range(0.5, 2), 2);
  return { team, car };
}
var TIER_OBJECTIVE = { top: 1, upper: 4, mid: 7, lower: 10 };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TEAM_SEEDS,
  buildAiTeam,
  difficultyProfile
});
