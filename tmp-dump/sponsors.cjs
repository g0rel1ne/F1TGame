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

// src/data/sponsors.ts
var sponsors_exports = {};
__export(sponsors_exports, {
  SPONSORS: () => SPONSORS,
  getSponsor: () => getSponsor
});
module.exports = __toCommonJS(sponsors_exports);
var SPONSORS = [
  { id: "sp-volt", name: "Volt Dynamics", industry: "Energy", upfront: 6e6, perRace: 35e4, positionBonus: 8e6, targetPosition: 5, minReputation: 60, difficulty: 0.4, placement: "sidepod", fictional: true },
  { id: "sp-nimbus", name: "Nimbus Cloud", industry: "Technology", upfront: 9e6, perRace: 48e4, positionBonus: 12e6, targetPosition: 3, minReputation: 74, difficulty: 0.6, placement: "engine-cover", fictional: true },
  { id: "sp-apex", name: "Apex Financial", industry: "Finance", upfront: 4e6, perRace: 26e4, positionBonus: 5e6, targetPosition: 8, minReputation: 50, difficulty: 0.3, placement: "rear-wing", fictional: true },
  { id: "sp-helios", name: "Helios Aerospace", industry: "Aerospace", upfront: 11e6, perRace: 52e4, positionBonus: 15e6, targetPosition: 2, minReputation: 80, difficulty: 0.75, placement: "nose", fictional: true },
  { id: "sp-quantum", name: "Quantum Motors", industry: "Automotive", upfront: 75e5, perRace: 4e5, positionBonus: 9e6, targetPosition: 4, minReputation: 66, difficulty: 0.5, placement: "sidepod", fictional: true },
  { id: "sp-meridian", name: "Meridian Telecom", industry: "Telecom", upfront: 55e5, perRace: 3e5, positionBonus: 65e5, targetPosition: 6, minReputation: 58, difficulty: 0.42, placement: "accent", fictional: true },
  { id: "sp-forge", name: "Forge Steel", industry: "Manufacturing", upfront: 32e5, perRace: 21e4, positionBonus: 4e6, targetPosition: 9, minReputation: 46, difficulty: 0.28, placement: "rear-wing", fictional: true },
  { id: "sp-lumen", name: "Lumen Health", industry: "Healthcare", upfront: 48e5, perRace: 28e4, positionBonus: 55e5, targetPosition: 7, minReputation: 54, difficulty: 0.35, placement: "engine-cover", fictional: true },
  { id: "sp-kestrel", name: "Kestrel Beverages", industry: "Drinks", upfront: 68e5, perRace: 36e4, positionBonus: 85e5, targetPosition: 5, minReputation: 62, difficulty: 0.48, placement: "nose", fictional: true },
  { id: "sp-orbit", name: "Orbit Streaming", industry: "Media", upfront: 82e5, perRace: 43e4, positionBonus: 1e7, targetPosition: 4, minReputation: 70, difficulty: 0.55, placement: "sidepod", fictional: true },
  { id: "sp-titan", name: "Titanium Grid", industry: "Materials", upfront: 39e5, perRace: 235e3, positionBonus: 48e5, targetPosition: 8, minReputation: 50, difficulty: 0.32, placement: "accent", fictional: true },
  { id: "sp-nova", name: "Nova Insurance", industry: "Insurance", upfront: 51e5, perRace: 295e3, positionBonus: 6e6, targetPosition: 6, minReputation: 56, difficulty: 0.38, placement: "rear-wing", fictional: true }
];
function getSponsor(id) {
  return SPONSORS.find((s) => s.id === id);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SPONSORS,
  getSponsor
});
