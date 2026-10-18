import { handler, readJson, json, HttpError } from "../_shared/http.ts";
import { adminClient, loadCareer, loadLobby, requireMember, requireUser, saveCareer } from "../_shared/db.ts";
import { applyCareerAction } from "../_shared/actions.ts";

interface Body {
  lobbyId?: string;
  action?: Record<string, unknown>;
}

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<Body>(req);
    if (!body.lobbyId || !body.action) throw new HttpError(400, "lobbyId and action are required.");

    const lobby = await loadLobby(body.lobbyId);
    await requireMember(lobby.id, user.id);
    const record = await loadCareer(lobby.id);

    const result = applyCareerAction(record.bundle, body.action, {
      userId: user.id,
      lobbyId: lobby.id,
      isHost: lobby.host_user_id === user.id,
    });

    await saveCareer(lobby.id, { bundle: result.bundle, version: record.version });

    // Creating a team also binds the member row to that team.
    const teamId = result.extra.teamId;
    if (typeof teamId === "string") {
      const { error } = await adminClient()
        .from("lobby_members")
        .update({ team_id: teamId })
        .eq("lobby_id", lobby.id)
        .eq("user_id", user.id);
      if (error) throw new HttpError(400, error.message);
    }

    return json({ bundle: result.bundle, extra: result.extra });
  }),
);
