import type { Circuit } from "../engine/types";

/**
 * Shared circuit geometry.
 *
 * Every track in the game is reduced to a single, carefully conditioned
 * centre-line here and every other feature (road edges, kerbs, the racing line,
 * the speed profile used to animate cars, sector markers, the pit lane) is
 * derived from it. Keeping one source of truth means the car view, the dots
 * view and the AI all agree on where the track actually is.
 *
 * Pipeline:
 *   1. Map the normalised outline into the canvas (PCA so the long axis fits).
 *   2. Chaikin corner-cutting to round the raw, blocky control polygon.
 *   3. Laplacian diffusion to smooth curvature discontinuities.
 *   4. Refit, then push apart any non-adjacent sections that would overlap the
 *      road (relaxation). Genuine crossovers (Suzuka) are detected and skipped.
 *   5. Limit the minimum corner radius so the road stroke never folds in on
 *      itself, then refit one last time.
 *
 * The result is a clean closed curve with no unintended self-intersections and
 * guaranteed clearance, which is what makes smooth kerbs and a believable
 * racing line possible.
 */

export interface Pt {
  x: number;
  y: number;
}

const SPACING = 2;

function wrap(t: number): number {
  return ((t % 1) + 1) % 1;
}

// -- low level geometry helpers ---------------------------------------------

function mapOutline(outline: Pt[], W: number, H: number, pad: number): Pt[] {
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
  const rotate = (a: number): Pt[] => {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return outline.map((p) => ({ x: (p.x - cx) * cos - (p.y - cy) * sin, y: (p.x - cx) * sin + (p.y - cy) * cos }));
  };
  let rotated = rotate(-angle);
  const bounds = (pts: Pt[]) => ({
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  });
  let b = bounds(rotated);
  if (b.maxY - b.minY > b.maxX - b.minX) {
    angle += Math.PI / 2;
    rotated = rotate(-angle);
    b = bounds(rotated);
  }
  const { minX, maxX, minY, maxY } = b;
  const s = Math.min((W - pad * 2) / Math.max(0.001, maxX - minX), (H - pad * 2) / Math.max(0.001, maxY - minY));
  const offsetX = (W - (maxX - minX) * s) / 2;
  const offsetY = (H - (maxY - minY) * s) / 2;
  return rotated.map((p) => ({ x: offsetX + (p.x - minX) * s, y: offsetY + (p.y - minY) * s }));
}

function resample(pts: Pt[], spacing: number): Pt[] {
  const n = pts.length;
  if (n < 2) return [...pts];
  const segs = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    return { a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y) };
  });
  const total = segs.reduce((a, seg) => a + seg.len, 0);
  const count = Math.max(48, Math.round(total / spacing));
  const step = total / count;
  const out: Pt[] = [];
  let si = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
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

function chaikin(pts: Pt[], iters: number): Pt[] {
  let cur = pts;
  for (let k = 0; k < iters; k++) {
    const out: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = out;
  }
  return cur;
}

function laplace(pts: Pt[], lambda: number, iters: number): Pt[] {
  let cur = pts;
  for (let k = 0; k < iters; k++) {
    const next = cur.map((p, i) => {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[(i + 1) % cur.length];
      return { x: p.x + lambda * ((a.x + b.x) / 2 - p.x), y: p.y + lambda * ((a.y + b.y) / 2 - p.y) };
    });
    cur = next;
  }
  return cur;
}

interface Refit {
  pts: Pt[];
  apply(p: Pt): Pt;
}

function refit(pts: Pt[], pad: number, W: number, H: number): Refit {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const s = Math.min((W - pad * 2) / Math.max(0.001, maxX - minX), (H - pad * 2) / Math.max(0.001, maxY - minY));
  const ox = (W - (maxX - minX) * s) / 2;
  const oy = (H - (maxY - minY) * s) / 2;
  const apply = (p: Pt): Pt => ({ x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s });
  return { pts: pts.map(apply), apply };
}

function curvatureAt(pts: Pt[]): number[] {
  const n = pts.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = abx * bcy - aby * bcx;
    const l1 = Math.hypot(abx, aby) || 1;
    const l2 = Math.hypot(bcx, bcy) || 1;
    const l3 = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    out[i] = (2 * cross) / (l1 * l2 * l3);
  }
  return out;
}

