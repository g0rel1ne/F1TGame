import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Database, LogOut, Save, ShieldCheck, User } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Panel, SectionHeading } from "../components/ui";
import { findTeam } from "../lib/career";

export function SettingsPage() {
  const { bundle, lobby, user, myTeamId, applyAction, pushToast, mode, leaveLobby, logout } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [numberStyle, setNumberStyle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!bundle || !lobby || !user) return null;
  const team = findTeam(bundle, myTeamId);

  const currentName = name || team?.name || "";
  const currentShort = shortName || team?.shortName || "";
  const currentStyle = numberStyle || team?.numberStyle || "classic";

  const save = async () => {
    if (!team) return;
    const clash = bundle.teams.some((t) => t.id !== team.id && t.name.toLowerCase() === currentName.trim().toLowerCase());
    if (clash) {
      pushToast("error", "Another team already uses that name.");
      return;
    }
    setBusy(true);
    try {
      await applyAction({
        type: "update-team",
        teamId: team.id,
        patch: { name: currentName.trim(), shortName: currentShort.trim(), numberStyle: currentStyle },
      });
      pushToast("success", "Team identity updated");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading title="Settings" subtitle="Account, team identity and career configuration." />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Account" right={<User size={15} className="text-gray-500" />}>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between border-b border-carbon-800 pb-2"><dt className="text-gray-500">Username</dt><dd className="font-medium text-gray-200">{user.username}</dd></div>
              <div className="flex items-center justify-between border-b border-carbon-800 pb-2"><dt className="text-gray-500">Email</dt><dd className="text-gray-300">{user.email}</dd></div>
              <div className="flex items-center justify-between border-b border-carbon-800 pb-2"><dt className="text-gray-500">Backend</dt><dd><Badge tone={mode === "supabase" ? "good" : "info"}>{mode === "supabase" ? "Supabase (online)" : "Local (offline dev)"}</Badge></dd></div>
              <div className="flex items-center justify-between"><dt className="text-gray-500">Lobby</dt><dd className="text-gray-300">{lobby.name}</dd></div>
            </dl>
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost" onClick={() => void logout().then(() => navigate("/"))}><LogOut size={15} /> Sign out</button>
              <button className="btn-subtle text-red-300" onClick={() => void leaveLobby().then(() => navigate("/"))}>Leave lobby</button>
            </div>
          </Panel>

          <Panel title="Team identity" right={<ShieldCheck size={15} className="text-gray-500" />}>
            {!team ? (
              <p className="text-sm text-gray-500">No team created yet.</p>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="label">Team name</span>
                  <input className="input mt-1" value={currentName} onChange={(e) => setName(e.target.value)} maxLength={40} />
                </label>
                <label className="block">
                  <span className="label">Short name</span>
                  <input className="input mt-1" value={currentShort} onChange={(e) => setShortName(e.target.value)} maxLength={20} />
                </label>
                <label className="block">
                  <span className="label">Number style</span>
                  <select className="input mt-1" value={currentStyle} onChange={(e) => setNumberStyle(e.target.value)}>
                    {["classic", "italic", "block", "outline"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Abbreviation, nationality and engine are fixed for the season.</span>
                  <button className="btn-primary" onClick={() => void save()} disabled={busy}><Save size={15} /> Save</button>
                </div>
                <Link to="/career/team" className="btn-ghost w-full justify-center text-xs">Edit livery in the team studio</Link>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Career configuration" right={<Database size={15} className="text-gray-500" />}>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[
                ["AI difficulty", bundle.settings.aiDifficulty],
                ["Season length", `${bundle.settings.seasonLength} races`],
                ["Race distance", `${bundle.settings.raceDistancePct}%`],
                ["Incident severity", bundle.settings.incidentSeverity],
                ["Starting season", String(bundle.settings.startingSeason)],
                ["Simulation speed", `${bundle.settings.simSpeed}/10`],
                ["Max principals", String(lobby.settings.maxPlayers)],
                ["Visibility", lobby.settings.isPublic ? "Public" : "Private"],
              ].map(([k, v]) => (
                <div key={k} className="rounded bg-carbon-900/60 p-2">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500">{k}</dt>
                  <dd className="font-semibold capitalize text-gray-200">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-gray-500">Career settings are locked once the lobby exists so every principal competes under the same rules.</p>
          </Panel>

          <Panel title="Invitation" right={<Copy size={15} className="text-gray-500" />}>
            <div className="flex items-center gap-2">
              <code className="rounded-lg border border-carbon-600 bg-carbon-900 px-3 py-2 font-mono tracking-[0.3em] text-race-teal">{lobby.inviteCode}</code>
              <button
                className="btn-ghost"
                onClick={() => void navigator.clipboard.writeText(lobby.inviteCode).then(() => pushToast("success", "Code copied")).catch(() => pushToast("error", "Clipboard unavailable"))}
              >
                Copy
              </button>
            </div>
          </Panel>

          <div className="panel panel-pad text-xs leading-relaxed text-gray-500">
            <div className="label mb-1">Data, licensing &amp; assumptions</div>
            Circuit names, locations, lap lengths and corner counts are drawn from widely published sports data. Track outlines trace the real layouts using the open-source f1-circuits GeoJSON set (MIT licence); the car artwork is an original illustration. AI teams use real constructor names to identify competitors but no official logos or liveries. The default driver roster is fictional; any real person's name is flagged in data and only used where a season roster permits. Sponsor brands are fictional.
          </div>
        </div>
      </div>
    </div>
  );
}
