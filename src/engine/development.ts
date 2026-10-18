import type { CarSpec, Facility, FacilityKind, UpgradeArea, UpgradeProject } from "./types";
import type { Rng } from "./rng";
import { clamp } from "./rng";

export interface UpgradeMeta {
  name: string;
  baseCost: number;
  /** Research ticks (each tick == one race weekend of development). */
  baseTicks: number;
  /** Nominal performance points added to the area on completion. */
  nominalGain: number;
  category: "aero" | "mechanical" | "power" | "reliability";
}

export const UPGRADE_META: Record<UpgradeArea, UpgradeMeta> = {
  "front-wing": { name: "Front Wing", baseCost: 1_400_000, baseTicks: 2, nominalGain: 2.4, category: "aero" },
  "rear-wing": { name: "Rear Wing", baseCost: 1_300_000, baseTicks: 2, nominalGain: 2.2, category: "aero" },
  floor: { name: "Floor", baseCost: 2_200_000, baseTicks: 3, nominalGain: 3.6, category: "aero" },
  sidepods: { name: "Sidepods", baseCost: 1_600_000, baseTicks: 2, nominalGain: 2.0, category: "aero" },
  suspension: { name: "Suspension", baseCost: 1_500_000, baseTicks: 2, nominalGain: 2.0, category: "mechanical" },
  chassis: { name: "Chassis", baseCost: 2_500_000, baseTicks: 3, nominalGain: 2.6, category: "mechanical" },
  brakes: { name: "Brake System", baseCost: 900_000, baseTicks: 1, nominalGain: 1.6, category: "mechanical" },
  cooling: { name: "Cooling", baseCost: 800_000, baseTicks: 1, nominalGain: 1.2, category: "reliability" },
  engine: { name: "Engine Integration", baseCost: 3_000_000, baseTicks: 4, nominalGain: 3.4, category: "power" },
  gearbox: { name: "Gearbox", baseCost: 2_400_000, baseTicks: 3, nominalGain: 2.2, category: "power" },
  reliability: { name: "Reliability Package", baseCost: 1_200_000, baseTicks: 2, nominalGain: 2.0, category: "reliability" },
};

export const FACILITY_META: Record<FacilityKind, { name: string; baseCost: number; effect: string }> = {
  factory: { name: "Factory", baseCost: 12_000_000, effect: "Manufacturing capacity and repair speed" },
  "design-office": { name: "Design Office", baseCost: 10_000_000, effect: "Upgrade quality and design speed" },
  "wind-tunnel": { name: "Wind Tunnel", baseCost: 18_000_000, effect: "Aerodynamic research throughput" },
  simulator: { name: "Simulator", baseCost: 9_000_000, effect: "Setup accuracy and driver development" },
  "driver-academy": { name: "Driver Academy", baseCost: 7_000_000, effect: "Young driver growth and scouting" },
  "pit-crew": { name: "Pit Crew Training", baseCost: 8_000_000, effect: "Faster, safer pit stops" },
  commercial: { name: "Commercial Department", baseCost: 6_000_000, effect: "Sponsorship income and reputation" },
  "reliability-lab": { name: "Reliability Lab", baseCost: 8_000_000, effect: "Fewer mechanical failures" },
  hospitality: { name: "Hospitality", baseCost: 5_000_000, effect: "Reputation and staff morale" },
};

export function facilityLevel(facilities: Facility[], kind: FacilityKind): number {
  return facilities.find((f) => f.kind === kind)?.level ?? 0;
}

export function facilityUpgradeCost(kind: FacilityKind, currentLevel: number): number {
  return Math.round(FACILITY_META[kind].baseCost * (0.6 + currentLevel * 0.5));
}

export interface DevelopmentModifiers {
  speed: number; // multiplies tick progress
  quality: number; // multiplies rolled quality
  maxConcurrent: number;
  reliabilityBonus: number;
  pitStopBonus: number;
}

export function developmentModifiers(facilities: Facility[], topStaffSkill: number): DevelopmentModifiers {
  const design = facilityLevel(facilities, "design-office");
  const tunnel = facilityLevel(facilities, "wind-tunnel");
  const sim = facilityLevel(facilities, "simulator");
  const reliabilityLab = facilityLevel(facilities, "reliability-lab");
  const pitCrew = facilityLevel(facilities, "pit-crew");

  return {
    speed: 1 + design * 0.09 + tunnel * 0.07 + topStaffSkill / 400,
    quality: 1 + design * 0.06 + (topStaffSkill - 60) / 300,
    maxConcurrent: Math.max(1, 1 + Math.floor(tunnel / 1.5) + Math.floor(design / 3) + (sim >= 3 ? 1 : 0)),
    reliabilityBonus: reliabilityLab * 0.03,
    pitStopBonus: pitCrew * 0.06,
  };
}

/** A research project can fail or be delayed; risk comes from facilities/staff. */
export function createUpgradeProject(
  rng: Rng,
  params: {
    careerId: string;
    teamId: string;
    area: UpgradeArea;
    season: number;
    mods: DevelopmentModifiers;
  },
): UpgradeProject {
  const meta = UPGRADE_META[params.area];
  const cost = Math.round(meta.baseCost * rng.range(0.9, 1.15));
  const ticks = Math.max(1, Math.round(meta.baseTicks / clamp(params.mods.speed, 0.5, 2.5)));
  const quality = clamp(rng.gaussian(70 * params.mods.quality, 12), 25, 100);
  const gain = meta.nominalGain * (0.6 + quality / 200);

  return {
    id: `proj-${params.teamId}-${params.area}-${Date.now().toString(36)}-${Math.floor(rng.next() * 1e5)}`,
    careerId: params.careerId,
    teamId: params.teamId,
    area: params.area,
    name: `${meta.name} upgrade`,
    quality,
    cost,
    durationTicks: ticks,
    ticksRemaining: ticks,
    nominalGain: gain,
    completed: false,
    installed: false,
    season: params.season,
    createdAt: Date.now(),
  };
}

export function tickProject(project: UpgradeProject): UpgradeProject {
  if (project.completed) return project;
  const remaining = Math.max(0, project.ticksRemaining - 1);
  return { ...project, ticksRemaining: remaining, completed: remaining === 0 };
}

/** Install a completed project onto a car. Each area's points stack. */
export function installUpgrade(car: CarSpec, project: UpgradeProject): CarSpec {
  if (!project.completed) throw new Error("Cannot install an unfinished upgrade");
  const installed = { ...car.installed };
  installed[project.area] = (installed[project.area] ?? 0) + project.nominalGain;
  return { ...car, installed };
}

export function emptyInstalled(): Record<UpgradeArea, number> {
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
    reliability: 0,
  };
}
