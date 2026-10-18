import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FlaskConical, Gauge, Layers, Timer, Wrench } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, Progress, SectionHeading, Stat } from "../components/ui";
import { UPGRADE_META, FACILITY_META, facilityLevel } from "../engine/development";
import { teamDevelopmentModifiers } from "../engine/season";
import { balanceOf, findTeam } from "../lib/career";
import { money } from "../lib/format";
import type { UpgradeArea } from "../engine/types";

const AREAS = Object.keys(UPGRADE_META) as UpgradeArea[];
const CATEGORY_COLORS: Record<string, string> = { aero: "#38bdf8", mechanical: "#a78bfa", power: "#fb923c", reliability: "#34d399" };

export function DevelopmentPage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  if (!bundle || !myTeamId) return null;
  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const car = bundle.cars.find((c) => c.teamId === myTeamId)!;
  const mods = teamDevelopmentModifiers(bundle, myTeamId);
  const projects = bundle.upgrades.filter((u) => u.teamId === myTeamId);
  const active = projects.filter((u) => !u.completed);
  const completed = projects.filter((u) => u.completed && !u.installed);
  const installed = projects.filter((u) => u.installed);
  const balance = balanceOf(bundle, myTeamId);
  const facilities = bundle.facilities.filter((f) => f.teamId === myTeamId);
  const atCapacity = active.length >= mods.maxConcurrent;

  const act = async (fn: () => Promise<unknown>, id: string, ok: string) => {
    setBusy(id);
    try {
      await fn();
      pushToast("success", ok);
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Car Development"
        subtitle="Research upgrades, then install completed components onto the car. Each race weekend advances active projects by one tick."
        right={<Badge tone={atCapacity ? "warn" : "good"}>{atCapacity ? "Research capacity full" : `${mods.maxConcurrent - active.length} slot(s) free`}</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Research speed" value={`${mods.speed.toFixed(2)}×`} hint="Facilities + staff" />
        <Stat label="Quality multiplier" value={`${mods.quality.toFixed(2)}×`} hint="Affects upgrade gain" />
        <Stat label="Active projects" value={`${active.length}/${mods.maxConcurrent}`} hint="One tick per race weekend" />
        <Stat label="Budget" value={money(balance, { compact: true })} hint="Research is charged up front" accent={balance < 0 ? "#f87171" : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Active research" right={<FlaskConical size={15} className="text-gray-500" />}>
            {active.length === 0 ? (
              <Empty title="No projects in development" hint="Pick an area below to start researching an upgrade." />
            ) : (
              <div className="space-y-2">
                {active.map((u) => {
                  const pct = ((u.durationTicks - u.ticksRemaining) / u.durationTicks) * 100;
                  return (
                    <div key={u.id} className="rounded-lg border border-carbon-700 bg-carbon-900/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-100">{u.name}</div>
                          <div className="text-[11px] text-gray-500">
                            {UPGRADE_META[u.area].category} · quality {u.quality.toFixed(0)} · est. +{u.nominalGain.toFixed(1)} pts
                          </div>
                        </div>
                        <Badge tone="info">{u.ticksRemaining} tick{u.ticksRemaining === 1 ? "" : "s"} left</Badge>
                      </div>
                      <div className="mt-2"><Progress value={pct} color={CATEGORY_COLORS[UPGRADE_META[u.area].category]} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {completed.length > 0 && (
            <Panel title="Ready to install" right={<Badge tone="good">{completed.length} complete</Badge>}>
              <div className="space-y-2">
                {completed.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-2.5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-400" />
                      <div>
                        <div className="text-sm font-semibold text-gray-100">{u.name}</div>
                        <div className="text-[11px] text-gray-500">+{u.nominalGain.toFixed(1)} performance points</div>
                      </div>
                    </div>
                    <button className="btn-primary py-1" disabled={busy === u.id} onClick={() => void act(() => applyAction({ type: "install-project", teamId: myTeamId, projectId: u.id }), u.id, `${u.name} installed`)}>
                      Install
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Start a project" right={<Wrench size={15} className="text-gray-500" />}>
            <p className="mb-3 text-xs text-gray-500">Costs are estimates based on your facilities. Higher quality rolls yield larger performance gains on installation.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {AREAS.map((area) => {
                const meta = UPGRADE_META[area];
                const cost = Math.round(meta.baseCost * 1.02);
                const ticks = Math.max(1, Math.round(meta.baseTicks / mods.speed));
                const disabled = atCapacity || busy === area;
                return (
                  <button
                    key={area}
                    disabled={disabled}
                    onClick={() => void act(() => applyAction({ type: "start-project", teamId: myTeamId, area }), area, `${meta.name} research started`)}
                    className="rounded-lg border border-carbon-700 bg-carbon-900/50 p-3 text-left transition-colors hover:border-race-teal/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-100">{meta.name}</span>
                      <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[meta.category] }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                      <span className="font-mono">{money(cost, { compact: true })}</span>
                      <span className="inline-flex items-center gap-1"><Timer size={11} /> {ticks} tick{ticks === 1 ? "" : "s"}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-600">+{meta.nominalGain.toFixed(1)} nominal points · {meta.category}</div>
                  </button>
                );
              })}
            </div>
            {atCapacity && <p className="mt-2 text-xs text-amber-400">Research capacity reached. Install or wait for a project to finish, or upgrade the wind tunnel/design office.</p>}
          </Panel>

          {installed.length > 0 && (
            <Panel title="Installed upgrades">
              <div className="grid gap-2 sm:grid-cols-2">
                {installed.map((u) => (
                  <div key={u.id} className="flex items-center justify-between rounded-lg bg-carbon-900/50 px-2.5 py-2 text-xs">
                    <span className="text-gray-300">{u.name}</span>
                    <span className="font-mono text-emerald-400">+{u.nominalGain.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Current car" right={<Gauge size={15} className="text-gray-500" />}>
            <div className="space-y-2">
              {[
                ["Aero efficiency", car.aeroEfficiency],
                ["Downforce", car.downforce],
                ["Cornering", car.cornering],
                ["Straight-line", car.straightLine],
                ["Reliability", car.reliability],
                ["Mechanical grip", car.mechanicalGrip],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <div className="flex justify-between text-[11px]"><span className="text-gray-400">{label}</span><span className="font-mono text-gray-300">{Number(value).toFixed(0)}</span></div>
                  <Progress value={Number(value)} color="#00d2be" />
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-gray-500">Installed points add directly to race performance. Upgrades carry into the next season.</div>
          </Panel>

          <Panel title="Development facilities" right={<Link to="/career/facilities" className="text-xs text-race-teal hover:underline">Upgrade</Link>}>
            <div className="space-y-2">
              {(["design-office", "wind-tunnel", "simulator", "reliability-lab", "pit-crew"] as const).map((kind) => (
                <div key={kind} className="flex items-center gap-2 text-xs">
                  <Layers size={13} className="text-gray-500" />
                  <span className="flex-1 text-gray-300">{FACILITY_META[kind].name}</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((l) => <span key={l} className={`h-2 w-2 rounded-sm ${l <= facilityLevel(facilities, kind) ? "bg-race-teal" : "bg-carbon-700"}`} />)}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="panel panel-pad text-xs text-gray-500">
            <div className="label mb-1">How ticks work</div>
            Each completed race weekend counts as one development tick. Projects started late in a season may finish in the next one — install them before the season reset to keep the gains.
          </div>
        </div>
      </div>
    </div>
  );
}
