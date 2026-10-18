import { useState } from "react";
import { Gauge, RotateCcw, Save, Shapes, Sparkles, Target, Wind } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Panel, Progress, SectionHeading, Stat } from "../components/ui";
import { CarSvg, stylesFromTeam, paintFromTeam, type CarStyle } from "../components/CarSvg";
import { findTeam } from "../lib/career";
import { getCircuit } from "../data/circuits";
import type { FrontWingStyle, RearWingStyle, SidepodStyle, NoseStyle, HaloStyle } from "../engine/types";
import {
  NEUTRAL_SETUP,
  SETUP_RANGES,
  deriveAxes,
  hasDetailedSetup,
  idealSetup,
  sanitizeSetup,
  setupBreakdown,
  setupPenalty,
  wingFromAxes,
  type Setup,
  type SetupPart,
} from "../engine/car";

const PARTS: SetupPart[] = ["frontWing", "rearWing", "rideHeight", "brakeBias", "differential"];

const PART_META: Record<SetupPart, { label: string; blurb: string; low: string; high: string; unit: string }> = {
  frontWing: { label: "Front wing", blurb: "Front-end aero load. Sharpens turn-in but adds drag.", low: "Trimmed", high: "Max attack", unit: "" },
  rearWing: { label: "Rear wing", blurb: "Rear grip and stability. Bigger wing costs straight-line speed.", low: "Low drag", high: "Max downforce", unit: "" },
  rideHeight: { label: "Ride height", blurb: "Lower height boosts ground effect; higher helps compliance.", low: "Low / aggressive", high: "High / compliant", unit: "" },
  brakeBias: { label: "Brake bias", blurb: "Front-to-rear braking balance.", low: "Rearward", high: "Forward", unit: "%" },
  differential: { label: "Differential", blurb: "Locking aids traction out of corners but blunts rotation.", low: "Open", high: "Fully locked", unit: "" },
};

const TONE = { good: "#34d399", warn: "#fbbf24", bad: "#f87171" };

const FRONT_WING_STYLES: FrontWingStyle[] = ["swept", "straight", "multi"];
const REAR_WING_STYLES: RearWingStyle[] = ["swept", "box", "biplane"];
const SIDEPOD_STYLES: SidepodStyle[] = ["tapered", "wide", "tunnel"];
const NOSE_STYLES: NoseStyle[] = ["slender", "thumb", "blunt"];
const HALO_STYLES: HaloStyle[] = ["standard", "aero"];

function starterSetup(saved: Setup | null): Setup {
  if (saved && hasDetailedSetup(saved)) return sanitizeSetup(saved);
  const downforce = saved?.downforce ?? 3;
  const balance = saved?.balance ?? 0;
  return sanitizeSetup({ ...NEUTRAL_SETUP, ...wingFromAxes(downforce, balance), downforce, balance });
}

