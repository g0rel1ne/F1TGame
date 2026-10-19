import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCareerBundle, type CareerBundle } from "../src/engine/season";
import { DEFAULT_CAREER_SETTINGS } from "../src/backend/types";

/**
 * Live integration test for the `commit-live-race` Edge Function.
 *
 * It talks to a real Supabase project, creating throwaway accounts and a lobby,
 * so it is skipped unless E2E_SUPABASE=1 is set:
 *
 *   E2E_SUPABASE=1 npx vitest run tests/e2e.commitLive.test.ts
 */
const RUN = process.env.E2E_SUPABASE === "1";

interface Ctx {
  url: string;
  anon: string;
  stamp: string;
}

function readCtx(): Ctx {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const get = (key: string) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  const url = get("VITE_SUPABASE_URL");
  const anon = get("VITE_SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local");
  return { url, anon, stamp: Date.now().toString(36) };
}

async function signup(ctx: Ctx, name: string): Promise<{ userId: string; token: string }> {
  const res = await fetch(`${ctx.url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ctx.anon, Authorization: `Bearer ${ctx.anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `e2e-live-${name.toLowerCase()}-${ctx.stamp}@f1tp.test`,
      password: "Passw0rd!23",
      data: { username: name },
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`signup failed: ${res.status} ${JSON.stringify(body)}`);
  return { userId: body.user.id, token: body.access_token };
}

async function rest(ctx: Ctx, path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ctx.url}/rest/v1${path}`, {
    ...init,
    headers: { apikey: ctx.anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
  });
}

async function fn(ctx: Ctx, name: string, token: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${ctx.url}/functions/v1/${name}`, {
    method: "POST",
    headers: { apikey: ctx.anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe.skipIf(!RUN)("commit-live-race edge function", () => {
  it("records a live result and re-scores every point on the server", async () => {
    const ctx = readCtx();
    const host = await signup(ctx, "E2EHost");
    const guest = await signup(ctx, "E2EGuest");

    const careerId = crypto.randomUUID();
    const lobbyRes = await rest(ctx, "/lobbies", host.token, {
      method: "POST",
      body: JSON.stringify({
        name: `E2E live ${ctx.stamp}`,
        host_user_id: host.userId,
        settings: {},
        invite_code: `E2E${ctx.stamp.toUpperCase().slice(0, 5)}`,
        career_id: careerId,
      }),
    });
    const [lobby] = await lobbyRes.json();
    expect(lobby?.id).toBeTruthy();

    await rest(ctx, "/lobby_members", host.token, {
      method: "POST",
      body: JSON.stringify({ lobby_id: lobby.id, user_id: host.userId, username: "E2EHost", is_host: true, online: true }),
    });
    await rest(ctx, "/rpc/join_lobby_by_code", guest.token, {
      method: "POST",
      body: JSON.stringify({ p_code: lobby.invite_code, p_username: "E2EGuest" }),
    });

    const bundle: CareerBundle = createCareerBundle({
      careerId,
      lobbyId: lobby.id,
      name: `E2E live ${ctx.stamp}`,
      settings: { ...DEFAULT_CAREER_SETTINGS, seasonLength: 6 },
    });
    await rest(ctx, "/careers", host.token, {
      method: "POST",
      body: JSON.stringify({ id: careerId, lobby_id: lobby.id, version: 1, snapshot: bundle }),
    });

    expect((await fn(ctx, "set-ready", host.token, { lobbyId: lobby.id, ready: true })).status).toBe(200);
    expect((await fn(ctx, "set-ready", guest.token, { lobbyId: lobby.id, ready: true })).status).toBe(200);

    // A host client sends the finishing order — and tries to award itself 999 points.
    const drivers = bundle.drivers.slice(0, 6);
    const classification = drivers.map((d, i) => ({
      position: i + 1,
      driverId: d.id,
      teamId: d.teamId,
      laps: 30,
      timeSeconds: 3600 + i * 4,
      gap: i === 0 ? "WINNER" : `+${i * 4}`,
      bestLap: 91.5 + i * 0.2,
      points: 999,
      status: "finished",
      pits: 1,
      fastestLap: false,
      gridPosition: i + 1,
      penalties: 0,
    }));
    const result = {
      id: "tampered",
      careerId: "tampered",
      season: 99,
      raceIndex: 99,
      circuitId: bundle.weekend.circuitId,
      session: "race",
      seed: 1,
      weatherStart: bundle.weekend.weather.condition,
      classification,
      qualifying: [],
      incidents: [],
      laps: [{ lap: 1, driverId: drivers[0].id, lapTime: 91.5, compound: "medium", stint: 1, gapToLeader: 0 }],
      safetyCarDeployments: 0,
      virtualSafetyCarPeriods: 0,
      redFlags: 0,
      fastestLapDriverId: null,
      poleDriverId: null,
      winnerDriverId: null,
      processed: false,
    };

    const { status, body } = await fn(ctx, "commit-live-race", host.token, { lobbyId: lobby.id, result });
    expect(status).toBe(200);
    expect(body.bundle.results[0].processed).toBe(true);
    // Identity comes from the career snapshot, not the client.
    expect(body.result.season).toBe(bundle.season.number);
    expect(body.result.raceIndex).toBe(bundle.weekend.raceIndex);
    expect(body.result.qualifying.length).toBeGreaterThan(0);
    // The bogus 999 points were thrown away and replaced with the ruleset's.
    expect(body.result.classification[0].points).not.toBe(999);
    expect(body.result.classification[1].points).toBeLessThan(body.result.classification[0].points);
    expect(body.result.classification.filter((c: { fastestLap: boolean }) => c.fastestLap)).toHaveLength(1);
    expect(body.bundle.results).toHaveLength(1);

    // Idempotent: a race is processed exactly once.
    const again = await fn(ctx, "commit-live-race", host.token, { lobbyId: lobby.id, result });
    expect(again.status).toBe(200);
    expect(again.body.bundle.results).toHaveLength(1);

    // Only the host may record the race.
    const denied = await fn(ctx, "commit-live-race", guest.token, { lobbyId: lobby.id, result });
    expect(denied.status).toBe(403);

    console.log(`[e2e] cleanup -> lobby ${lobby.id} career ${careerId} users ${host.userId} ${guest.userId}`);
  }, 180_000);
});
