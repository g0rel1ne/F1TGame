import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ChevronRight, CloudRain, Crosshair, Gauge, Pause, Play, Radio, Trophy, Vote, Zap,
} from "lucide-react";
import { Badge, Panel } from "../components/ui";
import { TrackMap, type TrackMarker } from "./TrackMap";
import { LiveRace, type LiveEvent, type Pace } from "../engine/liveRace";
import { prepareRace, type CareerBundle } from "../engine/season";
import type { Compound, RaceResult } from "../engine/types";
import { getCircuit } from "../data/circuits";
import { lapTime } from "../lib/format";

const COMPOUND_COLOR: Record<Compound, string> = { soft: "#f87171", medium: "#fbbf24", hard: "#e5e7eb", intermediate: "#34d399", wet: "#38bdf8" };
const COMPOUND_LABEL: Record<Compound, string> = { soft: "Soft", medium: "Medium", hard: "Hard", intermediate: "Inter", wet: "Wet" };
const ALL_COMPOUNDS: Compound[] = ["soft", "medium", "hard", "intermediate", "wet"];
const FLAG_COLOR: Record<string, string> = { green: "#34d399", yellow: "#fbbf24", "safety-car": "#fbbf24", "virtual-safety-car": "#fbbf24", "red-flag": "#f87171", chequered: "#e5e7eb" };
const PACE_META: Record<Pace, { label: string; tone: string; hint: string }> = {
  conserve: { label: "Manage", tone: "text-amber-300", hint: "Save tyres & fuel" },
  normal: { label: "Normal", tone: "text-gray-200", hint: "Balanced pace" },
  push: { label: "Push", tone: "text-emerald-300", hint: "Attack — more risk" },
};

/**
 * Real-time seconds one simulated lap takes on screen at 1x. Derived from the
 * circuit's real lap time so a longer lap visibly takes longer, then slowed
 * down heavily — a race is something you watch, not blink through.
 */
function baseLapSeconds(referenceLapSeconds: number): number {
  return Math.min(11, Math.max(5.5, referenceLapSeconds / 11));
}

