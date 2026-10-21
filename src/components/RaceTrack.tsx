import { memo, useMemo } from "react";
import type { Circuit } from "../engine/types";
import { CarSvg, type CarPaint, type CarStyle } from "./CarSvg";
import { getTrack, type Pt } from "../lib/trackGeometry";

export interface RaceTrackCar {
  id: string;
  progress: number;
  color: string;
  paint: CarPaint;
  style: CarStyle;
  code?: string;
  highlight?: boolean;
  pit?: boolean;
  /** Extra lateral offset (px) used for side-by-side racing in traffic. */
  lane?: number;
  /** 0..1 of the car's flat-out speed, used for motion blur and brake lights. */
  speed?: number;
  braking?: boolean;
  drs?: boolean;
  blueFlag?: boolean;
  pitPhase?: "none" | "entry" | "stop" | "exit";
  pitProgress?: number;
  contact?: number;
  damage?: number;
  elevationMetres?: number;
}

export interface RaceTrackCamera {
  progress: number;
  zoom?: number;
}

const Car = memo(CarSvg);

const W = 400;
const H = 240;
const ROAD = 10;
const PAD = 16;

export function RaceTrack({
  circuit,
  cars,
  className = "",
  height = 300,
  camera,
  showSectors = false,
  showPit = true,
  pitBoxColors = [],
  safetyCarProgress = null,
}: {
  circuit: Circuit;
  cars: RaceTrackCar[];
  className?: string;
  height?: number;
  camera?: RaceTrackCamera;
  showSectors?: boolean;
  showPit?: boolean;
  pitBoxColors?: string[];
  safetyCarProgress?: number | null;
}) {
  const geo = useMemo(() => getTrack(circuit, W, H, PAD, ROAD), [circuit]);

  // The road stroke represents ~15 m of asphalt. A 5.6 m F1 car is therefore
  // just over a third of its width, not most of it as in an arcade top-down.
  const carLen = ROAD * 0.44;
  const carW = carLen * (120 / 320);
  const maxLateral = ROAD / 2 - carW / 2 - 0.35;

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
      cars.map((c) => {
        const inPit = c.pitPhase ? c.pitPhase !== "none" : c.pit && (c.progress > 0.9 || c.progress < 0.12);
        // All cars run the racing line; traffic adds a small side-by-side shift.
        const racing = geo.racingOffsetAt(c.progress);
        const lateral = inPit
          ? pit.side * pit.offset
          : Math.max(-maxLateral, Math.min(maxLateral, racing + (c.lane ?? 0)));
        const p = geo.offsetAt(c.progress, lateral);
        const deg = (geo.angleAt(c.progress) * 180) / Math.PI;
        return { car: c, p, deg };
      }),
    [cars, geo, pit, maxLateral],
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
      <path d={geo.path} fill="none" stroke="#151a20" strokeWidth={ROAD + 14} strokeLinejoin="round" strokeLinecap="round" />

      {/* Track shadow + surface */}
      <path d={geo.path} fill="none" stroke="#000" strokeWidth={ROAD + 3} strokeLinejoin="round" strokeLinecap="round" opacity="0.5" />
      <path d={geo.path} fill="none" stroke={`url(#rt-asphalt-${circuit.id})`} strokeWidth={ROAD} strokeLinejoin="round" strokeLinecap="round" />

      {/* Crossovers (Suzuka) - the later pass is the upper deck */}
      {geo.bridges.map((b, i) => (
        <g key={`bridge-${i}`}>
          <path d={b.d} fill="none" stroke="#05060a" strokeWidth={ROAD + 4} strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
          <path d={b.d} fill="none" stroke={`url(#rt-asphalt-${circuit.id})`} strokeWidth={ROAD + 0.4} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}

      {/* Track edge lines */}
      <path d={geo.offsetPath(0, 1, ROAD / 2 - 0.35, 260)} fill="none" stroke="#e6e9ee" strokeWidth="0.5" opacity="0.4" />
      <path d={geo.offsetPath(0, 1, -(ROAD / 2 - 0.35), 260)} fill="none" stroke="#e6e9ee" strokeWidth="0.5" opacity="0.4" />

      {/* Kerbs, hugging the white line and clamped to the corner radius */}
      {geo.kerbRuns.map((run, i) => (
        <g key={i}>
          <path d={run.d} fill="none" stroke="#f2f3f5" strokeWidth={run.inside ? 1.7 : 2.3} strokeLinecap="butt" strokeLinejoin="round" />
          <path
            d={run.d}
            fill="none"
            stroke="#e10600"
            strokeWidth={run.inside ? 1.7 : 2.3}
            strokeLinecap="butt"
            strokeLinejoin="round"
            strokeDasharray={run.inside ? "3.6 3.6" : "4.4 4.4"}
          />
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

      {/* Safety car */}
      {safetyCarProgress !== null && (() => {
        const p = geo.pointAt(safetyCarProgress);
        const deg = (geo.angleAt(safetyCarProgress) * 180) / Math.PI;
        return (
          <g transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${deg.toFixed(1)})`}>
            <circle r={ROAD * 0.55} fill="#facc15" opacity="0.25" className="animate-pulse-fast" />
            <rect x={-carLen / 2} y={-carW / 2} width={carLen} height={carW} rx={carW * 0.2} fill="#f8fafc" stroke="#111827" strokeWidth="0.3" />
            <rect x={-carLen * 0.28} y={-carW * 0.55} width={carLen * 0.18} height={carW * 1.1} fill="#f59e0b" />
            <circle cx={carLen * 0.12} cy={0} r={carW * 0.12} fill="#ef4444" />
          </g>
        );
      })()}

      {/* Cars */}
      {placed.map(({ car, p, deg }) => {
        const lift = Math.max(0, Math.min(1, ((car.elevationMetres ?? 0) + 30) / 60));
        const contact = car.contact ?? 0;
        const damage = car.damage ?? 0;
        return (
          <g key={car.id} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${deg.toFixed(1)})`}>
            <ellipse
              cx={(lift - 0.5) * 2.4}
              cy={(lift - 0.5) * 1.6}
              rx={carLen * 0.5}
              ry={carW * 0.9}
              fill="#000"
              opacity={0.25 + lift * 0.2}
            />
            {car.highlight && <ellipse rx={carLen * 0.55} ry={carW * 1.0} fill="none" stroke={car.color} strokeWidth="0.45" opacity="0.9" />}
            {car.blueFlag && <ellipse rx={carLen * 0.62} ry={carW * 1.12} fill="none" stroke="#3b82f6" strokeWidth="0.5" opacity="0.95" />}
            <Car paint={car.paint} style={car.style} width={carLen} height={carW} x={-carLen / 2} y={-carW / 2} />
            {car.braking && (
              <g fill="#ff2a2a">
                <circle cx={-carLen * 0.43} cy={-carW * 0.28} r={carW * 0.07} />
                <circle cx={-carLen * 0.43} cy={carW * 0.28} r={carW * 0.07} />
              </g>
            )}
            {car.drs && <rect x={-carLen * 0.49} y={-carW * 0.2} width={carLen * 0.05} height={carW * 0.4} fill="#22d3ee" opacity="0.95" />}
            {damage > 0.55 && (
              <g fill="#94a3b8" opacity={Math.min(0.65, damage - 0.4)}>
                <circle cx={-carLen * 0.58} cy={-carW * 0.2} r={carW * 0.16} />
                <circle cx={-carLen * 0.68} cy={carW * 0.1} r={carW * 0.22} />
              </g>
            )}
            {contact > 0.25 && (
              <g stroke="#fbbf24" strokeWidth={0.28} opacity={Math.min(1, contact)}>
                <line x1={-carLen * 0.2} y1={-carW * 0.55} x2={-carLen * 0.36} y2={-carW * 0.82} />
                <line x1={-carLen * 0.1} y1={carW * 0.55} x2={-carLen * 0.26} y2={carW * 0.85} />
              </g>
            )}
            {car.pitPhase === "stop" && (
              <g opacity="0.95">
                <rect x={-carLen * 0.55} y={-carW * 1.25} width={carLen * 1.1} height={carW * 0.34} rx={0.4} fill="#111827" stroke="#f59e0b" strokeWidth="0.22" />
                <text x={0} y={-carW * 1.01} fontSize={carW * 0.22} fill="#fbbf24" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                  PIT STOP
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Car codes (upright) */}
      {placed.map(({ car, p }) =>
        car.code ? (
          <text
            key={`lbl-${car.id}`}
            x={p.x}
            y={p.y - carW - 1.1}
            fontSize="2.2"
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
