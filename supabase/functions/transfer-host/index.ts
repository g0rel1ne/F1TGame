import { handler, json, HttpError, readJson } from "../_shared/http.ts";
import { adminClient, loadLobby, loadMembers, requireHost, requireUser } from "../_shared/db.ts";

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<{ lobbyId?: string; toUserId?: string }>(req);
    if (!body.lobbyId || !body.toUserId) throw new HttpError(400, "lobbyId and toUserId are required.");

    const lobby = await loadLobby(body.lobbyId);
    await requireHost(lobby, user.id);

    const members = await loadMembers(lobby.id);
    if (!members.some((m) => m.user_id === body.toUserId)) {
      throw new HttpError(404, "That user is not a member of the lobby.");
    }

    const admin = adminClient();
    const { error: lobbyError } = await admin
      .from("lobbies")
      .update({ host_user_id: body.toUserId })
      .eq("id", lobby.id)
      .eq("host_user_id", user.id);
    if (lobbyError) throw new HttpError(400, lobbyError.message);

    const { error: memberError } = await admin
      .from("lobby_members")
      .update({ is_host: false })
      .eq("lobby_id", lobby.id);
    if (memberError) throw new HttpError(400, memberError.message);

    const { error: newHostError } = await admin
      .from("lobby_members")
      .update({ is_host: true })
      .eq("lobby_id", lobby.id)
      .eq("user_id", body.toUserId);
    if (newHostError) throw new HttpError(400, newHostError.message);

    return json({ ok: true });
  }),
);
