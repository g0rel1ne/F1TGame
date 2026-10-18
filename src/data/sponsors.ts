import type { Sponsor } from "../engine/types";

/**
 * Sponsor market. All brands here are FICTIONAL and invented for the game.
 * Real brands should only be added where their branding and usage rights permit.
 */
export const SPONSORS: Sponsor[] = [
  { id: "sp-volt", name: "Volt Dynamics", industry: "Energy", upfront: 6_000_000, perRace: 350_000, positionBonus: 8_000_000, targetPosition: 5, minReputation: 60, difficulty: 0.4, placement: "sidepod", fictional: true },
  { id: "sp-nimbus", name: "Nimbus Cloud", industry: "Technology", upfront: 9_000_000, perRace: 480_000, positionBonus: 12_000_000, targetPosition: 3, minReputation: 74, difficulty: 0.6, placement: "engine-cover", fictional: true },
  { id: "sp-apex", name: "Apex Financial", industry: "Finance", upfront: 4_000_000, perRace: 260_000, positionBonus: 5_000_000, targetPosition: 8, minReputation: 50, difficulty: 0.3, placement: "rear-wing", fictional: true },
  { id: "sp-helios", name: "Helios Aerospace", industry: "Aerospace", upfront: 11_000_000, perRace: 520_000, positionBonus: 15_000_000, targetPosition: 2, minReputation: 80, difficulty: 0.75, placement: "nose", fictional: true },
  { id: "sp-quantum", name: "Quantum Motors", industry: "Automotive", upfront: 7_500_000, perRace: 400_000, positionBonus: 9_000_000, targetPosition: 4, minReputation: 66, difficulty: 0.5, placement: "sidepod", fictional: true },
  { id: "sp-meridian", name: "Meridian Telecom", industry: "Telecom", upfront: 5_500_000, perRace: 300_000, positionBonus: 6_500_000, targetPosition: 6, minReputation: 58, difficulty: 0.42, placement: "accent", fictional: true },
  { id: "sp-forge", name: "Forge Steel", industry: "Manufacturing", upfront: 3_200_000, perRace: 210_000, positionBonus: 4_000_000, targetPosition: 9, minReputation: 46, difficulty: 0.28, placement: "rear-wing", fictional: true },
  { id: "sp-lumen", name: "Lumen Health", industry: "Healthcare", upfront: 4_800_000, perRace: 280_000, positionBonus: 5_500_000, targetPosition: 7, minReputation: 54, difficulty: 0.35, placement: "engine-cover", fictional: true },
  { id: "sp-kestrel", name: "Kestrel Beverages", industry: "Drinks", upfront: 6_800_000, perRace: 360_000, positionBonus: 8_500_000, targetPosition: 5, minReputation: 62, difficulty: 0.48, placement: "nose", fictional: true },
  { id: "sp-orbit", name: "Orbit Streaming", industry: "Media", upfront: 8_200_000, perRace: 430_000, positionBonus: 10_000_000, targetPosition: 4, minReputation: 70, difficulty: 0.55, placement: "sidepod", fictional: true },
  { id: "sp-titan", name: "Titanium Grid", industry: "Materials", upfront: 3_900_000, perRace: 235_000, positionBonus: 4_800_000, targetPosition: 8, minReputation: 50, difficulty: 0.32, placement: "accent", fictional: true },
  { id: "sp-nova", name: "Nova Insurance", industry: "Insurance", upfront: 5_100_000, perRace: 295_000, positionBonus: 6_000_000, targetPosition: 6, minReputation: 56, difficulty: 0.38, placement: "rear-wing", fictional: true },
];

export function getSponsor(id: string): Sponsor | undefined {
  return SPONSORS.find((s) => s.id === id);
}
