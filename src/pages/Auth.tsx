import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, Loader2, Play, ShieldCheck } from "lucide-react";
import { useSession } from "../state/session";

const GUEST_KEY = "f1team.guest";

interface GuestCredentials {
  username: string;
  email: string;
  password: string;
}

function makeGuest(): GuestCredentials {
  const id = Math.random().toString(36).slice(2, 8);
  return {
    username: `Principal ${id.slice(0, 4).toUpperCase()}`,
    email: `guest.${id}@offline.local`,
    password: `guest-${id}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

export function AuthPage() {
  const { login, register, mode, backend } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const playOffline = async () => {
    setBusy(true);
    setErr(null);
    try {
      let guest: GuestCredentials | null = null;
      try {
        const stored = localStorage.getItem(GUEST_KEY);
        if (stored) guest = JSON.parse(stored) as GuestCredentials;
      } catch {
        guest = null;
      }
      if (guest) {
        try {
          await login(guest.email, guest.password);
          navigate("/");
          return;
        } catch {
          // The local database may have been cleared; create a fresh guest below.
        }
      }
      const fresh = makeGuest();
      await register(fresh.username, fresh.email, fresh.password);
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify(fresh));
      } catch {
        // Ignore storage failures.
      }
      navigate("/");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (tab === "register") {
        if (username.trim().length < 2) throw new Error("Choose a username of at least 2 characters.");
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        await register(username.trim(), email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      navigate("/");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col lg:flex-row">
        <div className="flex flex-1 flex-col justify-center px-6 py-12 lg:px-10">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-race-red">
              <Flag size={22} className="text-white" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold uppercase tracking-wide leading-none">F1 Team Principal</h1>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-race-teal">Online</p>
            </div>
          </div>
          <h2 className="max-w-xl font-display text-4xl font-bold leading-tight text-white sm:text-5xl">
            Build your team. Beat your friends. Win the championship.
          </h2>
          <p className="mt-4 max-w-lg text-gray-400">
            A persistent multiplayer Formula 1 management career. Hire drivers, develop the car, negotiate sponsors and take on AI versions of the
            real-world grid across authentic circuits.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="chip">Multiplayer lobbies</span>
            <span className="chip">Full race simulation</span>
            <span className="chip">Crashes &amp; safety cars</span>
            <span className="chip">Multi-season careers</span>
          </div>
          <div className="mt-8 flex items-center gap-2 text-xs text-gray-500">
            <ShieldCheck size={14} />
            Backend: <span className="font-semibold text-gray-300">{mode === "local" ? "Local IndexedDB (dev mode)" : "Supabase"}</span>
            <span className="ml-2 rounded bg-carbon-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">{backend.mode}</span>
          </div>
        </div>

        <div className="flex w-full items-center justify-center px-6 py-12 lg:w-[420px] lg:px-0">
          <form onSubmit={submit} className="panel w-full max-w-sm p-6">
            <div className="mb-4 grid grid-cols-2 rounded-lg bg-carbon-900 p-1">
              {(["login", "register"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    setErr(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${tab === t ? "bg-carbon-700 text-white" : "text-gray-400"}`}
                >
                  {t === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            {tab === "register" && (
              <label className="mb-3 block">
                <span className="label">Username</span>
                <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Team principal name" autoComplete="username" />
              </label>
            )}
            <label className="mb-3 block">
              <span className="label">Email</span>
              <input className="input mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            <label className="mb-4 block">
              <span className="label">Password</span>
              <input className="input mt-1" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={tab === "login" ? "current-password" : "new-password"} />
            </label>

            {err && <div className="mb-3 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">{err}</div>}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {tab === "login" ? "Sign in" : "Create account"}
            </button>

            {mode === "local" && (
              <>
                <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-gray-600">
                  <span className="h-px flex-1 bg-carbon-700" /> or <span className="h-px flex-1 bg-carbon-700" />
                </div>
                <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void playOffline()}>
                  <Play size={16} /> Play offline
                </button>
                <p className="mt-2 text-center text-[11px] text-gray-500">No account needed. Your career is saved in this browser.</p>
              </>
            )}

            <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-500">
              {mode === "local"
                ? "Offline mode: accounts and careers are stored in this browser only, so an invitation code works for a second tab in this same browser but not on another device. Other devices need the online (Supabase) setup."
                : "Accounts are secured by Supabase Auth. Never share your password."}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
