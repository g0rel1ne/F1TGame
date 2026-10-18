import { handler, json, HttpError, readJson } from "../_shared/http.ts";
import { loadBundle, loadLobby, requireMember, requireUser } from "../_shared/db.ts";
import { negotiate } from "../_shared/engine/drivermarket.ts";
import { Rng } from "../_shared/engine/rng.ts";
import type { ContractOffer } from "../_shared/engine/drivermarket.ts";

Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<{
      lobbyId?: string;
      driverId?: string;
      teamId?: string;
      offer?: ContractOffer;
    }>(req);
    if (!body.lobbyId || !body.driverId || !body.teamId || !body.offer) {
      throw new HttpError(400, "lobbyId, driverId, teamId and offer are required.");
    }

    const lobby = await loadLobby(body.lobbyId);
    await requireMember(lobby.id, user.id);
    const bundle = await loadBundle(lobby.id);

    const team = bundle.teams.find((t) => t.id === body.teamId);
    if (!team) throw new HttpError(404, "Team not found.");
    if (team.ownerUserId !== user.id) throw new HttpError(403, "You can only negotiate for your own team.");

    const driver = bundle.drivers.find((d) => d.id === body.driverId);
    if (!driver) throw new HttpError(404, "Driver not found.");
    if (driver.teamId && driver.teamId !== team.id) {
      throw new HttpError(409, `${driver.name} is already contracted to another team.`);
    }

    const rng = new Rng(`negotiate:${lobby.id}:${driver.id}:${crypto.randomUUID()}`);
    const result = negotiate(rng, driver, team, body.offer, team.objective);
    return json({ negotiation: result });
  }),
);