function smoothSeries(values: number[], win: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let w = 0;
    for (let j = -win; j <= win; j++) {
      const wt = 1 - Math.abs(j) / (win + 1);
      sum += values[(i + j + n) % n] * wt;
      w += wt;
    }
    out[i] = sum / w;
  }
  return out;
}

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Close non-adjacent sections that would otherwise overlap the road. */
function relax(pts: Pt[], required: number, iters: number): Pt[] {
  let cur = pts;
  const n = cur.length;
  const sigma = 6;
  const kernel: number[] = [];
  for (let k = -sigma * 2; k <= sigma * 2; k++) kernel.push(Math.exp((-k * k) / (2 * sigma * sigma)));

  for (let it = 0; it < iters; it++) {
    const disp = cur.map(() => ({ x: 0, y: 0 }));
    const cell = required;
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(cur[i].x / cell)},${Math.floor(cur[i].y / cell)}`;
      const arr = grid.get(key);
      if (arr) arr.push(i);
      else grid.set(key, [i]);
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(cur[i].x / cell);
      const gy = Math.floor(cur[i].y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = grid.get(`${gx + dx},${gy + dy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i + 8) continue;
            const arc = Math.min(j - i, n - (j - i));
            if (arc < 30) continue;
            const ddx = cur[j].x - cur[i].x;
            const ddy = cur[j].y - cur[i].y;
            const dist = Math.hypot(ddx, ddy);
            if (dist >= required || dist < 1e-6) continue;
            if (segIntersect(cur[i], cur[(i + 1) % n], cur[j], cur[(j + 1) % n])) continue;
            const push = (required - dist) * 0.35;
            const ux = ddx / dist;
            const uy = ddy / dist;
            for (let k = -sigma * 2; k <= sigma * 2; k++) {
              const w = kernel[k + sigma * 2];
              const a = (i + k + n * 4) % n;
              const b = (j + k + n * 4) % n;
              disp[a].x -= ux * push * w * 0.5;
              disp[a].y -= uy * push * w * 0.5;
              disp[b].x += ux * push * w * 0.5;
              disp[b].y += uy * push * w * 0.5;
            }
            moved++;
          }
        }
      }
    }
    if (!moved) break;
    for (let i = 0; i < n; i++) {
      const d = disp[i];
      const len = Math.hypot(d.x, d.y);
      if (len > 0.8) {
        d.x = (d.x / len) * 0.8;
        d.y = (d.y / len) * 0.8;
      }
      cur[i] = { x: cur[i].x + d.x, y: cur[i].y + d.y };
    }
  }
  return cur;
}

/** Locally smooth the sharpest corners until the minimum radius is acceptable. */
function enforceMinRadius(pts: Pt[], minRadius: number, iters: number): Pt[] {
  let cur = pts;
  const limit = 1 / minRadius;
  for (let it = 0; it < iters; it++) {
    const n = cur.length;
    const k = smoothSeries(curvatureAt(cur), 3);
    const mask = k.map((v) => Math.abs(v) > limit);
    if (!mask.some(Boolean)) break;
    cur = cur.map((p, i) => {
      let near = false;
      for (let j = -6; j <= 6; j++) {
        if (mask[(i + j + n) % n]) {
          near = true;
          break;
        }
      }
      if (!near) return p;
      const a = cur[(i - 2 + n) % n];
      const b = cur[(i + 2) % n];
      return { x: p.x + 0.5 * ((a.x + b.x) / 2 - p.x), y: p.y + 0.5 * ((a.y + b.y) / 2 - p.y) };
    });
  }
  return cur;
}

function countCrossings(pts: Pt[]): number {
  const n = pts.length;
  let count = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (i === 0 && j === n - 2) continue;
      if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) {
        count++;
        if (count > 8) return count;
      }
    }
  }
  return count;
}

// -- public types ------------------------------------------------------------

export interface KerbRun {
  d: string;
  /** +1 uses the left-hand normal, -1 the right-hand normal. */
  side: 1 | -1;
  inside: boolean;
}

export interface Bridge {
  /** Polyline of the upper deck (the pass drawn on top). */
  d: string;
  x: number;
  y: number;
  angle: number;
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
  startAngle: number;
  kerbRuns: KerbRun[];
  bridges: Bridge[];
  /** Signed lateral offset (px) of the racing line at each dense sample. */
  racingOffset: number[];
  racing: Pt[];
  /** Sparse smoothing factor 0.3 (tight corner) .. 1 (flat out) at each sample. */
  speedFactor: number[];
  pointAt(t: number): Pt;
  normalAt(t: number): Pt;
  angleAt(t: number): number;
  offsetAt(t: number, lateral: number): Pt;
  curvatureAt(i: number): number;
  offsetPath(fromT: number, toT: number, lateral: number, slices?: number): string;
  racingOffsetAt(t: number): number;
  racingPointAt(t: number): Pt;
  speedFactorAt(t: number): number;
  /** Map an elapsed-time fraction of a lap to a distance fraction along the lap. */
  progressAtTime(u: number): number;
}

