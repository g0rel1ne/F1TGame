import { describe, expect, it } from "vitest";
import {
  baseLapSeconds,
  beatStale,
  emptyVotes,
  lapMsFor,
  majorityNeed,
  resolveSkip,
  resolveSpeed,
  speedTally,
  type LiveBeat,
} from "../src/engine/liveSession";

const LOBBY = ["u1", "u2", "u3"];

describe("live session voting", () => {
  it("needs a strict majority, not a plurality, to change speed", () => {
    expect(majorityNeed(1)).toBe(1);
    expect(majorityNeed(2)).toBe(2);
    expect(majorityNeed(3)).toBe(2);
    expect(majorityNeed(6)).toBe(4);
  });

  it("resolves the speed once the lobby agrees", () => {
    const votes = { u1: 2 as const, u2: 2 as const, u3: 4 as const };
    expect(resolveSpeed(votes, LOBBY)).toBe(2);
  });

  it("never lets one voice outvote a tied pair", () => {
    expect(resolveSpeed({ u1: 4, u2: 2 }, ["u1", "u2"])).toBeNull();
    expect(resolveSpeed({ u1: 4, u2: 4 }, ["u1", "u2"])).toBe(4);
  });

  it("accepts the option that reaches a majority on its own", () => {
    // 4x has two of three votes — enough — even though 2x is the minority pick.
    expect(resolveSpeed({ u1: 2, u2: 4, u3: 4 }, LOBBY)).toBe(4);
  });

  it("stays undecided while every option is short of a majority", () => {
    expect(resolveSpeed({ u1: 2, u2: 4, u3: 1 }, LOBBY)).toBeNull();
    expect(resolveSpeed({ u1: 2, u2: 4 }, LOBBY)).toBeNull();
  });

  it("ignores votes from people who are not in the lobby", () => {
    expect(resolveSpeed({ u1: 2, ghost: 2 }, LOBBY)).toBeNull();
  });

  it("counts the vote tally for display, including the slow replay speeds", () => {
    expect(speedTally({ u1: 2, u2: 2, u3: 4 }, LOBBY)).toEqual({ 0.25: 0, 0.5: 0, 1: 0, 2: 2, 4: 1 });
    expect(speedTally({ u1: 0.25, u2: 0.5, u3: 1 }, LOBBY)).toEqual({ 0.25: 1, 0.5: 1, 1: 1, 2: 0, 4: 0 });
  });

  it("applies a skip only when the lobby agrees", () => {
    expect(resolveSkip(["u1"], LOBBY)).toBe(false);
    expect(resolveSkip(["u1", "u2"], LOBBY)).toBe(true);
    expect(resolveSkip(["u1"], ["u1", "u2"])).toBe(false);
    expect(resolveSkip(["u1", "u2"], ["u1", "u2"])).toBe(true);
  });

  it("lets a solo principal skip immediately", () => {
    expect(resolveSkip(["u1"], ["u1"])).toBe(true);
    expect(resolveSpeed({ u1: 4 }, ["u1"])).toBe(4);
    expect(emptyVotes()).toEqual({ speed: {}, skip: [] });
  });
});

describe("live session pacing", () => {
  it("keeps a lap watchable regardless of the real lap time", () => {
    expect(baseLapSeconds(60)).toBe(5.5);
    expect(baseLapSeconds(100)).toBeCloseTo(9.09, 1);
    expect(baseLapSeconds(90)).toBeCloseTo(8.18, 1);
  });

  it("scales lap length linearly with the chosen speed", () => {
    expect(lapMsFor(90, 2)).toBeCloseTo(lapMsFor(90, 1) / 2, 6);
    expect(lapMsFor(90, 4)).toBeCloseTo(lapMsFor(90, 1) / 4, 6);
    expect(lapMsFor(90, 0.5)).toBeCloseTo(lapMsFor(90, 1) * 2, 6);
    expect(lapMsFor(90, 0.25)).toBeCloseTo(lapMsFor(90, 1) * 4, 6);
  });

  it("only treats a beat as stale after several missed laps", () => {
    const beat: LiveBeat = {
      seq: 1,
      sessionId: "session-1",
      snapshot: {
        lap: 1,
        totalLaps: 10,
        flag: "green",
        weather: { condition: "dry", intensity: 0, trackWetness: 0, airTempC: 22, trackTempC: 30 },
        cars: [],
        finished: false,
        safetyCarProgress: null,
        lapFraction: 0,
      },
      events: [],
      speed: 1,
      paused: false,
      lapMs: 8000,
      at: 1000,
      votes: emptyVotes(),
    };
    expect(beatStale(beat, 1000 + 8000 * 3)).toBe(false);
    expect(beatStale(beat, 1000 + 8000 * 20)).toBe(true);
  });
});
