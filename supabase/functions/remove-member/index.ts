import { handler, json, HttpError, readJson } from "../_shared/http.ts";
import { adminClient, loadLobby, requireHost, requireUser } from "../_shared/db.ts";

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<{ lobbyId?: string; memberUserId?: string }>(req);
    if (!body.lobbyId || !body.memberUserId) {
      throw new HttpError(400, "lobbyId and memberUserId are required.");
    }

    const lobby = await loadLobby(body.lobbyId);
    await requireHost(lobby, user.id);
    if (body.memberUserId === user.id) {
      throw new HttpError(400, "Transfer host privileges before removing yourself.");
    }

    const { error } = await adminClient()
      .from("lobby_members")
      .delete()
      .eq("lobby_id", lobby.id)
      .eq("user_id", body.memberUserId);
    if (error) throw new HttpError(400, error.message);

    return json({ ok: true });
  }),
);
