import type { Circuit, TrackPoint } from "./types";
import { clamp } from "./rng";

/**
 * Deterministic circuit profile shared by the race engine and the broadcast.
 *
 * `outline` is the real (normalised) circuit trace. From it we derive a smooth
 * racing line, a corner-speed profile with braking/acceleration, and a
 * repeatable elevation profile. No UI code is imported, so the same profile is
 * available inside the Supabase Edge Function during an audit replay.
 */
export interface CircuitProfilePoint {
  x: number;
  y: number;
  progress: number;
  speed: number;
  elevation: number;
  corner: number | null;
}

export interface CircuitProfile {
  points: CircuitProfilePoint[];
  /** Lap-time units: progress -> normalised elapsed time (0..1). */
  timeAt(progress: number): number;
  progressAtTime(time: number): number;
  speedAt(progress: number): number;
  elevationAt(progress: number): number;
  /** 1-based corner number at this point, if the point is a recognised apex. */
  cornerAt(progress: number): number | null;
  /** Elevation change across the lap in metres. */
  elevationRange: number;
  /** Highest point as normalised progress. */
  elevationPeak: number;
  /** Lowest point as normalised progress. */
  elevationTrough: number;
}

const SAMPLES = 240;
const CACHE = new Map<string, CircuitProfile>();

const wrap = (v: number) => ((v % 1) + 1) % 1;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resampleClosed(outline: TrackPoint[], count: number): TrackPoint[] {
  const pts = outline.length > 2 ? outline : [
    { x: 0, y: 0.5 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0.5 },
    { x: 0.5, y: 1 },
  ];
  const segs = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y) };
  });
  const total = segs.reduce((sum, s) => sum + s.len, 0) || 1;
  const out: TrackPoint[] = [];
  let si = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (si < segs.length - 1 && acc + segs[si].len < target) {
      acc += segs[si].len;
      si++;
    }
    const seg = segs[si];
    const f = seg.len > 1e-9 ? (target - acc) / seg.len : 0;
    out.push({ x: seg.a.x + (seg.b.x - seg.a.x) * f, y: seg.a.y + (seg.b.y - seg.a.y) * f });
  }
  return out;
}

function smooth(points: TrackPoint[], passes = 3): TrackPoint[] {
  let cur = points;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((v, i) => {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[(i + 1) % cur.length];
      return { x: v.x * 0.5 + (a.x + b.x) * 0.25, y: v.y * 0.5 + (a.y + b.y) * 0.25 };
    });
  }
  return cur;
}

function curvature(points: TrackPoint[]): number[] {
  const n = points.length;
  return points.map((_, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
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
}

function movingAverage(values: number[], window: number): number[] {
  const n = values.length;
  return values.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let j = -window; j <= window; j++) {
      const w = 1 - Math.abs(j) / (window + 1);
      sum += values[(i + j + n) % n] * w;
      weight += w;
    }
    return sum / weight;
  });
}

function buildElevation(circuit: Circuit, curvatureValues: number[], progress: number[]): number[] {
  const seed = hash(circuit.id);
  const range = circuit.elevationMetres ?? clamp(8 + circuit.lengthKm * 4 + circuit.danger * 18, 8, 65);
  const phaseA = ((seed & 255) / 255) * Math.PI * 2;
  const phaseB = (((seed >>> 8) & 255) / 255) * Math.PI * 2;
  const phaseC = (((seed >>> 16) & 255) / 255) * Math.PI * 2;
  const waves = progress.map((p, i) => {
    const crest = Math.sin(p * Math.PI * 2 + phaseA) * 0.55;
    const shoulder = Math.sin(p * Math.PI * 4 + phaseB) * 0.22;
    const gentle = Math.sin(p * Math.PI * 6 + phaseC) * 0.08;
    // Crests tend to sit on straights, dips in braking zones.
    const corner = clamp(Math.abs(curvatureValues[i]) * 4, 0, 0.35);
    return crest + shoulder + gentle - corner;
  });
  const smoothed = movingAverage(waves, 7);
  const min = Math.min(...smoothed);
  const max = Math.max(...smoothed);
  const span = max - min || 1;
  return smoothed.map((v) => ((v - min) / span - 0.5) * range);
}