export function GaragePage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [draft, setDraft] = useState<Setup | null>(null);
  const [styleDraft, setStyleDraft] = useState<CarStyle | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  if (!bundle || !myTeamId) return null;

  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const circuit = getCircuit(bundle.weekend.circuitId);
  const savedSetup = bundle.setups[myTeamId]?.setup ?? null;
  const current = draft ?? starterSetup(savedSetup);
  const dirty = draft !== null;

  const baseStyle = stylesFromTeam(team);
  const currentStyle = { ...baseStyle, ...(styleDraft ?? {}) };
  const styleDirty = styleDraft !== null;

  const ideal = idealSetup(circuit);
  const breakdown = setupBreakdown(current, circuit);
  const aeroSeconds = breakdown.rows[0].seconds + breakdown.rows[1].seconds;
  const axes = deriveAxes(current.frontWing!, current.rearWing!);
  const savedPenalty = savedSetup ? setupPenalty(savedSetup, circuit) : setupPenalty(starterSetup(null), circuit);
  const penalty = setupPenalty(current, circuit);
  const balanceWord = current.balance < 0 ? "oversteer" : current.balance > 0 ? "understeer" : "neutral";
  const paint = paintFromTeam(team);

  const setPart = (part: SetupPart, value: number) => setDraft(sanitizeSetup({ ...current, [part]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await applyAction({ type: "set-setup", teamId: myTeamId, setup: sanitizeSetup(current) });
      setDraft(null);
      pushToast("success", "Car setup saved");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveStyle = async () => {
    setSavingStyle(true);
    try {
      await applyAction({
        type: "update-team",
        teamId: myTeamId,
        patch: {
          livery: {
            ...team.livery,
            frontWingStyle: currentStyle.frontWing,
            rearWingStyle: currentStyle.rearWing,
            sidepodStyle: currentStyle.sidepod,
            noseStyle: currentStyle.nose,
            haloStyle: currentStyle.halo,
          },
        },
      });
      setStyleDraft(null);
      pushToast("success", "Bodywork updated");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setSavingStyle(false);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Car Setup Studio"
        subtitle="Tune every aero and mechanical part of the car. Changes are free and feed straight into practice, qualifying and the race."
        right={<Badge tone={penalty < 0.25 ? "good" : penalty < 1 ? "warn" : "bad"}>{penalty < 0.25 ? "Dialled in" : `${penalty.toFixed(2)}s off ideal`}</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Circuit" value={circuit.name} hint={`${circuit.location} · aero ${Math.round(circuit.aeroDemand * 100)}/100`} />
        <Stat label="Setup error" value={`+${penalty.toFixed(2)}s`} hint="Lap-time penalty vs the perfect setup" accent={penalty < 0.25 ? TONE.good : penalty < 1 ? TONE.warn : TONE.bad} />
        <Stat label="Aero load" value={`${axes.downforce} / 5`} hint={`Target ${ideal.downforce} / 5`} />
        <Stat label="Aero balance" value={balanceWord} hint={`Target ${ideal.balance > 0 ? `+${ideal.balance}` : ideal.balance} (${ideal.balance > 0 ? "understeer" : ideal.balance < 0 ? "oversteer" : "neutral"})`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <Panel title="Chassis preview" right={<span className="text-xs text-gray-500">Live — reflects your setup</span>}>
            <div className="rounded-xl border border-carbon-700 bg-gradient-to-b from-carbon-800 to-carbon-900 p-4">
              <CarSvg
                paint={paint}
                number={team.abbreviation}
                tuning={{ frontWing: current.frontWing, rearWing: current.rearWing, rideHeight: current.rideHeight }}
                style={currentStyle}
                className="mx-auto h-56 w-full max-w-2xl"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-carbon-900/60 p-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500"><Wind size={11} /> Front wing</div>
                <div className="mt-0.5 font-mono text-gray-200">{current.frontWing} / 10</div>
              </div>
              <div className="rounded-lg bg-carbon-900/60 p-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500"><Wind size={11} /> Rear wing</div>
                <div className="mt-0.5 font-mono text-gray-200">{current.rearWing} / 10</div>
              </div>
              <div className="rounded-lg bg-carbon-900/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Ride height</div>
                <div className="mt-0.5 font-mono text-gray-200">{current.rideHeight} / 10</div>
              </div>
              <div className="rounded-lg bg-carbon-900/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Brake bias</div>
                <div className="mt-0.5 font-mono text-gray-200">{current.brakeBias}% front</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
                <Save size={15} /> {saving ? "Saving…" : "Save setup"}
              </button>
              <button className="btn-ghost" onClick={() => setDraft(sanitizeSetup(ideal))}>
                <Sparkles size={15} /> Engineer's target
              </button>
              <button className="btn-subtle ml-auto" onClick={() => setDraft(null)} disabled={!dirty}>
                <RotateCcw size={15} /> Revert
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {dirty ? (
                <>Unsaved changes — currently {penalty.toFixed(2)}s off ideal{savedSetup ? ` (saved setup ${savedPenalty.toFixed(2)}s off)` : ""}.</>
              ) : (
                <>Setup is saved. Changes are free and take effect immediately.</>
              )}
            </div>
          </Panel>

          <Panel title="Bodywork" right={<Shapes size={15} className="text-gray-500" />}>
            <p className="mb-3 text-xs text-gray-500">Cosmetic only — switch the shape of each part and watch the preview update. Performance still comes from the setup.</p>
            <div className="space-y-3">
              <StyleRow label="Front wing" options={FRONT_WING_STYLES} value={currentStyle.frontWing} onChange={(v) => setStyleDraft({ ...(styleDraft ?? {}), frontWing: v })} />
              <StyleRow label="Rear wing" options={REAR_WING_STYLES} value={currentStyle.rearWing} onChange={(v) => setStyleDraft({ ...(styleDraft ?? {}), rearWing: v })} />
              <StyleRow label="Sidepods" options={SIDEPOD_STYLES} value={currentStyle.sidepod} onChange={(v) => setStyleDraft({ ...(styleDraft ?? {}), sidepod: v })} />
              <StyleRow label="Nose" options={NOSE_STYLES} value={currentStyle.nose} onChange={(v) => setStyleDraft({ ...(styleDraft ?? {}), nose: v })} />
              <StyleRow label="Halo" options={HALO_STYLES} value={currentStyle.halo} onChange={(v) => setStyleDraft({ ...(styleDraft ?? {}), halo: v })} />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button className="btn-primary" onClick={() => void saveStyle()} disabled={!styleDirty || savingStyle}>
                <Save size={15} /> {savingStyle ? "Saving…" : "Save bodywork"}
              </button>
              <button className="btn-subtle ml-auto" onClick={() => setStyleDraft(null)} disabled={!styleDirty}>
                <RotateCcw size={15} /> Revert
              </button>
            </div>
          </Panel>

          <Panel title="Where the time is" right={<Gauge size={15} className="text-gray-500" />}>
            <div className="space-y-2.5">
              {breakdown.rows.map((r) => {
                const tone = r.seconds < 0.15 ? TONE.good : r.seconds < 0.5 ? TONE.warn : TONE.bad;
                return (
                  <div key={r.label}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-gray-400">{r.label}</span>
                      <span className="font-mono" style={{ color: tone }}>{r.seconds < 0.005 ? "on target" : `+${r.seconds.toFixed(2)}s`}</span>
                    </div>
                    <Progress value={Math.min(r.seconds, 1)} max={1} color={tone} />
                    <div className="mt-0.5 text-[10px] text-gray-600">you {r.value} · target {r.ideal}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-carbon-700 pt-3 text-sm">
              <span className="text-gray-400">Total setup penalty</span>
              <span className="font-mono font-semibold" style={{ color: penalty < 0.25 ? TONE.good : penalty < 1 ? TONE.warn : TONE.bad }}>+{breakdown.total.toFixed(2)}s / lap</span>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Garage controls" right={<Target size={15} className="text-gray-500" />}>
            <div className="space-y-5">
              {PARTS.map((part) => (
                <PartControl
                  key={part}
                  part={part}
                  value={current[part]!}
                  ideal={ideal[part]}
                  seconds={part === "frontWing" || part === "rearWing" ? aeroSeconds : breakdown.rows.find((r) => r.part === part)?.seconds ?? 0}
                  onChange={(v) => setPart(part, v)}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Engineer notes">
            <div className="space-y-2 text-xs text-gray-400">
              <p className="text-gray-300">{describeTarget(circuit.name, ideal)}</p>
              <ul className="space-y-1.5">
                <li className="flex gap-2"><span className="text-race-teal">•</span> Setup error costs lap time in every session — refine it after practice, which converges the suggestion toward the ideal.</li>
                <li className="flex gap-2"><span className="text-race-teal">•</span> Wings trade downforce for straight-line speed; end-of-straight grip is worth more on aero-heavy circuits.</li>
                <li className="flex gap-2"><span className="text-race-teal">•</span> Lower ride height unlocks ground-effect downforce but rewards a smooth, compliant car.</li>
              </ul>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StyleRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-300">{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-carbon-700">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            aria-pressed={value === o}
            className={`px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
              value === o ? "bg-race-teal text-carbon-950" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function PartControl({
  part,
  value,
  ideal,
  seconds,
  onChange,
}: {
  part: SetupPart;
  value: number;
  ideal: number;
  seconds: number;
  onChange: (v: number) => void;
}) {
  const meta = PART_META[part];
  const range = SETUP_RANGES[part];
  const toPct = (v: number) => ((v - range.min) / (range.max - range.min)) * 100;
  const off = Math.abs(value - ideal);
  const tone = off <= 0.5 ? TONE.good : off <= 2 ? TONE.warn : TONE.bad;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-200">{meta.label}</span>
        <span className="font-mono text-xs" style={{ color: tone }}>
          {value}{meta.unit}
          <span className="ml-2 text-[10px] text-gray-500">{seconds < 0.005 ? "on target" : `+${seconds.toFixed(2)}s`}</span>
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-race-teal"
          aria-label={meta.label}
        />
        <span
          className="pointer-events-none absolute -top-0.5 h-4 w-0.5 -translate-x-1/2 rounded bg-race-teal/70"
          style={{ left: `${toPct(ideal)}%` }}
          title={`Target ${ideal}`}
        />
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-600">
        <span>{meta.low}</span>
        <span className="text-gray-500">{meta.blurb}</span>
        <span>{meta.high}</span>
      </div>
    </div>
  );
}

function describeTarget(name: string, ideal: ReturnType<typeof idealSetup>): string {
  const df = ideal.downforce >= 4 ? "a high-downforce" : ideal.downforce <= 2 ? "a low-downforce" : "a balanced";
  const ride = ideal.rideHeight <= 4 ? "run the car low for ground effect" : ideal.rideHeight >= 7 ? "keep the ride height up for compliance" : "a mid ride height works well";
  const brake = ideal.brakeBias >= 60 ? "bias the brakes forward" : ideal.brakeBias <= 56 ? "run a more rearward brake bias" : "keep the brake bias near even";
  return `${name} rewards ${df} setup. Engineer's read: ${ride} and ${brake}.`;
}
