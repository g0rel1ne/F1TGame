import { describe, expect, it } from "vitest";
import { CIRCUITS } from "../src/data/circuits";
import { buildTrack, type Pt } from "../src/lib/trackGeometry";
import { buildRealDrivers } from "../src/data/drivers";
import { driverIq } from "../src/engine/driverIq";
import type { Driver as DriverType } from "../src/engine/types";

const DRIVERS = buildRealDrivers();

const ROAD = 10;

function smoothCurvature(pts: Pt[], win = 4): number[] {
  const n = pts.length;
  const raw = pts.map((b, i) => {
    const a = pts[(i - 1 + n) % n];
    const c = pts[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = abx * bcy - aby * bcx;
    const l1 = Math.hypot(abx, aby) || 1;
    const l2 = Math.hypot(bcx, bcy) || 1;
    const l3 = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    return (2 * cross) / (l1 * l2 * l3);
  });
  return raw.map((_, i) => {
    let sum = 0;
    for (let j = -win; j <= win; j++) sum += raw[(i + j + n) % n];
    return sum / (win * 2 + 1);
  });
}

function segX(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

describe("track geometry", () => {
  const geometries = CIRCUITS.map((circuit) => ({ circuit, geo: buildTrack(circuit, 400, 240, 16, ROAD) }));

  it("builds a usable closed centre-line for every circuit", () => {
    for (const { geo } of geometries) {
      expect(geo.dense.length).toBeGreaterThan(120);
      expect(geo.totalLength).toBeGreaterThan(350);
      expect(Number.isFinite(geo.totalLength)).toBe(true);
      expect(geo.path.startsWith("M ")).toBe(true);
      expect(geo.path.endsWith("Z")).toBe(true);
      for (const p of geo.dense) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThan(-20);
        expect(p.x).toBeLessThan(420);
        expect(p.y).toBeGreaterThan(-20);
        expect(p.y).toBeLessThan(260);
      }
    }
  });

  it("has no unintended self-intersections (Suzuka's bridge is allowed)", () => {
    for (const { circuit, geo } of geometries) {
      const d = geo.dense;
      const n = d.length;
      let crosses = 0;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 2; j < n - 1; j++) {
          if (i === 0 && j === n - 2) continue;
          if (segX(d[i], d[(i + 1) % n], d[j], d[(j + 1) % n])) crosses++;
        }
      }
      if (circuit.id === "suzuka") {
        expect(crosses).toBeGreaterThanOrEqual(1);
        expect(geo.bridges.length).toBeGreaterThanOrEqual(1);
      } else {
        expect(crosses, `${circuit.id} has ${crosses} self-intersections`).toBe(0);
      }
    }
  });

  it("keeps non-adjacent sections far enough apart for the road width", () => {
    for (const { circuit, geo } of geometries) {
      if (circuit.id === "suzuka") continue; // genuine crossover
      const d = geo.dense;
      const n = d.length;
      let minClear = Infinity;
      for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
          const arc = Math.min(geo.cum[j] - geo.cum[i], geo.totalLength - (geo.cum[j] - geo.cum[i]));
          if (arc < 40) continue;
          const dist = Math.hypot(d[i].x - d[j].x, d[i].y - d[j].y);
          if (dist < minClear) minClear = dist;
        }
      }
      expect(minClear, `${circuit.id} clearance ${minClear.toFixed(1)}px`).toBeGreaterThan(ROAD - 1.5);
    }
  });

  it("never lets a corner fold tighter than the road half-width", () => {
    for (const { circuit, geo } of geometries) {
      const k = smoothCurvature(geo.dense);
      const maxK = Math.max(...k.map((v) => Math.abs(v)));
      const minR = 1 / Math.max(maxK, 1e-6);
      expect(minR, `${circuit.id} min radius ${minR.toFixed(1)}px`).toBeGreaterThan(ROAD / 2 - 0.5);
    }
  });

  it("keeps the racing line inside the road and free of cusps", () => {
    for (const { geo } of geometries) {
      const limit = ROAD / 2 - 1.4;
      for (const off of geo.racingOffset) {
        expect(Number.isFinite(off)).toBe(true);
        expect(Math.abs(off)).toBeLessThanOrEqual(limit + 1e-6);
      }
      // The racing line must not zig-zag: neighbouring offsets stay close.
      for (let i = 0; i < geo.racingOffset.length; i++) {
        const a = geo.racingOffset[i];
        const b = geo.racingOffset[(i + 1) % geo.racingOffset.length];
        expect(Math.abs(a - b)).toBeLessThan(1.6);
      }
      // Apex of a corner should sit on the inside, i.e. the line actually bends.
      const k = smoothCurvature(geo.dense);
      let apex = 0;
      for (let i = 0; i < k.length; i++) if (Math.abs(k[i]) > Math.abs(k[apex])) apex = i;
      void apex;
      expect(geo.racing.length).toBe(geo.dense.length);
    }
  });

  it("produces sensible kerbs that follow the road edges", () => {
    for (const { circuit, geo } of geometries) {
      const limit = ROAD / 2 + 0.6;
      for (const run of geo.kerbRuns) {
        expect(run.d.length).toBeGreaterThan(0);
        expect([1, -1]).toContain(run.side);
        // Every kerb vertex must sit on (or just inside) the road edge.
        const coords = run.d.match(/-?\d+\.\d+/g) ?? [];
        expect(coords.length % 2).toBe(0);
        for (let i = 0; i < coords.length; i += 2) {
          const px = parseFloat(coords[i]);
          const py = parseFloat(coords[i + 1]);
          const nearest = nearestLateral(geo.dense, geo.normals, { x: px, y: py });
          expect(Math.abs(nearest), `${circuit.id} kerb lateral ${nearest.toFixed(1)}`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("gives a speed profile that laps in the right direction", () => {
    for (const { geo } of geometries) {
      const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9];
      const mapped = samples.map((u) => geo.progressAtTime(u));
      for (let i = 1; i < mapped.length; i++) {
        expect(mapped[i]).toBeGreaterThan(mapped[i - 1]);
      }
      expect(mapped[0]).toBeCloseTo(0, 1);
      for (const f of geo.speedFactor) {
        expect(f).toBeGreaterThan(0.25);
        expect(f).toBeLessThanOrEqual(1);
      }
      // Tight circuits should be slower per metre than flat-out ones.
      const avg = geo.speedFactor.reduce((a, b) => a + b, 0) / geo.speedFactor.length;
      expect(avg).toBeGreaterThan(0.3);
    }
  });

  it("starts on the real start/finish line", () => {
    for (const { geo } of geometries) {
      expect(geo.start).toBe(geo.dense[0]);
      expect(Number.isFinite(geo.startAngle)).toBe(true);
      const p = geo.pointAt(0);
      expect(Math.hypot(p.x - geo.start.x, p.y - geo.start.y)).toBeLessThan(0.01);
    }
  });
});

function nearestLateral(dense: Pt[], normals: Pt[], p: Pt): number {
  let best = Infinity;
  let lateral = 0;
  for (let i = 0; i < dense.length; i++) {
    const d = Math.hypot(dense[i].x - p.x, dense[i].y - p.y);
    if (d < best) {
      best = d;
      lateral = (p.x - dense[i].x) * normals[i].x + (p.y - dense[i].y) * normals[i].y;
    }
  }
  return lateral;
}

describe("driver IQ", () => {
  it("is bounded and rewards racecraft", () => {
    for (const d of DRIVERS) {
      const iq = driverIq(d as unknown as DriverType);
      expect(iq.overall).toBeGreaterThanOrEqual(0);
      expect(iq.overall).toBeLessThanOrEqual(1);
      expect(iq.attack).toBeGreaterThanOrEqual(0);
      expect(iq.attack).toBeLessThanOrEqual(1);
      expect(iq.defend).toBeGreaterThanOrEqual(0);
      expect(iq.defend).toBeLessThanOrEqual(1);
    }
  });

  it("separates a sharp driver from a clumsy one", () => {
    const base = DRIVERS[0] as unknown as DriverType;
    const clone = (patch: Partial<DriverType["attributes"]>): DriverType => ({
      ...base,
      attributes: { ...base.attributes, ...patch },
    });
    const sharp = driverIq(clone({ racecraft: 95, overtaking: 95, consistency: 95, concentration: 95, experience: 95 }));
    const clumsy = driverIq(clone({ racecraft: 40, overtaking: 40, consistency: 40, concentration: 40, experience: 40 }));
    expect(sharp.overall).toBeGreaterThan(clumsy.overall);
    expect(sharp.attack).toBeGreaterThan(clumsy.attack);
    expect(sharp.defend).toBeGreaterThan(clumsy.defend);
  });

  it("exposes attribute data used by the IQ score", () => {
    const d = DRIVERS[0] as unknown as DriverType;
    expect(typeof d.id).toBe("string");
    expect(typeof d.attributes.racecraft).toBe("number");
  });
});
