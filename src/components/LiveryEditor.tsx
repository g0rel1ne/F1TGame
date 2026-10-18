import { CarSvg, DEFAULT_PAINT, type CarPaint } from "./CarSvg";
import type { TeamSpec } from "../engine/types";

const SECTIONS: Array<{ key: keyof CarPaint; label: string }> = [
  { key: "nose", label: "Nose" },
  { key: "frontWing", label: "Front wing" },
  { key: "sidepod", label: "Sidepod" },
  { key: "engineCover", label: "Engine cover" },
  { key: "rearWing", label: "Rear wing" },
  { key: "accentStripe", label: "Accent stripe" },
  { key: "halo", label: "Halo / cockpit" },
];

const PRESETS: Array<{ name: string; paint: Partial<CarPaint> }> = [
  { name: "Crimson", paint: { primary: "#e10600", secondary: "#0f1115", accent: "#ffd700", nose: "#e10600", frontWing: "#0f1115", sidepod: "#e10600", engineCover: "#e10600", rearWing: "#0f1115", accentStripe: "#ffd700", halo: "#0f1115" } },
  { name: "Teal", paint: { primary: "#00a19b", secondary: "#0b0f14", accent: "#c0c0c0", nose: "#00a19b", frontWing: "#0b0f14", sidepod: "#00a19b", engineCover: "#00a19b", rearWing: "#0b0f14", accentStripe: "#c0c0c0", halo: "#0b0f14" } },
  { name: "Papaya", paint: { primary: "#ff8000", secondary: "#10131c", accent: "#00d2be", nose: "#ff8000", frontWing: "#10131c", sidepod: "#ff8000", engineCover: "#ff8000", rearWing: "#10131c", accentStripe: "#00d2be", halo: "#10131c" } },
  { name: "Midnight", paint: { primary: "#1e2a78", secondary: "#0a0b10", accent: "#f5c518", nose: "#1e2a78", frontWing: "#0a0b10", sidepod: "#1e2a78", engineCover: "#1e2a78", rearWing: "#0a0b10", accentStripe: "#f5c518", halo: "#0a0b10" } },
  { name: "Forest", paint: { primary: "#00594f", secondary: "#101210", accent: "#d4ff00", nose: "#00594f", frontWing: "#101210", sidepod: "#00594f", engineCover: "#00594f", rearWing: "#101210", accentStripe: "#d4ff00", halo: "#101210" } },
];

export function LiveryEditor({ paint, onChange, number }: { paint: CarPaint; onChange: (p: CarPaint) => void; number?: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-carbon-700 bg-gradient-to-b from-carbon-800 to-carbon-900 p-4">
        <CarSvg paint={paint} number={number} className="mx-auto h-40 w-full max-w-md" />
      </div>
      <div>
        <div className="label mb-2">Presets</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => onChange({ ...DEFAULT_PAINT, ...p.paint } as CarPaint)}
              className="flex items-center gap-2 rounded-lg border border-carbon-600 bg-carbon-800 px-2.5 py-1.5 text-xs font-semibold text-gray-300 hover:bg-carbon-700"
            >
              <span className="flex gap-0.5">
                <span className="h-3 w-3 rounded-sm" style={{ background: p.paint.primary }} />
                <span className="h-3 w-3 rounded-sm" style={{ background: p.paint.accent }} />
              </span>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SECTIONS.map((s) => (
          <label key={s.key} className="flex items-center gap-2 rounded-lg border border-carbon-700 bg-carbon-900/60 p-2">
            <input
              type="color"
              value={paint[s.key]}
              onChange={(e) => onChange({ ...paint, [s.key]: e.target.value })}
              className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label={s.label}
            />
            <span className="text-xs font-medium text-gray-300">{s.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function TeamBadge({ team, size = 36 }: { team: Pick<TeamSpec, "abbreviation" | "colors" | "logo">; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-display font-bold text-white shadow-inner"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${team.colors.primary}, ${team.logo.background})`,
        border: `1px solid ${team.colors.accent}55`,
        fontSize: size * 0.34,
        letterSpacing: "0.02em",
      }}
      title={team.abbreviation}
    >
      {team.abbreviation}
    </span>
  );
}

export function TeamSwatch({ colors }: { colors: { primary: string; secondary: string; accent: string } }) {
  return (
    <span className="inline-flex overflow-hidden rounded-full border border-carbon-600">
      <span className="h-3 w-3" style={{ background: colors.primary }} />
      <span className="h-3 w-3" style={{ background: colors.accent }} />
      <span className="h-3 w-3" style={{ background: colors.secondary }} />
    </span>
  );
}
