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

// src/data/drivers.ts
var drivers_exports = {};
__export(drivers_exports, {
  FICTIONAL_DRIVER_COUNT: () => FICTIONAL_DRIVER_COUNT,
  FICTIONAL_SEEDS: () => FICTIONAL_SEEDS,
  REAL_SEEDS: () => REAL_SEEDS,
  buildFictionalDrivers: () => buildFictionalDrivers,
  buildRealDrivers: () => buildRealDrivers
});
module.exports = __toCommonJS(drivers_exports);

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

// src/data/drivers.ts
var TIER = {
  elite: { mu: 88, spread: 3, salary: 34e6, rep: 88, exp: 78 },
  good: { mu: 82, spread: 3, salary: 13e6, rep: 76, exp: 62 },
  mid: { mu: 77, spread: 3, salary: 65e5, rep: 64, exp: 50 },
  rookie: { mu: 74, spread: 3, salary: 3e6, rep: 52, exp: 12 }
};
function mk(seed, id, salt = "") {
  const rng = new Rng(salt ? `driver:${salt}:${seed.name}` : `driver:${seed.name}`);
  const t = TIER[seed.tier];
  const base = t.mu;
  const att = (offset = 0, spread = t.spread) => round(clamp(base + offset + rng.gaussian(0, spread), 40, 99));
  const traits = [...seed.traits ?? []];
  const ageFactor = seed.age < 23 ? -1.5 : seed.age > 34 ? -2.5 : 0;
  const attributes = {
    pace: att(ageFactor),
    qualifying: att(seed.traits?.includes("qualifying-specialist") ? 4 : 0),
    racecraft: att(seed.traits?.includes("defensive") ? 3 : 0),
    overtaking: att(seed.traits?.includes("aggressive") ? 4 : 0),
    defending: att(seed.traits?.includes("defensive") ? 5 : 0),
    tireManagement: att(seed.traits?.includes("tire-whisperer") ? 6 : 0),
    wet: att(seed.traits?.includes("wet-master") ? 7 : 0),
    consistency: att(seed.traits?.includes("consistent") ? 5 : seed.traits?.includes("fast-but-error-prone") ? -7 : 0),
    concentration: att(seed.traits?.includes("fast-but-error-prone") ? -5 : 0),
    aggression: round(clamp((seed.traits?.includes("aggressive") ? 0.78 : 0.5) + rng.gaussian(0, 0.12), 0.1, 0.98), 2),
    experience: round(clamp(t.exp + (seed.age - 25) * 4, 5, 100))
  };
  const potential = rng.int(85, 99);
  return {
    id,
    name: seed.name,
    code: seed.code,
    nationality: seed.nationality,
    country: seed.country,
    age: seed.age,
    isRealPerson: seed.isRealPerson ?? false,
    portraitSeed: seed.name,
    attributes,
    potential,
    peakAge: seed.tier === "rookie" ? 27 : 29,
    salaryDemand: Math.round(t.salary * rng.range(0.85, 1.2)),
    marketability: round(clamp((t.rep + rng.gaussian(0, 6)) / 100, 0.15, 0.99), 2),
    reputation: round(clamp(t.rep + rng.gaussian(0, 5), 20, 99)),
    morale: round(rng.range(62, 82)),
    traits,
    teamId: null,
    scoutedAbility: round(clamp(t.mu + rng.gaussian(0, 4), 40, 99)),
    starts: seed.age > 30 ? rng.int(120, 260) : seed.tier === "rookie" ? rng.int(0, 12) : rng.int(20, 120),
    careerWins: 0,
    careerPodiums: 0,
    careerPoles: 0,
    careerPoints: 0,
    championships: 0
  };
}
var FICTIONAL_SEEDS = [
  { name: "Alex Mercer", code: "MER", nationality: "British", country: "GB", age: 31, tier: "elite", traits: ["consistent", "veteran"] },
  { name: "Luca Moretti", code: "MOR", nationality: "Italian", country: "IT", age: 27, tier: "elite", traits: ["aggressive"] },
  { name: "Elias Novak", code: "NOV", nationality: "Czech", country: "CZ", age: 25, tier: "good", traits: ["qualifying-specialist"] },
  { name: "Mateo Silva", code: "SIL", nationality: "Brazilian", country: "BR", age: 28, tier: "good", traits: ["tire-whisperer"] },
  { name: "Noah Bennett", code: "BEN", nationality: "British", country: "GB", age: 20, tier: "rookie", traits: ["rookie"] },
  { name: "Viktor Sokolov", code: "SOK", nationality: "Russian", country: "RU", age: 29, tier: "good", traits: ["wet-master"] },
  { name: "Daniel Fischer", code: "FIS", nationality: "German", country: "DE", age: 34, tier: "good", traits: ["veteran", "consistent"] },
  { name: "Rafael Costa", code: "COS", nationality: "Portuguese", country: "PT", age: 26, tier: "good", traits: ["fast-but-error-prone", "aggressive"] },
  { name: "Kai Tanaka", code: "TAN", nationality: "Japanese", country: "JP", age: 24, tier: "good", traits: ["qualifying-specialist"] },
  { name: "Oscar Lindqvist", code: "LIN", nationality: "Swedish", country: "SE", age: 30, tier: "good", traits: ["consistent"] },
  { name: "Yuki Nakamura", code: "NAK", nationality: "Japanese", country: "JP", age: 22, tier: "rookie" },
  { name: "Pierre Laurent", code: "LAU", nationality: "French", country: "FR", age: 32, tier: "mid", traits: ["veteran"] },
  { name: "Andr\xE9s Vega", code: "VEG", nationality: "Spanish", country: "ES", age: 26, tier: "mid", traits: ["aggressive"] },
  { name: "Tom Whitfield", code: "WHI", nationality: "British", country: "GB", age: 29, tier: "mid" },
  { name: "Finn O'Brien", code: "OBR", nationality: "Irish", country: "IE", age: 23, tier: "rookie" },
  { name: "Marcus Adeyemi", code: "ADE", nationality: "Nigerian", country: "NG", age: 27, tier: "good" },
  { name: "Diego Herrera", code: "HER", nationality: "Mexican", country: "MX", age: 31, tier: "mid", traits: ["wet-master"] },
  { name: "Jonas Berg", code: "BER", nationality: "Norwegian", country: "NO", age: 25, tier: "mid" },
  { name: "Sasha Petrov", code: "PET", nationality: "Estonian", country: "EE", age: 28, tier: "mid", traits: ["defensive"] },
  { name: "Liam Chen", code: "CHE", nationality: "Singaporean", country: "SG", age: 24, tier: "rookie", traits: ["qualifying-specialist"] },
  { name: "Hugo Martins", code: "MAR", nationality: "Brazilian", country: "BR", age: 33, tier: "mid", traits: ["veteran", "tire-whisperer"] },
  { name: "Nils Ekstr\xF6m", code: "EKS", nationality: "Swedish", country: "SE", age: 21, tier: "rookie" },
  { name: "Callum Reid", code: "REI", nationality: "Scottish", country: "GB", age: 30, tier: "mid", traits: ["consistent"] },
  { name: "Ivan Horvath", code: "HOR", nationality: "Hungarian", country: "HU", age: 26, tier: "mid", traits: ["fast-but-error-prone"] },
  { name: "Zane Williams", code: "WIL", nationality: "Australian", country: "AU", age: 28, tier: "good", traits: ["aggressive"] },
  { name: "Ravi Patel", code: "PAT", nationality: "Indian", country: "IN", age: 23, tier: "rookie" },
  { name: "Emil Sorensen", code: "SOR", nationality: "Danish", country: "DK", age: 29, tier: "mid" },
  { name: "Bruno Almeida", code: "ALM", nationality: "Brazilian", country: "BR", age: 22, tier: "rookie" },
  { name: "Klaus Vogt", code: "VOG", nationality: "Austrian", country: "AT", age: 35, tier: "mid", traits: ["veteran", "defensive"] },
  { name: "Theo Marchand", code: "MCH", nationality: "French", country: "FR", age: 24, tier: "good", traits: ["tire-whisperer"] },
  { name: "Bowie Grant", code: "GRA", nationality: "New Zealander", country: "NZ", age: 21, tier: "rookie", traits: ["rookie", "aggressive"] },
  { name: "Aleksander Kowalski", code: "KOW", nationality: "Polish", country: "PL", age: 27, tier: "good", traits: ["consistent"] },
  { name: "Ryan Osei", code: "OSE", nationality: "Ghanaian", country: "GH", age: 25, tier: "mid" },
  { name: "Fabio Russo", code: "RUS", nationality: "Italian", country: "IT", age: 30, tier: "good", traits: ["qualifying-specialist"] },
  { name: "Hana Suzuki", code: "SUZ", nationality: "Japanese", country: "JP", age: 22, tier: "rookie", traits: ["rookie", "tire-whisperer"] },
  { name: "Lars Jansen", code: "JAN", nationality: "Dutch", country: "NL", age: 26, tier: "mid", traits: ["wet-master"] },
  // Custom young prospects (18-19, rookie-tier baseline so they grow into the grid).
  { name: "Qistiano Bodado", code: "BOD", nationality: "Portuguese", country: "PT", age: 18, tier: "rookie", traits: ["rookie"] },
  { name: "Scott Laso", code: "LAS", nationality: "Polish", country: "PL", age: 19, tier: "rookie", traits: ["rookie"] },
  { name: "Clanker Ant", code: "CKA", nationality: "Dutch", country: "NL", age: 18, tier: "rookie", traits: ["rookie", "aggressive"] },
  { name: "Myles Bedroque", code: "BED", nationality: "British", country: "GB", age: 19, tier: "rookie", traits: ["rookie"] },
  { name: "Oliwier Lewandowski", code: "LEW", nationality: "Polish", country: "PL", age: 19, tier: "rookie", traits: ["rookie"] },
  { name: "Dion Dior", code: "DIO", nationality: "British", country: "GB", age: 18, tier: "rookie", traits: ["rookie", "qualifying-specialist"] },
  { name: "Jack Brish", code: "BRI", nationality: "British", country: "GB", age: 19, tier: "rookie", traits: ["rookie"] },
  { name: "Kevin Hollis", code: "HOL", nationality: "American", country: "US", age: 18, tier: "rookie", traits: ["rookie"] }
];
var REAL_SEEDS = [
  { name: "Arvid Lindblad", code: "LIN", nationality: "British", country: "GB", age: 20, tier: "rookie", isRealPerson: true },
  { name: "Isack Hadjar", code: "HAD", nationality: "French", country: "FR", age: 22, tier: "good", isRealPerson: true },
  { name: "Gabriel Bortoleto", code: "BOR", nationality: "Brazilian", country: "BR", age: 22, tier: "good", isRealPerson: true },
  { name: "Oliver Bearman", code: "BEA", nationality: "British", country: "GB", age: 21, tier: "good", isRealPerson: true },
  { name: "Andrea Kimi Antonelli", code: "ANT", nationality: "Italian", country: "IT", age: 20, tier: "good", isRealPerson: true },
  { name: "Lance Stroll", code: "STR", nationality: "Canadian", country: "CA", age: 27, tier: "mid", isRealPerson: true },
  { name: "Carlos Sainz", code: "SAI", nationality: "Spanish", country: "ES", age: 31, tier: "elite", isRealPerson: true },
  { name: "Alexander Albon", code: "ALB", nationality: "Thai", country: "TH", age: 29, tier: "good", isRealPerson: true },
  { name: "Pierre Gasly", code: "GAS", nationality: "French", country: "FR", age: 29, tier: "good", isRealPerson: true },
  { name: "Esteban Ocon", code: "OCO", nationality: "French", country: "FR", age: 29, tier: "good", isRealPerson: true },
  { name: "Nico Hulkenberg", code: "HUL", nationality: "German", country: "DE", age: 38, tier: "good", isRealPerson: true },
  { name: "Fernando Alonso", code: "ALO", nationality: "Spanish", country: "ES", age: 44, tier: "elite", isRealPerson: true },
  { name: "Lando Norris", code: "NOR", nationality: "British", country: "GB", age: 26, tier: "elite", isRealPerson: true },
  { name: "Charles Leclerc", code: "LEC", nationality: "Mon\xE9gasque", country: "MC", age: 28, tier: "elite", isRealPerson: true },
  { name: "Oscar Piastri", code: "PIA", nationality: "Australian", country: "AU", age: 25, tier: "elite", isRealPerson: true },
  { name: "Max Verstappen", code: "VER", nationality: "Dutch", country: "NL", age: 28, tier: "elite", isRealPerson: true },
  { name: "George Russell", code: "RUS", nationality: "British", country: "GB", age: 28, tier: "elite", isRealPerson: true },
  { name: "Yuki Tsunoda", code: "TSU", nationality: "Japanese", country: "JP", age: 26, tier: "good", isRealPerson: true },
  { name: "Liam Lawson", code: "LAW", nationality: "New Zealander", country: "NZ", age: 24, tier: "good", isRealPerson: true },
  { name: "Lewis Hamilton", code: "HAM", nationality: "British", country: "GB", age: 41, tier: "elite", isRealPerson: true }
];
function buildFictionalDrivers(salt) {
  return FICTIONAL_SEEDS.map((s, i) => mk(s, `f-driver-${i}`, salt));
}
function buildRealDrivers(salt) {
  return REAL_SEEDS.map((s, i) => mk(s, `r-driver-${i}`, salt));
}
var FICTIONAL_DRIVER_COUNT = FICTIONAL_SEEDS.length;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FICTIONAL_DRIVER_COUNT,
  FICTIONAL_SEEDS,
  REAL_SEEDS,
  buildFictionalDrivers,
  buildRealDrivers
});