interface CornerRun {
  startArc: number;
  apexArc: number;
  endArc: number;
  sign: number;
  strength: number;
}

function findCorners(k: number[], cum: number[], threshold: number, minArc: number): CornerRun[] {
  const n = k.length;
  const runs: CornerRun[] = [];
  const inside = k.map((v) => Math.abs(v) > threshold);
  let i = 0;
  while (i < n) {
    if (!inside[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && inside[i]) i++;
    const end = i - 1;
    if (end <= start) continue;
    let sum = 0;
    let peak = start;
    let peakK = 0;
    for (let j = start; j <= end; j++) {
      sum += k[j];
      if (Math.abs(k[j]) > Math.abs(peakK)) {
        peakK = k[j];
        peak = j;
      }
    }
    const arc = cum[end] - cum[start];
    if (arc < minArc) continue;
    runs.push({ startArc: cum[start], apexArc: cum[peak], endArc: cum[end], sign: Math.sign(sum) || 1, strength: Math.abs(peakK) });
  }
  return runs;
}

function makeArcIndexer(cum: number[], totalLength: number): (arc: number) => number {
  const n = cum.length;
  return (arc: number): number => {
    const a = wrap(arc / totalLength) * totalLength;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= a) lo = mid;
      else hi = mid;
    }
    return lo;
  };
}

function buildRacingOffsets(
  dense: Pt[],
  k: number[],
  cum: number[],
  totalLength: number,
  roadWidth: number,
): number[] {
  const n = dense.length;
  const halfW = roadWidth / 2;
  const maxOffset = Math.max(0.8, halfW - Math.max(1.9, roadWidth * 0.19));
  const target = new Array<number>(n).fill(0);

  const corners = findCorners(k, [...cum], 0.010, 16);
  for (const c of corners) {
    const dir = c.sign; // ascending-curvature side
    const inside = -dir; // lateral sign of the geometric inside
    const lenBefore = Math.max(2, (c.apexArc - c.startArc + totalLength) % totalLength);
    const lenAfter = Math.max(2, (c.endArc - c.apexArc + totalLength) % totalLength);
    const ramp = Math.min(30, Math.max(10, (lenBefore + lenAfter) * 0.45));
    const entry = lenBefore + ramp;
    const exit = lenAfter + ramp;
    const insideVal = inside * maxOffset * 0.98;
    const outsideEntry = inside * -1 * maxOffset * 0.9;
    const outsideExit = inside * -1 * maxOffset * 0.68;
    for (let i = 0; i < n; i++) {
      const arc = cum[i];
      let delta = (arc - c.apexArc) % totalLength;
      if (delta < 0) delta += totalLength;
      // signed distance from apex: negative before, positive after
      let d = delta > totalLength / 2 ? delta - totalLength : delta;
      if (d > -entry && d <= 0) {
        const t = (d + entry) / entry;
        const s = t * t * (3 - 2 * t);
        target[i] += outsideEntry + (insideVal - outsideEntry) * s;
      } else if (d > 0 && d < exit) {
        const t = d / exit;
        const s = t * t * (3 - 2 * t);
        target[i] += insideVal + (outsideExit - insideVal) * s;
      }
    }
  }

  let offset = smoothSeries(target, 3);

  // Limit how quickly the line can move sideways (no teleporting across track).
  const maxSlope = 0.3 * SPACING;
  const limit = (arr: number[]): number[] => {
    const out = arr.slice();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n; i++) out[i] = Math.max(out[i - 1] - maxSlope, Math.min(out[i - 1] + maxSlope, out[i]));
      out[0] = Math.max(out[n - 1] - maxSlope, Math.min(out[n - 1] + maxSlope, out[0]));
    }
    return out;
  };
  offset = limit(offset);

  // Never exceed the local corner radius, or the line would fold off the road.
  for (let i = 0; i < n; i++) {
    const ki = k[i];
    let cap = maxOffset;
    if (Math.abs(ki) > 1e-4) cap = Math.min(cap, 0.85 / Math.abs(ki));
    offset[i] = Math.max(-cap, Math.min(cap, offset[i]));
  }

  offset = smoothSeries(offset, 2);
  for (let i = 0; i < n; i++) offset[i] = Math.max(-maxOffset, Math.min(maxOffset, offset[i]));
  return offset;
}

