/**
 * Supabase backend (production path).
 *
 * Uses Supabase Auth for accounts, Postgres tables for lobbies / membership /
 * chat / careers, Supabase Realtime for lobby synchronisation, and an Edge
 * Function (`apply-action`) for authoritative, server-side career mutations.
 *
 * The Edge Function imports the SAME engine as this app (`src/engine`), so all
 * game-changing logic — race simulation, finance, contracts, points — runs on
 * the server. The client sends an action, never results, balances or points.
 *
 * Configure with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. See README.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Backend, CareerAction, CareerActionExtra, AuthUser, LiveTransport } from "./types";
import { DEFAULT_LOBBY_SETTINGS, settingsFromLobby } from "./types";
import type { ChatMessage, Lobby, LobbySettings, RaceResult } from "../engine/types";
import type { CareerBundle } from "../engine/season";
import type { ContractOffer, NegotiationResult } from "../engine/drivermarket";
import { createCareerBundle } from "../engine/season";
import type { LiveMessage } from "../engine/liveSession";

interface LobbyRow {
  id: string;
  name: string;
  invite_code: string;
  host_user_id: string;
  settings: LobbySettings;
  career_id: string;
  created_at: string;
  paused: boolean;
}

interface MemberRow {
  lobby_id: string;
  user_id: string;
  username: string;
  team_id: string | null;
  is_host: boolean;
  online: boolean;
  last_seen: string;
}

export class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  private client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, { auth: { persistSession: true } });
  }

  auth = {
    register: async (username: string, email: string, password: string): Promise<AuthUser> => {
      const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { username } } });
      if (error) throw new Error(error.message);
      if (!data.user) throw new Error("Registration failed.");
      return { id: data.user.id, username, email };
    },
    login: async (email: string, password: string): Promise<AuthUser> => {
      const { data, error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const user = data.user;
      return { id: user.id, username: (user.user_metadata?.username as string) ?? user.email ?? "Principal", email: user.email ?? email };
    },
    logout: async () => {
      await this.client.auth.signOut();
    },
    current: async () => {
      const { data } = await this.client.auth.getUser();
      if (!data.user) return null;
      return {
        id: data.user.id,
        username: (data.user.user_metadata?.username as string) ?? data.user.email ?? "Principal",
        email: data.user.email ?? "",
      };
    },
  };

  private async mapLobby(row: LobbyRow, members: MemberRow[]): Promise<Lobby> {
    return {
      id: row.id,
      name: row.name,
      inviteCode: row.invite_code,
      hostUserId: row.host_user_id,
      settings: row.settings,
      careerId: row.career_id,
      createdAt: new Date(row.created_at).getTime(),
      paused: row.paused,
      members: members.map((m) => ({
        userId: m.user_id,
        username: m.username,
        teamId: m.team_id,
        isHost: m.is_host,
        online: m.online,
        joinedAt: new Date(m.last_seen).getTime(),
        lastSeen: new Date(m.last_seen).getTime(),
      })),
    };
  }

  async createLobby(userId: string, username: string, name: string, settings: Partial<LobbySettings>): Promise<Lobby> {
    const merged: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, ...settings };
    const { data: lobbyRow, error } = await this.client
      .from("lobbies")
      .insert({ name, host_user_id: userId, settings: merged, invite_code: randomCode(), career_id: crypto.randomUUID() })
      .select()
      .single();
    if (error || !lobbyRow) throw new Error(error?.message ?? "Could not create lobby.");

    await this.client.from("lobby_members").insert({ lobby_id: lobbyRow.id, user_id: userId, username, is_host: true, online: true });

    // Seed the career on the client using the shared engine, then persist the snapshot.
    const bundle = createCareerBundle({ careerId: lobbyRow.career_id, lobbyId: lobbyRow.id, name, settings: settingsFromLobby(merged) });
    await this.client.from("careers").insert({ id: lobbyRow.career_id, lobby_id: lobbyRow.id, version: 1, snapshot: bundle });

    return this.getLobby(lobbyRow.id) as Promise<Lobby>;
  }

  async joinLobby(_userId: string, username: string, inviteCode: string): Promise<Lobby> {
    // Resolved server-side so private lobbies never need a public SELECT policy.
    const { data: lobbyId, error } = await this.client.rpc("join_lobby_by_code", {
      p_code: inviteCode,
      p_username: username,
    });
    if (error) throw new Error(error.message);
    if (!lobbyId) throw new Error("No lobby found with that invitation code.");
    return this.getLobby(lobbyId as string) as Promise<Lobby>;
  }

  async listMyLobbies(userId: string): Promise<Lobby[]> {
    const { data: memberships } = await this.client.from("lobby_members").select("lobby_id").eq("user_id", userId);
    const ids = (memberships ?? []).map((m) => m.lobby_id);
    if (ids.length === 0) return [];
    const { data: rows } = await this.client.from("lobbies").select().in("id", ids);
    return Promise.all((rows ?? []).map((r) => this.getLobby(r.id) as Promise<Lobby>));
  }

  async listPublicLobbies(): Promise<Lobby[]> {
    const { data: rows } = await this.client.from("lobbies").select().eq("settings->>isPublic", "true");
    return Promise.all((rows ?? []).map((r) => this.getLobby(r.id) as Promise<Lobby>));
  }

  async getLobby(lobbyId: string): Promise<Lobby | null> {
    const { data: row } = await this.client.from("lobbies").select().eq("id", lobbyId).maybeSingle();
    if (!row) return null;
    const { data: members } = await this.client.from("lobby_members").select().eq("lobby_id", lobbyId);
    return this.mapLobby(row as LobbyRow, (members ?? []) as MemberRow[]);
  }

  async leaveLobby(lobbyId: string, userId: string): Promise<void> {
    await this.client.from("lobby_members").delete().eq("lobby_id", lobbyId).eq("user_id", userId);
  }

  async heartbeat(lobbyId: string, userId: string, online: boolean): Promise<void> {
    await this.client.from("lobby_members").update({ online, last_seen: new Date().toISOString() }).eq("lobby_id", lobbyId).eq("user_id", userId);
  }

  async setReady(lobbyId: string, userId: string, ready: boolean): Promise<Lobby> {
    const res = await this.invoke("set-ready", { lobbyId, userId, ready });
    return (res.lobby as Lobby) ?? (await this.getLobby(lobbyId))!;
  }

  async transferHost(lobbyId: string, fromUserId: string, toUserId: string): Promise<Lobby> {
    await this.invoke("transfer-host", { lobbyId, fromUserId, toUserId });
    return (await this.getLobby(lobbyId))!;
  }

  async removeMember(lobbyId: string, hostUserId: string, memberUserId: string): Promise<Lobby> {
    await this.invoke("remove-member", { lobbyId, hostUserId, memberUserId });
    return (await this.getLobby(lobbyId))!;
  }

  async setPaused(lobbyId: string, hostUserId: string, paused: boolean): Promise<Lobby> {
    await this.client.from("lobbies").update({ paused }).eq("id", lobbyId).eq("host_user_id", hostUserId);
    return (await this.getLobby(lobbyId))!;
  }

  async listChat(lobbyId: string): Promise<ChatMessage[]> {
    const { data } = await this.client.from("chat_messages").select().eq("lobby_id", lobbyId).order("created_at").limit(200);
    return (data ?? []).map((m) => ({
      id: m.id,
      lobbyId: m.lobby_id,
      userId: m.user_id,
      username: m.username,
      body: m.body,
      createdAt: new Date(m.created_at).getTime(),
    }));
  }

  async sendChat(lobbyId: string, userId: string, username: string, body: string): Promise<ChatMessage> {
    const { data, error } = await this.client
      .from("chat_messages")
      .insert({ lobby_id: lobbyId, user_id: userId, username, body: body.slice(0, 500) })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not send message.");
    return { id: data.id, lobbyId, userId, username, body, createdAt: new Date(data.created_at).getTime() };
  }

  async getBundle(lobbyId: string): Promise<CareerBundle> {
    const { data, error } = await this.client.from("careers").select("snapshot").eq("lobby_id", lobbyId).maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "Career not found.");
    return data.snapshot as CareerBundle;
  }

  async applyAction(lobbyId: string, userId: string, action: CareerAction): Promise<{ bundle: CareerBundle; extra: CareerActionExtra }> {
    const res = await this.invoke("apply-action", { lobbyId, userId, action });
    return { bundle: res.bundle as CareerBundle, extra: (res.extra ?? {}) as CareerActionExtra };
  }

  async negotiate(lobbyId: string, userId: string, driverId: string, teamId: string, offer: ContractOffer): Promise<NegotiationResult> {
    const res = await this.invoke("negotiate", { lobbyId, userId, driverId, teamId, offer });
    return res.negotiation as NegotiationResult;
  }

  async startRace(lobbyId: string, userId: string): Promise<{ bundle: CareerBundle; result: RaceResult }> {
    const res = await this.invoke("start-race", { lobbyId, userId });
    return { bundle: res.bundle as CareerBundle, result: res.result as RaceResult };
  }

  async commitRace(lobbyId: string, userId: string, result: RaceResult): Promise<{ bundle: CareerBundle; result: RaceResult }> {
    // The host simulated the race locally; the server re-validates the result
    // against the shared career before processing points and finances.
    const res = await this.invoke("commit-live-race", { lobbyId, userId, result });
    return { bundle: res.bundle as CareerBundle, result: res.result as RaceResult };
  }

  openLive(lobbyId: string, userId: string): LiveTransport {
    const client = this.client;
    const channel = client.channel(`live:${lobbyId}`, { config: { broadcast: { self: false, ack: false } } });
    const listeners = new Set<(message: LiveMessage, from: string) => void>();
    let ready = false;
    const pending: LiveMessage[] = [];
    const flush = () => {
      while (ready && pending.length > 0) {
        const message = pending.shift()!;
        void channel.send({ type: "broadcast", event: "live", payload: { from: userId, message } });
      }
    };
    channel
      .on("broadcast", { event: "live" }, (payload) => {
        const data = payload.payload as { from?: string; message?: LiveMessage } | undefined;
        if (!data || !data.message || typeof data.from !== "string" || data.from === userId) return;
        for (const listener of listeners) listener(data.message, data.from);
      })
      .subscribe((status) => {
        ready = status === "SUBSCRIBED";
        if (ready) flush();
      });
    return {
      send(message: LiveMessage) {
        if (!ready) {
          // Only the newest state matters; keep the queue tiny.
          if (pending.length > 4) pending.shift();
          pending.push(message);
          return;
        }
        void channel.send({ type: "broadcast", event: "live", payload: { from: userId, message } });
      },
      listen(handler) {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      close() {
        listeners.clear();
        pending.length = 0;
        void client.removeChannel(channel);
      },
    };
  }

  subscribeLobby(lobbyId: string, onChange: () => void): () => void {
    const channel = this.client
      .channel(`lobby:${lobbyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lobby_members", filter: `lobby_id=eq.${lobbyId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `lobby_id=eq.${lobbyId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "careers", filter: `lobby_id=eq.${lobbyId}` }, onChange)
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }

  private async invoke(fn: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.functions.invoke(fn, { body: payload });
    if (error) {
      let message = error.message ?? `Edge function ${fn} failed.`;
      // Supabase hides the response body behind error.context; surface our message.
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      try {
        const body = (await context?.json?.()) as { error?: unknown } | undefined;
        if (body && typeof body.error === "string") message = body.error;
      } catch {
        // Keep the generic message.
      }
      throw new Error(message);
    }
    if (data && typeof data === "object" && "error" in data) throw new Error(String((data as { error: unknown }).error));
    return (data ?? {}) as Record<string, unknown>;
  }
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
