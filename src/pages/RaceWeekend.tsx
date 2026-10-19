import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, Check, CloudRain, FastForward, Flag, Gauge, Pause, Play,
  Radio, RotateCcw, Timer, Trophy, Wind, Wrench,
} from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, SectionHeading, Spinner, Stat } from "../components/ui";
import { TeamBadge } from "../components/LiveryEditor";
import { TrackMap, type TrackMarker } from "../components/TrackMap";
import { LiveRaceView, type LiveRaceOnline } from "../components/LiveRace";
import { getCircuit } from "../data/circuits";
import { deriveAxes, hasDetailedSetup, setupPenalty, type Setup } from "../engine/car";
import type { LapRecord, RaceIncident, RaceResult, WeatherState } from "../engine/types";
import type { LiveTransport } from "../backend/types";
import { balanceOf, findTeam } from "../lib/career";
import { lapTime, money } from "../lib/format";

const COMPOUND_COLOR: Record<string, string> = { soft: "#f87171", medium: "#fbbf24", hard: "#e5e7eb", intermediate: "#34d399", wet: "#38bdf8" };
const SEVERITY_TONE = ["default", "info", "warn", "bad", "bad"] as const;
const FLAG_COLOR: Record<string, string> = { green: "#34d399", yellow: "#fbbf24", "safety-car": "#fbbf24", "virtual-safety-car": "#fbbf24", "red-flag": "#f87171", chequered: "#e5e7eb" };

function setupSummary(setup: Setup): Array<[string, string]> {
  const detailed = hasDetailedSetup(setup);
  const axes = detailed ? deriveAxes(setup.frontWing!, setup.rearWing!) : { downforce: setup.downforce, balance: setup.balance };
  const balWord = axes.balance < 0 ? "oversteer" : axes.balance > 0 ? "understeer" : "neutral";
  if (!detailed) {
    return [
      ["Downforce", `${setup.downforce} / 5`],
      ["Balance", `${setup.balance > 0 ? "+" : ""}${setup.balance} (${balWord})`],
    ];
  }
  return [
    ["Front wing", `${setup.frontWing} / 10`],
    ["Rear wing", `${setup.rearWing} / 10`],
    ["Aero load", `${axes.downforce} / 5`],
    ["Aero balance", balWord],
    ["Ride height", `${setup.rideHeight} / 10`],
    ["Brake bias", `${setup.brakeBias}% front`],
  ];
}

