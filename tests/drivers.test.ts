import { describe, expect, it } from "vitest";
import { buildFictionalDrivers, buildRealDrivers, FICTIONAL_DRIVER_COUNT } from "../src/data/drivers";

const CUSTOM = [
  "Qistiano Bodado",
  "Scott Laso",
  "Clanker Ant",
  "Myles Bedroque",
  "Oliwier Lewandowski",
  "Dion Dior",
  "Jack Brish",
  "Kevin Hollis",
];

describe("driver pool", () => {
  const pool = buildFictionalDrivers();

  it("builds one driver per seed with unique ids and timing codes", () => {
    expect(pool).toHaveLength(FICTIONAL_DRIVER_COUNT);
    expect(new Set(pool.map((d) => d.id)).size).toBe(pool.length);
    expect(new Set(pool.map((d) => d.code)).size).toBe(pool.length);
  });

  it("keeps every generated attribute inside its legal band", () => {
    for (const d of pool) {
      const a = d.attributes;
      for (const key of ["pace", "qualifying", "racecraft", "overtaking", "defending", "tireManagement", "wet", "consistency", "concentration"] as const) {
        expect(a[key]).toBeGreaterThanOrEqual(40);
        expect(a[key]).toBeLessThanOrEqual(99);
      }
      expect(a.aggression).toBeGreaterThanOrEqual(0.1);
      expect(a.aggression).toBeLessThanOrEqual(0.98);
      expect(d.potential).toBeGreaterThanOrEqual(85);
      expect(d.potential).toBeLessThanOrEqual(99);
      expect(d.morale).toBeGreaterThanOrEqual(0);
      expect(d.salaryDemand).toBeGreaterThan(0);
    }
  });

  it("re-rolls the grid for each career but stays stable within one", () => {
    const a = buildFictionalDrivers("career-a");
    const b = buildFictionalDrivers("career-b");
    const aAgain = buildFictionalDrivers("career-a");
    expect(a.map((d) => [d.attributes.pace, d.potential])).toEqual(aAgain.map((d) => [d.attributes.pace, d.potential]));
    const changed = a.filter((d, i) => d.attributes.pace !== b[i].attributes.pace).length;
    expect(changed).toBeGreaterThan(5);
    for (const d of [...a, ...b]) {
      expect(d.potential).toBeGreaterThanOrEqual(85);
      expect(d.potential).toBeLessThanOrEqual(99);
    }
  });

  it("includes the custom young prospects as free-agent-ready rookies", () => {
    for (const name of CUSTOM) {
      const d = pool.find((x) => x.name === name);
      expect(d, name).toBeDefined();
      expect(d!.age).toBeGreaterThanOrEqual(18);
      expect(d!.age).toBeLessThanOrEqual(19);
      expect(d!.teamId).toBeNull();
      expect(d!.isRealPerson).toBe(false);
    }
  });

  it("flags real drivers as real people", () => {
    for (const d of buildRealDrivers()) expect(d.isRealPerson).toBe(true);
  });
});
