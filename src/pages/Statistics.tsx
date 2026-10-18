import { useMemo, useState } from "react";
import { Activity, BarChart3, Users } from "lucide-react";
import { useSession } from "../state/session";
import { Empty, Panel, SectionHeading, Stat } from "../components/ui";
import { findTeam, seasonLabel } from "../lib/career";

export function StatisticsPage() {
  const { bundle } = useSession();
  const [tab, setTab] = useState<"drivers" | "teams" | "races">("drivers");

  const results = useMemo(() => (bundle ? bundle.results.filter((r) => r.processed) : []), [bundle]);
  if (!bundle) return null;

  const driverStats = useMemo(() => {
    const map = new Map<string, { driverId: string; teamId: string; starts: number; wins: number; podiums: number; points: number; dnfs: number; best: number; finishSum: number; laps: number; fl: number }>();
    for (const r of results) {
      for (const c of r.classification) {
        const cur = map.get(c.driverId) ?? { driverId: c.driverId, teamId: c.teamId, starts: 0, wins: 0, podiums: 0, points: 0, dnfs: 0, best: 99, finishSum: 0, laps: 0, fl: 0 };
        cur.starts += 1;
        cur.teamId = c.teamId;
        cur.laps += c.laps;
        cur.points += c.points;
        if (c.status === "finished") {
          if (c.position === 1) cur.wins += 1;
          if (c.position <= 3) cur.podiums += 1;
          cur.best = Math.min(cur.best, c.position);
          cur.finishSum += c.position;
        } else {
          cur.dnfs += 1;
        }
        if (r.fastestLapDriverId === c.driverId) cur.fl += 1;
        map.set(c.driverId, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.points - a.points || a.best - b.best);
  }, [results]);

  const teamStats = useMemo(() => {
    return bundle.teams
      .map((t) => {
        const entries = results.flatMap((r) => r.classification.filter((c) => c.teamId === t.id));
        const finished = entries.filter((e) => e.status === "finished");
        const incidents = results.flatMap((r) => r.incidents.filter((i) => i.involvedDriverIds.some((id) => bundle.drivers.find((d) => d.id === id)?.teamId === t.id)));
        const pits = entries.reduce((s, e) => s + e.pits, 0);
        return {
          team: t,
          starts: entries.length,
          wins: finished.filter((e) => e.position === 1).length,
          podiums: finished.filter((e) => e.position <= 3).length,
          points: entries.reduce((s, e) => s + e.points, 0),
          avgFinish: finished.length ? finished.reduce((s, e) => s + e.position, 0) / finished.length : null,
          dnfs: entries.filter((e) => e.status !== "finished").length,
          incidents: incidents.length,
          pits,
        };
      })
      .sort((a, b) => b.points - a.points);
  }, [bundle.teams, bundle.drivers, results]);

  const totalLaps = results.reduce((s, r) => s + Math.max(0, ...r.classification.map((c) => c.laps)), 0);
  const totalIncidents = results.reduce((s, r) => s + r.incidents.length, 0);
  const totalDnfs = results.reduce((s, r) => s + r.classification.filter((c) => c.status === "dnf").length, 0);
  const totalSc = results.reduce((s, r) => s + r.safetyCarDeployments + r.virtualSafetyCarPeriods, 0);

  return (
    <div>
      <SectionHeading title="Statistics" subtitle={`${seasonLabel(bundle)} season · aggregated from ${results.length} processed race${results.length === 1 ? "" : "s"}`} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Races completed" value={results.length} hint="Processed results" />
        <Stat label="Racing laps" value={totalLaps.toLocaleString()} hint="Across all classified cars" />
        <Stat label="Incidents" value={totalIncidents} hint={`${totalDnfs} retirements`} />
        <Stat label="Neutralisations" value={totalSc} hint="Safety cars + VSCs" />
      </div>

      <div className="mb-3 inline-flex rounded-lg border border-carbon-700 bg-carbon-900 p-1">
        {(["drivers", "teams", "races"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-carbon-700 text-white" : "text-gray-400 hover:text-gray-200"}`}>
            {t}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <Empty title="No completed races" hint="Statistics build up as race weekends are finished." />
      ) : tab === "drivers" ? (
        <Panel title="Driver statistics" right={<Users size={15} className="text-gray-500" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="pb-2">Driver</th><th className="pb-2">Team</th><th className="pb-2 text-right">Starts</th><th className="pb-2 text-right">Wins</th>
                  <th className="pb-2 text-right">Podiums</th><th className="pb-2 text-right">Pts</th><th className="pb-2 text-right">Best</th><th className="pb-2 text-right">Avg fin</th><th className="pb-2 text-right">DNF</th><th className="pb-2 text-right">FL</th>
                </tr>
              </thead>
              <tbody>
                {driverStats.map((s) => {
                  const d = bundle.drivers.find((x) => x.id === s.driverId);
                  const t = findTeam(bundle, s.teamId);
                  return (
                    <tr key={s.driverId} className="border-t border-carbon-800">
                      <td className="py-1.5 text-gray-100">{d?.name ?? s.driverId}</td>
                      <td className="py-1.5 text-xs text-gray-500">{t?.shortName}</td>
                      <td className="py-1.5 text-right font-mono text-gray-400">{s.starts}</td>
                      <td className="py-1.5 text-right font-mono text-gray-300">{s.wins}</td>
                      <td className="py-1.5 text-right font-mono text-gray-400">{s.podiums}</td>
                      <td className="py-1.5 text-right font-mono font-semibold text-gray-100">{s.points}</td>
                      <td className="py-1.5 text-right font-mono text-gray-400">{s.best === 99 ? "—" : `P${s.best}`}</td>
                      <td className="py-1.5 text-right font-mono text-gray-400">{s.starts - s.dnfs > 0 ? (s.finishSum / (s.starts - s.dnfs)).toFixed(1) : "—"}</td>
                      <td className="py-1.5 text-right font-mono text-gray-400">{s.dnfs}</td>
                      <td className="py-1.5 text-right font-mono text-gray-400">{s.fl}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : tab === "teams" ? (
        <Panel title="Team statistics" right={<BarChart3 size={15} className="text-gray-500" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="pb-2">Team</th><th className="pb-2 text-right">Starts</th><th className="pb-2 text-right">Wins</th><th className="pb-2 text-right">Podiums</th>
                  <th className="pb-2 text-right">Pts</th><th className="pb-2 text-right">Avg fin</th><th className="pb-2 text-right">DNF</th><th className="pb-2 text-right">Pit stops</th><th className="pb-2 text-right">Incidents</th>
                </tr>
              </thead>
              <tbody>
                {teamStats.map((s) => (
                  <tr key={s.team.id} className="border-t border-carbon-800">
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5 text-gray-100">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.team.colors.primary }} />
                        {s.team.shortName}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{s.starts}</td>
                    <td className="py-1.5 text-right font-mono text-gray-300">{s.wins}</td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{s.podiums}</td>
                    <td className="py-1.5 text-right font-mono font-semibold text-gray-100">{s.points}</td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{s.avgFinish != null ? s.avgFinish.toFixed(1) : "—"}</td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{s.dnfs}</td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{s.pits}</td>
                    <td className="py-1.5 text-right font-mono text-gray-400">{s.incidents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Panel title="Race reports" right={<Activity size={15} className="text-gray-500" />}>
          <div className="space-y-2">
            {results.map((r) => {
              const winner = bundle.drivers.find((d) => d.id === r.classification[0]?.driverId);
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-carbon-900/50 p-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-gray-200">Round {r.raceIndex + 1} · {winner?.name ?? "—"}</div>
                    <div className="text-gray-500">{r.laps.length} laps · {r.weatherStart} · {r.classification.filter((c) => c.status === "dnf").length} DNF</div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-gray-400">
                    <span>{r.incidents.length} incidents</span>
                    <span>{r.safetyCarDeployments} SC</span>
                    <span>{r.virtualSafetyCarPeriods} VSC</span>
                    <span>{r.redFlags} red</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
