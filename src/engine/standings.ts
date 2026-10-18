import type { ChampionshipStandings, RaceResult, StandingRow } from "./types";

/**
 * Aggregate a season's standings from its race results.
 *
 * Idempotency guarantee: this is a pure function of the supplied (already
 * de-duplicated, `processed`) results. Applying the same result set twice yields
 * the same standings, so a result can never be double-counted.
 */
export function computeStandings(results: RaceResult[], season: number): ChampionshipStandings {
  const driverMap = new Map<string, StandingRow & { driverId: string }>();
  const teamMap = new Map<string, StandingRow>();

  for (const r of results) {
    if (r.season !== season) continue;
    for (const entry of r.classification) {
      const d = driverMap.get(entry.driverId) ?? {
        driverId: entry.driverId,
        teamId: entry.teamId,
        points: 0,
        wins: 0,
        podiums: 0,
        poles: 0,
        fastestLaps: 0,
        dnfs: 0,
        position: 0,
      };
      d.teamId = entry.teamId;
      d.points += entry.points;
      if (entry.position === 1 && entry.status === "finished") d.wins += 1;
      if (entry.position <= 3 && entry.status === "finished") d.podiums += 1;
      if (entry.fastestLap) d.fastestLaps += 1;
      if (entry.status === "dnf") d.dnfs += 1;
      driverMap.set(entry.driverId, d);

      const t = teamMap.get(entry.teamId) ?? {
        teamId: entry.teamId,
        points: 0,
        wins: 0,
        podiums: 0,
        poles: 0,
        fastestLaps: 0,
        dnfs: 0,
        position: 0,
      };
      t.points += entry.points;
      if (entry.position === 1 && entry.status === "finished") t.wins += 1;
      if (entry.position <= 3 && entry.status === "finished") t.podiums += 1;
      if (entry.fastestLap) t.fastestLaps += 1;
      if (entry.status === "dnf") t.dnfs += 1;
      teamMap.set(entry.teamId, t);
    }

    // Poles awarded to the qualifying leader.
    if (r.session === "race" && r.poleDriverId) {
      const d = driverMap.get(r.poleDriverId);
      if (d) d.poles += 1;
      const entry = r.classification.find((c) => c.driverId === r.poleDriverId);
      if (entry) {
        const t = teamMap.get(entry.teamId);
        if (t) t.poles += 1;
      }
    }
  }

  const sortRows = <T extends StandingRow>(rows: T[]): T[] =>
    rows
      .sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums)
      .map((r, i) => ({ ...r, position: i + 1 }));

  return {
    season,
    drivers: sortRows([...driverMap.values()]),
    constructors: sortRows([...teamMap.values()]),
  };
}
