import { memo, useMemo } from "react";
import type { Circuit } from "../engine/types";
import { CarSvg, type CarPaint, type CarStyle } from "./CarSvg";
import { buildTrack, type Pt } from "../lib/trackGeometry";

export interface RaceTrackCar {
  id: string;
  progress: number;
  color: string;
  paint: CarPaint;
  style: CarStyle;
  code?: string;
  highlight?: boolean;
  pit?: boolean;
  lane?: number;
}

export interface RaceTrackCamera {
  progress: number;
  zoom?: number;
}

const Car = memo(CarSvg);

const W = 400;
const H = 240;
const ROAD = 12;

export function RaceTrack({
  circuit,
  cars,
  className = "",
  height = 300,
  camera,
  showSectors = false,
  showPit = true,
  pitBoxColors = [],
}: {
  circuit: Circuit;
  cars: RaceTrackCar[];
  className?: string;
  height?: number;
  camera?: RaceTrackCamera;
  showSectors?: boolean;
  showPit?: boolean;
  pitBoxColors?: string[];
}) {
  const geo = useMemo(() => buildTrack(circuit, W, H, 28, ROAD), [circuit]);

  const carLen = ROAD * 0.66;
  const carW = carLen * (120 / 320);

  const pit = useMemo(() => {
    const side: 1 | -1 = -1;
    const offset = ROAD / 2 + 4.6;
    const from = 0.9;
    const to = 0.075;
    const path = geo.offsetPath(from, to, side * offset, 56);
    const entry = geo.pointAt(from);
    const entryPit = geo.offsetAt(from, side * offset);
    const exit = geo.pointAt(to);
    const exitPit = geo.offsetAt(to, side * offset);
    const boxes: Array<{ a: Pt; b: Pt; color: string }> = [];
    const count = Math.max(1, pitBoxColors.length);
    const span = ((to - from) % 1 + 1) % 1;
    for (let i = 0; i < count; i++) {
      const t = from + span * ((i + 1) / (count + 1));
      const p = geo.offsetAt(t, side * offset);
      const nrm = geo.normalAt(t);
      const half = ROAD * 0.26;
      boxes.push({
        a: { x: p.x + nrm.x * half, y: p.y + nrm.y * half },
        b: { x: p.x - nrm.x * half, y: p.y - nrm.y * half },
        color: pitBoxColors[i],
      });
    }
    return { side, offset, path, entry, entryPit, exit, exitPit, boxes };
  }, [geo, pitBoxColors]);

  const placed = useMemo(
    () =>
      cars.map((c, idx) => {
        const lane = c.lane ?? (idx % 2 === 0 ? -0.6 : 0.6);
        const inPit = c.pit && (c.progress > 0.9 || c.progress < 0.12);
        const lateral = inPit ? pit.side * pit.offset : lane * (ROAD * 0.3);
        const p = geo.offsetAt(c.progress, lateral);
        const deg = (geo.angleAt(c.progress) * 180) / Math.PI;
        return { car: c, p, deg };
      }),
    [cars, geo, pit],
  );

  const sectorPoints = showSectors ? circuit.sectors.map((s) => geo.pointAt(s.end)) : [];

  let viewBox = `0 0 ${W} ${H}`;
  if (camera) {
    const zoom = Math.min(14, Math.max(1, camera.zoom ?? 5));
    const c = geo.pointAt(camera.progress);
    const a = geo.angleAt(camera.progress);
    const look = 3;
    const cx = c.x + Math.cos(a) * look;
    const cy = c.y + Math.sin(a) * look;
    const vw = W / zoom;
    const vh = H / zoom;
    viewBox = `${(cx - vw / 2).toFixed(2)} ${(cy - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`;
  }

  const startLine = (() => {
    const p = geo.pointAt(0);
    const n = geo.normalAt(0);
    const h = ROAD / 2;
    return { a: { x: p.x + n.x * h, y: p.y + n.y * h }, b: { x: p.x - n.x * h, y: p.y - n.y * h } };
  })();

  return (
    <svg viewBox={viewBox} className={className} style={{ height }} role="img" aria-label={`${circuit.name} live track`}>
      <defs>
        <linearGradient id={`rt-asphalt-${circuit.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3a4353" />
          <stop offset="100%" stopColor="#232833" />
        </linearGradient>
      </defs>

      <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="#0a0c10" />

      {/* Run-off */}
      <path d={geo.path} fill="none" stroke="#151a20" strokeWidth={ROAD + 16} strokeLinejoin="round" strokeLinecap="round" />

      {/* Track shadow + surface */}
      <path d={geo.path} fill="none" stroke="#000" strokeWidth={ROAD + 3} strokeLinejoin="round" strokeLinecap="round" opacity="0.5" />
      <path d={geo.path} fill="none" stroke={`url(#rt-asphalt-${circuit.id})`} strokeWidth={ROAD} strokeLinejoin="round" strokeLinecap="round" />

      {/* Track edge lines */}
      <path d={geo.offsetPath(0, 1, ROAD / 2 - 0.5, 220)} fill="none" stroke="#e6e9ee" strokeWidth="0.55" opacity="0.35" />
      <path d={geo.offsetPath(0, 1, -(ROAD / 2 - 0.5), 220)} fill="none" stroke="#e6e9ee" strokeWidth="0.55" opacity="0.35" />

      {/* Kerbs */}
      {geo.kerbRuns.map((run, i) => (
        <g key={i}>
          <path d={run.d} fill="none" stroke="#f2f3f5" strokeWidth="2" strokeLinecap="butt" strokeLinejoin="round" />
          <path d={run.d} fill="none" stroke="#e10600" strokeWidth="2" strokeLinecap="butt" strokeLinejoin="round" strokeDasharray="4.5 4.5" />
        </g>
      ))}

      {/* Pit lane */}
      {showPit && (
        <g>
          <path d={pit.path} fill="none" stroke="#20252d" strokeWidth={ROAD * 0.72} strokeLinecap="round" />
          <path d={pit.path} fill="none" stroke="#343a45" strokeWidth={ROAD * 0.62} strokeLinecap="round" />
          <path d={pit.path} fill="none" stroke="#cbd2dc" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" />
          <line x1={pit.entry.x} y1={pit.entry.y} x2={pit.entryPit.x} y2={pit.entryPit.y} stroke="#343a45" strokeWidth={ROAD * 0.55} strokeLinecap="round" />
          <line x1={pit.exit.x} y1={pit.exit.y} x2={pit.exitPit.x} y2={pit.exitPit.y} stroke="#343a45" strokeWidth={ROAD * 0.55} strokeLinecap="round" />
          {pit.boxes.map((b, i) => (
            <line key={i} x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} stroke={b.color} strokeWidth="1.6" strokeLinecap="round" opacity="0.95" />
          ))}
          <text x={pit.entryPit.x} y={pit.entryPit.y - 3} fontSize="5" fill="#8b93a1" fontFamily="Rajdhani, sans-serif" textAnchor="middle">
            PIT LANE
          </text>
        </g>
      )}

      {/* Centre line */}
      <path d={geo.path} fill="none" stroke="#6b7484" strokeWidth="0.7" strokeDasharray="3 6" strokeLinejoin="round" opacity="0.5" />

      {sectorPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.8" fill="#ffb400" opacity="0.7" />
      ))}

      {/* Start/finish */}
      <g>
        <line x1={startLine.a.x} y1={startLine.a.y} x2={startLine.b.x} y2={startLine.b.y} stroke="#f7f8fa" strokeWidth="2" />
        <line x1={startLine.a.x} y1={startLine.a.y} x2={startLine.b.x} y2={startLine.b.y} stroke="#0a0b0e" strokeWidth="2" strokeDasharray="1.6 1.6" />
      </g>

      {/* Cars */}
      {placed.map(({ car, p, deg }) => (
        <g key={car.id} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${deg.toFixed(1)})`}>
          {car.highlight && <ellipse rx={carLen * 0.55} ry={carW * 1.0} fill="none" stroke={car.color} strokeWidth="0.45" opacity="0.9" />}
          <Car paint={car.paint} style={car.style} width={carLen} height={carW} x={-carLen / 2} y={-carW / 2} />
        </g>
      ))}

      {/* Car codes (upright) */}
      {placed.map(({ car, p }) =>
        car.code ? (
          <text
            key={`lbl-${car.id}`}
            x={p.x}
            y={p.y - carW - 1.2}
            fontSize="3.4"
            fill={car.highlight ? "#ffffff" : "#cfd5df"}
            stroke="#0a0b0e"
            strokeWidth="1"
            paintOrder="stroke"
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
          >
            {car.code}
          </text>
        ) : null,
      )}
    </svg>
  );
}
