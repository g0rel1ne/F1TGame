import { prepareRace, type CareerBundle } from "./season";
import {
  LiveRace,
  sanitizeDriverCommand,
  type LiveAuditEntry,
  type LiveRaceAudit,
} from "./liveRace";

const MAX_AUDIT_ENTRIES = 6000;

/** Teams owned by a human principal, in a stable order shared by client and server. */
export function liveControlledDriverIds(bundle: CareerBundle): string[] {
  const owned = new Set(bundle.teams.filter((t) => t.ownerUserId).map((t) => t.id));
  return bundle.drivers.filter((d) => d.teamId && owned.has(d.teamId)).map((d) => d.id);
}

/**
 * Rebuild a live race from its instruction log and produce the official result.
 * This is the same engine the host ran, so replaying the log is deterministic.
 */
export function replayLiveRaceAudit(bundle: CareerBundle, audit: LiveRaceAudit) {
  const prep = prepareRace(bundle);
  if (audit.raceId !== prep.raceId) throw new Error("Live audit does not match the scheduled race.");
  if (typeof audit.sessionId !== "string" || audit.sessionId.length === 0 || audit.sessionId.length > 128) {
    throw new Error("Invalid live session id.");
  }
  if (!Array.isArray(audit.entries) || audit.entries.length > MAX_AUDIT_ENTRIES) {
    throw new Error("Live audit is too large.");
  }

  const controlled = new Set(liveControlledDriverIds(bundle));
  const seen = new Map<string, number>();
  for (const entry of audit.entries) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid live audit entry.");
    if (!Number.isInteger(entry.afterLap) || entry.afterLap < 0 || entry.afterLap > prep.totalLaps) {
      throw new Error("Invalid live audit lap.");
    }
    if (!controlled.has(entry.driverId)) throw new Error("Live audit references a driver outside this race.");
    seen.set(entry.driverId, (seen.get(entry.driverId) ?? 0) + 1);
    if (seen.get(entry.driverId)! > 500) throw new Error("Too many instructions for one driver.");
    if (entry.type === "command") {
      const clean = sanitizeDriverCommand(entry.patch ?? {});
      if (Object.keys(clean).length === 0) throw new Error("Invalid live audit command.");
    } else if (entry.type === "control") {
      if (entry.mode !== "human" && entry.mode !== "ai") throw new Error("Invalid live control mode.");
    } else {
      throw new Error("Unknown live audit entry.");
    }
  }

  const indexed = audit.entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) => a.entry.afterLap - b.entry.afterLap || a.index - b.index);

  const engine = new LiveRace({
    raceId: prep.raceId,
    sessionId: audit.sessionId,
    seed: prep.seed,
    circuit: prep.circuit,
    totalLaps: prep.totalLaps,
    ruleset: prep.ruleset,
    weatherStart: prep.weatherStart,
    entrants: prep.entrants,
    severitySetting: bundle.settings.incidentSeverity,
    controlledDriverIds: [...controlled],
    qualifying: prep.qualifying,
    poleDriverId: prep.poleDriverId,
  });

  let cursor = 0;
  let guard = 0;
  while (!engine.finished && guard <= prep.totalLaps + 5) {
    while (cursor < indexed.length && indexed[cursor].entry.afterLap <= engine.lap) {
      const entry = indexed[cursor].entry as LiveAuditEntry;
      if (entry.type === "control") engine.setControlMode(entry.driverId, entry.mode);
      else engine.setCommand(entry.driverId, entry.patch);
      cursor++;
    }
    if (engine.finished) break;
    engine.step();
    guard++;
  }

  return engine.finalize();
}
