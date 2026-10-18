import type { CareerBundle } from "../engine/season";
import type { Driver, StandingRow, TeamSpec } from "../engine/types";

export function findTeam(bundle: CareerBundle, teamId: string | null | undefined): TeamSpec | null {
  if (!teamId) return null;
  return bundle.teams.find((t) => t.id === teamId) ?? null;
}

export function findDriver(bundle: CareerBundle, driverId: string | null | undefined): Driver | null {
  if (!driverId) return null;
  return bundle.drivers.find((d) => d.id === driverId) ?? null;
}

export function teamDrivers(bundle: CareerBundle, teamId: string): Driver[] {
  return bundle.drivers.filter((d) => d.teamId === teamId).slice(0, 2);
}

export function balanceOf(bundle: CareerBundle, teamId: string): number {
  return bundle.finances.find((f) => f.teamId === teamId)?.balance ?? 0;
}

export function constructorRow(bundle: CareerBundle, teamId: string): StandingRow | null {
  return bundle.standings.constructors.find((r) => r.teamId === teamId) ?? null;
}

export function driverRow(bundle: CareerBundle, driverId: string): StandingRow | null {
  return bundle.standings.drivers.find((r) => r.driverId === driverId) ?? null;
}

export function activeSponsors(bundle: CareerBundle, teamId: string) {
  return bundle.sponsorContracts
    .filter((sc) => sc.teamId === teamId && sc.active)
    .map((sc) => ({ contract: sc, sponsor: bundle.sponsors.find((s) => s.id === sc.sponsorId) ?? null }))
    .filter((x) => x.sponsor !== null);
}

export function seasonLabel(bundle: CareerBundle): string {
  return `${bundle.settings.startingSeason + bundle.season.number - 1}`;
}

export function raceLabel(index: number, length: number): string {
  return `Round ${Math.min(index + 1, length)} of ${length}`;
}

export function driverName(bundle: CareerBundle, driverId: string | null | undefined): string {
  return findDriver(bundle, driverId)?.name ?? "—";
}

export function teamShort(bundle: CareerBundle, teamId: string | null | undefined): string {
  return findTeam(bundle, teamId)?.shortName ?? "—";
}
