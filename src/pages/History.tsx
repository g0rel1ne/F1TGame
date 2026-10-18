import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, Trophy } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, SectionHeading } from "../components/ui";
import { computeStandings } from "../engine/standings";
import { findDriver, findTeam } from "../lib/career";
import { getCircuit } from "../data/circuits";

export function HistoryPage() {
  const { bundle } = useSession();
  const [open, setOpen] = useState<number | null>(null);
  if (!bundle) return null;

  const seasons = useMemo(
    () =>
      [...bundle.seasons].reverse().map((season) => {
        const results = bundle.results.filter((r) => r.season === season.number && r.processed);
        const standings = season.completed ? computeStandings(results, season.number) : bundle.standings;
        return { season, results, standings };
      }),
    [bundle],
  );

  return (
    <div>
      <SectionHeading
        title="Career History"
        subtitle="Season-by-season record, champions and final standings."
        right={<Badge tone="info">{bundle.seasons.length} season{bundle.seasons.length === 1 ? "" : "s"}</Badge>}
      />

      <div className="space-y-3">
        {seasons.map(({ season, results, standings }) => {
          const isOpen = open === season.number;
          const champion = findDriver(bundle, season.championDriverId);
          const championTeam = findTeam(bundle, season.championTeamId);
          return (
            <Panel
              key={season.id}
              title={`${bundle.settings.startingSeason + season.number - 1} season`}
              right={
                <button className="btn-subtle p-1" onClick={() => setOpen(isOpen ? null : season.number)}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-carbon-800"><Trophy size={18} className={season.completed ? "text-amber-400" : "text-gray-500"} /></span>
                  <div>
                    <div className="text-sm font-semibold text-gray-100">
                      {season.completed ? champion?.name ?? "Champion not recorded" : `Season in progress · ${results.length}/${season.calendar.length} rounds`}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {season.completed && championTeam ? `${championTeam.name} constructors' champions` : `Current season ${bundle.career.currentSeason}`}
                    </div>
                  </div>
                </div>
                <Badge tone={season.completed ? "good" : "info"}>{season.completed ? "Complete" : "Active"}</Badge>
              </div>

              {isOpen && (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="label mb-1">Final constructors' standings</div>
                    {standings.constructors.length === 0 ? (
                      <Empty title="No standings" />
                    ) : (
                      <div className="space-y-1">
                        {standings.constructors.slice(0, 10).map((r) => {
                          const t = findTeam(bundle, r.teamId);
                          return (
                            <div key={r.teamId} className="flex items-center gap-2 text-xs">
                              <span className="w-4 text-right font-mono text-gray-500">{r.position}</span>
                              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: t?.colors.primary ?? "#666" }} />
                              <span className="flex-1 truncate text-gray-300">{t?.name ?? r.teamId}</span>
                              <span className="font-mono text-gray-400">{r.points}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="label mb-1">Race winners</div>
                    {results.length === 0 ? (
                      <Empty title="No races yet" />
                    ) : (
                      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {results.map((r) => {
                          const winner = findDriver(bundle, r.classification[0]?.driverId);
                          return (
                            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate text-gray-400">R{r.raceIndex + 1} · {getCircuit(r.circuitId).name}</span>
                              <span className="font-medium text-gray-200">{winner?.name ?? "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500">
                <History size={12} /> {bundle.settings.startingSeason + season.number - 1} · {season.calendar.length} rounds · {results.length} completed
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
