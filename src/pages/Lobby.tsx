import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Circle, Copy, Crown, Pause, Play, Send, UserMinus, Wifi, WifiOff } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Panel, SectionHeading } from "../components/ui";
import { TeamBadge } from "../components/LiveryEditor";
import { getCircuit } from "../data/circuits";
import { money, timeAgo } from "../lib/format";

export function LobbyPage() {
  const { lobby, bundle, user, chat, sendChat, setReady, isHost, backend, refresh, pushToast, leaveLobby } = useSession();
  const navigate = useNavigate();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const circuit = bundle ? getCircuit(bundle.weekend.circuitId) : null;
  const required = useMemo(() => (lobby ? lobby.members.filter((m) => m.online) : []), [lobby]);
  const readyIds = bundle?.weekend.readyUserIds ?? [];
  const readyCount = required.filter((m) => readyIds.includes(m.userId)).length;
  const me = lobby?.members.find((m) => m.userId === user?.id);
  const iAmReady = !!user && readyIds.includes(user.id);

  if (!lobby || !bundle || !user) return null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("success", `${label} copied`);
    } catch {
      pushToast("error", "Clipboard unavailable");
    }
  };

  const inviteLink = `${window.location.origin}${import.meta.env.BASE_URL}?join=${lobby.inviteCode}`;

  const runHostAction = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      pushToast("success", label);
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/" className="btn-subtle text-sm">
          <ArrowLeft size={16} /> All careers
        </Link>
        <div className="flex gap-2">
          <Link to="/career/dashboard" className="btn-ghost">Open dashboard</Link>
          <button
            className="btn-subtle text-red-300"
            onClick={() => void leaveLobby().then(() => navigate("/"))}
          >
            Leave lobby
          </button>
        </div>
      </div>

      <SectionHeading
        title={lobby.name}
        subtitle={`${lobby.members.length}/${lobby.settings.maxPlayers} principals · ${lobby.settings.aiDifficulty} AI · ${lobby.settings.seasonLength} race season`}
        right={<Badge tone={lobby.paused ? "warn" : "good"}>{lobby.paused ? "Career paused" : "Career live"}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Next Grand Prix" right={circuit ? <Badge tone="info">Round {bundle.weekend.raceIndex + 1} / {bundle.season.calendar.length}</Badge> : null}>
            {circuit && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="font-display text-xl font-bold text-white">{circuit.name}</div>
                  <div className="text-sm text-gray-400">{circuit.location}, {circuit.country} · {circuit.lengthKm.toFixed(3)} km · {circuit.corners} corners</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="chip">Weather: {bundle.weekend.weather.condition}</span>
                    <span className="chip">Track {Math.round(bundle.weekend.weather.trackTempC)}°C</span>
                    <span className="chip">Session: {bundle.weekend.session}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="label">Ready to race</div>
                  <div className="font-mono text-2xl font-semibold text-race-teal">{readyCount}/{required.length}</div>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Principals" right={<span className="text-xs text-gray-500">Online status updates automatically</span>}>
            <div className="space-y-2">
              {lobby.members.map((m) => {
                const team = bundle.teams.find((t) => t.id === m.teamId) ?? null;
                const ready = readyIds.includes(m.userId);
                const online = m.online;
                return (
                  <div key={m.userId} className="flex flex-wrap items-center gap-3 rounded-lg border border-carbon-700 bg-carbon-900/50 p-2.5">
                    {online ? <Wifi size={15} className="text-emerald-400" /> : <WifiOff size={15} className="text-gray-600" />}
                    {team ? <TeamBadge team={team} size={32} /> : <span className="grid h-8 w-8 place-items-center rounded-md border border-dashed border-carbon-600 text-[10px] text-gray-500">TBD</span>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                        {m.username}
                        {m.isHost && <Crown size={13} className="text-amber-400" />}
                        {m.userId === user.id && <span className="text-[10px] text-gray-500">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-gray-500">{team ? team.name : "Team not created yet"}</div>
                    </div>
                    {team && <span className="hidden text-xs text-gray-500 sm:block">{money(team.budget, { compact: true })} budget</span>}
                    <Badge tone={ready ? "good" : "default"}>{ready ? <><Check size={11} /> Ready</> : <><Circle size={11} /> Not ready</>}</Badge>
                    {isHost && m.userId !== user.id && (
                      <div className="flex gap-1">
                        <button
                          className="btn-subtle p-1 text-xs"
                          title="Transfer host"
                          onClick={() => void runHostAction(() => backend.transferHost(lobby.id, user.id, m.userId), "Host privileges transferred")}
                          disabled={busy}
                        >
                          <Crown size={14} />
                        </button>
                        <button
                          className="btn-subtle p-1 text-xs text-red-300"
                          title="Remove member"
                          onClick={() => void runHostAction(() => backend.removeMember(lobby.id, user.id, m.userId), "Member removed")}
                          disabled={busy}
                        >
                          <UserMinus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className={iAmReady ? "btn-ghost" : "btn-primary"}
                onClick={() =>
                  void setReady(!iAmReady)
                    .then(() => pushToast("success", iAmReady ? "Readiness withdrawn" : "You are ready"))
                    .catch((e) => pushToast("error", (e as Error).message))
                }
              >
                <Check size={16} /> {iAmReady ? "Cancel ready" : "I'm ready"}
              </button>
              {isHost && (
                <>
                  <button className="btn-ghost" onClick={() => void runHostAction(() => backend.setPaused(lobby.id, user.id, !lobby.paused), lobby.paused ? "Career resumed" : "Career paused")}>
                    {lobby.paused ? <Play size={15} /> : <Pause size={15} />} {lobby.paused ? "Resume" : "Pause"}
                  </button>
                  <button className="btn-ghost" onClick={() => navigate("/career/race")}>
                    Go to race weekend
                  </button>
                </>
              )}
            </div>
          </Panel>

          <Panel
            title="Invite friends"
            right={<span className="text-xs text-gray-500">Share the code or link</span>}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-carbon-600 bg-carbon-900 px-3 py-2 font-mono text-lg tracking-[0.35em] text-race-teal">{lobby.inviteCode}</span>
              <button className="btn-ghost" onClick={() => void copy(lobby.inviteCode, "Invitation code")}><Copy size={15} /> Copy code</button>
              <button className="btn-ghost" onClick={() => void copy(inviteLink, "Invitation link")}><Copy size={15} /> Copy link</button>
            </div>
            <p className="mt-2 break-all text-xs text-gray-500">{inviteLink}</p>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Lobby chat" right={<span className="text-xs text-gray-500">{chat.length} messages</span>}>
            <div className="flex h-64 flex-col gap-2 overflow-y-auto pr-1">
              {chat.length === 0 && <div className="text-xs text-gray-500">No messages yet. Say hello.</div>}
              {chat.map((m) => (
                <div key={m.id} className={`rounded-lg px-2.5 py-1.5 text-sm ${m.userId === user.id ? "ml-8 bg-race-teal/10 text-gray-100" : "mr-8 bg-carbon-800 text-gray-200"}`}>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span className="font-semibold text-gray-300">{m.username}</span>
                    <span>{timeAgo(m.createdAt)}</span>
                  </div>
                  <div className="break-words">{m.body}</div>
                </div>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const body = msg.trim();
                if (!body) return;
                setMsg("");
                void sendChat(body).catch((err) => pushToast("error", (err as Error).message));
              }}
            >
              <input className="input" placeholder="Message the lobby…" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} />
              <button className="btn-primary shrink-0" type="submit"><Send size={16} /></button>
            </form>
          </Panel>

          <Panel title="Career settings">
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["AI difficulty", lobby.settings.aiDifficulty],
                ["Season length", `${lobby.settings.seasonLength} races`],
                ["Race distance", `${lobby.settings.raceDistancePct}%`],
                ["Starting budget", money(lobby.settings.startingBudget, { compact: true })],
                ["Incidents", lobby.settings.incidentSeverity],
                ["Mid-season joins", lobby.settings.allowMidSeasonJoin ? "Allowed" : "Closed"],
                ["Visibility", lobby.settings.isPublic ? "Public" : "Private"],
                ["Approval", lobby.settings.requireApproval ? "Host approval" : "Open"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md bg-carbon-900/60 p-2">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500">{k}</dt>
                  <dd className="font-semibold capitalize text-gray-200">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <div className="panel panel-pad text-xs text-gray-500">
            <div className="label mb-1">Connection</div>
            {me?.online ? "You are online. Your progress is saved automatically after every action." : "You appear offline."}
          </div>
        </div>
      </div>
    </div>
  );
}
