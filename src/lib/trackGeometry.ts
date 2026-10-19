import type { Circuit } from "../engine/types";

export interface Pt {
  x: number;
  y: number;
}

function catmullRomSamples(points: Pt[], stepsPerSegment: number): Pt[] {
  if (points.length < 2) return [...points];
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...points[0] });
  return out;
}

function catmullRomPath(points: Pt[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function wrap(t: number): number {
  return ((t % 1) + 1) % 1;
}

export interface KerbRun {
  d: string;
  side: 1 | -1;
}

export interface TrackGeometry {
  W: number;
  H: number;
  path: string;
  dense: Pt[];
  normals: Pt[];
  cum: number[];
  totalLength: number;
  roadWidth: number;
  start: Pt;
  pointAt(t: number): Pt;
  normalAt(t: number): Pt;
  angleAt(t: number): number;
  offsetAt(t: number, lateral: number): Pt;
  curvatureAt(i: number): number;
  offsetPath(fromT: number, toT: number, lateral: number, slices?: number): string;
  kerbRuns: KerbRun[];
}

export function buildTrack(circuit: Circuit, W = 400, H = 240, pad = 22, roadWidth = 12): TrackGeometry {
  const outline = circuit.outline;
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of outline) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const rotate = (pts: Pt[], a: number): Pt[] => {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return pts.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  };
  let rotated = rotate(outline.map((p) => ({ x: p.x - cx, y: p.y - cy })), -angle);
  const bounds = (pts: Pt[]) => ({
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  });
  let b = bounds(rotated);
  if (b.maxY - b.minY > b.maxX - b.minX) {
    angle += Math.PI / 2;
    rotated = rotate(outline.map((p) => ({ x: p.x - cx, y: p.y - cy })), -angle);
    b = bounds(rotated);
  }

  const { minX, maxX, minY, maxY } = b;
  const s = Math.min((W - pad * 2) / Math.max(0.001, maxX - minX), (H - pad * 2) / Math.max(0.001, maxY - minY));
  const offsetX = (W - (maxX - minX) * s) / 2;
  const offsetY = (H - (maxY - minY) * s) / 2;
  const mapped: Pt[] = rotated.map((p) => ({ x: offsetX + (p.x - minX) * s, y: offsetY + (p.y - minY) * s }));

  const dense = catmullRomSamples(mapped, 20);
  const n = dense.length;
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
  const totalLength = cum[n - 1] || 1;

  const normals: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = dense[(i - 1 + n) % n];
    const b2 = dense[(i + 1) % n];
    const dx = b2.x - a.x;
    const dy = b2.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    normals[i] = { x: -dy / len, y: dx / len };
  }

  const curvatureAt = (i: number): number => {
    const a = dense[(i - 1 + n) % n];
    const b0 = dense[i];
    const c = dense[(i + 1) % n];
    const abx = b0.x - a.x;
    const aby = b0.y - a.y;
    const bcx = c.x - b0.x;
    const bcy = c.y - b0.y;
    const cross = abx * bcy - aby * bcx;
    const l1 = Math.hypot(abx, aby) || 1;
    const l2 = Math.hypot(bcx, bcy) || 1;
    const l3 = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    return (2 * cross) / (l1 * l2 * l3);
  };

  const indexAt = (t: number): { i: number; frac: number } => {
    const target = wrap(t) * totalLength;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = cum[lo + 1] - cum[lo] || 1;
    return { i: lo, frac: (target - cum[lo]) / span };
  };

  const pointAt = (t: number): Pt => {
    const { i, frac } = indexAt(t);
    const a = dense[i];
    const b0 = dense[i + 1] ?? dense[n - 1];
    return { x: a.x + (b0.x - a.x) * frac, y: a.y + (b0.y - a.y) * frac };
  };

  const normalAt = (t: number): Pt => {
    const { i, frac } = indexAt(t);
    const a = normals[i];
    const b0 = normals[i + 1] ?? normals[n - 1];
    const x = a.x + (b0.x - a.x) * frac;
    const y = a.y + (b0.y - a.y) * frac;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };

  const angleAt = (t: number): number => {
    const p = pointAt(t);
    const q = pointAt(t + 0.004);
    return Math.atan2(q.y - p.y, q.x - p.x);
  };

  const offsetAt = (t: number, lateral: number): Pt => {
    const p = pointAt(t);
    const nrm = normalAt(t);
    return { x: p.x + nrm.x * lateral, y: p.y + nrm.y * lateral };
  };

  const offsetPath = (fromT: number, toT: number, lateral: number, slices = 64): string => {
    const span = wrap(toT - fromT) || 1;
    const pts: string[] = [];
    for (let i = 0; i <= slices; i++) {
      const t = fromT + span * (i / slices);
      const p = offsetAt(t, lateral);
      pts.push(`${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
    }
    return pts.join(" ");
  };

  const rawCurv = new Array<number>(n);
  for (let i = 0; i < n; i++) rawCurv[i] = curvatureAt(i);
  const smoothCurv = new Array<number>(n);
  {
    const win = 6;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -win; k <= win; k++) sum += rawCurv[(i + k + n) % n];
      smoothCurv[i] = sum / (win * 2 + 1);
    }
  }

  const kerbThreshold = 0.016;
  const kerbRuns: KerbRun[] = [];
  {
    const inside = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) inside[i] = Math.abs(smoothCurv[i]) > kerbThreshold;
    const kerbLateral = roadWidth / 2 - 1.1;
    let i = 0;
    while (i < n - 1) {
      if (!inside[i]) {
        i++;
        continue;
      }
      const startIdx = i;
      while (i < n - 1 && inside[i]) i++;
      const endIdx = i;
      const from = Math.max(0, startIdx - 4);
      const to = Math.min(n - 1, endIdx + 4);
      if (cum[to] - cum[from] < 22) continue;
      let sum = 0;
      for (let k = startIdx; k < endIdx; k++) sum += smoothCurv[k];
      const side: 1 | -1 = sum >= 0 ? 1 : -1;
      const pts: string[] = [];
      for (let k = from; k <= to; k++) {
        const p = dense[k];
        const nrm = normals[k];
        pts.push(`${k === from ? "M" : "L"} ${(p.x + nrm.x * kerbLateral * side).toFixed(2)} ${(p.y + nrm.y * kerbLateral * side).toFixed(2)}`);
      }
      kerbRuns.push({ d: pts.join(" "), side });
    }
  }

  return {
    W,
    H,
    path: catmullRomPath(mapped),
    dense,
    normals,
    cum,
    totalLength,
    roadWidth,
    start: mapped[0] ?? { x: W / 2, y: H / 2 },
    pointAt,
    normalAt,
    angleAt,
    offsetAt,
    curvatureAt,
    offsetPath,
    kerbRuns,
  };
}