function buildSpeedProfile(racing: Pt[], cum: number[]): { speed: number[]; times: number[]; total: number } {
  const n = racing.length;
  const k = smoothSeries(curvatureAt(racing), 4);
  const ds = new Array<number>(n).fill(SPACING);
  for (let i = 1; i < n; i++) ds[i] = Math.max(0.5, cum[i] - cum[i - 1]);
  const vMax = 1;
  const K0 = 0.05;
  const v = k.map((kk) => Math.max(0.32, vMax / Math.sqrt(1 + (Math.abs(kk) / K0) ** 2)));
  const aBrake = 0.02;
  const aAccel = 0.014;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      const d = i === n - 1 ? cum[0] + SPACING : ds[i + 1];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * aBrake * Math.max(0.5, d)));
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n; i++) {
      v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * aAccel * ds[i]));
    }
    v[0] = Math.min(v[0], Math.sqrt(v[n - 1] * v[n - 1] + 2 * aAccel * ds[0]));
  }
  const times = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) times[i] = times[i - 1] + ds[i] / v[i];
  const total = times[n - 1] + (cum[0] + SPACING) / v[0];
  return { speed: v, times, total };
}

function buildBridges(dense: Pt[]): Bridge[] {
  const n = dense.length;
  const bridges: Bridge[] = [];
  const seen: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (i === 0 && j === n - 2) continue;
      if (!segIntersect(dense[i], dense[(i + 1) % n], dense[j], dense[(j + 1) % n])) continue;
      const p = lineIntersection(dense[i], dense[(i + 1) % n], dense[j], dense[(j + 1) % n]);
      if (!p) continue;
      if (seen.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 6)) continue;
      seen.push(p);
      const half = 9;
      const pts: string[] = [];
      for (let k = -half; k <= half; k++) {
        const idx = ((j + k) % n + n) % n;
        pts.push(`${k === -half ? "M" : "L"} ${dense[idx].x.toFixed(2)} ${dense[idx].y.toFixed(2)}`);
      }
      const a = dense[(j - 1 + n) % n];
      const b = dense[(j + 1) % n];
      bridges.push({ d: pts.join(" "), x: p.x, y: p.y, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
    }
  }
  return bridges;
}

function lineIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

function polylinePath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  return `${d} Z`;
}

// -- main entry point --------------------------------------------------------

