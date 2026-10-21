import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3, Bell, CalendarDays, Car, ChevronRight, CircleDollarSign, Factory, Flag, Gauge,
  History, LayoutDashboard, LogOut, Menu, Settings, Shield, Trophy, Users, Wrench, X, Handshake, UserCog,
} from "lucide-react";
import { useSession } from "../state/session";
import { TeamBadge } from "./LiveryEditor";
import { Badge } from "./ui";
import { timeAgo } from "../lib/format";

const NAV = [
  { to: "/career/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/career/team", label: "My Team", icon: Shield },
  { to: "/career/drivers", label: "Drivers", icon: Users },
  { to: "/career/garage", label: "Car Setup", icon: Car },
  { to: "/career/development", label: "Car Development", icon: Wrench },
  { to: "/career/staff", label: "Staff", icon: UserCog },
  { to: "/career/facilities", label: "Facilities", icon: Factory },
  { to: "/career/finance", label: "Finance", icon: CircleDollarSign },
  { to: "/career/sponsors", label: "Sponsors", icon: Handshake },
  { to: "/career/race", label: "Race Weekend", icon: Flag },
  { to: "/career/championship", label: "Championship", icon: Trophy },
  { to: "/career/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/career/statistics", label: "Statistics", icon: BarChart3 },
  { to: "/career/history", label: "Career History", icon: History },
  { to: "/career/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { lobby, bundle, user, logout, myTeamId, pushToast, liveTransport, isHost } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const pathRef = useRef(location.pathname);
  const joinedSessionRef = useRef<string | null>(null);
  pathRef.current = location.pathname;

  // A guest can be anywhere in the career when the host goes live. Take them to
  // the shared race once per session instead of depending on them already
  // sitting on Race Weekend.
  useEffect(() => {
    if (!liveTransport || isHost) return;
    // Discover a race that is already running (or paused) when this page loads.
    liveTransport.send({ t: "sync" });
    return liveTransport.listen((message, from) => {
      if (!lobby?.hostUserId || from !== lobby.hostUserId) return;
      const sessionId =
        message.t === "start" ? message.session.sessionId : message.t === "beat" ? message.beat.sessionId : null;
      if (!sessionId) return;
      if (pathRef.current === "/career/race") {
        joinedSessionRef.current = sessionId;
        return;
      }
      if (joinedSessionRef.current === sessionId) return;
      joinedSessionRef.current = sessionId;
      navigate("/career/race");
    });
  }, [liveTransport, isHost, lobby?.hostUserId, navigate]);

  const team = bundle?.teams.find((t) => t.id === myTeamId) ?? null;
  const news = useMemo(() => (bundle ? [...bundle.news].reverse().slice(0, 12) : []), [bundle]);
  const readKey = bundle ? `f1tp.read.${bundle.career.id}` : "";
  const [readIds, setReadIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(readKey) || "[]");
    } catch {
      return [];
    }
  });
  const unread = news.filter((n) => !readIds.includes(n.id)).length;

  useEffect(() => {
    if (!readKey) {
      setReadIds([]);
      return;
    }
    try {
      setReadIds(JSON.parse(localStorage.getItem(readKey) || "[]"));
    } catch {
      setReadIds([]);
    }
  }, [readKey]);

  const markRead = () => {
    const ids = news.map((n) => n.id);
    setReadIds(ids);
    try {
      localStorage.setItem(readKey, JSON.stringify(ids));
    } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-carbon-700 bg-carbon-950/95 backdrop-blur transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <button onClick={() => navigate("/")} className="flex items-center gap-3 border-b border-carbon-700 px-4 py-4 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-race-red"><Flag size={18} /></span>
            <div>
              <div className="font-display text-sm font-bold uppercase leading-none tracking-wide">Team Principal</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-race-teal">Online</div>
            </div>
          </button>

          <div className="px-3 py-3">
            <div className="rounded-lg border border-carbon-700 bg-carbon-900/70 p-2.5">
              <div className="flex items-center gap-2">
                {team ? <TeamBadge team={team} size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-md border border-dashed border-carbon-600 text-[9px] text-gray-500">TBD</span>}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-100">{team?.shortName ?? "No team yet"}</div>
                  <div className="truncate text-[10px] text-gray-500">{lobby?.name}</div>
                </div>
              </div>
              {bundle && (
                <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
                  <span>Season {bundle.season.number}</span>
                  <span>Rd {bundle.season.currentRaceIndex + 1}/{bundle.season.calendar.length}</span>
                </div>
              )}
            </div>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
            {NAV.map((item) => {
              const active = location.pathname === item.to;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-carbon-800 text-white" : "text-gray-400 hover:bg-carbon-900 hover:text-gray-200"
                  }`}
                >
                  <item.icon size={16} className={active ? "text-race-teal" : ""} />
                  {item.label}
                  {active && <ChevronRight size={14} className="ml-auto text-race-teal" />}
                </NavLink>
              );
            })}
            <NavLink
              to={lobby ? `/lobby/${lobby.id}` : "/"}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-carbon-900 hover:text-gray-200"
            >
              <Users size={16} /> Lobby
            </NavLink>
          </nav>

          <div className="border-t border-carbon-700 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
              <span className="truncate">{user?.username}</span>
              <button className="btn-subtle p-1" onClick={() => void logout().then(() => navigate("/"))} title="Sign out"><LogOut size={15} /></button>
            </div>
            <div className="text-[10px] text-gray-600">Form data &amp; saves are stored in the lobby career.</div>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-carbon-700 bg-carbon-950/80 px-4 py-2.5 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2">
            <button className="btn-subtle p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu size={18} /></button>
            <div className="hidden items-center gap-2 text-xs text-gray-500 sm:flex">
              <Gauge size={14} className="text-race-teal" />
              {bundle ? `${bundle.season.calendar.length} rounds · ${bundle.teams.length} teams · ${bundle.drivers.filter((d) => d.teamId).length} drivers` : "Career"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {bundle?.career.phase === "off-season" && <Badge tone="warn">Off-season</Badge>}
            <div className="relative">
              <button className="btn-subtle relative p-2" onClick={() => setBell((b) => !b)} aria-label="Notifications">
                <Bell size={18} />
                {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-race-red px-1 text-[9px] font-bold text-white">{unread}</span>}
              </button>
              {bell && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setBell(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-carbon-700 bg-carbon-850 shadow-xl">
                    <div className="flex items-center justify-between border-b border-carbon-700 px-3 py-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-300">Notifications</span>
                      <button className="text-[11px] text-race-teal hover:underline" onClick={markRead}>Mark all read</button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {news.length === 0 && <div className="px-3 py-6 text-center text-xs text-gray-500">No notifications yet.</div>}
                      {news.map((n) => (
                        <div key={n.id} className={`border-b border-carbon-800 px-3 py-2 ${readIds.includes(n.id) ? "opacity-60" : ""}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-200">{n.title}</span>
                            <span className="shrink-0 text-[10px] text-gray-500">{timeAgo(n.createdAt)}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button className="btn-ghost hidden sm:inline-flex" onClick={() => { navigate("/career/race"); pushToast("info", "Race weekend centre open"); }}>
              <Flag size={15} /> Race Weekend
            </button>
          </div>
        </header>

        <main className="px-4 py-5 lg:px-6">
          <div key={location.pathname} className="animate-slide-up">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
      <X size={16} className="mt-0.5" /> {message}
    </div>
  );
}
