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

// src/engine/rulesets.ts
var rulesets_exports = {};
__export(rulesets_exports, {
  DEFAULT_RULESET_ID: () => DEFAULT_RULESET_ID,
  RULESETS: () => RULESETS,
  getRuleset: () => getRuleset
});
module.exports = __toCommonJS(rulesets_exports);
var RULESETS = {
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
    redFlags: true
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
    redFlags: true
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
    redFlags: true
  }
};
var DEFAULT_RULESET_ID = "classic-25-18";
function getRuleset(id) {
  return RULESETS[id] ?? RULESETS[DEFAULT_RULESET_ID];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_RULESET_ID,
  RULESETS,
  getRuleset
});
