import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ChevronRight, CloudRain, Crosshair, Gauge, Pause, Play, Radio, Trophy, Vote, Wifi, Zap,
} from "lucide-react";
import { Badge, Panel } from "../components/ui";
import { TrackMap, type TrackMarker } from "./TrackMap";
import { RaceTrack, type RaceTrackCar } from "./RaceTrack";
import { paintFromTeam, stylesFromTeam, DEFAULT_PAINT, DEFAULT_STYLE, type CarPaint, type CarStyle } from "./CarSvg";
import { LiveRace, type DriverCommand, type LiveEvent, type LiveSnapshot, type Pace } from "../engine/liveRace";
import { prepareRace, type CareerBundle } from "../engine/season";
import {
  baseLapSeconds,
  emptyVotes,
  lapMsFor,
  majorityNeed,
  resolveSkip,
  resolveSpeed,
  speedTally,
  type LiveBeat,
  type LiveMessage,
  type LiveSpeed,
  type LiveVotes,
} from "../engine/liveSession";
import type { Compound, RaceResult } from "../engine/types";
import type { LiveTransport } from "../backend/types";
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

export interface LiveRacePeer {
  userId: string;
  teamId: string | null;
  online: boolean;
}

export interface LiveRaceOnline {
  transport: LiveTransport;
  userId: string;
  isHost: boolean;
  peers: LiveRacePeer[];
}