export function buildTrack(circuit: Circuit, W = 400, H = 240, pad = 18, roadWidth = 10): TrackGeometry {
  const mapped = mapOutline(circuit.outline, W, H, pad);
  const anchor0 = mapped[0] ?? { x: W / 2, y: H / 2 };

  let anchor = anchor0;
  let poly = resample(chaikin(mapped, 3), SPACING);
  poly = laplace(poly, 0.6, 120);
  {
    const first = refit(poly, 16, W, H);
    poly = resample(first.pts, SPACING);
    anchor = first.apply(anchor);
  }

  if (countCrossings(poly) === 0) {
    poly = relax(poly, roadWidth + 3, 60);
  }
  poly = enforceMinRadius(poly, 6, 120);
  poly = laplace(poly, 0.35, 3);
  {
    const final = refit(resample(poly, SPACING), 16, W, H);
    poly = final.pts;
    anchor = final.apply(anchor);
  }

  // Roll the loop so index 0 sits on the real start/finish line.
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(poly[i].x - anchor.x, poly[i].y - anchor.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  const dense = poly.slice(best).concat(poly.slice(0, best));

  const n = dense.length;
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
  const totalLength = cum[n - 1] || 1;

  const normals: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = dense[(i - 1 + n) % n];
    const b = dense[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    normals[i] = { x: -dy / len, y: dx / len };
  }

  const rawK = curvatureAt(dense);
  const smoothK = smoothSeries(rawK, 4);

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
    const b = dense[i + 1] ?? dense[0];
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  };

  const normalAt = (t: number): Pt => {
    const { i, frac } = indexAt(t);
    const a = normals[i];
    const b = normals[i + 1] ?? normals[0];
    const x = a.x + (b.x - a.x) * frac;
    const y = a.y + (b.y - a.y) * frac;
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

  const racingOffset = buildRacingOffsets(dense, smoothK, cum, totalLength, roadWidth);
  const racing = dense.map((p, i) => ({ x: p.x + normals[i].x * racingOffset[i], y: p.y + normals[i].y * racingOffset[i] }));

  const profile = buildSpeedProfile(racing, cum);
  const speedFactor = profile.speed;

  const progressAtTime = (u: number): number => {
    const target = wrap(u) * profile.total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (profile.times[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = profile.times[lo + 1] - profile.times[lo] || 1;
    const frac = (target - profile.times[lo]) / span;
    const arc = cum[lo] + (cum[lo + 1] - cum[lo]) * frac;
    return wrap(arc / totalLength);
  };

  const racingOffsetAt = (t: number): number => {
    const { i, frac } = indexAt(t);
    const a = racingOffset[i];
    const b = racingOffset[i + 1] ?? racingOffset[0];
    return a + (b - a) * frac;
  };

  const racingPointAt = (t: number): Pt => {
    const p = pointAt(t);
    const nrm = normalAt(t);
    const off = racingOffsetAt(t);
    return { x: p.x + nrm.x * off, y: p.y + nrm.y * off };
  };

  const speedFactorAt = (t: number): number => {
    const { i, frac } = indexAt(t);
    const a = speedFactor[i];
    const b = speedFactor[i + 1] ?? speedFactor[0];
    return a + (b - a) * frac;
  };

  const kerbRuns = buildKerbs(dense, normals, smoothK, cum, totalLength, roadWidth);
  const bridges = buildBridges(dense);

  return {
    W,
    H,
    path: polylinePath(dense),
    dense,
    normals,
    cum,
    totalLength,
    roadWidth,
    start: dense[0],
    startAngle: angleAt(0),
    kerbRuns,
    bridges,
    racingOffset,
    racing,
    speedFactor,
    pointAt,
    normalAt,
    angleAt,
    offsetAt,
    curvatureAt: (i: number) => rawK[((i % n) + n) % n],
    offsetPath,
    racingOffsetAt,
    racingPointAt,
    speedFactorAt,
    progressAtTime,
  };
}

function buildKerbs(
  dense: Pt[],
  normals: Pt[],
  k: number[],
  cum: number[],
  totalLength: number,
  roadWidth: number,
): KerbRun[] {
  const n = dense.length;
  const halfW = roadWidth / 2;
  const kerbW = Math.max(1.8, roadWidth * 0.2);
  const baseLateral = halfW - kerbW / 2;
  const corners = findCorners(k, [...cum], 0.012, 18);
  const runs: KerbRun[] = [];
  const arcToIndex = makeArcIndexer(cum, totalLength);

  const inPitWindow = (t: number): boolean => t > 0.88 || t < 0.075;
  const nearStart = (t: number): boolean => t > 0.95 || t < 0.045;

  for (const c of corners) {
    const insideSide = Math.sign(c.sign) as 1 | -1;
    const specs: Array<{ side: 1 | -1; inside: boolean }> = [
      { side: (-insideSide) as 1 | -1, inside: false },
    ];
    if (c.strength > 0.05) specs.push({ side: insideSide, inside: true });

    for (const spec of specs) {
      const i0 = arcToIndex(c.startArc - 3 * SPACING);
      const i1 = arcToIndex(c.endArc + 3 * SPACING);
      const span = ((i1 - i0) % n + n) % n;
      if (span < 5) continue;
      const pts: string[] = [];
      for (let s = 0; s <= span; s++) {
        const idx = (i0 + s) % n;
        const t = cum[idx] / totalLength;
        if (nearStart(t)) continue;
        if (spec.side === -1 && inPitWindow(t)) continue;
        let lateral = baseLateral;
        if (spec.inside && Math.abs(k[idx]) > 1e-4) lateral = Math.min(lateral, 0.8 / Math.abs(k[idx]));
        if (lateral < 0.6) continue;
        const p = dense[idx];
        const nrm = normals[idx];
        pts.push(`${pts.length === 0 ? "M" : "L"} ${(p.x + nrm.x * lateral * spec.side).toFixed(2)} ${(p.y + nrm.y * lateral * spec.side).toFixed(2)}`);
      }
      if (pts.length < 6) continue;
      runs.push({ d: pts.join(" "), side: spec.side, inside: spec.inside });
    }
  }
  return runs;
}

// -- cached accessor ---------------------------------------------------------

const cache = new Map<string, TrackGeometry>();

/** Cached build so the car view, dots view and animation share one geometry. */
export function getTrack(circuit: Circuit, W = 400, H = 240, pad = 16, roadWidth = 10): TrackGeometry {
  const key = `${circuit.id}:${W}x${H}:${pad}:${roadWidth}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const geo = buildTrack(circuit, W, H, pad, roadWidth);
  cache.set(key, geo);
  return geo;
}