export function LiveRaceView({
  bundle,
  myTeamId,
  onFinish,
  onAbort,
}: {
  bundle: CareerBundle;
  myTeamId: string | null;
  onFinish: (result: RaceResult) => Promise<void> | void;
  onAbort: () => void;
}) {
  const engineRef = useRef<LiveRace | null>(null);
  const driversByTeam = useMemo(() => bundle.drivers.filter((d) => d.teamId === myTeamId).slice(0, 2), [bundle.drivers, myTeamId]);

  if (!engineRef.current) {
    const prep = prepareRace(bundle);
    engineRef.current = new LiveRace({
      raceId: prep.raceId,
      seed: prep.seed,
      circuit: prep.circuit,
      totalLaps: prep.totalLaps,
      ruleset: prep.ruleset,
      weatherStart: prep.weatherStart,
      entrants: prep.entrants,
      severitySetting: bundle.settings.incidentSeverity,
      controlledDriverIds: driversByTeam.map((d) => d.id),
      qualifying: prep.qualifying,
      poleDriverId: prep.poleDriverId,
    });
  }
  const engine = engineRef.current;
  const circuit = getCircuit(bundle.weekend.circuitId);
  const lapSeconds = baseLapSeconds(circuit.referenceLapSeconds);

  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [done, setDone] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [feedOpen, setFeedOpen] = useState(true);
  const [lockOn, setLockOn] = useState(false);
  const [skipVote, setSkipVote] = useState(false);

  const progRef = useRef(0);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  speedRef.current = speed;
  pausedRef.current = paused;

  useEffect(() => {
    if (paused || done) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (pausedRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      progRef.current += dt / (lapSeconds / speedRef.current);
      let stepped = false;
      while (progRef.current >= 1 && !engine.finished) {
        progRef.current -= 1;
        engine.step();
        stepped = true;
      }
      if (stepped) setTick((t) => t + 1);
      if (engine.finished) {
        progRef.current = 1;
        setProgress(1);
        setDone(true);
        return;
      }
      setProgress(progRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, speed, done, engine, lapSeconds]);

  const snapshot = useMemo(() => engine.snapshot(), [engine, tick]);
  const events = useMemo(() => engine.events, [engine, tick]);

  const lastLap = engine.laps.length > 0 ? engine.laps[engine.laps.length - 1] : null;
  const effectiveProgress = engine.finished ? 1 : progress;

  const markers: TrackMarker[] = useMemo(() => {
    const cars = snapshot.cars.filter((c) => !c.retired);
    return cars.map((c) => {
      const d = bundle.drivers.find((x) => x.id === c.driverId);
      const t = bundle.teams.find((x) => x.id === c.teamId);
      let p: number;
      if (!lastLap) {
        p = (c.position - 1) / Math.max(1, cars.length);
      } else {
        const entry = lastLap.entries.find((e) => e.driverId === c.driverId);
        const leaderLap = lastLap.entries[0]?.lapTime || circuit.referenceLapSeconds;
        const gapFraction = entry && leaderLap > 0 ? (entry.gapToLeader / leaderLap) % 1 : 0;
        p = (((effectiveProgress - gapFraction) % 1) + 1) % 1;
      }
      return {
        id: c.driverId,
        progress: p,
        color: t?.colors.primary ?? "#888",
        label: c.controlled || c.position <= 3 ? d?.code : undefined,
        highlight: c.controlled || c.position === 1,
      };
    });
  }, [snapshot, lastLap, effectiveProgress, bundle, circuit.referenceLapSeconds]);

  /** On-screen progress of the leading car you control — used to lock the camera. */
  const focusProgress = useMemo(() => {
    const controlledIds = new Set(snapshot.cars.filter((c) => c.controlled && !c.retired).map((c) => c.driverId));
    const mine = markers.find((mk) => controlledIds.has(mk.id));
    return mine?.progress ?? 0;
  }, [markers, snapshot.cars]);

  const flag = snapshot.flag;
  const runningCount = snapshot.cars.filter((c) => !c.retired).length;

  const doFinish = async () => {
    setCommitting(true);
    try {
      const out = engine.finalize();
      await onFinish(out.result);
    } finally {
      setCommitting(false);
    }
  };

  const skipToEnd = () => {
    let guard = 0;
    while (!engine.finished && guard < engine.totalLaps + 5) {
      engine.step();
      guard++;
    }
    progRef.current = 1;
    setProgress(1);
    setPaused(true);
    setDone(true);
    setSkipVote(false);
    setTick((t) => t + 1);
  };

  const winner = snapshot.cars.find((c) => c.position === 1 && !c.retired);
  const winnerDriver = winner ? bundle.drivers.find((d) => d.id === winner.driverId) : undefined;

  return (
    <Panel
      title="Race control — live"
      right={
        <div className="flex items-center gap-2">
          {!done && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Live
            </span>
          )}
          <Badge tone="info">Lap {Math.max(1, snapshot.lap)} / {snapshot.totalLaps}</Badge>
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            <span className="h-2 w-2 rounded-full" style={{ background: FLAG_COLOR[flag] }} /> {flag.replace("-", " ")}
          </span>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        {/* Map + controls */}
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl border border-carbon-700 bg-carbon-900/50 p-2">
            <TrackMap circuit={circuit} markers={markers} height={280} className="w-full" focus={lockOn && !done ? { progress: focusProgress, zoom: 2.6 } : undefined} />
            <div className="pointer-events-none absolute left-4 top-4 rounded-lg bg-carbon-950/80 px-3 py-2 backdrop-blur">
              <div className="font-display text-2xl font-bold leading-none text-white">{Math.max(1, snapshot.lap)}<span className="text-sm text-gray-500">/{snapshot.totalLaps}</span></div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Lap</div>
            </div>
            <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-1">
              <div className="rounded-lg bg-carbon-950/80 px-2.5 py-1.5 text-right backdrop-blur">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Conditions</div>
                <div className="flex items-center gap-1 text-xs capitalize text-gray-200">
                  <CloudRain size={12} className="text-sky-300" /> {snapshot.weather.condition.replace("-", " ")}
                </div>
                <div className="font-mono text-[10px] text-gray-500">{Math.round(snapshot.weather.trackTempC)}°C · {Math.round(snapshot.weather.trackWetness * 100)}% wet</div>
              </div>
              <div className="rounded-lg bg-carbon-950/80 px-2.5 py-1 text-[10px] text-gray-400 backdrop-blur">{runningCount} cars running</div>
            </div>
            {paused && !done && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="rounded-full bg-carbon-950/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-gray-200">Paused</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={() => setPaused((p) => !p)} disabled={done}>
              {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? "Resume" : "Pause"}
            </button>
            <div className="flex overflow-hidden rounded-lg border border-carbon-700">
              {[1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  disabled={done}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${speed === s ? "bg-race-teal text-carbon-950" : "text-gray-400 hover:text-gray-200"}`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <button
              className={`btn-ghost ${lockOn ? "text-race-teal" : ""}`}
              onClick={() => setLockOn((v) => !v)}
              disabled={done}
              title="Lock the camera on your car"
            >
              <Crosshair size={15} /> {lockOn ? "Unlock camera" : "Lock on my car"}
            </button>
            <button className="btn-ghost" onClick={() => setSkipVote(true)} disabled={done || skipVote}>
              <Vote size={15} /> Vote to skip
            </button>
            <button className="btn-subtle ml-auto" onClick={onAbort} disabled={committing}>
              Abandon
            </button>
          </div>

          {skipVote && !done && (
            <div className="animate-scale-in rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><Vote size={15} /> Skip the rest of the race?</div>
              <p className="mt-1 text-xs text-gray-400">
                Skipping is a decision, not a shortcut — the remaining {Math.max(0, snapshot.totalLaps - snapshot.lap)} laps would be simulated instantly. It needs your vote to proceed.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Votes 0 / 1</span>
                <button className="btn-primary py-1.5 text-xs" onClick={skipToEnd}>Cast vote &amp; skip</button>
                <button className="btn-subtle py-1.5 text-xs" onClick={() => setSkipVote(false)}>Keep racing</button>
              </div>
            </div>
          )}

          {done && (
            <div className="animate-scale-in rounded-xl border border-race-teal/40 bg-race-teal/5 p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/20 text-amber-300"><Trophy size={18} /></span>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Chequered flag</div>
                  <div className="font-display text-lg font-bold text-white">{winnerDriver?.name ?? "Winner"} wins</div>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">Results are ready to be recorded into the championship.</p>
              <button className="btn-primary mt-3" onClick={() => void doFinish()} disabled={committing}>
                {committing ? "Recording…" : <><ChevronRight size={15} /> Record results</>}
              </button>
            </div>
          )}
        </div>

        {/* Radio + feed */}
        <div className="space-y-3">
          <div className="rounded-xl border border-carbon-700 bg-carbon-900/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-200">
              <Radio size={15} className="text-race-teal" /> Team radio
            </div>
            {driversByTeam.length === 0 ? (
              <p className="text-xs text-gray-500">You have no drivers to command.</p>
            ) : (
              <div className="space-y-3">
                {snapshot.cars.filter((c) => c.controlled).map((c) => {
                  const d = driversByTeam.find((x) => x.id === c.driverId);
                  const t = bundle.teams.find((x) => x.id === c.teamId);
                  const spec = PACE_META[c.pace];
                  return (
                    <div key={c.driverId} className="rounded-lg border border-carbon-700 bg-carbon-950/40 p-2.5">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-3 w-1.5 rounded-sm" style={{ background: t?.colors.primary ?? "#666" }} />
                        <span className="flex-1 text-sm font-semibold text-gray-100">{d?.name ?? c.driverId}</span>
                        <span className="rounded bg-carbon-900 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">P{c.position}</span>
                        <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COMPOUND_COLOR[c.compound] }} /> {COMPOUND_LABEL[c.compound]} · {c.tireAge}L</span>
                      </div>
                      {c.retired ? (
                        <div className="flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={12} /> Out of the race.</div>
                      ) : (
                        <>
                          <div className="mb-1.5 flex gap-1">
                            {(["conserve", "normal", "push"] as Pace[]).map((p) => (
                              <button
                                key={p}
                                onClick={() => { engine.setCommand(c.driverId, { pace: p }); setTick((v) => v + 1); }}
                                className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${c.pace === p ? "border-race-teal bg-race-teal/15 text-race-teal" : "border-carbon-700 text-gray-400 hover:border-carbon-600 hover:text-gray-200"}`}
                                title={PACE_META[p].hint}
                              >
                                {PACE_META[p].label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {c.pit ? (
                              <span className="flex-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-center text-[11px] font-semibold text-blue-300">In this lap</span>
                            ) : (
                              <>
                                <select
                                  className="input h-8 flex-1 text-xs"
                                  defaultValue="medium"
                                  onChange={(e) => engine.setCommand(c.driverId, { pitCompound: e.target.value as Compound })}
                                  title="Tyre to fit when boxing"
                                >
                                  {ALL_COMPOUNDS.map((cp) => <option key={cp} value={cp}>{COMPOUND_LABEL[cp]}</option>)}
                                </select>
                                <button
                                  className="btn-primary py-1.5 text-xs"
                                  onClick={() => { engine.setCommand(c.driverId, { pitRequest: true }); setTick((v) => v + 1); }}
                                >
                                  Box
                                </button>
                              </>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-500">
                            <span className={spec.tone}>Pace: {spec.label}</span>
                            <span className="font-mono">
                              {c.lastLapTime ? `Last ${lapTime(c.lastLapTime)}` : "—"}
                              {c.gapAhead !== null && ` · Gap ${c.gapAhead.toFixed(1)}s`}
                            </span>
                          </div>
                          {c.damagePct > 0.05 && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400"><Gauge size={10} /> Damage {Math.round(c.damagePct * 100)}%</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-carbon-700 bg-carbon-900/50">
            <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-gray-200" onClick={() => setFeedOpen((o) => !o)}>
              <span className="flex items-center gap-2"><Zap size={15} className="text-amber-300" /> Race feed</span>
              <span className="text-[10px] text-gray-500">{events.length} updates</span>
            </button>
            {feedOpen && (
              <div className="max-h-64 space-y-1 overflow-y-auto px-3 pb-3">
                {[...events].reverse().map((e) => <FeedRow key={e.id} event={e} bundle={bundle} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order tower */}
      <div className="mt-4 overflow-hidden rounded-xl border border-carbon-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-carbon-900/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Pos</th><th className="px-3 py-2">Driver</th><th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">Gap</th><th className="px-3 py-2 text-right">Tyre</th><th className="px-3 py-2 text-right">Pits</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.cars.map((c) => {
              const d = bundle.drivers.find((x) => x.id === c.driverId);
              const t = bundle.teams.find((x) => x.id === c.teamId);
              return (
                <tr key={c.driverId} className={`border-t border-carbon-800 transition-colors ${c.controlled ? "bg-race-teal/10" : ""} ${c.retired ? "opacity-40" : ""}`}>
                  <td className="px-3 py-1.5 font-mono text-gray-400">{c.retired ? "—" : c.position}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2 text-gray-100">
                      <span className="h-2.5 w-1 rounded-sm" style={{ background: t?.colors.primary ?? "#666" }} />
                      {d?.name ?? c.driverId}
                      {c.controlled && <span className="rounded bg-race-teal/20 px-1 text-[9px] font-bold uppercase text-race-teal">You</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{t?.shortName}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-400">{c.retired ? "OUT" : c.gapAhead === null ? "LEADER" : `+${c.gapAhead.toFixed(1)}`}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: COMPOUND_COLOR[c.compound] }} />{c.tireAge}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-500">{c.pits}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function FeedRow({ event, bundle }: { event: LiveEvent; bundle: CareerBundle }) {
  const driver = event.driverId ? bundle.drivers.find((d) => d.id === event.driverId) : undefined;
  const toneClass: Record<LiveEvent["tone"], string> = { info: "text-gray-300", good: "text-emerald-300", warn: "text-amber-300", bad: "text-red-300" };
  return (
    <div className="flex items-start gap-2 rounded px-1 py-1 text-[11px] leading-snug">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: event.color ?? "#6b7280" }} />
      <span className="shrink-0 font-mono text-[10px] text-gray-600">L{event.lap}</span>
      <span className={toneClass[event.tone]}>
        {event.kind === "radio" ? <><Radio size={10} className="mr-0.5 inline text-race-teal" />{driver ? `${driver.name}: ` : ""}{event.text}</> : event.text}
      </span>
    </div>
  );
}
