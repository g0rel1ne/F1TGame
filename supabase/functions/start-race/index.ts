import { handler, json, HttpError, readJson } from "../_shared/http.ts";
import { loadCareer, loadLobby, requireHost, requireMember, requireUser, saveCareer } from "../_shared/db.ts";
import { runRaceWeekend } from "../_shared/engine/season.ts";

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<{ lobbyId?: string }>(req);
    if (!body.lobbyId) throw new HttpError(400, "lobbyId is required.");

    const lobby = await loadLobby(body.lobbyId);
    await requireMember(lobby.id, user.id);
    await requireHost(lobby, user.id);

    const record = await loadCareer(lobby.id);
    const bundle = record.bundle;
    if (bundle.weekend.resultId) {
      const existing = bundle.results.find((r) => r.id === bundle.weekend.resultId);
      if (existing) return json({ bundle, result: existing });
    }

    // Readiness is advisory: the host may force the start.
    const { bundle: next, result } = runRaceWeekend(bundle);
    await saveCareer(lobby.id, { bundle: next, version: record.version });
    return json({ bundle: next, result });
  }),
);
