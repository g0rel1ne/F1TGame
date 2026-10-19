import type { Circuit, Driver } from "./types";
import { clamp } from "./rng";

/**
 * Driver IQ.
 *
 * A single 0..1 "how well does this driver read a race?" score distilled from
 * the raw driver attributes. It is deliberately separate from the team's
 * strategy rating: a great strategist on the pit wall cannot make a driver brake
 * later, and a brilliant driver cannot fix a bad strategy call.
 *
 * The score is used on track, where it nudges:
 *   - how little time a driver loses in dirty air (better aero management),
 *   - how much of an overtake attempt is down to skill rather than luck,
 *   - how well a driver defends a position,
 *   - how late they can afford to brake into a heavy braking zone,
 *   - how likely they are to avoid (or cause) contact.
 *
 * Everything is deterministic and derived from existing attributes, so the
 * simulation stays reproducible and every circuit benefits from the same code.
 */

export interface DriverIq {
  /** Overall 0..1 race intelligence. */
  overall: number;
  /** 0..1 wheel-to-wheel attacking quality. */
  attack: number;
  /** 0..1 wheel-to-wheel defending quality. */
  defend: number;
  /** 0..1 ability to extract lap time without over-driving the car. */
  precision: number;
}

export function driverIq(driver: Driver): DriverIq {
  const a = driver.attributes;
  const n = (v: number) => clamp(v / 100, 0, 1);

  const precision = clamp(
    n(a.pace) * 0.34 + n(a.consistency) * 0.3 + n(a.concentration) * 0.22 + n(a.experience) * 0.14,
    0,
    1,
  );
  const attack = clamp(
    n(a.racecraft) * 0.36 + n(a.overtaking) * 0.3 + n(a.aggression) * 0.16 + n(a.pace) * 0.18,
    0,
    1,
  );
  const defend = clamp(
    n(a.racecraft) * 0.3 + n(a.defending) * 0.36 + n(a.concentration) * 0.18 + n(a.experience) * 0.16,
    0,
    1,
  );
  const overall = clamp(precision * 0.4 + attack * 0.3 + defend * 0.3, 0, 1);

  return { overall, attack, defend, precision };
}

/**
 * How much a circuit rewards a clever driver versus raw bravery. Heavy braking
 * zones and low-grip layouts suit high-IQ drivers; flat-out power tracks level
 * the field.
 */
export function circuitIqWeight(circuit: Circuit): number {
  return clamp(0.35 + circuit.brakingDemand * 0.35 + circuit.tractionDemand * 0.3, 0.3, 1);
}

/** Convenience: everything the on-track model needs, precomputed per driver. */
export interface RacerSkill {
  iq: number;
  attack: number;
  defend: number;
  aggression: number;
  overtaking: number;
  defending: number;
  concentration: number;
  experience: number;
}

export function racerSkill(driver: Driver): RacerSkill {
  const iq = driverIq(driver);
  return {
    iq: iq.overall,
    attack: iq.attack,
    defend: iq.defend,
    aggression: clamp(driver.attributes.aggression, 0, 1),
    overtaking: clamp(driver.attributes.overtaking / 100, 0, 1),
    defending: clamp(driver.attributes.defending / 100, 0, 1),
    concentration: clamp(driver.attributes.concentration / 100, 0, 1),
    experience: clamp(driver.attributes.experience / 100, 0, 1),
  };
}
