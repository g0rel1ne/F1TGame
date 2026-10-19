import { useId } from "react";
import type {
  TeamSpec,
  FrontWingStyle,
  RearWingStyle,
  SidepodStyle,
  NoseStyle,
  HaloStyle,
} from "../engine/types";

export interface CarPaint {
  primary: string;
  secondary: string;
  accent: string;
  nose: string;
  frontWing: string;
  sidepod: string;
  engineCover: string;
  rearWing: string;
  accentStripe: string;
  halo: string;
}

export function paintFromTeam(team: TeamSpec): CarPaint {
  return {
    primary: team.colors.primary,
    secondary: team.colors.secondary,
    accent: team.colors.accent,
    nose: team.livery.nose,
    frontWing: team.livery.frontWing,
    sidepod: team.livery.sidepod,
    engineCover: team.livery.engineCover,
    rearWing: team.livery.rearWing,
    accentStripe: team.livery.accentStripe,
    halo: team.livery.halo,
  };
}

export const DEFAULT_PAINT: CarPaint = {
  primary: "#e10600",
  secondary: "#111318",
  accent: "#00d2be",
  nose: "#e10600",
  frontWing: "#111318",
  sidepod: "#e10600",
  engineCover: "#e10600",
  rearWing: "#111318",
  accentStripe: "#00d2be",
  halo: "#111318",
};

/** Visible outline for dark panels so the silhouette survives on dark backgrounds. */
const EDGE = "#6b7484";

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : (lo + hi) / 2;
}

export interface CarTuning {
  /** 0 (minimum trim) .. 10 (maximum aero load). */
  frontWing?: number;
  rearWing?: number;
  /** 0 (low) .. 10 (high). */
  rideHeight?: number;
}

export interface CarStyle {
  frontWing?: FrontWingStyle;
  rearWing?: RearWingStyle;
  sidepod?: SidepodStyle;
  nose?: NoseStyle;
  halo?: HaloStyle;
}

export const DEFAULT_STYLE: Required<CarStyle> = {
  frontWing: "swept",
  rearWing: "swept",
  sidepod: "tapered",
  nose: "slender",
  halo: "standard",
};

/** Read the selected bodywork shapes off a team, falling back to defaults. */
export function stylesFromTeam(team: TeamSpec): Required<CarStyle> {
  const l = team.livery;
  return {
    frontWing: l.frontWingStyle ?? DEFAULT_STYLE.frontWing,
    rearWing: l.rearWingStyle ?? DEFAULT_STYLE.rearWing,
    sidepod: l.sidepodStyle ?? DEFAULT_STYLE.sidepod,
    nose: l.noseStyle ?? DEFAULT_STYLE.nose,
    halo: l.haloStyle ?? DEFAULT_STYLE.halo,
  };
}

/**
 * Original top-down Formula single-seater, drawn entirely in SVG so it stays
 * crisp and fully recolourable. The geometry is a generic modern F1 car: it
 * does not reproduce any real team's bodywork, logos or livery.
 *
 * `tuning` reflects the setup (wing angles visibly grow/trim, ride height nudges
 * the body). `style` switches between bodywork shapes for the front wing, rear
 * wing, sidepods, nose and halo, so the car can be visually personalised.
 */
