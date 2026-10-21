import type { StaffMember, StaffRole } from "../engine/types";
import { Rng, clamp, round } from "../engine/rng";

/** Fictional staff name pools. */
export const FIRST = [
  "Adrian", "Beatrice", "Carlos", "Delphine", "Eduardo", "Freya", "Gareth", "Helena",
  "Igor", "Julia", "Kwame", "Lorenzo", "Mira", "Nadia", "Otto", "Priya",
  "Quentin", "Rosa", "Stefan", "Tessa", "Umberto", "Valentina", "Willem", "Ximena",
  "Yusuf", "Zara", "Amara", "Boris", "Camille", "Dmitri",
];
export const LAST = [
  "Alvarez", "Bakker", "Costa", "Dubois", "Eriksen", "Fontaine", "Girard", "Hoffmann",
  "Ibarra", "Jensen", "Keller", "Lombardi", "Moreau", "Novak", "Okafor", "Petrov",
  "Quintero", "Ricci", "Schmidt", "Tanaka", "Ulrich", "Vargas", "Weber", "Yilmaz",
];

export interface StaffRoleMeta {
  role: StaffRole;
  label: string;
  /** Base salary by skill (USD per season, at skill 100). */
  salaryBase: number;
  effect: string;
}

export const STAFF_ROLES: StaffRoleMeta[] = [
  { role: "technical-director", label: "Technical Director", salaryBase: 4_500_000, effect: "Overall development speed" },
  { role: "chief-designer", label: "Chief Designer", salaryBase: 3_600_000, effect: "Upgrade quality" },
  { role: "aero-chief", label: "Aerodynamics Chief", salaryBase: 3_400_000, effect: "Aero research output" },
  { role: "race-engineer", label: "Race Engineer", salaryBase: 2_200_000, effect: "Setup accuracy & strategy" },
  { role: "performance-engineer", label: "Performance Engineer", salaryBase: 1_900_000, effect: "Qualifying pace extraction" },
  { role: "sporting-director", label: "Sporting Director", salaryBase: 2_600_000, effect: "Penalty mitigation & morale" },
  { role: "chief-mechanic", label: "Chief Mechanic", salaryBase: 1_800_000, effect: "Pit stop speed" },
  { role: "pit-crew", label: "Pit Crew", salaryBase: 1_200_000, effect: "Pit stop consistency" },
  { role: "commercial-director", label: "Commercial Director", salaryBase: 2_800_000, effect: "Sponsorship income" },
  { role: "scout", label: "Scout", salaryBase: 1_100_000, effect: "Talent discovery" },
];

export const CORE_ROLES: StaffRole[] = [
  "technical-director", "chief-designer", "aero-chief", "race-engineer", "performance-engineer",
  "sporting-director", "chief-mechanic", "pit-crew", "commercial-director", "scout",
];

export function roleMeta(role: StaffRole): StaffRoleMeta {
  return STAFF_ROLES.find((r) => r.role === role) ?? STAFF_ROLES[0];
}

export function staffName(seed: string): string {
  const rng = new Rng(`staffname:${seed}`);
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

function makeStaff(role: StaffRole, skill: number, careerId: string, seedKey: string): StaffMember {
  const rng = new Rng(seedKey);
  const meta = roleMeta(role);
  const age = rng.int(30, 58);
  const wage = Math.round(meta.salaryBase * (0.35 + (skill / 100) * 0.75) * rng.range(0.9, 1.1));
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
    experience: round(clamp((age - 28) * 4 + rng.gaussian(0, 6), 5, 100)),
  };
}

/** Build a full staff roster for a team at a given quality tier (0..1). */
export function buildStaff(careerId: string, teamId: string, quality: number, seedKey: string): StaffMember[] {
  const rng = new Rng(`staffteam:${seedKey}`);
  return CORE_ROLES.map((role) => {
    const skill = clamp(55 + quality * 38 + rng.gaussian(0, 6), 35, 99);
    const s = makeStaff(role, skill, careerId, `${seedKey}:${role}`);
    s.teamId = teamId;
    return s;
  });
}

/** Free-agent staff for the market. */
export function buildStaffMarket(careerId: string, count = 24, seed = "market"): StaffMember[] {
  const rng = new Rng(`staffmarket:${seed}`);
  const out: StaffMember[] = [];
  for (let i = 0; i < count; i++) {
    const role = rng.pick(CORE_ROLES);
    const skill = clamp(rng.gaussian(72, 12), 40, 97);
    out.push(makeStaff(role, skill, careerId, `${seed}:${i}:${role}`));
  }
  return out;
}
