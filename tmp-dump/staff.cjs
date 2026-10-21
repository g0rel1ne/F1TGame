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

// src/data/staff.ts
var staff_exports = {};
__export(staff_exports, {
  CORE_ROLES: () => CORE_ROLES,
  FIRST: () => FIRST,
  LAST: () => LAST,
  STAFF_ROLES: () => STAFF_ROLES,
  buildStaff: () => buildStaff,
  buildStaffMarket: () => buildStaffMarket,
  roleMeta: () => roleMeta,
  staffName: () => staffName
});
module.exports = __toCommonJS(staff_exports);

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

// src/data/staff.ts
var FIRST = [
  "Adrian",
  "Beatrice",
  "Carlos",
  "Delphine",
  "Eduardo",
  "Freya",
  "Gareth",
  "Helena",
  "Igor",
  "Julia",
  "Kwame",
  "Lorenzo",
  "Mira",
  "Nadia",
  "Otto",
  "Priya",
  "Quentin",
  "Rosa",
  "Stefan",
  "Tessa",
  "Umberto",
  "Valentina",
  "Willem",
  "Ximena",
  "Yusuf",
  "Zara",
  "Amara",
  "Boris",
  "Camille",
  "Dmitri"
];
var LAST = [
  "Alvarez",
  "Bakker",
  "Costa",
  "Dubois",
  "Eriksen",
  "Fontaine",
  "Girard",
  "Hoffmann",
  "Ibarra",
  "Jensen",
  "Keller",
  "Lombardi",
  "Moreau",
  "Novak",
  "Okafor",
  "Petrov",
  "Quintero",
  "Ricci",
  "Schmidt",
  "Tanaka",
  "Ulrich",
  "Vargas",
  "Weber",
  "Yilmaz"
];
var STAFF_ROLES = [
  { role: "technical-director", label: "Technical Director", salaryBase: 45e5, effect: "Overall development speed" },
  { role: "chief-designer", label: "Chief Designer", salaryBase: 36e5, effect: "Upgrade quality" },
  { role: "aero-chief", label: "Aerodynamics Chief", salaryBase: 34e5, effect: "Aero research output" },
  { role: "race-engineer", label: "Race Engineer", salaryBase: 22e5, effect: "Setup accuracy & strategy" },
  { role: "performance-engineer", label: "Performance Engineer", salaryBase: 19e5, effect: "Qualifying pace extraction" },
  { role: "sporting-director", label: "Sporting Director", salaryBase: 26e5, effect: "Penalty mitigation & morale" },
  { role: "chief-mechanic", label: "Chief Mechanic", salaryBase: 18e5, effect: "Pit stop speed" },
  { role: "pit-crew", label: "Pit Crew", salaryBase: 12e5, effect: "Pit stop consistency" },
  { role: "commercial-director", label: "Commercial Director", salaryBase: 28e5, effect: "Sponsorship income" },
  { role: "scout", label: "Scout", salaryBase: 11e5, effect: "Talent discovery" }
];
var CORE_ROLES = [
  "technical-director",
  "chief-designer",
  "aero-chief",
  "race-engineer",
  "performance-engineer",
  "sporting-director",
  "chief-mechanic",
  "pit-crew",
  "commercial-director",
  "scout"
];
function roleMeta(role) {
  return STAFF_ROLES.find((r) => r.role === role) ?? STAFF_ROLES[0];
}
function staffName(seed) {
  const rng = new Rng(`staffname:${seed}`);
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}
function makeStaff(role, skill, careerId, seedKey) {
  const rng = new Rng(seedKey);
  const meta = roleMeta(role);
  const age = rng.int(30, 58);
  const wage = Math.round(meta.salaryBase * (0.35 + skill / 100 * 0.75) * rng.range(0.9, 1.1));
  return {
    id: `staff-${seedKey}`,
    careerId,
    teamId: null,
    name: staffName(seedKey),
    role,
    nationality: rng.pick(["British", "Italian", "German", "French", "Spanish", "Dutch", "Japanese", "American", "Brazilian"]),
    age,
    skill: round(clamp(skill + rng.gaussian(0, 3), 35, 99)),
    potential: round(clamp(skill + rng.range(0, 14), 40, 99)),
    wage,
    morale: round(rng.range(60, 85)),
    experience: round(clamp((age - 28) * 4 + rng.gaussian(0, 6), 5, 100))
  };
}
function buildStaff(careerId, teamId, quality, seedKey) {
  const rng = new Rng(`staffteam:${seedKey}`);
  return CORE_ROLES.map((role) => {
    const skill = clamp(55 + quality * 38 + rng.gaussian(0, 6), 35, 99);
    const s = makeStaff(role, skill, careerId, `${seedKey}:${role}`);
    s.teamId = teamId;
    return s;
  });
}
function buildStaffMarket(careerId, count = 24, seed = "market") {
  const rng = new Rng(`staffmarket:${seed}`);
  const out = [];
  for (let i = 0; i < count; i++) {
    const role = rng.pick(CORE_ROLES);
    const skill = clamp(rng.gaussian(72, 12), 40, 97);
    out.push(makeStaff(role, skill, careerId, `${seed}:${i}:${role}`));
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CORE_ROLES,
  FIRST,
  LAST,
  STAFF_ROLES,
  buildStaff,
  buildStaffMarket,
  roleMeta,
  staffName
});
