import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Gauge, Palette, Save, Wrench } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Panel, Progress, SectionHeading, Stat } from "../components/ui";
import { CarSvg, DEFAULT_PAINT, type CarPaint } from "../components/CarSvg";
import { LiveryEditor, TeamBadge } from "../components/LiveryEditor";
import { balanceOf, constructorRow, findTeam, teamDrivers } from "../lib/career";
import { money, ordinal } from "../lib/format";
import { UPGRADE_META } from "../engine/development";
import type { TeamSpec } from "../engine/types";

function paintFromTeam(team: TeamSpec): CarPaint {
  return { ...DEFAULT_PAINT, ...team.colors, ...team.livery };
}

const SPECS: Array<{ key: keyof import("../engine/types").CarSpec; label: string; invert?: boolean }> = [
  { key: "aeroEfficiency", label: "Aero efficiency" },
  { key: "downforce", label: "Downforce" },
  { key: "cornering", label: "Cornering" },
  { key: "straightLine", label: "Straight-line speed" },
  { key: "braking", label: "Braking" },
  { key: "mechanicalGrip", label: "Mechanical grip" },
  { key: "tireFriendliness", label: "Tyre friendliness" },
  { key: "reliability", label: "Reliability" },
  { key: "wetPerformance", label: "Wet performance" },
  { key: "cooling", label: "Cooling" },
];

