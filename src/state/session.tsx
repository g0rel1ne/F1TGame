import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createBackend, type Backend, type AuthUser, type CareerAction, type CareerActionExtra } from "../backend";
import type { CareerBundle } from "../engine/season";
import type { ChatMessage, Lobby, RaceResult } from "../engine/types";
import type { ContractOffer, NegotiationResult } from "../engine/drivermarket";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
}

interface SessionValue {
  backend: Backend;
  user: AuthUser | null;
  lobby: Lobby | null;
  bundle: CareerBundle | null;
  chat: ChatMessage[];
  loading: boolean;
  error: string | null;
  toasts: Toast[];
  mode: Backend["mode"];

  register(username: string, email: string, password: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;

  createLobby(name: string, settings: Partial<import("../engine/types").LobbySettings>): Promise<Lobby>;
  joinLobby(code: string): Promise<Lobby>;
  openLobby(lobbyId: string): Promise<void>;
  closeLobby(): void;

  refresh(): Promise<void>;
  applyAction(action: CareerAction): Promise<CareerActionExtra>;
  startRace(): Promise<RaceResult>;
  commitRace(result: RaceResult): Promise<void>;
  negotiate(driverId: string, teamId: string, offer: ContractOffer): Promise<NegotiationResult>;
  setReady(ready: boolean): Promise<void>;
  sendChat(body: string): Promise<void>;
  leaveLobby(): Promise<void>;

  pushToast(kind: Toast["kind"], message: string): void;
  myTeamId: string | null;
  isHost: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

const ACTIVE_LOBBY_KEY = "f1team.activeLobby";

function readStoredLobby(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LOBBY_KEY);
  } catch {
    return null;
  }
}

function storeLobby(lobbyId: string | null): void {
  try {
    if (lobbyId) localStorage.setItem(ACTIVE_LOBBY_KEY, lobbyId);
    else localStorage.removeItem(ACTIVE_LOBBY_KEY);
  } catch {
    // Storage can be unavailable in private browsing; the app still works for this tab.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => createBackend(), []);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [bundle, setBundle] = useState<CareerBundle | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lobbyIdRef = useRef<string | null>(null);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    (async () => {
      const current = await backend.auth.current();
      setUser(current);
      const storedLobbyId = current ? readStoredLobby() : null;
      if (current && storedLobbyId) {
        lobbyIdRef.current = storedLobbyId;
        try {
          const [l, b] = await Promise.all([backend.getLobby(storedLobbyId), backend.getBundle(storedLobbyId)]);
          if (!l || !l.members.some((m) => m.userId === current.id)) {
            lobbyIdRef.current = null;
            storeLobby(null);
          } else {
            setLobby(l);
            setBundle(b);
            setChat(await backend.listChat(storedLobbyId));
          }
        } catch {
          lobbyIdRef.current = null;
          storeLobby(null);
        }
      } else if (storedLobbyId) {
        storeLobby(null);
      }
      setLoading(false);
    })();
  }, [backend]);

  const refresh = useCallback(async () => {
    const id = lobbyIdRef.current;
    if (!id) return;
    try {
      const [l, b] = await Promise.all([backend.getLobby(id), backend.getBundle(id)]);
      setLobby(l);
      setBundle(b);
      setChat(await backend.listChat(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backend]);

  // Realtime subscription for the open lobby.
  useEffect(() => {
    const id = lobby?.id;
    if (!id) return;
    const unsub = backend.subscribeLobby(id, () => {
      void refresh();
    });
    return unsub;
  }, [lobby?.id, backend, refresh]);

  // Presence heartbeat.
  useEffect(() => {
    const id = lobby?.id;
    if (!id || !user) return;
    void backend.heartbeat(id, user.id, true);
    const interval = setInterval(() => void backend.heartbeat(id, user.id, true), 15000);
    return () => {
      clearInterval(interval);
      void backend.heartbeat(id, user.id, false);
    };
  }, [lobby?.id, user, backend]);

  const openLobby = useCallback(
    async (lobbyId: string) => {
      lobbyIdRef.current = lobbyId;
      storeLobby(lobbyId);
      setLoading(true);
      try {
        await refresh();
      } catch (e) {
        lobbyIdRef.current = null;
        storeLobby(null);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const closeLobby = useCallback(() => {
    lobbyIdRef.current = null;
    storeLobby(null);
    setLobby(null);
    setBundle(null);
    setChat([]);
  }, []);

  const value: SessionValue = {
    backend,
    user,
    lobby,
    bundle,
    chat,
    loading,
    error,
    toasts,
    mode: backend.mode,

    register: async (username, email, password) => {
      const u = await backend.auth.register(username, email, password);
      setUser(u);
    },
    login: async (email, password) => {
      const u = await backend.auth.login(email, password);
      setUser(u);
    },
    logout: async () => {
      await backend.auth.logout();
      setUser(null);
      closeLobby();
    },

    createLobby: async (name, settings) => {
      if (!user) throw new Error("Not signed in.");
      const l = await backend.createLobby(user.id, user.username, name, settings);
      await openLobby(l.id);
      return l;
    },
    joinLobby: async (code) => {
      if (!user) throw new Error("Not signed in.");
      const l = await backend.joinLobby(user.id, user.username, code);
      await openLobby(l.id);
      return l;
    },
    openLobby,
    closeLobby,
    refresh,

    applyAction: async (action) => {
      if (!user || !lobby) throw new Error("No active lobby.");
      const res = await backend.applyAction(lobby.id, user.id, action);
      setBundle(res.bundle);
      await refresh();
      return res.extra;
    },
    startRace: async () => {
      if (!user || !lobby) throw new Error("No active lobby.");
      const res = await backend.startRace(lobby.id, user.id);
      setBundle(res.bundle);
      await refresh();
      return res.result;
    },
    commitRace: async (result) => {
      if (!user || !lobby) throw new Error("No active lobby.");
      const res = await backend.commitRace(lobby.id, user.id, result);
      setBundle(res.bundle);
      await refresh();
    },
    negotiate: async (driverId, teamId, offer) => {
      if (!user || !lobby) throw new Error("No active lobby.");
      return backend.negotiate(lobby.id, user.id, driverId, teamId, offer);
    },
    setReady: async (ready) => {
      if (!user || !lobby) throw new Error("No active lobby.");
      await backend.setReady(lobby.id, user.id, ready);
      await refresh();
    },
    sendChat: async (body) => {
      if (!user || !lobby) throw new Error("No active lobby.");
      await backend.sendChat(lobby.id, user.id, user.username, body);
      await refresh();
    },
    leaveLobby: async () => {
      if (!user || !lobby) return;
      await backend.leaveLobby(lobby.id, user.id);
      closeLobby();
    },

    pushToast,
    myTeamId: lobby && user ? (lobby.members.find((m) => m.userId === user.id)?.teamId ?? null) : null,
    isHost: !!lobby && !!user && lobby.hostUserId === user.id,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