export function buildCircuitProfile(circuit: Circuit): CircuitProfile {
  const raw = resampleClosed(circuit.outline, SAMPLES);
  const points = smooth(raw, 3);
  const n = points.length;
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const total = cum[n - 1] + Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y) || 1;
  const progress = cum.map((d) => d / total);

  const k = movingAverage(curvature(points), 4);
  const speed = k.map((kk) => clamp(1 / Math.sqrt(1 + (Math.abs(kk) / 0.055) ** 2), 0.28, 1));

  // Brake before corners and accelerate out, exactly like a driver would.
  const ds = progress.map((p, i) => Math.max(0.0005, (i === 0 ? 1 + p - progress[n - 1] : p - progress[i - 1]) * total));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n];
      speed[i] = Math.min(speed[i], Math.sqrt(next * next + 2 * 0.018 * ds[i]));
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n; i++) {
      speed[i] = Math.min(speed[i], Math.sqrt(speed[i - 1] ** 2 + 2 * 0.012 * ds[i]));
    }
    speed[0] = Math.min(speed[0], Math.sqrt(speed[n - 1] ** 2 + 2 * 0.012 * ds[0]));
  }

  const times = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) times[i] = times[i - 1] + ds[i] / Math.max(0.1, speed[i]);
  const lapUnits = times[n - 1] + ds[0] / Math.max(0.1, speed[0]);
  for (let i = 0; i < n; i++) times[i] /= lapUnits;

  // Apex numbers are useful for radio messages; mark local minima in speed.
  const corners: Array<number | null> = new Array(n).fill(null);
  let cornerNumber = 0;
  let inCorner = false;
  for (let i = 0; i < n; i++) {
    const tight = speed[i] < 0.82;
    if (tight && !inCorner) {
      inCorner = true;
      cornerNumber++;
    } else if (!tight && inCorner) {
      inCorner = false;
    }
    if (inCorner) corners[i] = cornerNumber;
  }

  const elevation = buildElevation(circuit, k, progress);
  const elevationRange = Math.max(...elevation) - Math.min(...elevation);
  const peakIndex = elevation.indexOf(Math.max(...elevation));
  const troughIndex = elevation.indexOf(Math.min(...elevation));

  const indexAt = (t: number): { i: number; frac: number } => {
    const target = wrap(t);
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (progress[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = (progress[lo + 1] ?? 1) - progress[lo] || 1;
    return { i: lo, frac: (target - progress[lo]) / span };
  };

  const interpolate = (values: number[], t: number): number => {
    const { i, frac } = indexAt(t);
    const a = values[i];
    const b = values[(i + 1) % n];
    return a + (b - a) * frac;
  };

  const progressAtTime = (time: number): number => {
    const target = wrap(time);
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = (times[lo + 1] ?? 1) - times[lo] || 1;
    const frac = (target - times[lo]) / span;
    return wrap(progress[lo] + ((progress[lo + 1] ?? 1) - progress[lo]) * frac);
  };

  const timeAt = (p: number): number => interpolate(times, p);
  const speedAt = (p: number): number => interpolate(speed, p);
  const elevationAt = (p: number): number => interpolate(elevation, p);

  const cornerAt = (p: number): number | null => {
    const { i } = indexAt(p);
    return corners[i] ?? null;
  };

  return {
    points: points.map((v, i) => ({
      x: v.x,
      y: v.y,
      progress: progress[i],
      speed: speed[i],
      elevation: elevation[i],
      corner: corners[i],
    })),
    timeAt,
    progressAtTime,
    speedAt,
    elevationAt,
    cornerAt,
    elevationRange,
    elevationPeak: progress[peakIndex],
    elevationTrough: progress[troughIndex],
  };
}

export function getCircuitProfile(circuit: Circuit): CircuitProfile {
  const hit = CACHE.get(circuit.id);
  if (hit) return hit;
  const profile = buildCircuitProfile(circuit);
  CACHE.set(circuit.id, profile);
  return profile;
}
