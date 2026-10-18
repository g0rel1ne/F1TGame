import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Copy, Flag, LogOut, Plus, RefreshCw, Users, WifiOff } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Modal, SectionHeading, Spinner } from "../components/ui";
import { DEFAULT_LOBBY_SETTINGS } from "../backend/types";
import type { Lobby, LobbySettings } from "../engine/types";
import { timeAgo } from "../lib/format";

export function HomePage() {
  const { user, backend, createLobby, joinLobby, openLobby, logout, pushToast } = useSession();
  const navigate = useNavigate();
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [publicLobbies, setPublicLobbies] = useState<Lobby[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, pub] = await Promise.all([backend.listMyLobbies(user.id), backend.listPublicLobbies()]);
      setLobbies(mine);
      setPublicLobbies(pub.filter((l) => !l.members.some((m) => m.userId === user.id)));
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const open = async (lobby: Lobby) => {
    await openLobby(lobby.id);
    navigate("/career/dashboard");
  };

  const doJoin = async (code: string) => {
    setBusy(true);
    try {
      const l = await joinLobby(code.trim().toUpperCase());
      await openLobby(l.id);
      navigate("/career/dashboard");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-race-red">
            <Flag size={22} />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold uppercase tracking-wide leading-none">F1 Team Principal Online</h1>
            <p className="text-sm text-gray-400">Signed in as <span className="font-semibold text-gray-200">{user.username}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => void load()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn-subtle" onClick={() => void logout().then(() => navigate("/"))}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      {backend.mode === "local" && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-carbon-600 bg-carbon-900/60 px-4 py-3 text-xs text-gray-400">
          <WifiOff size={15} className="mt-0.5 shrink-0 text-race-teal" />
          <p>
            <span className="font-semibold text-gray-200">Offline mode.</span> Careers are stored in this browser only, so an invitation code works
            for another tab in this same browser but never for another device. Set up Supabase for real online multiplayer.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div>
            <SectionHeading
              title="Your careers"
              subtitle="Persistent lobbies you are a member of."
              right={
                <button className="btn-primary" onClick={() => setShowCreate(true)}>
                  <Plus size={16} /> Create career
                </button>
              }
            />
            {loading ? (
              <Spinner />
            ) : lobbies.length === 0 ? (
              <Empty
                title="No careers yet"
                hint="Create a lobby and invite friends with a code, or join an existing career below."
                action={
                  <button className="btn-primary mt-2" onClick={() => setShowCreate(true)}>
                    <Plus size={16} /> Create your first career
                  </button>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {lobbies.map((l) => (
                  <button key={l.id} onClick={() => void open(l)} className="panel group p-4 text-left transition-colors hover:border-race-teal/50">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-display text-lg font-bold text-white">{l.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                          <span className="inline-flex items-center gap-1">
                            <Users size={13} /> {l.members.length}/{l.settings.maxPlayers}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays size={13} /> {l.settings.seasonLength} races
                          </span>
                          {l.paused && <Badge tone="warn">Paused</Badge>}
                          {l.settings.isPublic && <Badge tone="info">Public</Badge>}
                        </div>
                      </div>
                      <span className="rounded bg-carbon-900 px-2 py-1 font-mono text-[11px] text-race-teal">{l.inviteCode}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                      <span>{l.hostUserId === user.id ? "You are host" : "Member"}</span>
                      <span>Created {timeAgo(l.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="panel panel-pad">
            <h3 className="heading mb-3 text-base">Join with a code</h3>
            <div className="flex gap-2">
              <input className="input font-mono uppercase tracking-[0.3em]" placeholder="ABC12345" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} maxLength={12} />
              <button className="btn-primary shrink-0" disabled={busy || joinCode.trim().length < 4} onClick={() => void doJoin(joinCode)}>
                Join
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">Or open an invitation link shared by a host — it will load the code automatically.</p>
          </div>

          {publicLobbies.length > 0 && (
            <div>
              <SectionHeading title="Public lobbies" subtitle="Open careers looking for principals." />
              <div className="space-y-2">
                {publicLobbies.map((l) => (
                  <div key={l.id} className="panel flex items-center justify-between p-3">
                    <div>
                      <div className="font-semibold text-gray-100">{l.name}</div>
                      <div className="text-xs text-gray-500">
                        {l.members.length}/{l.settings.maxPlayers} principals · {l.settings.aiDifficulty} AI · {l.settings.seasonLength} races
                      </div>
                    </div>
                    <button className="btn-ghost" onClick={() => void doJoin(l.inviteCode)}>
                      Join
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="panel panel-pad">
            <h3 className="heading mb-2 text-base">How it works</h3>
            <ol className="space-y-2 text-sm text-gray-400">
              <li><span className="font-semibold text-gray-200">1.</span> Create or join a lobby.</li>
              <li><span className="font-semibold text-gray-200">2.</span> Build your team in the wizard.</li>
              <li><span className="font-semibold text-gray-200">3.</span> Hire drivers and develop the car.</li>
              <li><span className="font-semibold text-gray-200">4.</span> Ready up, then the host runs the race.</li>
              <li><span className="font-semibold text-gray-200">5.</span> Progress through persistent seasons.</li>
            </ol>
          </div>
          <div className="panel panel-pad text-xs text-gray-500">
            <div className="label mb-1">Data &amp; licensing</div>
            Circuit data is drawn from widely published figures; track outlines are derived from the open-source f1-circuits GeoJSON set (MIT licence) and car
            art is an original illustration. AI team names identify real competitors but use no official logos or liveries. Driver data defaults to a fictional roster.
          </div>
        </aside>
      </div>

      <CreateLobbyModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={createLobby} onCreated={(l) => open(l)} />
    </div>
  );
}

function CreateLobbyModal({
  open,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, settings: Partial<LobbySettings>) => Promise<Lobby>;
  onCreated: (l: Lobby) => Promise<void>;
}) {
  const [name, setName] = useState("My F1 Career");
  const [settings, setSettings] = useState<Partial<LobbySettings>>(DEFAULT_LOBBY_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof LobbySettings>(k: K, v: LobbySettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const summary = useMemo(() => `${settings.seasonLength} races · ${settings.raceDistancePct}% distance · ${settings.aiDifficulty} AI`, [settings]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const l = await onCreate(name.trim() || "My F1 Career", settings);
      await onCreated(l);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a career lobby"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
            <Copy size={15} /> Create lobby
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="label">Lobby name</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Max principals</span>
            <select className="input mt-1" value={settings.maxPlayers} onChange={(e) => set("maxPlayers", Number(e.target.value))}>
              {[2, 4, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Season length</span>
            <select className="input mt-1" value={settings.seasonLength} onChange={(e) => set("seasonLength", Number(e.target.value))}>
              {[6, 8, 12, 16, 21].map((n) => <option key={n} value={n}>{n} races</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">AI difficulty</span>
            <select className="input mt-1" value={settings.aiDifficulty} onChange={(e) => set("aiDifficulty", e.target.value as LobbySettings["aiDifficulty"])}>
              {["beginner", "normal", "expert", "elite"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Race distance</span>
            <select className="input mt-1" value={settings.raceDistancePct} onChange={(e) => set("raceDistancePct", Number(e.target.value))}>
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n}%</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Starting budget</span>
            <select className="input mt-1" value={settings.startingBudget} onChange={(e) => set("startingBudget", Number(e.target.value))}>
              {[75_000_000, 100_000_000, 125_000_000, 150_000_000].map((n) => <option key={n} value={n}>${n / 1e6}M</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Incident severity</span>
            <select className="input mt-1" value={settings.incidentSeverity} onChange={(e) => set("incidentSeverity", e.target.value as LobbySettings["incidentSeverity"])}>
              {["lenient", "realistic", "strict"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={settings.isPublic} onChange={(e) => set("isPublic", e.target.checked)} className="h-4 w-4 accent-race-teal" />
            Public lobby
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={settings.allowMidSeasonJoin} onChange={(e) => set("allowMidSeasonJoin", e.target.checked)} className="h-4 w-4 accent-race-teal" />
            Allow mid-season joins
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={settings.requireApproval} onChange={(e) => set("requireApproval", e.target.checked)} className="h-4 w-4 accent-race-teal" />
            Host approval
          </label>
        </div>

        <div className="rounded-lg border border-carbon-700 bg-carbon-900/60 p-3 text-xs text-gray-400">{summary}</div>
        {err && <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">{err}</div>}
      </div>
    </Modal>
  );
}