export function TeamPage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [paint, setPaint] = useState<CarPaint | null>(null);
  const [saving, setSaving] = useState(false);
  if (!bundle || !myTeamId) return null;

  const team = findTeam(bundle, myTeamId);
  const car = bundle.cars.find((c) => c.teamId === myTeamId);
  if (!team || !car) return null;

  const drivers = teamDrivers(bundle, myTeamId);
  const row = constructorRow(bundle, myTeamId);
  const current = paint ?? paintFromTeam(team);
  const dirty = paint !== null;

  const save = async () => {
    setSaving(true);
    try {
      await applyAction({
        type: "update-team",
        teamId: team.id,
        patch: {
          colors: { primary: current.primary, secondary: current.secondary, accent: current.accent },
          livery: {
            nose: current.nose,
            frontWing: current.frontWing,
            sidepod: current.sidepod,
            engineCover: current.engineCover,
            rearWing: current.rearWing,
            accentStripe: current.accentStripe,
            halo: current.halo,
          },
        },
      });
      setPaint(null);
      pushToast("success", "Livery saved");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const installed = Object.entries(car.installed).filter(([, v]) => v > 0);

  return (
    <div>
      <SectionHeading
        title="My Team"
        subtitle="Identity, livery and technical overview of your constructor."
        right={<Badge tone="info">{team.isPlayerTeam ? "Privateer entrant" : "AI team"}</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Reputation" value={`${Math.round(team.reputation)}/100`} hint={team.reputation >= 75 ? "Paddock heavyweight" : team.reputation >= 55 ? "Respected midfield" : "Building credibility"} />
        <Stat label="Constructors" value={row ? ordinal(row.position) : "—"} hint={row ? `${row.points} pts` : "Awaiting first race"} />
        <Stat label="Budget" value={money(balanceOf(bundle, myTeamId), { compact: true })} hint="Cash available" />
        <Stat label="Home" value={team.headquarters.split(",")[0]} hint={team.headquarters} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Panel title="Livery studio" right={<Palette size={15} className="text-gray-500" />}>
            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="rounded-xl border border-carbon-700 bg-gradient-to-b from-carbon-800 to-carbon-900 p-3">
                <CarSvg paint={current} number={team.abbreviation} className="h-44 w-full" />
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-display text-sm font-bold text-gray-200">{team.name}</span>
                  <span className="font-mono text-[11px] text-gray-500">{team.engineSupplier}</span>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs text-gray-400">Paint sections independently, then save. Colour changes are free and take effect immediately.</p>
                <LiveryEditor paint={current} onChange={setPaint} number={team.abbreviation} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-gray-500">{dirty ? "Unsaved livery changes" : "Livery is up to date"}</span>
              <div className="flex gap-2">
                {dirty && <button className="btn-ghost" onClick={() => setPaint(null)}>Reset</button>}
                <button className="btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
                  <Save size={15} /> Save livery
                </button>
              </div>
            </div>
          </Panel>

          <Panel title="Car performance" right={<span className="text-xs text-gray-500">Baseline + installed upgrades</span>}>
            <div className="grid gap-3 sm:grid-cols-2">
              {SPECS.map((s) => {
                const value = Number(car[s.key]);
                return (
                  <div key={String(s.key)}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-gray-400">{s.label}</span>
                      <span className="font-mono text-gray-300">{value.toFixed(0)}</span>
                    </div>
                    <Progress value={value} max={100} color={value >= 85 ? "#34d399" : value >= 75 ? "#00d2be" : "#fbbf24"} />
                  </div>
                );
              })}
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-400">Weight</span>
                  <span className="font-mono text-gray-300">{car.weight.toFixed(0)} kg</span>
                </div>
                <Progress value={Math.max(0, 900 - car.weight)} max={120} color="#94a3b8" />
              </div>
            </div>
            <div className="mt-4 border-t border-carbon-700 pt-3">
              <div className="label mb-1">Installed upgrade points</div>
              {installed.length === 0 ? (
                <p className="text-xs text-gray-500">No upgrades installed yet. <Link to="/career/development" className="text-race-teal hover:underline">Start developing</Link>.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {installed.map(([area, pts]) => (
                    <span key={area} className="chip">{UPGRADE_META[area as keyof typeof UPGRADE_META].name} +{pts.toFixed(1)}</span>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Identity">
            <div className="flex items-center gap-3">
              <TeamBadge team={team} size={48} />
              <div>
                <div className="font-display text-lg font-bold text-white">{team.name}</div>
                <div className="text-xs text-gray-400">{team.shortName} · {team.abbreviation} · {team.nationality}</div>
              </div>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              {[
                ["Headquarters", team.headquarters],
                ["Engine", team.engineSupplier],
                ["Philosophy", team.philosophy],
                ["Number style", team.numberStyle],
                ["Season objective", `P${team.objective} or better`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 border-b border-carbon-800 pb-1.5 last:border-0">
                  <dt className="text-xs text-gray-500">{k}</dt>
                  <dd className="text-right text-xs font-medium text-gray-200">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Race line-up" right={<Link to="/career/drivers" className="text-xs text-race-teal hover:underline">Manage</Link>}>
            {drivers.length === 0 ? (
              <p className="text-xs text-gray-500">No drivers contracted. Sign two drivers before racing.</p>
            ) : (
              <div className="space-y-2">
                {drivers.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg bg-carbon-900/60 p-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-carbon-800 font-mono text-[10px] text-gray-400">{d.code}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-gray-100">{d.name}</div>
                      <div className="text-[11px] text-gray-500">{d.nationality} · age {d.age} · {d.starts} starts</div>
                    </div>
                    <span className="font-mono text-xs text-gray-400">{Math.round(d.morale)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Facilities snapshot" right={<Link to="/career/facilities" className="text-xs text-race-teal hover:underline">Upgrade</Link>}>
            <div className="space-y-1.5">
              {bundle.facilities
                .filter((f) => f.teamId === myTeamId)
                .slice(0, 6)
                .map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <Building2 size={13} className="text-gray-500" />
                    <span className="flex-1 capitalize text-gray-300">{f.kind.replace("-", " ")}</span>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((l) => (
                        <span key={l} className={`h-2 w-2 rounded-sm ${l <= f.level ? "bg-race-teal" : "bg-carbon-700"}`} />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </Panel>

          <div className="panel panel-pad text-xs text-gray-500">
            <div className="flex items-center gap-1.5 font-semibold text-gray-400"><Wrench size={13} /> Team notes</div>
            <p className="mt-1">Identity is fixed for the season; colours can be changed any time. Car performance is driven by baseline specs plus installed upgrade points.</p>
            <div className="mt-2 flex items-center gap-1.5"><Gauge size={13} /> Grid <span className="font-mono text-gray-400">P{team.objective}</span> objective</div>
          </div>
        </div>
      </div>
    </div>
  );
}