export function LiveRaceView({
  bundle,
  myTeamId,
  onFinish,
  onAbort,
  online,
}: {
  bundle: CareerBundle;
  myTeamId: string | null;
  onFinish: (result: RaceResult) => Promise<void> | void;
  onAbort: () => void;
  online?: LiveRaceOnline | null;
}) {
  const isHost = !online || online.isHost;
  const circuit = getCircuit(bundle.weekend.circuitId);
  const lapSeconds = baseLapSeconds(circuit.referenceLapSeconds);
  const myDrivers = useMemo(() => bundle.drivers.filter((d) => d.teamId === myTeamId).slice(0, 2), [bundle.drivers, myTeamId]);
  const mineIds = useMemo(() => new Set(myDrivers.map((d) => d.id)), [myDrivers]);
  // Every principal's cars are "controlled" so remote radio commands are accepted;
  // the wire still checks that a sender only ever commands their own team.
  const playerDriverIds = useMemo(
    () =>
      bundle.drivers
        .filter((d) => d.teamId && bundle.teams.find((t) => t.id === d.teamId)?.ownerUserId)
        .map((d) => d.id),
    [bundle.drivers, bundle.teams],
  );
  const memberIds = useMemo(() => (online ? online.peers.filter((p) => p.online).map((p) => p.userId) : []), [online]);

  const engineRef = useRef<LiveRace | null>(null);
  if (isHost && !engineRef.current) {
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
      controlledDriverIds: playerDriverIds,
      qualifying: prep.qualifying,
      poleDriverId: prep.poleDriverId,
    });
  }
  const engine = engineRef.current;

  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<LiveSpeed>(1);
  const [done, setDone] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [feedOpen, setFeedOpen] = useState(true);
  const [lockOn, setLockOn] = useState(true);
  const [viewMode, setViewMode] = useState<"cars" | "dots">(() => (localStorage.getItem("f1team.trackView") === "dots" ? "dots" : "cars"));
  const [skipVote, setSkipVote] = useState(false);
  const [votes, setVotes] = useState<LiveVotes>(emptyVotes);
  const [beat, setBeat] = useState<LiveBeat | null>(null);
  const [beatEvents, setBeatEvents] = useState<LiveEvent[]>([]);
  const [recorded, setRecorded] = useState(false);
  const [waiting, setWaiting] = useState(!!online && !online.isHost);
  const [pending, setPending] = useState<Record<string, Partial<DriverCommand>>>({});
  const [myVote, setMyVote] = useState<LiveSpeed | null>(null);
  const [mySkip, setMySkip] = useState(false);

  const progRef = useRef(0);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const beatRef = useRef<LiveBeat | null>(null);
  const votesRef = useRef(votes);
  const seqRef = useRef(0);
  const sentEventsRef = useRef(0);
  const pendingSeqRef = useRef(-1);
  const askedRef = useRef(false);
  const startedRef = useRef(false);
  const publishRef = useRef<() => void>(() => {});
  const onAbortRef = useRef(onAbort);
  speedRef.current = speed;
  pausedRef.current = paused;
  beatRef.current = beat;
  votesRef.current = votes;
  onAbortRef.current = onAbort;

  const totalLaps = engine ? engine.totalLaps : Math.max(5, Math.round(circuit.laps * (bundle.settings.raceDistancePct / 100)));
  const emptySnapshot: LiveSnapshot = useMemo(
    () => ({ lap: 0, totalLaps, flag: "green", weather: bundle.weekend.weather, cars: [], finished: false }),
    [totalLaps, bundle.weekend.weather],
  );

  const snapshot: LiveSnapshot = useMemo(
    () => (engine ? engine.snapshot() : beat ? beat.snapshot : emptySnapshot),
    [engine, beat, emptySnapshot, tick],
  );

  const events: LiveEvent[] = useMemo(() => (engine ? engine.events : beatEvents), [engine, beatEvents, tick]);
  const finished = snapshot.finished || done;
  const effectiveSpeed: LiveSpeed = engine ? speed : (beat?.speed ?? 1);
  const viewPaused = engine ? paused : (beat?.paused ?? false);
  const liveVotes = isHost ? votes : (beat?.votes ?? emptyVotes());
  const showWaitingOverlay = !!online && !online.isHost && waiting;

  const send = useCallback(
    (message: LiveMessage) => {
      online?.transport.send(message);
    },
    [online],
  );

  /** The host streams one beat per simulated lap; guests render them as-is. */
  const publish = useCallback(() => {
    if (!engine || !online || !online.isHost) return;
    const grew = engine.events.slice(sentEventsRef.current);
    sentEventsRef.current = engine.events.length;
    seqRef.current += 1;
    send({
      t: "beat",
      beat: {
        seq: seqRef.current,
        snapshot: engine.snapshot(),
        events: grew,
        speed: speedRef.current,
        paused: pausedRef.current,
        lapMs: lapMsFor(circuit.referenceLapSeconds, speedRef.current),
        at: Date.now(),
        votes: votesRef.current,
      },
    });
  }, [engine, online, send, circuit.referenceLapSeconds]);
  publishRef.current = publish;

  // Kick the race off: the host announces the start so guests' screens open on
  // the live view before the first lap completes. A guest asks for the current
  // state straight away so it does not have to wait a whole lap for a beat.
  useEffect(() => {
    if (!online) return;
    if (online.isHost) {
      if (engine && !startedRef.current) {
        startedRef.current = true;
        send({ t: "start" });
      }
      return;
    }
    if (askedRef.current) return;
    askedRef.current = true;
    send({ t: "sync" });
  }, [engine, online, send]);

  // ---- host simulation loop ----
  useEffect(() => {
    if (!engine || !isHost) return;
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
      if (engine.finished) {
        progRef.current = 1;
        setProgress(1);
        setDone(true);
        publishRef.current();
        return;
      }
      if (stepped) {
        setTick((t) => t + 1);
        publishRef.current();
      }
      setProgress(progRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isHost, paused, done, engine, lapSeconds]);

  // ---- guest interpolation loop ----
  useEffect(() => {
    if (isHost) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        const ms = beatRef.current?.lapMs ?? lapSeconds * 1000;
        progRef.current = Math.min(1, progRef.current + (dt * 1000) / Math.max(250, ms));
      }
      setProgress(progRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isHost, lapSeconds]);

  // ---- wire ----
  useEffect(() => {
    if (!online) return;
    return online.transport.listen((message, from) => {
      if (online.isHost) {
        if (message.t === "cmd") {
          const driver = bundle.drivers.find((d) => d.id === message.driverId);
          const sender = online.peers.find((p) => p.userId === from);
          if (!driver || !sender || !sender.teamId || sender.teamId !== driver.teamId) return;
          const patch = sanitizeCommand(message.patch);
          if (Object.keys(patch).length === 0) return;
          engine?.setCommand(message.driverId, patch);
          setTick((t) => t + 1);
          publishRef.current();
        } else if (message.t === "sync") {
          // Someone just joined (or came back): push them the current state.
          publishRef.current();
        } else if (message.t === "vote") {
          setVotes((prev) => {
            const next: LiveVotes = { speed: { ...prev.speed }, skip: [...prev.skip] };
            if (message.speed) next.speed[from] = message.speed;
            if (message.skip && !next.skip.includes(from)) next.skip.push(from);
            return next;
          });
        }
        return;
      }
      if (message.t === "start") {
        setWaiting(false);
      } else if (message.t === "beat") {
        setWaiting(false);
        setBeat((prev) => (!prev || message.beat.seq > prev.seq ? message.beat : prev));
        setBeatEvents((prev) => (message.beat.events.length > 0 ? [...prev, ...message.beat.events] : prev));
        if (pendingSeqRef.current >= 0 && message.beat.seq > pendingSeqRef.current) {
          pendingSeqRef.current = -1;
          setPending({});
        }
        if (message.beat.snapshot.finished) setDone(true);
      } else if (message.t === "end") {
        setRecorded(true);
        setDone(true);
      } else if (message.t === "abort") {
        onAbortRef.current();
      }
    });
  }, [online, engine, bundle.drivers]);

  // Keep guests in step when the host pauses or changes speed between laps.
  useEffect(() => {
    if (!online || !online.isHost) return;
    publishRef.current();
  }, [paused, speed, online]);

  // A guest that hears nothing for a long time should say so rather than spin.
  useEffect(() => {
    if (isHost || !online) return;
    const timer = setInterval(() => {
      const current = beatRef.current;
      if (!current) return;
      const silence = Date.now() - current.at;
      setWaiting(silence > Math.max(6000, current.lapMs * 8));
    }, 1000);
    return () => clearInterval(timer);
  }, [isHost, online]);

  // Host applies a majority vote.
  useEffect(() => {
    if (!online || !online.isHost || memberIds.length === 0) return;
    const agreed = resolveSpeed(votes.speed, memberIds);
    if (agreed !== null && agreed !== speedRef.current) {
      setSpeed(agreed);
      setPaused(false);
      setVotes((prev) => ({ speed: {}, skip: prev.skip }));
      publishRef.current();
    }
    if (resolveSkip(votes.skip, memberIds)) {
      setVotes(emptyVotes());
      skipToEnd();
    }
  }, [votes, online, memberIds]);

  const effProgress = finished ? 1 : progress;

  const markers: TrackMarker[] = useMemo(() => {
    const cars = snapshot.cars.filter((c) => !c.retired);
    const lapLength = circuit.referenceLapSeconds || 90;
    return cars.map((c) => {
      const d = bundle.drivers.find((x) => x.id === c.driverId);
      const t = bundle.teams.find((x) => x.id === c.teamId);
      const gapFraction = c.gapToLeader > 0 ? (c.gapToLeader / lapLength) % 1 : 0;
      const p = (((effProgress - gapFraction) % 1) + 1) % 1;
      const mine = mineIds.has(c.driverId);
      return {
        id: c.driverId,
        progress: p,
        color: t?.colors.primary ?? "#888",
        label: mine || c.position <= 3 ? d?.code : undefined,
        highlight: mine || c.position === 1,
      };
    });
  }, [snapshot.cars, effProgress, bundle.drivers, bundle.teams, mineIds, circuit.referenceLapSeconds]);

  /** On-screen progress of the leading car you control — used to lock the camera.
   *  If you field no cars (or have none running), follow the race leader instead. */
  const focusProgress = useMemo(() => {
    const mine = markers.find((mk) => mineIds.has(mk.id));
    if (mine) return mine.progress;
    const lead = markers.find((mk) => mk.highlight) ?? markers[0];
    return lead?.progress ?? 0;
  }, [markers, mineIds]);
  const lockCamera = lockOn && !finished && markers.length > 0;

  const teamPaint = useMemo(() => {
    const map = new Map<string, CarPaint>();
    for (const t of bundle.teams) map.set(t.id, paintFromTeam(t));
    return map;
  }, [bundle.teams]);

  const teamStyle = useMemo(() => {
    const map = new Map<string, CarStyle>();
    for (const t of bundle.teams) map.set(t.id, stylesFromTeam(t));
    return map;
  }, [bundle.teams]);

  const pitBoxColors = useMemo(() => bundle.teams.map((t) => t.colors.primary), [bundle.teams]);

  const trackCars: RaceTrackCar[] = useMemo(() => {
    const lapLength = circuit.referenceLapSeconds || 90;
    return snapshot.cars
      .filter((c) => !c.retired)
      .map((c) => {
        const d = bundle.drivers.find((x) => x.id === c.driverId);
        const t = bundle.teams.find((x) => x.id === c.teamId);
        const gapFraction = c.gapToLeader > 0 ? (c.gapToLeader / lapLength) % 1 : 0;
        const p = (((effProgress - gapFraction) % 1) + 1) % 1;
        const mine = mineIds.has(c.driverId);
        return {
          id: c.driverId,
          progress: p,
          color: t?.colors.primary ?? "#888",
          paint: teamPaint.get(c.teamId) ?? DEFAULT_PAINT,
          style: teamStyle.get(c.teamId) ?? DEFAULT_STYLE,
          code: mine || c.position <= 3 ? d?.code : undefined,
          highlight: mine || c.position === 1,
          pit: !!c.pit,
          lane: c.position % 2 === 0 ? -0.62 : 0.62,
        };
      });
  }, [snapshot.cars, effProgress, bundle.drivers, bundle.teams, mineIds, circuit.referenceLapSeconds, teamPaint, teamStyle]);

  useEffect(() => {
    localStorage.setItem("f1team.trackView", viewMode);
  }, [viewMode]);

  const flag = snapshot.flag;
  const runningCount = snapshot.cars.filter((c) => !c.retired).length;

  const doFinish = async () => {
    if (!engine) return;
    setCommitting(true);
    try {
      const out = engine.finalize();
      send({ t: "end", result: out.result });
      await onFinish(out.result);
    } finally {
      setCommitting(false);
    }
  };

  const skipToEnd = () => {
    if (!engine) return;
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
    publishRef.current();
  };

  const setSpeedDirect = (next: LiveSpeed) => {
    setSpeed(next);
    setPaused(false);
    setVotes({ speed: online ? { [online.userId]: next } : {}, skip: [] });
  };

  const castSpeedVote = (next: LiveSpeed) => {
    if (!online) return setSpeedDirect(next);
    setMyVote(next);
    send({ t: "vote", speed: next });
  };

  const castSkipVote = () => {
    if (!online) return skipToEnd();
    setMySkip(true);
    if (online.isHost) {
      setVotes((prev) => (prev.skip.includes(online.userId) ? prev : { ...prev, skip: [...prev.skip, online.userId] }));
      return;
    }
    send({ t: "vote", skip: true });
  };

  const setCommand = (driverId: string, patch: Partial<DriverCommand>) => {
    if (!mineIds.has(driverId)) return;
    if (isHost) {
      engine?.setCommand(driverId, patch);
      setTick((t) => t + 1);
      publishRef.current();
      return;
    }
    setPending((prev) => ({ ...prev, [driverId]: { ...prev[driverId], ...patch } }));
    pendingSeqRef.current = beatRef.current?.seq ?? 0;
    send({ t: "cmd", driverId, patch });
  };

  const driverPatches = (driverId: string): Partial<DriverCommand> => (isHost ? {} : pending[driverId] ?? {});
  const myCars = snapshot.cars.filter((c) => mineIds.has(c.driverId));
  const skipNeed = majorityNeed(Math.max(1, memberIds.length));
  const skipCount = liveVotes.skip.filter((id) => memberIds.length === 0 || memberIds.includes(id)).length;
  const tally = speedTally(liveVotes.speed, memberIds.length === 0 ? (online ? [online.userId] : []) : memberIds);
  const winning = snapshot.cars.find((c) => c.position === 1 && !c.retired);
  const winnerDriver = winning ? bundle.drivers.find((d) => d.id === winning.driverId) : undefined;

  const abandon = () => {
    if (isHost && online) send({ t: "abort" });
    onAbort();
  };

  return (
    <Panel
      title="Race control — live"
      right={
        <div className="flex items-center gap-2">
          {!finished && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Live
            </span>
          )}
          {online && !online.isHost && (
            <span className="inline-flex items-center gap-1 rounded-full bg-carbon-800 px-2 py-0.5 text-[10px] text-gray-400">
              <Wifi size={11} /> Host: {online.peers.find((p) => p.userId !== online.userId && p.online)?.userId.slice(0, 6) ?? "online"}
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
            {viewMode === "cars" ? (
              <RaceTrack
                circuit={circuit}
                cars={trackCars}
                pitBoxColors={pitBoxColors}
                height={280}
                className="w-full"
                camera={lockCamera ? { progress: focusProgress, zoom: 5.2 } : undefined}
              />
            ) : (
              <TrackMap circuit={circuit} markers={markers} height={280} className="w-full" />
            )}
            <div className="absolute bottom-3 left-4 z-10">
              <button
                className="rounded-lg border border-carbon-700 bg-carbon-950/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300 backdrop-blur hover:text-white"
                onClick={() => setViewMode((m) => (m === "cars" ? "dots" : "cars"))}
                title="Switch between the detailed car view and the classic dots view"
              >
                {viewMode === "cars" ? "View: Cars" : "View: Dots"}
              </button>
            </div>
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
            {viewPaused && !finished && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="rounded-full bg-carbon-950/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-gray-200">Paused</span>
              </div>
            )}
            {showWaitingOverlay && (
              <div className="absolute inset-0 grid place-items-center bg-carbon-950/70">
                <span className="text-xs font-semibold uppercase tracking-widest text-amber-300">Waiting for the host…</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={() => setPaused((p) => !p)} disabled={finished || !isHost} title={isHost ? undefined : "Only the host controls the clock"}>
              {(isHost ? paused : viewPaused) ? <Play size={15} /> : <Pause size={15} />} {(isHost ? paused : viewPaused) ? "Resume" : "Pause"}
            </button>
            <div className="flex overflow-hidden rounded-lg border border-carbon-700">
              {([1, 2, 4] as LiveSpeed[]).map((s) => (
                <button
                  key={s}
                  onClick={() => (isHost ? setSpeedDirect(s) : castSpeedVote(s))}
                  disabled={finished}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${effectiveSpeed === s ? "bg-race-teal text-carbon-950" : myVote === s ? "bg-race-teal/25 text-race-teal" : "text-gray-400 hover:text-gray-200"}`}
                  title={isHost ? `Set speed to ${s}x` : `Vote for ${s}x`}
                >
                  {s}×{!isHost && tally[s] > 0 && <span className="ml-1 text-[9px] opacity-80">{tally[s]}</span>}
                </button>
              ))}
            </div>
            {viewMode === "cars" && (
              <button
                className={`btn-ghost ${lockOn ? "text-race-teal" : ""}`}
                onClick={() => setLockOn((v) => !v)}
                disabled={finished}
                title="Lock the camera on your car"
              >
                <Crosshair size={15} /> {lockOn ? "Unlock camera" : "Lock on my car"}
              </button>
            )}
            <button className="btn-ghost" onClick={() => setSkipVote(true)} disabled={finished || skipVote || mySkip}>
              <Vote size={15} /> Vote to skip
            </button>
            <button className="btn-subtle ml-auto" onClick={abandon} disabled={committing}>
              {isHost ? "Abandon" : "Leave race"}
            </button>
          </div>

          {skipVote && !finished && (
            <div className="animate-scale-in rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><Vote size={15} /> Skip the rest of the race?</div>
              <p className="mt-1 text-xs text-gray-400">
                Skipping is a decision, not a shortcut — the remaining {Math.max(0, snapshot.totalLaps - snapshot.lap)} laps would be simulated instantly.
                {memberIds.length > 1 ? " It needs a majority of the lobby to agree." : ""}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Votes {skipCount} / {skipNeed}</span>
                <button className="btn-primary py-1.5 text-xs" onClick={castSkipVote} disabled={mySkip && online != null}>
                  {mySkip && online ? "Vote cast" : "Cast skip vote"}
                </button>
                <button className="btn-subtle py-1.5 text-xs" onClick={() => setSkipVote(false)}>Keep racing</button>
              </div>
            </div>
          )}

          {finished && (
            <div className="animate-scale-in rounded-xl border border-race-teal/40 bg-race-teal/5 p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/20 text-amber-300"><Trophy size={18} /></span>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Chequered flag</div>
                  <div className="font-display text-lg font-bold text-white">{winnerDriver?.name ?? "Winner"} wins</div>
                </div>
              </div>
              {isHost ? (
                <>
                  <p className="mt-2 text-xs text-gray-400">Results are ready to be recorded into the championship.</p>
                  <button className="btn-primary mt-3" onClick={() => void doFinish()} disabled={committing}>
                    {committing ? "Recording…" : <><ChevronRight size={15} /> Record results</>}
                  </button>
                </>
              ) : (
                <p className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                  {recorded ? "The host is recording the results — the championship is updating." : "Waiting for the host to record the results…"}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Radio + feed */}
        <div className="space-y-3">
          <div className="rounded-xl border border-carbon-700 bg-carbon-900/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-200">
              <Radio size={15} className="text-race-teal" /> Team radio
            </div>
            {myDrivers.length === 0 ? (
              <p className="text-xs text-gray-500">You have no drivers to command.</p>
            ) : myCars.length === 0 ? (
              <p className="text-xs text-gray-500">Waiting for race data…</p>
            ) : (
              <div className="space-y-3">
                {myCars.map((c) => {
                  const d = myDrivers.find((x) => x.id === c.driverId);
                  const t = bundle.teams.find((x) => x.id === c.teamId);
                  const patch = driverPatches(c.driverId);
                  const pace = patch.pace ?? c.pace;
                  const specc = PACE_META[pace];
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
                                onClick={() => setCommand(c.driverId, { pace: p })}
                                className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${pace === p ? "border-race-teal bg-race-teal/15 text-race-teal" : "border-carbon-700 text-gray-400 hover:border-carbon-600 hover:text-gray-200"}`}
                                title={PACE_META[p].hint}
                              >
                                {PACE_META[p].label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {c.pit ? (
                              <span className="flex-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-center text-[11px] font-semibold text-blue-300">In this lap</span>
                            ) : (patch.pitRequest ?? c.pitRequest) ? (
                              <>
                                <span className="flex-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-center text-[11px] font-semibold text-blue-300">
                                  Box this lap · {COMPOUND_LABEL[patch.pitCompound ?? c.pitCompound ?? "medium"]}
                                </span>
                                <button className="btn-subtle py-1.5 text-xs" onClick={() => setCommand(c.driverId, { pitRequest: false })}>
                                  Stay out
                                </button>
                              </>
                            ) : (
                              <>
                                <select
                                  className="input h-8 flex-1 text-xs"
                                  value={patch.pitCompound ?? "medium"}
                                  onChange={(e) => setCommand(c.driverId, { pitCompound: e.target.value as Compound })}
                                  title="Tyre to fit when boxing"
                                >
                                  {ALL_COMPOUNDS.map((cp) => <option key={cp} value={cp}>{COMPOUND_LABEL[cp]}</option>)}
                                </select>
                                <button className="btn-primary py-1.5 text-xs" onClick={() => setCommand(c.driverId, { pitRequest: true })}>
                                  Box
                                </button>
                              </>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-500">
                            <span className={specc.tone}>Pace: {specc.label}</span>
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
      <div className="mt-4 max-h-96 overflow-y-auto rounded-xl border border-carbon-700">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-carbon-900 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Pos</th><th className="px-3 py-2">Driver</th><th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">Gap</th><th className="px-3 py-2 text-right">Tyre</th><th className="px-3 py-2 text-right">Pits</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.cars.map((c) => {
              const d = bundle.drivers.find((x) => x.id === c.driverId);
              const t = bundle.teams.find((x) => x.id === c.teamId);
              const mine = mineIds.has(c.driverId);
              return (
                <tr key={c.driverId} className={`border-t border-carbon-800 transition-colors ${mine ? "bg-race-teal/10" : ""} ${c.retired ? "opacity-40" : ""}`}>
                  <td className="px-3 py-1.5 font-mono text-gray-400">{c.retired ? "—" : c.position}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2 text-gray-100">
                      <span className="h-2.5 w-1 rounded-sm" style={{ background: t?.colors.primary ?? "#666" }} />
                      {d?.name ?? c.driverId}
                      {mine && <span className="rounded bg-race-teal/20 px-1 text-[9px] font-bold uppercase text-race-teal">You</span>}
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

/** Only a tiny, well-understood set of fields may be set remotely. */
function sanitizeCommand(patch: Partial<DriverCommand>): Partial<DriverCommand> {
  const out: Partial<DriverCommand> = {};
  if (patch.pace === "conserve" || patch.pace === "normal" || patch.pace === "push") out.pace = patch.pace;
  if (patch.pitCompound && ALL_COMPOUNDS.includes(patch.pitCompound)) out.pitCompound = patch.pitCompound;
  if (typeof patch.pitRequest === "boolean") out.pitRequest = patch.pitRequest;
  return out;
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
