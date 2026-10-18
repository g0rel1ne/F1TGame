import { useState } from "react";
import { Trophy } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, SectionHeading, Stat } from "../components/ui";
import { TeamBadge } from "../components/LiveryEditor";
import { findTeam, seasonLabel } from "../lib/career";
import { getRuleset } from "../engine/rulesets";
import { ordinal } from "../lib/format";

export function ChampionshipPage() {
  const { bundle } = useSession();
  const [tab, setTab] = useState<"constructors" | "drivers">("constructors");
  if (!bundle) return null;

  const ruleset = getRuleset(bundle.season.rulesetId);
  const results = bundle.results.filter((r) => r.processed);
  const leader = bundle.standings.constructors[0]?.points ?? 0;
  const roundsDone = results.length;
  const roundsTotal = bundle.season.calendar.length;

  return (
    <div>
      <SectionHeading
        title="Championship"
        subtitle={`${seasonLabel(bundle)} season · ${roundsDone} of ${roundsTotal} rounds scored`}
        right={<Badge tone="info">{ruleset.name}</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Rounds completed" value={`${roundsDone}/${roundsTotal}`} hint="Processed results" />
        <Stat label="Points system" value={`${ruleset.racePoints[0]}–${ruleset.racePoints[ruleset.racePoints.length - 1]}`} hint={`Top ${ruleset.racePoints.length} score`} />
        <Stat label="Fastest lap" value={ruleset.fastestLapPoints > 0 ? `+${ruleset.fastestLapPoints}` : "None"} hint={ruleset.fastestLapPoints > 0 ? `Inside top ${ruleset.fastestLapTopN}` : "Not awarded"} />
        <Stat label="Season champion" value={bundle.season.championDriverId ? bundle.drivers.find((d) => d.id === bundle.season.championDriverId)?.name ?? "—" : "In progress"} hint={bundle.season.championTeamId ? findTeam(bundle, bundle.season.championTeamId)?.shortName : ""} />
      </div>

      <div className="mb-3 inline-flex rounded-lg border border-carbon-700 bg-carbon-900 p-1">
        {(["constructors", "drivers"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-carbon-700 text-white" : "text-gray-400 hover:text-gray-200"}`}>
            {t}
          </button>
        ))}
      </div>

      <Panel title={`${tab === "constructors" ? "Constructors'" : "Drivers'"} championship`} right={<Trophy size={15} className="text-amber-400" />}>
        {tab === "constructors" ? (
          bundle.standings.constructors.length === 0 ? (
            <Empty title="No points scored yet" hint="Standings appear after the first processed race." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="pb-2">Pos</th><th className="pb-2">Team</th><th className="pb-2 text-right">Pts</th><th className="pb-2 text-right">Gap</th>
                    <th className="pb-2 text-right">Wins</th><th className="pb-2 text-right">Podiums</th><th className="pb-2 text-right">Poles</th><th className="pb-2 text-right">FL</th><th className="pb-2 text-right">DNF</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.standings.constructors.map((r) => {
                    const t = findTeam(bundle, r.teamId);
                    if (!t) return null;
                    return (
                      <tr key={r.teamId} className={`border-t border-carbon-800 ${r.position === 1 ? "bg-amber-500/5" : ""}`}>
                        <td className="py-2 font-mono text-gray-400">{ordinal(r.position)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <TeamBadge team={t} size={22} />
                            <div>
                              <div className="font-medium text-gray-100">{t.name}</div>
                              <div className="text-[10px] text-gray-500">{t.abbreviation} · {t.engineSupplier}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono font-semibold text-gray-100">{r.points}</td>
                        <td className="py-2 text-right font-mono text-xs text-gray-500">{r.position === 1 ? "—" : `-${leader - r.points}`}</td>
                        <td className="py-2 text-right font-mono text-gray-400">{r.wins}</td>
                        <td className="py-2 text-right font-mono text-gray-400">{r.podiums}</td>
                        <td className="py-2 text-right font-mono text-gray-400">{r.poles}</td>
                        <td className="py-2 text-right font-mono text-gray-400">{r.fastestLaps}</td>
                        <td className="py-2 text-right font-mono text-gray-400">{r.dnfs}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : bundle.standings.drivers.length === 0 ? (
          <Empty title="No points scored yet" hint="Standings appear after the first processed race." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="pb-2">Pos</th><th className="pb-2">Driver</th><th className="pb-2">Team</th><th className="pb-2 text-right">Pts</th>
                  <th className="pb-2 text-right">Gap</th><th className="pb-2 text-right">Wins</th><th className="pb-2 text-right">Podiums</th><th className="pb-2 text-right">Poles</th><th className="pb-2 text-right">DNF</th>
                </tr>
              </thead>
              <tbody>
                {bundle.standings.drivers.map((r) => {
                  const d = bundle.drivers.find((x) => x.id === r.driverId);
                  const t = findTeam(bundle, r.teamId);
                  const drvLeader = bundle.standings.drivers[0]?.points ?? 0;
                  return (
                    <tr key={r.driverId} className={`border-t border-carbon-800 ${r.position === 1 ? "bg-amber-500/5" : ""}`}>
                      <td className="py-2 font-mono text-gray-400">{ordinal(r.position)}</td>
                      <td className="py-2 font-medium text-gray-100">{d?.name ?? r.driverId}</td>
                      <td className="py-2 text-xs text-gray-500">{t?.shortName ?? "—"}</td>
                      <td className="py-2 text-right font-mono font-semibold text-gray-100">{r.points}</td>
                      <td className="py-2 text-right font-mono text-xs text-gray-500">{r.position === 1 ? "—" : `-${drvLeader - r.points}`}</td>
                      <td className="py-2 text-right font-mono text-gray-400">{r.wins}</td>
                      <td className="py-2 text-right font-mono text-gray-400">{r.podiums}</td>
                      <td className="py-2 text-right font-mono text-gray-400">{r.poles}</td>
                      <td className="py-2 text-right font-mono text-gray-400">{r.dnfs}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="panel panel-pad mt-4 text-xs text-gray-500">
        <div className="label mb-1">Sporting regulations</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>Qualifying: Q1 eliminates {ruleset.q1Eliminated}, Q2 eliminates {ruleset.q2Eliminated}.</div>
          <div>Mandatory pit stop: {ruleset.mandatoryPitStop ? "Yes" : "No"}.</div>
          <div>Cost cap: {ruleset.costCap > 0 ? `$${ruleset.costCap}M` : "Disabled"}.</div>
          <div>Safety cars: {ruleset.safetyCars ? "Yes" : "No"}{ruleset.virtualSafetyCars ? " · VSC" : ""}{ruleset.redFlags ? " · Red flags" : ""}.</div>
        </div>
      </div>
    </div>
  );
}
