import { handler, json, HttpError, readJson } from "../_shared/http.ts";
import { loadCareer, loadLobby, requireHost, requireMember, requireUser, saveCareer } from "../_shared/db.ts";
import { commitRaceResult, prepareRace } from "../_shared/engine/season.ts";
import { replayLiveRaceAudit } from "../_shared/engine/liveAudit.ts";
import type { RaceResult, ClassifiedEntry } from "../_shared/engine/types.ts";
import type { LiveRaceAudit } from "../_shared/engine/liveRace.ts";

interface Body {
  lobbyId?: string;
  result?: RaceResult;
  audit?: LiveRaceAudit;
}

/**
 * Records the result of an interactive live race.
 *
 * The host streams the race and sends the instruction audit (commands and
 * control handovers). The server replays that log through the same deterministic
 * engine and uses its finishing order, so a tampered client cannot invent a
 * result, award itself points or claim a different circuit.
 */
Deno.serve(
  handler(async (req) => {
    const user = await requireUser(req);
    const body = await readJson<Body>(req);
    if (!body.lobbyId) throw new HttpError(400, "lobbyId is required.");
    if (!body.result && !body.audit) throw new HttpError(400, "result or audit is required.");

    const lobby = await loadLobby(body.lobbyId);
    await requireMember(lobby.id, user.id);
    await requireHost(lobby, user.id);

    const record = await loadCareer(lobby.id);
    const bundle = record.bundle;

    // Idempotent: a race is only ever processed once.
    if (bundle.weekend.resultId) {
      const existing = bundle.results.find((r) => r.id === bundle.weekend.resultId);
      if (existing) return json({ bundle, result: existing });
    }

    // A live race may be started before every principal is ready; they can join
    // late and the host's authoritative audit already includes their cars.
    const prep = prepareRace(bundle);
    // The audit is the source of truth. Legacy clients without one still pass
    // through the stricter identity/field validation below.
    const incoming = body.audit ? replayLiveRaceAudit(bundle, body.audit).result : body.result!;
    if (incoming.circuitId !== prep.circuit.id) {
      throw new HttpError(400, "Result does not match the scheduled race.");
    }

    const driverIds = new Set(bundle.drivers.map((d) => d.id));
    const teamIds = new Set(bundle.teams.map((t) => t.id));
    const raw = (incoming.classification ?? []).filter((c) => driverIds.has(c.driverId) && teamIds.has(c.teamId));
    if (raw.length < 2) throw new HttpError(400, "Race result is incomplete.");

    // Re-order by the claimed finishing position, then score it ourselves.
    const ordered = [...raw].sort((a, b) => a.position - b.position);
    const timed = ordered.filter((c) => c.status !== "dnf" && typeof c.bestLap === "number");
    const fastestLap =
      timed.length > 0 ? timed.reduce((best, c) => ((c.bestLap ?? Infinity) < (best.bestLap ?? Infinity) ? c : best)) : null;
    const leaderTime = ordered.find((c) => c.status !== "dnf" && c.timeSeconds !== null)?.timeSeconds ?? 0;

    const classification: ClassifiedEntry[] = ordered.map((c, i) => {
      const dnf = c.status === "dnf" || c.status === "dsq";
      let points = dnf ? 0 : prep.ruleset.racePoints[i] ?? 0;
      const isFastest = !dnf && fastestLap !== null && c.driverId === fastestLap.driverId;
      if (isFastest && prep.ruleset.fastestLapPoints > 0 && i < prep.ruleset.fastestLapTopN) {
        points += prep.ruleset.fastestLapPoints;
      }
      const gapSeconds = c.timeSeconds !== null ? Math.max(0, c.timeSeconds - leaderTime) : null;
      return {
        ...c,
        position: i + 1,
        laps: Math.max(0, Math.min(prep.totalLaps, Math.round(c.laps))),
        timeSeconds: c.timeSeconds,
        gap: dnf
          ? "DNF"
          : i === 0
            ? "WINNER"
            : gapSeconds !== null && gapSeconds < prep.circuit.referenceLapSeconds
              ? `+${gapSeconds.toFixed(3)}`
              : `+${((gapSeconds ?? 0) / (prep.circuit.referenceLapSeconds || 90)).toFixed(3)} lap`,
        points,
        status: dnf ? c.status : "finished",
        pits: Math.max(0, Math.round(c.pits)),
        fastestLap: isFastest,
        penalties: 0,
      };
    });

    const safe: RaceResult = {
      ...incoming,
      id: prep.raceId,
      careerId: bundle.career.id,
      season: bundle.season.number,
      raceIndex: bundle.weekend.raceIndex,
      circuitId: prep.circuit.id,
      seed: prep.seed,
      session: "race",
      // Qualifying, grid and the weather the race actually started in come from
      // the server's own preparation, not from the client.
      qualifying: prep.qualifying,
      poleDriverId: prep.poleDriverId,
      weatherStart: prep.weatherStart.condition,
      classification,
      fastestLapDriverId: fastestLap?.driverId ?? null,
      winnerDriverId: classification.find((c) => c.status === "finished")?.driverId ?? null,
      laps: (incoming.laps ?? []).filter((l) => driverIds.has(l.driverId)),
      finalDamage: incoming.finalDamage,
      processed: false,
    };

    const res = commitRaceResult(bundle, safe);
    await saveCareer(lobby.id, { bundle: res.bundle, version: record.version });
    return json({ bundle: res.bundle, result: res.result });
  }),
);