export function RaceWeekendPage() {
  const { bundle, user, lobby, myTeamId, isHost, mode, backend, applyAction, startRace, commitRace, setReady, pushToast, refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState(false);

  // One live-race channel per open lobby. The host streams the race on it; the
  // guests listen for the start and then render the host's beats. It is created
  // inside the effect (rather than memoised) so a remount always gets a fresh,
  // open channel — StrictMode's double-invoke would otherwise close a shared one.
  const lobbyId = lobby?.id ?? null;
  const userId = user?.id ?? null;
  const [liveTransport, setLiveTransport] = useState<LiveTransport | null>(null);
  useEffect(() => {
    if (!lobbyId || !userId) return;
    const transport = backend.openLive(lobbyId, userId);
    setLiveTransport(transport);
    return () => {
      setLiveTransport(null);
      transport.close();
    };
  }, [backend, lobbyId, userId]);

  // Keep the wire props stable: a fresh object here would re-subscribe every render.
  const peers = useMemo(
    () => (lobby?.members ?? []).map((m) => ({ userId: m.userId, teamId: m.teamId, online: m.online })),
    [lobby?.members],
  );
  const liveOnline = useMemo<LiveRaceOnline | null>(
    () => (liveTransport && userId ? { transport: liveTransport, userId, isHost, peers } : null),
    [liveTransport, userId, isHost, peers],
  );
  const syncPendingRef = useRef(false);
  useEffect(() => {
    if (!liveTransport || isHost) return;
    // Ask the host for the current state: if a live race is already running
    // (page opened mid-race) that answer is what opens the live view. After the
    // guest leaves, later beats are ignored rather than reopening it.
    syncPendingRef.current = true;
    liveTransport.send({ t: "sync" });
    return liveTransport.listen((message) => {
      if (message.t === "start") {
        syncPendingRef.current = false;
        setLive(true);
        pushToast("info", "The host has started the live race.");
      } else if (message.t === "beat" && syncPendingRef.current) {
        syncPendingRef.current = false;
        setLive(true);
      } else if (message.t === "abort") {
        setLive(false);
      }
    });
  }, [liveTransport, isHost, pushToast]);

  if (!bundle || !user || !lobby) return null;
  const circuit = getCircuit(bundle.weekend.circuitId);
  const result = bundle.weekend.resultId ? bundle.results.find((r) => r.id === bundle.weekend.resultId) ?? null : null;
  const savedSetup = myTeamId ? bundle.setups[myTeamId]?.setup ?? null : null;
  const currentSetup = myTeamId ? savedSetup ?? { downforce: 3, balance: 0 } : null;
  const setupError = currentSetup ? setupPenalty(currentSetup, circuit) : 0;
  const readyIds = new Set(bundle.weekend.readyUserIds);
  const online = lobby.members.filter((m) => m.online);
  const readyCount = online.filter((m) => readyIds.has(m.userId)).length;
  const iAmReady = readyIds.has(user.id);
  const practiceResults = bundle.practice.slice(-6).reverse();
  const myDrivers = bundle.drivers.filter((d) => d.teamId === myTeamId);
  const balance = myTeamId ? balanceOf(bundle, myTeamId) : 0;
  const canGoLive = isHost;
  const showLive = live && !result;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      pushToast("success", ok);
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runStart = async () => {
    setStarting(true);
    try {
      await startRace();
      pushToast("success", "Race complete — results recorded");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const practiceDone = practiceResults.length > 0;

  return (
    <div>
      <SectionHeading
        title="Race Weekend"
        subtitle={`${circuit.name} · Round ${bundle.weekend.raceIndex + 1} of ${bundle.season.calendar.length} · ${bundle.settings.raceDistancePct}% distance`}
        right={
          <div className="flex items-center gap-2">
            <WeatherBadge weather={bundle.weekend.weather} />
            {result ? <Badge tone="good">Result recorded</Badge> : <Badge tone="info">{bundle.weekend.session}</Badge>}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Circuit length" value={`${circuit.lengthKm.toFixed(3)} km`} hint={`${circuit.corners} corners · ${Math.max(5, Math.round(circuit.laps * bundle.settings.raceDistancePct / 100))} race laps`} />
        <Stat label="Track conditions" value={`${Math.round(bundle.weekend.weather.trackTempC)}°C`} hint={`${bundle.weekend.weather.condition} · ${Math.round(bundle.weekend.weather.trackWetness * 100)}% wet`} />
        <Stat label="Ready" value={`${readyCount}/${online.length}`} hint="Online principals" accent={readyCount === online.length && online.length > 0 ? "#34d399" : undefined} />
        <Stat label="Budget" value={money(balance, { compact: true })} hint="Repairs are deducted after the race" />
      </div>

      {showLive ? (
        <LiveRaceView
          bundle={bundle}
          myTeamId={myTeamId}
          online={liveOnline}
          onAbort={() => setLive(false)}
          onFinish={async (res) => {
            await commitRace(res);
            setLive(false);
            pushToast("success", "Race recorded — results are in.");
          }}
        />
      ) : (
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Panel title="Circuit" right={<span className="text-xs text-gray-500">Accurate circuit layout</span>}>
            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-lg border border-carbon-700 bg-carbon-900/40 p-2">
                <TrackMap circuit={circuit} height={250} className="w-full" />
              </div>
              <div className="space-y-2 text-xs">
                <div className="rounded bg-carbon-900/60 p-2"><div className="text-[10px] uppercase text-gray-500">Location</div><div className="text-gray-200">{circuit.location}, {circuit.country}</div></div>
                <div className="rounded bg-carbon-900/60 p-2"><div className="text-[10px] uppercase text-gray-500">Overtaking</div><div className="text-gray-200">{Math.round(circuit.overtaking * 100)}/100 · DRS {circuit.drsZones.length} zone{circuit.drsZones.length === 1 ? "" : "s"}</div></div>
                <div className="rounded bg-carbon-900/60 p-2"><div className="text-[10px] uppercase text-gray-500">Tyre wear</div><div className="text-gray-200">{Math.round(circuit.tyreWear * 100)}/100 · pit loss {circuit.pitLossSeconds.toFixed(1)}s</div></div>
                <div className="rounded bg-carbon-900/60 p-2"><div className="text-[10px] uppercase text-gray-500">Rain chance</div><div className="text-gray-200">{Math.round(circuit.rainChance * 100)}%</div></div>
                <p className="text-[11px] leading-relaxed text-gray-500">{circuit.blurb}</p>
              </div>
            </div>
          </Panel>

          {!result && (
            <Panel title="Car setup" right={myTeamId ? <Badge tone={setupError < 0.25 ? "good" : setupError < 1 ? "warn" : "bad"}>+{setupError.toFixed(2)}s / lap</Badge> : null}>
              {!myTeamId || !currentSetup ? (
                <Empty title="No team" hint="Create your team to run practice and race." />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {setupSummary(currentSetup).map(([k, v]) => (
                        <div key={k} className="rounded-lg bg-carbon-900/60 p-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">{k}</div>
                          <div className="mt-0.5 font-mono text-gray-200">{v}</div>
                        </div>
                      ))}
                    </div>
                    <Link to="/career/garage" className="btn-primary mt-1 w-full justify-center">
                      <Wrench size={15} /> Open Car Setup Studio
                    </Link>
                    <p className="text-[11px] text-gray-500">Tune wings, ride height, brake bias and differential. Practice feedback converges the ideal setup onto your car.</p>
                  </div>
                  <div className="rounded-lg border border-carbon-700 bg-carbon-900/50 p-3 text-xs text-gray-400">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-gray-300"><Gauge size={14} /> Engineer notes</div>
                    Setup error costs lap time in every session, so refine it after each practice run.
                    <div className="mt-2 space-y-1">
                      {myDrivers.map((d) => <div key={d.id} className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-race-teal" /> {d.name} — morale {Math.round(d.morale)}</div>)}
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          )}

          {result ? (
            <>
              <ReplaySection result={result} bundle={bundle} />
              <ResultsSection result={result} bundle={bundle} myTeamId={myTeamId} />
              <QualifyingSection result={result} bundle={bundle} myTeamId={myTeamId} />
              <IncidentsSection incidents={result.incidents} bundle={bundle} />
            </>
          ) : (
            <>
              <Panel title="Practice" right={<Badge tone={practiceDone ? "good" : "default"}>{practiceDone ? "Running" : "Not started"}</Badge>}>
                <div className="mb-3 flex flex-wrap gap-2">
                  {[1, 2, 3].map((s) => (
                    <button
                      key={s}
                      className="btn-ghost"
                      disabled={busy === `practice-${s}` || !myTeamId || result !== null}
                      onClick={() => void act(`practice-${s}`, () => applyAction({ type: "run-practice", session: s }), `Practice ${s} complete`)}
                    >
                      <Timer size={15} /> Run FP{s}
                    </button>
                  ))}
                  <span className="self-center text-[11px] text-gray-500">Any principal can run practice; results are shared.</span>
                </div>
                {practiceResults.length === 0 ? (
                  <Empty title="No practice data" hint="Run a session to gather setup, tyre and reliability information." />
                ) : (
                  <div className="space-y-3">
                    {practiceResults.slice(0, 2).map((p, pi) => (
                      <div key={`${p.session}-${pi}`} className="rounded-lg border border-carbon-700 bg-carbon-900/40 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-gray-200">Session {p.session}</span>
                          <span className="text-gray-500">Suggested setup: {p.suggestedSetup.downforce} DF / {p.suggestedSetup.balance > 0 ? "+" : ""}{p.suggestedSetup.balance} balance</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="text-left text-[10px] uppercase text-gray-500"><th className="pb-1">Driver</th><th className="pb-1 text-right">Best</th><th className="pb-1 text-right">Long run</th><th className="pb-1 text-right">Wear/lap</th><th className="pb-1 pl-3">Feedback</th></tr></thead>
                            <tbody>
                              {p.entries.slice().sort((a, b) => a.bestLap - b.bestLap).slice(0, 8).map((e) => {
                                const d = bundle.drivers.find((x) => x.id === e.driverId);
                                return (
                                  <tr key={e.driverId} className="border-t border-carbon-800">
                                    <td className="py-1 text-gray-200">{d?.name}</td>
                                    <td className="py-1 text-right font-mono text-gray-300">{lapTime(e.bestLap)}</td>
                                    <td className="py-1 text-right font-mono text-gray-500">{e.longRunPace ? lapTime(e.longRunPace) : "—"}</td>
                                    <td className="py-1 text-right font-mono text-gray-500">{e.tireWearPerLap ? e.tireWearPerLap.toFixed(3) : "—"}</td>
                                    <td className="py-1 pl-3 text-gray-500">{e.setupHint}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {p.entries.some((e) => e.reliabilityConcern) && (
                          <div className="mt-2 space-y-0.5">
                            {p.entries.filter((e) => e.reliabilityConcern).map((e) => (
                              <div key={e.driverId} className="flex items-center gap-1.5 text-[11px] text-amber-300"><AlertTriangle size={11} /> {e.reliabilityConcern}</div>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex justify-end">
                          <button
                            className="btn-ghost py-1 text-xs"
                            disabled={!myTeamId || busy === `use-setup-${p.session}`}
                            onClick={() => myTeamId && void act(`use-setup-${p.session}`, () => applyAction({ type: "set-setup", teamId: myTeamId, setup: p.suggestedSetup }), "Suggested setup applied")}
                          >
                            Use suggested setup
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Readiness" right={<Badge tone={readyCount === online.length && online.length > 0 ? "good" : "warn"}>{readyCount}/{online.length} ready</Badge>}>
                <div className="space-y-2">
                  {lobby.members.map((m) => {
                    const t = findTeam(bundle, m.teamId);
                    return (
                      <div key={m.userId} className="flex items-center gap-2 rounded-lg bg-carbon-900/50 p-2 text-sm">
                        {t ? <TeamBadge team={t} size={26} /> : <span className="grid h-[26px] w-[26px] place-items-center rounded border border-dashed border-carbon-600 text-[9px] text-gray-500">—</span>}
                        <span className="flex-1 text-gray-200">{m.username} {m.userId === user.id && <span className="text-[10px] text-gray-500">(you)</span>}</span>
                        {!m.online && <span className="text-[10px] text-gray-500">offline</span>}
                        <Badge tone={readyIds.has(m.userId) ? "good" : "default"}>{readyIds.has(m.userId) ? "Ready" : "Not ready"}</Badge>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className={iAmReady ? "btn-ghost" : "btn-primary"} onClick={() => void setReady(!iAmReady).catch((e) => pushToast("error", (e as Error).message))}>
                    <Check size={15} /> {iAmReady ? "Cancel ready" : "I'm ready"}
                  </button>
                  {isHost ? (
                    <>
                      <button className="btn-primary" onClick={() => setLive(true)} disabled={!myTeamId || readyCount < online.length}>
                        <Radio size={15} /> Go live
                      </button>
                      <button className="btn-ghost" onClick={() => void runStart()} disabled={starting || readyCount < online.length || !myTeamId}>
                        {starting ? <Spinner label="Simulating…" /> : <><Flag size={15} /> Quick sim</>}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-500">Only the host can start the race once everyone is ready — if they go live, this screen switches to the shared race automatically.</span>
                  )}
                  {isHost && readyCount < online.length && <span className="text-xs text-amber-400">All online principals must be ready.</span>}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Short on cash? Races cost repairs and travel — running at least two healthy drivers is strongly advised. Current balance: {money(balance, { compact: true })}.</p>
              </Panel>
            </>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Weather" right={<CloudRain size={15} className="text-gray-500" />}>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-carbon-900 text-race-teal"><Wind size={22} /></div>
              <div>
                <div className="font-display text-lg font-bold capitalize text-white">{bundle.weekend.weather.condition.replace("-", " ")}</div>
                <div className="text-xs text-gray-400">Air {Math.round(bundle.weekend.weather.airTempC)}°C · Track {Math.round(bundle.weekend.weather.trackTempC)}°C</div>
              </div>
            </div>
            <div className="mt-3"><div className="mb-1 flex justify-between text-[11px] text-gray-500"><span>Track wetness</span><span className="font-mono">{Math.round(bundle.weekend.weather.trackWetness * 100)}%</span></div><div className="h-1.5 rounded-full bg-carbon-700"><div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.round(bundle.weekend.weather.trackWetness * 100)}%` }} /></div></div>
          </Panel>

          <Panel title="Weekend checklist">
            <ul className="space-y-2 text-xs">
              <ChecklistItem done={!!myTeamId} label="Team created" />
              <ChecklistItem done={myDrivers.length >= 2} label={`Two drivers signed (${myDrivers.length}/2)`} />
              <ChecklistItem done={practiceDone} label="Practice completed" />
              <ChecklistItem done={!!savedSetup} label="Setup saved" />
              <ChecklistItem done={readyCount === online.length && online.length > 0} label="All principals ready" />
              <ChecklistItem done={!!result} label="Race simulated" />
            </ul>
          </Panel>

          {result && (
            <Panel title="Race summary">
              <div className="space-y-1.5 text-xs">
                <Row label="Winner" value={bundle.drivers.find((d) => d.id === result.classification[0]?.driverId)?.name ?? "—"} />
                <Row label="Pole" value={bundle.drivers.find((d) => d.id === result.poleDriverId)?.name ?? "—"} />
                <Row label="Fastest lap" value={bundle.drivers.find((d) => d.id === result.fastestLapDriverId)?.name ?? "—"} />
                <Row label="Safety cars" value={String(result.safetyCarDeployments)} />
                <Row label="VSCs" value={String(result.virtualSafetyCarPeriods)} />
                <Row label="Red flags" value={String(result.redFlags)} />
                <Row label="Incidents" value={String(result.incidents.length)} />
              </div>
              <button className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => void refresh()}>
                <RotateCcw size={13} /> Refresh data
              </button>
            </Panel>
          )}

          <div className="panel panel-pad text-xs text-gray-500">
            <div className="label mb-1">Simulation note</div>
            Go live to run the race in real time: radio your drivers to push, save tyres or box for fresh rubber, and watch it play out on the map.
            {mode === "supabase"
              ? " Every principal in the lobby joins the same race, commands only their own cars, and can vote to change the pace or skip ahead — the host records the initial result, which the server re-scores against the championship."
              : " Offline, every tab of this browser watching the same lobby joins the race."}{" "}
            Or use {canGoLive ? "Quick sim" : "Start race"} for an instant deterministic result. Recorded results are processed exactly once to protect points and finances.
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function WeatherBadge({ weather }: { weather: WeatherState }) {
  const tone = weather.trackWetness > 0.5 ? "bad" : weather.trackWetness > 0.1 ? "warn" : "good";
  return <Badge tone={tone}>{weather.condition.replace("-", " ")}</Badge>;
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${done ? "bg-emerald-500/20 text-emerald-400" : "bg-carbon-700 text-gray-500"}`}>{done ? "✓" : ""}</span>
      <span className={done ? "text-gray-300" : "text-gray-500"}>{label}</span>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-gray-500">{label}</span><span className="text-right font-medium text-gray-200">{value}</span></div>;
}

/** Real-time seconds one lap of the replay takes at 1x, scaled to the circuit. */
function baseReplaySeconds(referenceLapSeconds: number): number {
  return Math.min(9, Math.max(4, referenceLapSeconds / 13));
}

function ReplaySection({ result, bundle }: { result: RaceResult; bundle: ReturnType<typeof useSession>["bundle"] }) {
  const laps = result.laps;
  const circuit = getCircuit(result.circuitId);
  const lapSeconds = baseReplaySeconds(circuit.referenceLapSeconds);
  const [position, setPosition] = useState(0);
  const positionRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const setPos = (next: number) => {
    positionRef.current = next;
    setPosition(next);
  };

  useEffect(() => {
    if (!playing || laps.length === 0) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = positionRef.current + (dt * speed) / lapSeconds;
      if (next >= laps.length) {
        setPos(laps.length);
        setPlaying(false);
        return;
      }
      setPos(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, laps.length, lapSeconds]);

  // Auto-start the replay whenever a fresh race result is shown.
  const replayKey = `${result.careerId}:${result.season}:${result.raceIndex}`;
  const startedRef = useRef<string | null>(null);
  useEffect(() => {
    if (startedRef.current === replayKey) return;
    startedRef.current = replayKey;
    positionRef.current = 0;
    setPosition(0);
    setPlaying(laps.length > 0);
  }, [replayKey, laps.length]);

  const lapIndex = Math.min(laps.length - 1, Math.floor(position));
  const lapFraction = Math.min(1, position - Math.floor(position));
  const lap: LapRecord | undefined = laps[lapIndex];
  const atEnd = position >= laps.length;

  const markers: TrackMarker[] = useMemo(() => {
    if (!lap) return [];
    const leaderLap = lap.entries[0]?.lapTime ?? circuit.referenceLapSeconds;
    return lap.entries
      .filter((e) => !e.retired)
      .map((e) => {
        const d = bundle?.drivers.find((x) => x.id === e.driverId);
        const t = bundle?.teams.find((x) => x.id === d?.teamId);
        const gapFraction = leaderLap > 0 ? (e.gapToLeader / leaderLap) % 1 : 0;
        const progress = (((lapFraction - gapFraction) % 1) + 1) % 1;
        return {
          id: e.driverId,
          progress,
          color: t?.colors.primary ?? "#888",
          label: e.position <= 3 ? d?.code : undefined,
          highlight: e.position === 1,
        };
      });
  }, [lap, lapFraction, bundle, circuit.referenceLapSeconds]);

  if (laps.length === 0) return <Panel title="Race replay"><Empty title="No lap data" /></Panel>;

  const flag = lap?.entries[0]?.flag ?? "green";
  const running = lap?.entries.filter((e) => !e.retired).length ?? 0;
  const leaderboard = lap ? [...lap.entries].sort((a, b) => a.position - b.position).slice(0, 8) : [];
  const displayLap = atEnd ? laps.length : Math.min(laps.length, lapIndex + 1);

  const togglePlay = () => {
    if (atEnd || position >= laps.length) setPos(0);
    setPlaying((p) => !p);
  };

  return (
    <Panel title="Race replay" right={<Badge tone="info">Lap {displayLap} / {laps.length}</Badge>}>
      <div className="grid gap-3 md:grid-cols-[1.15fr_1fr]">
        <div className="rounded-lg border border-carbon-700 bg-carbon-900/40 p-2">
          <TrackMap circuit={circuit} markers={markers} height={230} className="w-full" />
          <div className="mt-1 flex items-center justify-center gap-2 text-[10px]">
            <span className="inline-flex items-center gap-1 text-gray-500"><span className="h-2 w-2 rounded-full" style={{ background: FLAG_COLOR[flag] }} /> {flag.replace("-", " ")}</span>
            <span className="text-gray-500">{running} cars running</span>
            <span className="text-gray-600">· {Math.round(lapFraction * 100)}% lap</span>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <button className="btn-primary py-1" onClick={togglePlay}>
              {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : atEnd ? "Replay" : "Play"}
            </button>
            <button className="btn-ghost py-1" onClick={() => { setPlaying(false); setPos(laps.length); }}>
              <FastForward size={14} /> End
            </button>
            <button className="btn-ghost py-1" onClick={() => { setPlaying(false); setPos(0); }}>
              <RotateCcw size={14} /> Start
            </button>
            <select className="input h-8 w-20 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
          <input
            type="range"
            min={0}
            max={laps.length}
            step={0.01}
            value={position}
            onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }}
            className="w-full accent-race-teal"
          />
          <div className="mt-2 space-y-1">
            {leaderboard.map((e) => {
              const d = bundle?.drivers.find((x) => x.id === e.driverId);
              const t = bundle?.teams.find((x) => x.id === d?.teamId);
              return (
                <div key={e.driverId} className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs ${e.retired ? "opacity-40" : ""}`}>
                  <span className="w-3 text-right font-mono text-gray-500">{e.position}</span>
                  <span className="h-2.5 w-1 rounded-sm" style={{ background: t?.colors.primary ?? "#666" }} />
                  <span className="flex-1 truncate text-gray-200">{d?.name}</span>
                  <span className="h-2 w-2 rounded-full" style={{ background: COMPOUND_COLOR[e.compound] }} />
                  <span className="font-mono text-[10px] text-gray-500">{e.pit ? "PIT" : e.retired ? "OUT" : e.gapToLeader < 0.001 ? "LEADER" : `+${e.gapToLeader.toFixed(1)}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ResultsSection({ result, bundle, myTeamId }: { result: RaceResult; bundle: NonNullable<ReturnType<typeof useSession>["bundle"]>; myTeamId: string | null }) {
  return (
    <Panel
      title="Race classification"
      right={
        <div className="flex items-center gap-2">
          <Badge tone="info">{result.weatherStart}</Badge>
          <Trophy size={14} className="text-amber-400" />
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="pb-2">Pos</th><th className="pb-2">Driver</th><th className="pb-2">Team</th><th className="pb-2 text-right">Grid</th>
              <th className="pb-2 text-right">Laps</th><th className="pb-2 text-right">Time / Gap</th><th className="pb-2 text-right">Best lap</th><th className="pb-2 text-right">Pits</th><th className="pb-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {result.classification.map((c) => {
              const d = bundle.drivers.find((x) => x.id === c.driverId);
              const t = bundle.teams.find((x) => x.id === c.teamId);
              const mine = c.teamId === myTeamId;
              return (
                <tr key={c.driverId} className={`border-t border-carbon-800 ${mine ? "bg-race-teal/5" : ""}`}>
                  <td className="py-1.5 font-mono text-gray-400">{c.status === "finished" ? c.position : "—"}</td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      {t && <span className="h-2.5 w-1 rounded-sm" style={{ background: t.colors.primary }} />}
                      <span className={c.status === "dnf" ? "text-gray-500" : "text-gray-100"}>{d?.name ?? c.driverId}</span>
                      {c.fastestLap && <span className="text-[9px] font-bold text-purple-400">FL</span>}
                    </div>
                  </td>
                  <td className="py-1.5 text-xs text-gray-500">{t?.shortName}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-500">{c.gridPosition}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-400">{c.laps}</td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {c.status === "finished" ? (
                      <span className={c.position === 1 ? "text-gray-100" : "text-gray-400"}>{c.position === 1 ? lapTime(c.timeSeconds) : c.gap}</span>
                    ) : (
                      <span className="text-red-400">{c.status.toUpperCase()}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-500">{lapTime(c.bestLap)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-500">{c.pits}</td>
                  <td className="py-1.5 text-right font-mono text-xs font-semibold text-gray-200">{c.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function QualifyingSection({ result, bundle, myTeamId }: { result: RaceResult; bundle: NonNullable<ReturnType<typeof useSession>["bundle"]>; myTeamId: string | null }) {
  if (result.qualifying.length === 0) return null;
  return (
    <Panel title="Qualifying" right={<Badge tone="info">Q1 · Q2 · Q3</Badge>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="pb-2">Pos</th><th className="pb-2">Driver</th><th className="pb-2">Team</th><th className="pb-2 text-right">Q1</th><th className="pb-2 text-right">Q2</th><th className="pb-2 text-right">Q3</th>
            </tr>
          </thead>
          <tbody>
            {result.qualifying.map((q) => {
              const d = bundle.drivers.find((x) => x.id === q.driverId);
              const t = bundle.teams.find((x) => x.id === q.teamId);
              return (
                <tr key={q.driverId} className={`border-t border-carbon-800 ${q.teamId === myTeamId ? "bg-race-teal/5" : ""}`}>
                  <td className="py-1.5 font-mono text-gray-400">{q.position}</td>
                  <td className="py-1.5 text-gray-100">{d?.name ?? q.driverId}</td>
                  <td className="py-1.5 text-xs text-gray-500">{t?.shortName}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-400">{lapTime(q.q1)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-400">{lapTime(q.q2)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-gray-300">{lapTime(q.q3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function IncidentsSection({ incidents, bundle }: { incidents: RaceIncident[]; bundle: NonNullable<ReturnType<typeof useSession>["bundle"]> }) {
  return (
    <Panel title="Race control & incidents" right={<Badge tone={incidents.length ? "warn" : "good"}>{incidents.length} logged</Badge>}>
      {incidents.length === 0 ? (
        <Empty title="A clean race" hint="No incidents were reported by race control." />
      ) : (
        <div className="space-y-2">
          {incidents.map((inc) => (
            <div key={inc.id} className="rounded-lg border border-carbon-700 bg-carbon-900/40 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[inc.severity]}>Lap {inc.lap}</Badge>
                <span className="text-xs font-semibold capitalize text-gray-200">{inc.kind.replace("-", " ")}</span>
                <span className="text-[11px] text-gray-500">{inc.corner}</span>
                {inc.neutralisation !== "none" && <Badge tone="warn">{inc.neutralisation.replace("-", " ")}</Badge>}
                {inc.penalty && <Badge tone="bad">{inc.penalty.type === "time" ? `+${inc.penalty.seconds}s` : inc.penalty.type.replace("-", " ")}</Badge>}
              </div>
              <p className="mt-1 text-xs text-gray-400">{inc.narrative}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                <span>Involved: {inc.involvedDriverIds.map((id) => bundle.drivers.find((d) => d.id === id)?.name ?? id).join(", ")}</span>
                <span>· Responsibility: {inc.responsibility.replace("-", " ")}</span>
                {inc.factors.length > 0 && <span>· Factors: {inc.factors.join(", ")}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export const _raceIcons = { Activity };
