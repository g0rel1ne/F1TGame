import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./http.ts";
import type { CareerBundle } from "./engine/season.ts";

let admin: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `Missing environment variable ${name}`);
  return value;
}

export function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

function anonymousClient(): SupabaseClient {
  if (!authClient) {
    authClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return authClient;
}

/** Validate the caller's JWT and return their user id. */
export async function requireUser(req: Request): Promise<{ id: string; email: string }> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Sign in required.");
  const { data, error } = await anonymousClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session.");
  return { id: data.user.id, email: data.user.email ?? "" };
}

export interface LobbyRecord {
  id: string;
  name: string;
  host_user_id: string;
  invite_code: string;
  settings: Record<string, unknown>;
  career_id: string;
  paused: boolean;
}

export interface MemberRecord {
  lobby_id: string;
  user_id: string;
  username: string;
  team_id: string | null;
  is_host: boolean;
  online: boolean;
}

export async function loadLobby(lobbyId: string): Promise<LobbyRecord> {
  const { data, error } = await adminClient().from("lobbies").select("*").eq("id", lobbyId).maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, "Lobby not found.");
  return data as LobbyRecord;
}

export async function loadMembers(lobbyId: string): Promise<MemberRecord[]> {
  const { data, error } = await adminClient().from("lobby_members").select("*").eq("lobby_id", lobbyId);
  if (error) throw new HttpError(400, error.message);
  return (data ?? []) as MemberRecord[];
}

export async function requireMember(lobbyId: string, userId: string): Promise<MemberRecord> {
  const members = await loadMembers(lobbyId);
  const member = members.find((m) => m.user_id === userId);
  if (!member) throw new HttpError(403, "You are not a member of this lobby.");
  return member;
}

export async function requireHost(lobby: LobbyRecord, userId: string): Promise<void> {
  if (lobby.host_user_id !== userId) throw new HttpError(403, "Only the host can do that.");
}

export interface CareerRecord {
  bundle: CareerBundle;
  version: number;
}

export async function loadCareer(lobbyId: string): Promise<CareerRecord> {
  const { data, error } = await adminClient()
    .from("careers")
    .select("snapshot, version")
    .eq("lobby_id", lobbyId)
    .maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, "Career not found for this lobby.");
  return { bundle: data.snapshot as CareerBundle, version: data.version as number };
}

export async function loadBundle(lobbyId: string): Promise<CareerBundle> {
  return (await loadCareer(lobbyId)).bundle;
}

/**
 * Optimistic concurrency: the snapshot is only replaced if nobody else wrote it
 * since it was read. Prevents two simultaneous actions from silently clobbering
 * each other (e.g. a signing and a race result).
 */
export async function saveCareer(lobbyId: string, record: CareerRecord): Promise<void> {
  const nextVersion = record.version + 1;
  const { data, error } = await adminClient()
    .from("careers")
    .update({ snapshot: record.bundle, version: nextVersion, updated_at: new Date().toISOString() })
    .eq("lobby_id", lobbyId)
    .eq("version", record.version)
    .select("version");
  if (error) throw new HttpError(400, error.message);
  if (!data || data.length === 0) {
    throw new HttpError(409, "The career was updated by another player. Refresh and try again.");
  }
}