export function CarSvg({
  paint,
  number,
  tuning,
  style,
  className = "",
  x,
  y,
  width,
  height,
}: {
  paint: CarPaint;
  number?: string;
  tuning?: CarTuning;
  style?: CarStyle;
  className?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const shade = `car-shade-${uid}`;
  const floor = `car-floor-${uid}`;
  const tyre = `car-tyre-${uid}`;
  const carbon = `car-carbon-${uid}`;
  const soft = `car-soft-${uid}`;

  const st = { ...DEFAULT_STYLE, ...style };
  const fw = clamp(tuning?.frontWing ?? 5, 0, 10) / 10;
  const rw = clamp(tuning?.rearWing ?? 5, 0, 10) / 10;
  const ride = clamp(tuning?.rideHeight ?? 5, 0, 10) / 10;
  const frontWingTransform = `translate(300 60) scale(${(0.92 + fw * 0.18).toFixed(3)} ${(0.9 + fw * 0.2).toFixed(3)}) translate(-300 -60)`;
  const rearWingTransform = `translate(42 60) scale(${(0.92 + rw * 0.18).toFixed(3)} ${(0.9 + rw * 0.2).toFixed(3)}) translate(-42 -60)`;
  const floorTransform = `translate(0 ${((ride - 0.5) * 3).toFixed(2)})`;

  const wingStroke = { stroke: EDGE, strokeWidth: 0.9, strokeOpacity: 0.8 };
  const tyreStroke = { stroke: EDGE, strokeWidth: 0.9, strokeOpacity: 0.55 };

  return (
    <svg viewBox="0 0 320 120" className={className} x={x} y={y} width={width} height={height} role={width != null ? undefined : "img"} aria-hidden={width != null ? true : undefined} aria-label={width != null ? undefined : "Formula car livery preview"}>
      <defs>
        <linearGradient id={shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="72%" stopColor="#000000" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.46" />
        </linearGradient>
        <linearGradient id={floor} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0c0d11" />
          <stop offset="55%" stopColor="#242832" />
          <stop offset="100%" stopColor="#12141a" />
        </linearGradient>
        <radialGradient id={tyre} cx="0.5" cy="0.5" r="0.62">
          <stop offset="0%" stopColor="#4c515b" />
          <stop offset="58%" stopColor="#24272e" />
          <stop offset="100%" stopColor="#0a0b0e" />
        </radialGradient>
        <radialGradient id={soft} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <pattern id={carbon} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#15171c" />
          <rect width="2" height="2" fill="#22252c" />
        </pattern>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="166" cy="62" rx="142" ry="48" fill={`url(#${soft})`} opacity="0.6" />

      {/* Floor and diffuser */}
      <g transform={floorTransform}>
        <path d="M64 46 L100 42 L214 46 L234 53 L234 67 L214 74 L100 78 L64 74 Z" fill={`url(#${floor})`} stroke={EDGE} strokeWidth="0.9" strokeOpacity="0.6" />
        <path d="M68 52 L90 49 M68 60 L90 60 M68 68 L90 71" stroke="#333944" strokeWidth="1" opacity="0.9" />
        <path d="M62 48 L80 44 L80 76 L62 72 Z" fill={`url(#${carbon})`} stroke={EDGE} strokeWidth="0.7" strokeOpacity="0.5" />
        <path d="M224 47 L234 53 L234 67 L224 73" fill="none" stroke="#3a404b" strokeWidth="1.2" />
        <path d="M198 46 L222 46 L226 49 L202 51 Z" fill={paint.accentStripe} opacity="0.2" />
      </g>

      {/* Rear wing assembly */}
      <g transform={rearWingTransform}>
        {st.rearWing === "swept" && (
          <>
            <path d="M36 33 Q33 60 36 87 L44 86 Q41 60 44 34 Z" fill={paint.rearWing} {...wingStroke} />
            <path d="M46 37 Q44 60 46 83 L52 82 Q50 60 52 38 Z" fill={paint.rearWing} opacity="0.92" {...wingStroke} />
          </>
        )}
        {st.rearWing === "box" && (
          <>
            <rect x="35" y="33" width="10" height="54" rx="1.5" fill={paint.rearWing} {...wingStroke} />
            <rect x="46" y="36" width="8" height="48" rx="1.5" fill={paint.rearWing} opacity="0.92" {...wingStroke} />
          </>
        )}
        {st.rearWing === "biplane" && (
          <>
            <rect x="34" y="33" width="9" height="54" rx="1.5" fill={paint.rearWing} {...wingStroke} />
            <rect x="46" y="35" width="9" height="50" rx="1.5" fill={paint.rearWing} opacity="0.9" {...wingStroke} />
          </>
        )}
        {/* Endplates at the wing tips (chord-wise fins) */}
        <path d="M30 33 L56 36 L56 40 L30 38 Z" fill={paint.rearWing} {...wingStroke} />
        <path d="M30 87 L56 84 L56 80 L30 82 Z" fill={paint.rearWing} {...wingStroke} />
        <path d="M31 35.5 L55 38" stroke={paint.accent} strokeWidth="1" opacity="0.85" />
        <path d="M31 84.5 L55 82" stroke={paint.accent} strokeWidth="1" opacity="0.85" />
        {/* Central support + rain light */}
        <path d="M54 42 L64 45 L64 75 L54 78 Z" fill={`url(#${carbon})`} stroke={EDGE} strokeWidth="0.7" strokeOpacity="0.5" />
        <rect x="55" y="57.5" width="5" height="5" rx="2" fill="#ff2020" />
      </g>

      {/* Rear suspension */}
      <path d="M78 26 L102 46 M78 34 L102 52 M82 94 L102 74 M82 86 L102 68" stroke="#0b0c10" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M80 29 L102 48 M80 91 L102 72" stroke="#414855" strokeWidth="0.9" strokeLinecap="round" />

      {/* Rear wheels */}
      {[12, 92].map((y) => (
        <g key={y}>
          <rect x="76" y={y} width="38" height="16" rx="4" fill={`url(#${tyre})`} {...tyreStroke} />
          <rect x="80" y={y + 1.5} width="30" height="13" rx="3" fill="none" stroke="#4a505c" strokeWidth="0.7" opacity="0.6" />
          <rect x="82" y={y + 2.5} width="6" height="11" rx="3" fill={paint.accent} opacity="0.22" />
          <rect x="95.5" y={y + 1} width="3" height="14" fill="#a7adb6" opacity="0.13" />
        </g>
      ))}

      {/* Engine cover and central monocoque */}
      <path d="M58 46 Q96 41 142 44 L198 50 L212 55 L212 65 L198 70 L142 76 Q96 79 58 74 Z" fill={paint.engineCover} stroke={EDGE} strokeWidth="0.85" strokeOpacity="0.65" />
      <path d="M62 52 Q100 48 144 50 L198 54 L208 58 Q176 57 132 59 Q96 60 62 66 Z" fill={`url(#${shade})`} opacity="0.92" />
      <path d="M68 59.5 L206 59.5 L206 60.6 L68 61.6 Z" fill={paint.accentStripe} opacity="0.9" />
      {/* Shark fin */}
      <path d="M100 46 L158 48 L158 72 L100 74 Z" fill="#0a0b0e" opacity="0.16" />
      <path d="M108 45.5 L158 47.2 L158 48 L108 46.5 Z" fill={paint.accentStripe} opacity="0.55" />

      {/* Sidepods */}
      {st.sidepod === "tapered" && (
        <>
          <path d="M102 51 C 118 38 146 33 176 44 L190 52 L190 56 C 154 50 126 51 104 54 Z" fill={paint.sidepod} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.55" />
          <path d="M102 69 C 118 82 146 87 176 76 L190 68 L190 64 C 154 70 126 69 104 66 Z" fill={paint.sidepod} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.55" />
        </>
      )}
      {st.sidepod === "wide" && (
        <>
          <path d="M98 50 C 116 35 150 31 184 43 L194 51 L194 56 C 154 49 122 51 100 54 Z" fill={paint.sidepod} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.55" />
          <path d="M98 70 C 116 85 150 89 184 77 L194 69 L194 64 C 154 71 122 69 100 66 Z" fill={paint.sidepod} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.55" />
          <path d="M106 48 L186 45" stroke="#000" strokeWidth="1.3" opacity="0.2" />
        </>
      )}
      {st.sidepod === "tunnel" && (
        <>
          <path d="M104 51 C 122 40 148 37 172 45 L182 52 L182 56 C 152 51 126 52 106 54 Z" fill={paint.sidepod} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.55" />
          <path d="M104 69 C 122 80 148 83 172 75 L182 68 L182 64 C 152 69 126 68 106 66 Z" fill={paint.sidepod} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.55" />
          <path d="M110 53 L132 50 L132 70 L110 67 Z" fill="#0a0b0e" opacity="0.45" />
          <path d="M114 55 L128 53 M114 65 L128 67" stroke={paint.accent} strokeWidth="0.9" opacity="0.5" />
        </>
      )}
      <path d="M106 50 Q138 40 174 45" fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.2" />
      <path d="M106 70 Q138 80 174 75" fill="none" stroke="#000000" strokeWidth="1.3" opacity="0.24" />
      <path d="M114 52 Q142 47 174 50" fill="none" stroke={paint.accent} strokeWidth="1.1" opacity="0.5" />
      <path d="M114 68 Q142 73 174 70" fill="none" stroke={paint.accent} strokeWidth="1.1" opacity="0.5" />

      {/* Bargeboards */}
      <path d="M100 51 L92 49 L92 55 L100 56 Z" fill={`url(#${carbon})`} stroke={EDGE} strokeWidth="0.6" strokeOpacity="0.5" />
      <path d="M100 69 L92 71 L92 65 L100 64 Z" fill={`url(#${carbon})`} stroke={EDGE} strokeWidth="0.6" strokeOpacity="0.5" />

      {/* Cockpit, halo and driver helmet */}
      <path d="M184 50 Q208 45 220 53 L220 67 Q208 75 184 70 Q178 64 178 60 Q178 56 184 50 Z" fill="#0a0b0e" stroke={EDGE} strokeWidth="0.7" strokeOpacity="0.5" />
      <ellipse cx="202" cy="60" rx="10.5" ry="8" fill={paint.halo} />
      <ellipse cx="202" cy="60" rx="6.6" ry="5.2" fill="#101318" />
      <path d="M190 52 Q202 46.5 214 52" fill="none" stroke={paint.halo} strokeWidth="3" strokeLinecap="round" />
      <path d="M190 68 Q202 73.5 214 68" fill="none" stroke={paint.halo} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      <path d="M199 62 L199 71" stroke={paint.halo} strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="202" cy="60" rx="4.2" ry="4.2" fill="#d8dde6" />
      <path d="M199 58 Q202 56 205 58" stroke={paint.accent} strokeWidth="1.1" fill="none" />
      <path d="M190 49 L180 45 L177 47 L186 52 Z" fill={paint.secondary} />
      <path d="M190 71 L180 75 L177 73 L186 68 Z" fill={paint.secondary} />
      {st.halo === "aero" && (
        <path d="M210 53 Q222 49 228 51 L226 56 Q218 54 210 58 Z" fill={paint.halo} opacity="0.9" stroke={EDGE} strokeWidth="0.6" strokeOpacity="0.4" />
      )}

      {/* Front suspension */}
      <path d="M244 26 L222 46 M244 34 L222 52 M248 94 L222 74 M248 86 L222 68" stroke="#0b0c10" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M244 29 L222 48 M244 91 L222 72" stroke="#414855" strokeWidth="0.9" strokeLinecap="round" />

      {/* Front wheels */}
      {[12, 92].map((y) => (
        <g key={y}>
          <rect x="244" y={y} width="38" height="16" rx="4" fill={`url(#${tyre})`} {...tyreStroke} />
          <rect x="248" y={y + 1.5} width="30" height="13" rx="3" fill="none" stroke="#4a505c" strokeWidth="0.7" opacity="0.6" />
          <rect x="250" y={y + 2.5} width="6" height="11" rx="3" fill={paint.accent} opacity="0.18" />
          <rect x="263.5" y={y + 1} width="3" height="14" fill="#a7adb6" opacity="0.13" />
        </g>
      ))}

      {/* Nose cone */}
      {st.nose === "slender" && (
        <path d="M212 51 L264 53 L292 57 L298 60 L292 63 L264 67 L212 69 Z" fill={paint.nose} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.6" />
      )}
      {st.nose === "thumb" && (
        <>
          <path d="M212 51 L262 52 L288 56 Q298 57.5 298 60 Q298 62.5 288 64 L262 68 L212 69 Z" fill={paint.nose} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.6" />
          <ellipse cx="294" cy="60" rx="6.5" ry="5.4" fill={paint.nose} stroke={EDGE} strokeWidth="0.7" strokeOpacity="0.5" />
        </>
      )}
      {st.nose === "blunt" && (
        <path d="M212 51 L274 52.5 L284 55 L284 65 L274 67.5 L212 69 Z" fill={paint.nose} stroke={EDGE} strokeWidth="0.8" strokeOpacity="0.6" />
      )}
      <path d="M214 58.5 L290 58.5 L290 61.5 L214 61.5 Z" fill={paint.accentStripe} opacity="0.85" />
      <path d="M224 66 L288 63" stroke="#000000" strokeWidth="0.9" opacity="0.18" />

      {/* Front wing */}
      <g transform={frontWingTransform}>
        {st.frontWing === "swept" && (
          <>
            <path d="M302 13 Q312 32 312 60 Q312 88 302 107 L310 104 Q316 88 316 60 Q316 32 310 16 Z" fill={paint.frontWing} {...wingStroke} />
            <path d="M292 18 Q300 36 300 60 Q300 84 292 102 L299 100 Q305 84 305 60 Q305 36 299 20 Z" fill={paint.frontWing} opacity="0.9" {...wingStroke} />
          </>
        )}
        {st.frontWing === "straight" && (
          <>
            <rect x="302" y="13" width="8" height="94" rx="2.5" fill={paint.frontWing} {...wingStroke} />
            <rect x="292" y="18" width="7" height="84" rx="2.5" fill={paint.frontWing} opacity="0.9" {...wingStroke} />
          </>
        )}
        {st.frontWing === "multi" && (
          <>
            <rect x="304" y="13" width="7" height="94" rx="2.5" fill={paint.frontWing} {...wingStroke} />
            <rect x="295" y="16" width="7" height="88" rx="2.5" fill={paint.frontWing} opacity="0.92" {...wingStroke} />
            <rect x="286" y="19" width="7" height="82" rx="2.5" fill={paint.frontWing} opacity="0.84" {...wingStroke} />
          </>
        )}
        {/* Endplates at the wing tips */}
        <path d="M286 9 L316 11 L316 16 L286 14 Z" fill={paint.frontWing} {...wingStroke} />
        <path d="M286 111 L316 109 L316 104 L286 106 Z" fill={paint.frontWing} {...wingStroke} />
        <path d="M288 12 L314 13.5" stroke={paint.accent} strokeWidth="1" opacity="0.8" />
        <path d="M288 108 L314 106.5" stroke={paint.accent} strokeWidth="1" opacity="0.8" />
        {/* Wing pillar to the nose */}
        <path d="M286 54 L302 55 L302 65 L286 66 Z" fill={`url(#${carbon})`} stroke={EDGE} strokeWidth="0.7" strokeOpacity="0.5" />
      </g>

      {/* Body highlight */}
      <path d="M72 60 Q120 58 170 60 Q210 61 262 61" fill="none" stroke="#ffffff" strokeWidth="0.7" opacity="0.12" />

      {/* T-cam */}
      <rect x="170" y="57.5" width="7" height="5" rx="1.5" fill="#0a0b0e" />
      <rect x="171" y="58.5" width="2.4" height="3" rx="0.5" fill="#e10600" />
      <rect x="174.5" y="58.5" width="1.4" height="3" fill="#e5e7eb" opacity="0.7" />

      {/* Car number */}
      {number && (
        <text
          x="246"
          y="65"
          fontSize="12"
          fontWeight="800"
          fill="#ffffff"
          stroke="#0a0b0e"
          strokeWidth="2.4"
          paintOrder="stroke"
          fontFamily="Rajdhani, sans-serif"
          textAnchor="middle"
          opacity="0.96"
        >
          {number}
        </text>
      )}
    </svg>
  );
}

export function CarSvgMini({ paint }: { paint: CarPaint }) {
  return <CarSvg paint={paint} className="h-8 w-24" />;
}
