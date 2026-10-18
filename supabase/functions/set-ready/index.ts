import { handler, json, HttpError, readJson } from "../_shared/http.ts";
import { loadCareer, loadLobby, requireMember, requireUser, saveCareer } from "../_shared/db.ts";

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<{ lobbyId?: string; ready?: boolean }>(req);
    if (!body.lobbyId) throw new HttpError(400, "lobbyId is required.");

    const lobby = await loadLobby(body.lobbyId);
    await requireMember(lobby.id, user.id);
    const record = await loadCareer(lobby.id);
    const bundle = record.bundle;

    const set = new Set(bundle.weekend.readyUserIds);
    if (body.ready) set.add(user.id);
    else set.delete(user.id);

    const next = { ...bundle, weekend: { ...bundle.weekend, readyUserIds: [...set] } };
    await saveCareer(lobby.id, { bundle: next, version: record.version });

    return json({ readyUserIds: [...set] });
  }),
);
