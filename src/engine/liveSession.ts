import type { DriverCommand, LiveEvent, LiveSnapshot } from "./liveRace";
import type { RaceResult } from "./types";

/**
 * Wire protocol for the online live race.
 *
 * The host client coordinates the live `LiveRace` engine. It streams a compact
 * `LiveBeat` (a full `LiveSnapshot` plus the events produced since the previous
 * beat) roughly once per simulated lap. Guests render the beats so every
 * principal sees identical positions, gaps, tyre ages and penalties. The host
 * also records every instruction; the server replays that deterministic audit
 * before committing the official result.
 *
 * Guests can talk back: driver commands (pace / box / compound) and votes to
 * change the replay speed or skip to the end. The host validates every command
 * against the shared career and applies it to its engine, then publishes the
 * result in the next beat.
 */

export type LiveSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export const LIVE_SPEEDS: LiveSpeed[] = [0.25, 0.5, 1, 2, 4];

export function isLiveSpeed(value: unknown): value is LiveSpeed {
  return LIVE_SPEEDS.includes(value as LiveSpeed);
}

export interface LiveVotes {
  /** userId -> the speed that user voted for. */
  speed: Record<string, LiveSpeed>;
  /** userIds that voted to skip to the end. */
  skip: string[];
}

/** Identity shared by every participant of one live race. */
export interface LiveSessionInfo {
  sessionId: string;
  raceId: string;
  hostUserId: string;
  circuitId: string;
  totalLaps: number;
  startedAt: number;
}

export interface LiveBeat {
  /** Monotonic beat counter; guests ignore out-of-order beats. */
  seq: number;
  sessionId: string;
  snapshot: LiveSnapshot;
  /** Events produced since the previous beat. */
  events: LiveEvent[];
  /** Speed the host is currently replaying at. */
  speed: LiveSpeed;
  paused: boolean;
  /** Real-world milliseconds one lap takes on screen at `speed`. */
  lapMs: number;
  /** `Date.now()` on the host when the beat was published. */
  at: number;
  /** Current vote tally, so guests can render it without extra messages. */
  votes: LiveVotes;
}

export type LiveMessage =
  | { t: "start"; session: LiveSessionInfo }
  | { t: "beat"; beat: LiveBeat }
  /** A guest asking the host for the current state (on join or after a gap). */
  | { t: "sync"; sessionId?: string }
  | { t: "cmd"; driverId: string; patch: Partial<DriverCommand> }
  | { t: "vote"; speed?: LiveSpeed; skip?: boolean }
  | { t: "end"; result: RaceResult }
  | { t: "abort"; sessionId?: string };

export function emptyVotes(): LiveVotes {
  return { speed: {}, skip: [] };
}

/** A vote needs a strict majority: one voice can never outvote a tied lobby. */
export function majorityNeed(memberCount: number): number {
  return Math.max(1, Math.floor(memberCount / 2) + 1);
}

/** The agreed speed, or null while the lobby is split. */
export function resolveSpeed(votes: Record<string, LiveSpeed>, memberIds: string[]): LiveSpeed | null {
  const need = majorityNeed(memberIds.length);
  const tally = new Map<LiveSpeed, number>();
  for (const id of memberIds) {
    const speed = votes[id];
    if (speed) tally.set(speed, (tally.get(speed) ?? 0) + 1);
  }
  let best: { speed: LiveSpeed; count: number } | null = null;
  for (const [speed, count] of tally) {
    if (count >= need && (!best || count > best.count)) best = { speed, count };
  }
  return best?.speed ?? null;
}

/** Whether enough members voted to skip the rest of the race. */
export function resolveSkip(skipVotes: string[], memberIds: string[]): boolean {
  const need = majorityNeed(memberIds.length);
  return memberIds.filter((id) => skipVotes.includes(id)).length >= need;
}

/** How many members voted for each speed (for the UI). */
export function speedTally(votes: Record<string, LiveSpeed>, memberIds: string[]): Record<LiveSpeed, number> {
  const out: Record<LiveSpeed, number> = { 0.25: 0, 0.5: 0, 1: 0, 2: 0, 4: 0 };
  for (const id of memberIds) {
    const speed = votes[id];
    if (speed) out[speed] += 1;
  }
  return out;
}

/**
 * Real-world seconds one simulated lap takes on screen at 1x. Derived from the
 * circuit's real lap time so a longer lap visibly takes longer, then slowed
 * down heavily — a race is something you watch, not blink through.
 */
export function baseLapSeconds(referenceLapSeconds: number): number {
  return Math.min(36, Math.max(22, referenceLapSeconds / 3));
}

/** Real-world milliseconds per lap at a given speed. */
export function lapMsFor(referenceLapSeconds: number, speed: LiveSpeed): number {
  return (baseLapSeconds(referenceLapSeconds) / speed) * 1000;
}

/** True when a `Date.now()`-style clock is beyond the beat's expected life. */
export function beatStale(beat: LiveBeat, now: number, graceLaps = 6): boolean {
  const life = Math.max(1500, beat.lapMs) * graceLaps;
  return now - beat.at > life;
}
