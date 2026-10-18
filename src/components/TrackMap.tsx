import { useMemo } from "react";
import type { Circuit } from "../engine/types";

export interface TrackMarker {
  id: string;
  /** 0..1 progress around the lap. */
  progress: number;
  color: string;
  label?: string;
  highlight?: boolean;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Dense polyline that follows the same Catmull-Rom curve used for the rendered
 * path. Sampling the curve (instead of the control polygon) keeps markers
 * exactly on the drawn track through corners.
 */
function catmullRomSamples(points: Pt[], stepsPerSegment = 14): Pt[] {
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

/** Build a lookup that maps normalised progress (0..1) to a point on the sampled curve. */
function makeSampler(points: Pt[]) {
  const segs: Array<{ a: Pt; b: Pt; len: number }> = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, len });
    total += len;
  }
  return (t: number): Pt => {
    if (total === 0) return points[0] ?? { x: 0, y: 0 };
    const target = (((t % 1) + 1) % 1) * total;
    let acc = 0;
    for (const s of segs) {
      if (acc + s.len >= target) {
        const local = s.len === 0 ? 0 : (target - acc) / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * local, y: s.a.y + (s.b.y - s.a.y) * local };
      }
      acc += s.len;
    }
    return segs[0]?.a ?? points[0];
  };
}

export function TrackMap({
  circuit,
  markers = [],
  className = "",
  showSectors = true,
  height = 300,
  focus,
}: {
  circuit: Circuit;
  markers?: TrackMarker[];
  className?: string;
  showSectors?: boolean;
  height?: number;
  /** When set, crops/zooms the view around a point on the lap (0..1 progress). */
  focus?: { progress: number; zoom?: number };
}) {
  const W = 400;
  const H = 240;
  const pad = 22;

  const { path, sample, start } = useMemo(() => {
    const xs = circuit.outline.map((p) => p.x);
    const ys = circuit.outline.map((p) => p.y);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;

    // Rotate the real layout so its longest axis lies horizontally. This keeps
    // the true shape but uses the available panel space (Jeddah, Monaco, etc.).
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of circuit.outline) {
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
    let rotated = rotate(circuit.outline.map((p) => ({ x: p.x - cx, y: p.y - cy })), -angle);
    const bounds = (pts: Pt[]) => ({
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    });
    let b = bounds(rotated);
    if (b.maxY - b.minY > b.maxX - b.minX) {
      angle += Math.PI / 2;
      rotated = rotate(circuit.outline.map((p) => ({ x: p.x - cx, y: p.y - cy })), -angle);
      b = bounds(rotated);
    }

    const { minX, maxX, minY, maxY } = b;
    const s = Math.min((W - pad * 2) / Math.max(0.001, maxX - minX), (H - pad * 2) / Math.max(0.001, maxY - minY));
    const offsetX = (W - (maxX - minX) * s) / 2;
    const offsetY = (H - (maxY - minY) * s) / 2;
    const mapped: Pt[] = rotated.map((p) => ({
      x: offsetX + (p.x - minX) * s,
      y: offsetY + (p.y - minY) * s,
    }));
    const dense = catmullRomSamples(mapped);
    return {
      path: catmullRomPath(mapped),
      sample: makeSampler(dense),
      start: mapped[0] ?? { x: W / 2, y: H / 2 },
    };
  }, [circuit]);

  const sectorPoints = showSectors ? circuit.sectors.map((s) => sample(s.end)) : [];

  let viewBox = `0 0 ${W} ${H}`;
  if (focus) {
    const zoom = Math.max(1, focus.zoom ?? 2.4);
    const c = sample(focus.progress);
    const vw = W / zoom;
    const vh = H / zoom;
    const x = Math.max(0, Math.min(W - vw, c.x - vw / 2));
    const y = Math.max(0, Math.min(H - vh, c.y - vh / 2));
    viewBox = `${x.toFixed(1)} ${y.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`;
  }

  return (
    <svg viewBox={viewBox} className={className} style={{ height }} role="img" aria-label={`${circuit.name} track map`}>
      <defs>
        <linearGradient id={`track-glow-${circuit.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3a4353" />
          <stop offset="100%" stopColor="#20252f" />
        </linearGradient>
      </defs>

      {/* Track shadow */}
      <path d={path} fill="none" stroke="#000" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" opacity="0.45" />
      {/* Track surface */}
      <path d={path} fill="none" stroke={`url(#track-glow-${circuit.id})`} strokeWidth="11" strokeLinejoin="round" strokeLinecap="round" />
      {/* Kerb hint */}
      <path d={path} fill="none" stroke="#e5e7eb" strokeWidth="12.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.08" />
      {/* Centre line */}
      <path d={path} fill="none" stroke="#59616f" strokeWidth="1.5" strokeDasharray="4 7" strokeLinejoin="round" opacity="0.7" />

      {/* Sector markers */}
      {sectorPoints.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="#ffb400" opacity="0.8" />
        </g>
      ))}

      {/* Start/finish */}
      <g transform={`translate(${start.x} ${start.y})`}>
        <circle r="5" fill="#e10600" />
        <circle r="2" fill="#fff" />
      </g>

      {/* Markers */}
      {markers.map((m) => {
        const p = sample(m.progress);
        return (
          <g key={m.id} transform={`translate(${p.x} ${p.y})`}>
            {m.highlight && <circle r="9" fill={m.color} opacity="0.25" className="animate-pulse-fast" />}
            <circle r={m.highlight ? 5.5 : 3.6} fill={m.color} stroke="#0a0b0e" strokeWidth="1.5" />
            {m.label && (
              <text x="6" y="-5" fontSize="7.5" fill="#cfd5df" fontFamily="JetBrains Mono, monospace" paintOrder="stroke" stroke="#0a0b0e" strokeWidth="2.5">
                {m.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
