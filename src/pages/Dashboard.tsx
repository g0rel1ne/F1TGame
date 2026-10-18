import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Car, CircleDollarSign, CloudRain, Flag, Gauge, Trophy, Users } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, Progress, SectionHeading, Stat } from "../components/ui";
import { TeamBadge } from "../components/LiveryEditor";
import { TrackMap } from "../components/TrackMap";
import { getCircuit } from "../data/circuits";
import { balanceOf, constructorRow, findTeam, seasonLabel, teamDrivers } from "../lib/career";
import { lapTime, money, ordinal, timeAgo } from "../lib/format";

export function DashboardPage() {
  const { bundle, myTeamId, user, isHost, applyAction, pushToast, lobby } = useSession();
  if (!bundle || !user) return null;

  const team = findTeam(bundle, myTeamId);
  const circuit = getCircuit(bundle.weekend.circuitId);
  const row = myTeamId ? constructorRow(bundle, myTeamId) : null;
  const drivers = myTeamId ? teamDrivers(bundle, myTeamId) : [];
  const lastResult = bundle.results.filter((r) => r.processed).slice(-1)[0] ?? null;
  const nextRaceIndex = bundle.season.currentRaceIndex;
  const totalRounds = bundle.season.calendar.length;
  const offSeason = bundle.career.phase === "off-season";
  const weekendDone = !!bundle.weekend.resultId;
  const news = [...bundle.news].reverse().slice(0, 6);
  const ready = user ? bundle.weekend.readyUserIds.includes(user.id) : false;
  const required = lobby?.members.filter((m) => m.online) ?? [];
  const readyCount = required.filter((m) => bundle.weekend.readyUserIds.includes(m.userId)).length;

  const runHost = async (action: Parameters<typeof applyAction>[0], ok: string) => {
    try {
      await applyAction(action);
      pushToast("success", ok);
    } catch (e) {
      pushToast("error", (e as Error).message);
    }
  };

  if (!team) {
    return (
      <Empty
        title="No team yet"
        hint="Create your team in the lobby wizard to start managing."
        action={<Link to="/career/team" className="btn-primary mt-2">Create team</Link>}
      />
    );
  }

  return (
    <div>
      <SectionHeading
        title={offSeason ? "Season complete" : `${circuit.name}`}
        subtitle={`${team.name} · ${seasonLabel(bundle)} season · ${offSeason ? "Off-season" : `Round ${nextRaceIndex + 1} of ${totalRounds}`}`}
        right={
          <div className="flex items-center gap-2">
            {weekendDone && !offSeason && <Badge tone="good">Weekend complete</Badge>}
            {offSeason && <Badge tone="warn">Off-season</Badge>}
            <Link to="/career/race" className="btn-ghost"><Flag size={15} /> Race centre</Link>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Budget"
          value={money(balanceOf(bundle, team.id), { compact: true })}
          hint={balanceOf(bundle, team.id) < 0 ? "In the red — seek funding" : "Available for development"}
          accent={balanceOf(bundle, team.id) < 0 ? "#f87171" : undefined}
        />
        <Stat
          label="Constructors' position"
          value={row ? `${ordinal(row.position)}` : "—"}
          hint={row ? `${row.points} points · ${row.wins} wins` : "No points scored yet"}
        />
        <Stat
          label="Objective"
          value={`P${team.objective} or better`}
          hint={`Reputation ${Math.round(team.reputation)}/100`}
        />
        <Stat
          label="Ready to race"
          value={`${readyCount}/${required.length}`}
          hint={ready ? "You are ready" : "Tick ready before the host starts"}
          accent={readyCount === required.length && required.length > 0 ? "#34d399" : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Panel
            title={weekendDone ? "Current weekend" : `${circuit.location} Grand Prix`}
            right={weekendDone ? <Badge tone="good">Result recorded</Badge> : <Badge tone="info">{bundle.weekend.weather.condition}</Badge>}
          >
            <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
              <div className="rounded-lg border border-carbon-700 bg-carbon-900/40 p-2">
                <TrackMap circuit={circuit} height={220} className="w-full" />
                <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-gray-500">
                  <span>Accurate circuit layout</span>
                  <span>{circuit.lengthKm.toFixed(3)} km · {circuit.corners} corners</span>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-100">
                  <CalendarClock size={15} className="text-race-teal" /> Weekend plan
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-carbon-900/60 p-2">
                    <dt className="text-[10px] uppercase text-gray-500">Race laps</dt>
                    <dd className="font-mono text-gray-200">{Math.max(5, Math.round(circuit.laps * bundle.settings.raceDistancePct / 100))}</dd>
                  </div>
                  <div className="rounded bg-carbon-900/60 p-2">
                    <dt className="text-[10px] uppercase text-gray-500">Distance</dt>
                    <dd className="font-mono text-gray-200">{bundle.settings.raceDistancePct}%</dd>
                  </div>
                  <div className="rounded bg-carbon-900/60 p-2">
                    <dt className="text-[10px] uppercase text-gray-500">Track temp</dt>
                    <dd className="font-mono text-gray-200">{Math.round(bundle.weekend.weather.trackTempC)}°C</dd>
                  </div>
                  <div className="rounded bg-carbon-900/60 p-2">
                    <dt className="text-[10px] uppercase text-gray-500">Rain chance</dt>
                    <dd className="font-mono text-gray-200">{Math.round(circuit.rainChance * 100)}%</dd>
                  </div>
                </dl>
                <div className="mt-3 space-y-1.5">
                  {drivers.length === 0 && <div className="rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-300">No drivers signed. Visit the driver market.</div>}
                  {drivers.map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded bg-carbon-900/60 px-2 py-1.5 text-xs">
                      <span className="font-semibold text-gray-200">{d.name}</span>
                      <span className="font-mono text-gray-500">MOR {Math.round(d.morale)}</span>
                    </div>
                  ))}
                </div>
                <Link to="/career/race" className="btn-primary mt-3 w-full justify-center">
                  {weekendDone ? "View race result" : "Race weekend"} <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </Panel>

          {weekendDone && !offSeason && (
            <Panel title="Weekend complete" right={<Badge tone="info">Host control</Badge>}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-400">
                  {isHost ? "Advance the calendar when everyone is ready to continue." : "Waiting for the host to advance the calendar."}
                </p>
                {isHost && (
                  <button className="btn-primary" onClick={() => void runHost({ type: "advance-calendar" }, "Calendar advanced")}>
                    Continue to next round <ArrowRight size={15} />
                  </button>
                )}
              </div>
            </Panel>
          )}

          {offSeason && (
            <Panel title="Season review" right={<Badge tone="warn">Off-season</Badge>}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-gray-400">
                  Champion: <span className="font-semibold text-gray-200">{bundle.drivers.find((d) => d.id === bundle.season.championDriverId)?.name ?? "—"}</span>
                  {" · "}Constructors: <span className="font-semibold text-gray-200">{findTeam(bundle, bundle.season.championTeamId)?.name ?? "—"}</span>
                </div>
                {isHost ? (
                  <button className="btn-primary" onClick={() => void runHost({ type: "start-next-season" }, "New season started")}>
                    Start next season <ArrowRight size={15} />
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">Waiting for the host to start next season.</span>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Latest result" right={lastResult ? <span className="text-xs text-gray-500">Round {lastResult.raceIndex + 1}</span> : null}>
            {!lastResult ? (
              <Empty title="No races completed" hint="Results appear here once the first race weekend is run." />
            ) : (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                  <span>{getCircuit(lastResult.circuitId).name} · {new Date(lastResult.createdAt).toLocaleDateString()}</span>
                  <span>{lastResult.safetyCarDeployments} SC · {lastResult.virtualSafetyCarPeriods} VSC · {lastResult.incidents.length} incidents</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                        <th className="pb-1">Pos</th><th className="pb-1">Driver</th><th className="pb-1">Team</th><th className="pb-1 text-right">Time/Gap</th><th className="pb-1 text-right">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastResult.classification.slice(0, 6).map((c) => {
                        const d = bundle.drivers.find((x) => x.id === c.driverId);
                        const t = findTeam(bundle, c.teamId);
                        return (
                          <tr key={c.driverId} className={`border-t border-carbon-800 ${c.teamId === team.id ? "bg-race-teal/5" : ""}`}>
                            <td className="py-1 font-mono text-gray-400">{c.position}</td>
                            <td className="py-1 text-gray-200">{d?.name ?? c.driverId}</td>
                            <td className="py-1 text-gray-500">{t?.shortName}</td>
                            <td className="py-1 text-right font-mono text-gray-400">{c.status === "finished" ? (c.position === 1 ? lapTime(c.timeSeconds) : c.gap) : c.status.toUpperCase()}</td>
                            <td className="py-1 text-right font-mono text-gray-300">{c.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Constructors' championship" right={<Link to="/career/championship" className="text-xs text-race-teal hover:underline">Full table</Link>}>
            {bundle.standings.constructors.length === 0 ? (
              <Empty title="No standings yet" hint="Points are awarded after each race." />
            ) : (
              <div className="space-y-1.5">
                {bundle.standings.constructors.slice(0, 8).map((r) => {
                  const t = findTeam(bundle, r.teamId);
                  if (!t) return null;
                  const leader = bundle.standings.constructors[0]?.points || 1;
                  return (
                    <div key={r.teamId} className={`rounded-lg border px-2 py-1.5 ${r.teamId === team.id ? "border-race-teal/40 bg-race-teal/5" : "border-transparent"}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-4 text-right font-mono text-xs text-gray-500">{r.position}</span>
                        <TeamBadge team={t} size={22} />
                        <span className="flex-1 truncate text-xs font-semibold text-gray-200">{t.shortName}</span>
                        <span className="font-mono text-xs text-gray-300">{r.points}</span>
                      </div>
                      <div className="mt-1 pl-8"><Progress value={r.points} max={leader} color={t.colors.primary} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Drivers' championship" right={<Users size={14} className="text-gray-500" />}>
            {bundle.standings.drivers.length === 0 ? (
              <Empty title="No standings yet" />
            ) : (
              <div className="space-y-1">
                {bundle.standings.drivers.slice(0, 6).map((r) => {
                  const d = bundle.drivers.find((x) => x.id === r.driverId);
                  const t = findTeam(bundle, r.teamId);
                  return (
                    <div key={r.driverId} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-right font-mono text-gray-500">{r.position}</span>
                      {t && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.colors.primary }} />}
                      <span className="flex-1 truncate text-gray-200">{d?.name}</span>
                      <span className="font-mono text-gray-400">{r.points}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Team news" right={<Gauge size={14} className="text-gray-500" />}>
            {news.length === 0 ? (
              <Empty title="No news yet" hint="Race reports and business updates appear here." />
            ) : (
              <div className="space-y-2">
                {news.map((n) => (
                  <div key={n.id} className="rounded-lg bg-carbon-900/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-200">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-gray-500">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">{n.body}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Quick actions">
            <div className="grid grid-cols-2 gap-2">
              <Link to="/career/garage" className="btn-ghost justify-center"><Car size={15} /> Car Setup</Link>
              <Link to="/career/development" className="btn-ghost justify-center"><Gauge size={15} /> Develop</Link>
              <Link to="/career/drivers" className="btn-ghost justify-center"><Users size={15} /> Drivers</Link>
              <Link to="/career/finance" className="btn-ghost justify-center"><CircleDollarSign size={15} /> Finance</Link>
              <Link to="/career/championship" className="btn-ghost justify-center"><Trophy size={15} /> Standings</Link>
              <Link to="/career/race" className="btn-ghost justify-center"><Flag size={15} /> Race Weekend</Link>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500">
              <CloudRain size={13} /> Forecast: {bundle.weekend.weather.condition} · {Math.round(bundle.weekend.weather.trackWetness * 100)}% wetness
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
