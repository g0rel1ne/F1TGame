import { useMemo } from "react";
import type { Circuit } from "../engine/types";
import { getTrack } from "../lib/trackGeometry";

export interface TrackMarker {
  id: string;
  /** 0..1 progress around the lap. */
  progress: number;
  color: string;
  label?: string;
  highlight?: boolean;
}

const W = 400;
const H = 240;
const ROAD = 10;

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
  // Same geometry the car view draws, so dots sit exactly on the road.
  const geo = useMemo(() => getTrack(circuit, W, H, 16, ROAD), [circuit]);
  const { path, start } = geo;

  const sectorPoints = showSectors ? circuit.sectors.map((s) => geo.pointAt(s.end)) : [];

  let viewBox = `0 0 ${W} ${H}`;
  if (focus) {
    const zoom = Math.max(1, focus.zoom ?? 2.4);
    const c = geo.pointAt(focus.progress);
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
      <path d={path} fill="none" stroke="#000" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" opacity="0.45" />
      {/* Track surface */}
      <path d={path} fill="none" stroke={`url(#track-glow-${circuit.id})`} strokeWidth={ROAD} strokeLinejoin="round" strokeLinecap="round" />
      {/* Kerb hint */}
      <path d={path} fill="none" stroke="#e5e7eb" strokeWidth={ROAD + 0.8} strokeLinejoin="round" strokeLinecap="round" opacity="0.08" />
      {/* Centre line */}
      <path d={path} fill="none" stroke="#59616f" strokeWidth="1.2" strokeDasharray="4 7" strokeLinejoin="round" opacity="0.7" />

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
        const p = geo.pointAt(m.progress);
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
