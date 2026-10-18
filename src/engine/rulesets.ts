import type { Ruleset } from "./types";

/**
 * Championship rulesets. Season data references a ruleset by id; nothing in the
 * engine assumes a single permanent points system.
 */
export const RULESETS: Record<string, Ruleset> = {
  "classic-25-18": {
    id: "classic-25-18",
    name: "Classic (25-18, mandatory stop)",
    racePoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sprintPoints: [8, 7, 6, 5, 4, 3, 2, 1],
    fastestLapPoints: 1,
    fastestLapTopN: 10,
    q1Eliminated: 5,
    q2Eliminated: 5,
    mandatoryPitStop: true,
    costCap: 135,
    safetyCars: true,
    virtualSafetyCars: true,
    redFlags: true,
  },
  "no-points-fastest-lap": {
    id: "no-points-fastest-lap",
    name: "Modern (no fastest-lap point)",
    racePoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sprintPoints: [8, 7, 6, 5, 4, 3, 2, 1],
    fastestLapPoints: 0,
    fastestLapTopN: 0,
    q1Eliminated: 5,
    q2Eliminated: 5,
    mandatoryPitStop: true,
    costCap: 135,
    safetyCars: true,
    virtualSafetyCars: true,
    redFlags: true,
  },
  "historic-10-6-4": {
    id: "historic-10-6-4",
    name: "Historic (9-6-4-3-2-1)",
    racePoints: [9, 6, 4, 3, 2, 1],
    sprintPoints: [],
    fastestLapPoints: 0,
    fastestLapTopN: 0,
    q1Eliminated: 0,
    q2Eliminated: 0,
    mandatoryPitStop: false,
    costCap: 0,
    safetyCars: true,
    virtualSafetyCars: false,
    redFlags: true,
  },
};

export const DEFAULT_RULESET_ID = "classic-25-18";

export function getRuleset(id: string): Ruleset {
  return RULESETS[id] ?? RULESETS[DEFAULT_RULESET_ID];
}
