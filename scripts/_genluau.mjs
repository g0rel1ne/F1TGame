import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "roblox", "Data");
mkdirSync(outDir, { recursive: true });

const num = (n) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  const s = Number(n.toFixed(6)).toString();
  return s;
};
const str = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const LUAU_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
  "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "continue",
]);
const key = (k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !LUAU_KEYWORDS.has(k) ? k : `[${str(k)}]`);
const pairs = (o, keys, indent) => keys.map((k) => `${indent}${k}=${fmt(o[k])}`).join(",\n");

function fmt(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return str(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `{ ${v.map(fmt).join(", ")} }`;
  if (typeof v === "object") {
    const parts = Object.keys(v).map((k) => `${key(k)}=${fmt(v[k])}`);
    return `{ ${parts.join(", ")} }`;
  }
  return "nil";
}

const circuits = JSON.parse(readFileSync(path.join(root, "tmp-dump", "circuits.json"), "utf8"));

let out = `-- Circuit data, auto-generated from the game's TypeScript source.\n-- Outline points are normalised (0..1) map coordinates.\n-- NOTE: 'end' is a reserved word in Luau, so sector bounds use the ["end"] key.\n\nlocal Circuits = {}\n\nCircuits.ALL = {\n`;
for (const c of circuits) {
  out += `\t{\n`;
  out += `\t\tid = ${str(c.id)},\n`;
  out += `\t\tname = ${str(c.name)},\n`;
  out += `\t\tofficialName = ${str(c.officialName)},\n`;
  out += `\t\tlocation = ${str(c.location)},\n`;
  out += `\t\tcountry = ${str(c.country)},\n`;
  out += `\t\tcountryCode = ${str(c.countryCode)},\n`;
  out += `\t\tlengthKm = ${num(c.lengthKm)},\n`;
  out += `\t\tcorners = ${num(c.corners)},\n`;
  out += `\t\tlaps = ${num(c.laps)},\n`;
  out += `\t\treferenceLapSeconds = ${num(c.referenceLapSeconds)},\n`;
  out += `\t\tpitLossSeconds = ${num(c.pitLossSeconds)},\n`;
  out += `\t\tovertaking = ${num(c.overtaking)},\n`;
  out += `\t\ttyreWear = ${num(c.tyreWear)},\n`;
  out += `\t\ttractionDemand = ${num(c.tractionDemand)},\n`;
  out += `\t\taeroDemand = ${num(c.aeroDemand)},\n`;
  out += `\t\tbrakingDemand = ${num(c.brakingDemand)},\n`;
  out += `\t\trainChance = ${num(c.rainChance)},\n`;
  out += `\t\tsurfaceEvolution = ${num(c.surfaceEvolution)},\n`;
  out += `\t\tdanger = ${num(c.danger)},\n`;
  out += `\t\tblurb = ${str(c.blurb)},\n`;
  out += `\t\tdataSource = ${str(c.dataSource)},\n`;
  out += `\t\tsectors = { ${c.sectors.map((s) => `{ ["end"] = ${num(s.end)} }`).join(", ")} },\n`;
  out += `\t\tdrsZones = { ${c.drsZones.map((z) => `{ start = ${num(z.start)}, ["end"] = ${num(z.end)}, label = ${str(z.label)} }`).join(", ")} },\n`;
  out += `\t\toutline = {\n`;
  const flat = [];
  for (const p of c.outline) flat.push(num(p.x), num(p.y));
  for (let i = 0; i < flat.length; i += 16) out += `\t\t\t${flat.slice(i, i + 16).join(",")},\n`;
  out += `\t\t},\n`;
  out += `\t},\n`;
}
out += `}\n\nCircuits.byId = {}\nfor _, c in ipairs(Circuits.ALL) do\n\tCircuits.byId[c.id] = c\n\t-- Expand the flat outline (x1,y1,x2,y2,...) into point tables once.\n\tlocal flat = c.outline\n\tlocal pts = {}\n\tfor i = 1, #flat, 2 do\n\t\tpts[#pts + 1] = { x = flat[i], y = flat[i + 1] }\n\tend\n\tc.outline = pts\nend\n\nlocal function get(id)\n\treturn Circuits.byId[id]\nend\n\nreturn { ALL = Circuits.ALL, byId = Circuits.byId, get = get }\n`;

writeFileSync(path.join(outDir, "Circuits.luau"), out);
console.log("wrote Circuits.luau", out.length, "bytes");

// Rulesets
const rulesets = JSON.parse(readFileSync(path.join(root, "tmp-dump", "rulesets.json"), "utf8"));
let r = `-- Championship rulesets, auto-generated.\n\nlocal Rulesets = {}\n\nRulesets.RULESETS = {\n`;
for (const [id, v] of Object.entries(rulesets)) {
  r += `\t[${str(id)}] = {\n`;
  r += `\t\tid = ${str(v.id)},\n\t\tname = ${str(v.name)},\n`;
  r += `\t\tracePoints = ${fmt(v.racePoints)},\n\t\tsprintPoints = ${fmt(v.sprintPoints)},\n`;
  r += `\t\tfastestLapPoints = ${num(v.fastestLapPoints)},\n\t\tfastestLapTopN = ${num(v.fastestLapTopN)},\n`;
  r += `\t\tq1Eliminated = ${num(v.q1Eliminated)},\n\t\tq2Eliminated = ${num(v.q2Eliminated)},\n`;
  r += `\t\tmandatoryPitStop = ${v.mandatoryPitStop ? "true" : "false"},\n\t\tcostCap = ${num(v.costCap)},\n`;
  r += `\t\tsafetyCars = ${v.safetyCars ? "true" : "false"},\n\t\tvirtualSafetyCars = ${v.virtualSafetyCars ? "true" : "false"},\n`;
  r += `\t\tredFlags = ${v.redFlags ? "true" : "false"},\n\t},\n`;
}
r += `}\n\nRulesets.DEFAULT_ID = "classic-25-18"\n\nlocal function get(id)\n\treturn Rulesets.RULESETS[id] or Rulesets.RULESETS[Rulesets.DEFAULT_ID]\nend\n\nreturn { RULESETS = Rulesets.RULESETS, DEFAULT_ID = Rulesets.DEFAULT_ID, get = get }\n`;
writeFileSync(path.join(outDir, "Rulesets.luau"), r);
console.log("wrote Rulesets.luau", r.length, "bytes");

// ---- Teams -------------------------------------------------------------
const teams = JSON.parse(readFileSync(path.join(root, "tmp-dump", "teams.json"), "utf8"));
let t = `-- Team data, auto-generated from src/data/teams.ts\n\nlocal TEAM_SEEDS = {\n`;
for (const s of teams) t += `\t${fmt(s)},\n`;
t += `}\n\n`;
t += `local TIER_CAR = {\n\ttop = { mu = 89, spread = 2 },\n\tupper = { mu = 83, spread = 2 },\n\tmid = { mu = 79, spread = 2 },\n\tlower = { mu = 74, spread = 2 },\n}\n\n`;
t += `local TIER_OBJECTIVE = { top = 1, upper = 4, mid = 7, lower = 10 }\n\n`;
t += `local UPGRADE_POOL = { "front-wing", "rear-wing", "floor", "sidepods", "suspension", "chassis", "brakes", "cooling", "engine", "gearbox", "reliability" }\n\n`;
t += `return { TEAM_SEEDS = TEAM_SEEDS, TIER_CAR = TIER_CAR, TIER_OBJECTIVE = TIER_OBJECTIVE, UPGRADE_POOL = UPGRADE_POOL }\n`;
writeFileSync(path.join(outDir, "Teams.luau"), t);
console.log("wrote Teams.luau", t.length, "bytes");

// ---- Drivers -----------------------------------------------------------
const drivers = JSON.parse(readFileSync(path.join(root, "tmp-dump", "drivers.json"), "utf8"));
let d = `-- Driver seed data, auto-generated from src/data/drivers.ts\n\nlocal FICTIONAL_SEEDS = {\n`;
for (const s of drivers.fictional) d += `\t${fmt(s)},\n`;
d += `}\n\nlocal REAL_SEEDS = {\n`;
for (const s of drivers.real) d += `\t${fmt(s)},\n`;
d += `}\n\n`;
d += `local TIER = {\n`;
d += `\telite = { mu = 88, spread = 3, salary = 34000000, rep = 88, exp = 78 },\n`;
d += `\tgood = { mu = 82, spread = 3, salary = 13000000, rep = 76, exp = 62 },\n`;
d += `\tmid = { mu = 77, spread = 3, salary = 6500000, rep = 64, exp = 50 },\n`;
d += `\trookie = { mu = 74, spread = 3, salary = 3000000, rep = 52, exp = 12 },\n`;
d += `}\n\n`;
d += `return { FICTIONAL_SEEDS = FICTIONAL_SEEDS, REAL_SEEDS = REAL_SEEDS, TIER = TIER, FICTIONAL_DRIVER_COUNT = #FICTIONAL_SEEDS }\n`;
writeFileSync(path.join(outDir, "Drivers.luau"), d);
console.log("wrote Drivers.luau", d.length, "bytes");

// ---- Staff -------------------------------------------------------------
const staff = JSON.parse(readFileSync(path.join(root, "tmp-dump", "staff.json"), "utf8"));
let sf = `-- Staff data, auto-generated from src/data/staff.ts\n\n`;
sf += `local FIRST = ${fmt(staff.first)}\n\n`;
sf += `local LAST = ${fmt(staff.last)}\n\n`;
sf += `local STAFF_ROLES = {\n`;
for (const s of staff.roles) sf += `\t${fmt(s)},\n`;
sf += `}\n\n`;
sf += `local CORE_ROLES = ${fmt(staff.core)}\n\n`;
sf += `return { FIRST = FIRST, LAST = LAST, STAFF_ROLES = STAFF_ROLES, CORE_ROLES = CORE_ROLES }\n`;
writeFileSync(path.join(outDir, "Staff.luau"), sf);
console.log("wrote Staff.luau", sf.length, "bytes");

// ---- Sponsors ----------------------------------------------------------
const sponsors = JSON.parse(readFileSync(path.join(root, "tmp-dump", "sponsors.json"), "utf8"));
let sp = `-- Sponsor market, auto-generated from src/data/sponsors.ts\n\nlocal SPONSORS = {\n`;
for (const s of sponsors) sp += `\t${fmt(s)},\n`;
sp += `}\n\nreturn { SPONSORS = SPONSORS }\n`;
writeFileSync(path.join(outDir, "Sponsors.luau"), sp);
console.log("wrote Sponsors.luau", sp.length, "bytes");
