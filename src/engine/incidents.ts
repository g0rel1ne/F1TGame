import type {
  Circuit,
  Compound,
  DamageState,
  Driver,
  IncidentKind,
  IncidentResponsibility,
  IncidentSeverity,
  RaceIncident,
  WeatherState,
} from "./types";
import type { Rng } from "./rng";
import { clamp } from "./rng";

export interface NearbyCar {
  driverId: string;
  /** Seconds behind the focus car (positive == behind). */
  gap: number;
  /** Aggression 0..1 of the other car. */
  aggression: number;
  /** Skill 0..1 of the other car. */
  skill: number;
  defending: boolean;
}

export interface IncidentContext {
  driverId: string;
  driver: Driver;
  carReliability: number; // 0..100
  damage: DamageState;
  circuit: Circuit;
  weather: WeatherState;
  lap: number;
  totalLaps: number;
  isFirstLap: boolean;
  isRestart: boolean;
  isPitEntry: boolean;
  strategyRisk: "low" | "medium" | "high";
  compound: Compound;
  tireAge: number;
  tireGrip: number; // 0..1
  fuelLaps: number;
  nearby: NearbyCar[];
  severitySetting: "lenient" | "realistic" | "strict";
  /** 0..1 quality of the "brain" controlling this car (AI difficulty / 1 for humans). */
  decisionSkill: number;
}

const SEVERITY_MULT = { lenient: 0.7, realistic: 1, strict: 1.45 } as const;
const RISK_MULT = { low: 0.78, medium: 1, high: 1.35 } as const;

/**
 * Per-lap probability that this car is involved in an incident, in [0, 0.08].
 * Built from additive risk factors, so a collision needs several contributing
 * causes rather than a single unlucky roll.
 */
export function computeLapIncidentRisk(ctx: IncidentContext): number {
  const a = ctx.driver.attributes;
  const consistency = a.consistency / 100;
  const concentration = a.concentration / 100;

  let p = 0.0016 * (1 - consistency) + 0.0012 * (1 - concentration);
  p *= 1 - clamp(a.experience / 100, 0, 1) * 0.3;
  p *= 1 - clamp(ctx.decisionSkill, 0, 1) * 0.22;

  // Wet / low-grip conditions.
  p += Math.pow(ctx.weather.trackWetness, 1.4) * 0.006 * (1 - a.wet / 150);

  // Worn tyres and existing damage.
  p += clamp((1 - ctx.tireGrip) * 0.01, 0, 0.01);
  const dmg = (Object.values(ctx.damage) as number[]).reduce((s, v) => s + v, 0);
  p += clamp(dmg * 0.004, 0, 0.02);

  // Traffic proximity and wheel-to-wheel risk.
  for (const n of ctx.nearby) {
    const proximity = clamp(1 - Math.abs(n.gap) / 1.4, 0, 1);
    if (proximity <= 0) continue;
    p += 0.0018 * proximity * (0.5 + a.aggression) * (1 - n.skill * 0.6);
  }

  if (ctx.isFirstLap) p *= 2.6 + ctx.circuit.danger;
  if (ctx.isRestart) p *= 1.7;
  if (ctx.isPitEntry) p *= 1.4;
  p *= ctx.circuit.danger * 0.6 + 0.7;
  p *= RISK_MULT[ctx.strategyRisk];
  p *= SEVERITY_MULT[ctx.severitySetting];

  return clamp(p, 0, 0.08);
}

function pickKind(rng: Rng, ctx: IncidentContext): IncidentKind {
  const wet = ctx.weather.trackWetness;
  const hasTraffic = ctx.nearby.some((n) => Math.abs(n.gap) < 1.2);
  const weights: Array<[IncidentKind, number]> = [
    ["spin", 3],
    ["lock-up", 2.2],
    ["near-miss", 1.6],
    ["mechanical", 1.4 + (1 - ctx.carReliability / 100) * 4],
    ["tire-failure", 0.6 + clamp((1 - ctx.tireGrip) * 2, 0, 2)],
    ["barrier", 0.8],
    ["aquaplaning", wet > 0.4 ? 4 : 0.1],
    ["debris", 0.4],
    ["pit-lane", ctx.isPitEntry ? 2.5 : 0],
  ];
  if (hasTraffic) {
    weights.push(["contact", 3.2], ["rear-end", 1.8], ["side-to-side", 2.0], ["divebomb", 1.4]);
    if (ctx.isFirstLap) weights.push(["first-lap", 6]);
    if (ctx.nearby.filter((n) => Math.abs(n.gap) < 0.8).length >= 2) weights.push(["multi-car", 1.2]);
  }
  const kinds = weights.filter((w) => w[1] > 0).map((w) => w[0]);
  const ws = weights.filter((w) => w[1] > 0).map((w) => w[1]);
  return rng.weighted(kinds, ws);
}

function pickSeverity(rng: Rng, ctx: IncidentContext, kind: IncidentKind): IncidentSeverity {
  const highSpeed = clamp(ctx.circuit.lengthKm / 7, 0.25, 1);
  const wet = ctx.weather.trackWetness;
  const speedRoll = rng.next() * (0.8 + highSpeed * 0.8 + wet * 0.5);
  const raw = clamp(
    speedRoll +
      (ctx.isFirstLap ? 0.15 : 0) +
      (kind === "multi-car" ? 0.25 : 0) +
      (kind === "mechanical" ? 0.1 : 0) +
      rng.gaussian(0, 0.18),
    0,
    1.4,
  );
  if (kind === "near-miss") return 0;
  if (kind === "lock-up" || kind === "aquaplaning") return raw < 0.75 ? 1 : 2;
  if (raw < 0.42) return 1;
  if (raw < 0.78) return 2;
  if (raw < 1.05) return 3;
  return 4;
}

function damageForKind(
  rng: Rng,
  kind: IncidentKind,
  severity: IncidentSeverity,
  primaryIsAhead: boolean,
): { primary: Partial<DamageState>; secondary: Partial<DamageState> } {
  const s = severity;
  const empty = { primary: {}, secondary: {} };
  if (s === 0) return { primary: { frontWing: rng.range(0.02, 0.06) }, secondary: {} };

  switch (kind) {
    case "rear-end":
      return {
        primary: { frontWing: rng.range(0.2, 0.5) * s, floor: rng.range(0, 0.1) * s },
        secondary: { rearWing: rng.range(0.1, 0.35) * s, floor: rng.range(0, 0.15) * s },
      };
    case "side-to-side":
    case "divebomb":
    case "contact":
    case "first-lap":
    case "multi-car":
      return {
        primary: {
          frontWing: rng.range(0.1, 0.35) * s,
          suspension: rng.range(0, 0.4) * (s - 1),
          sidepod: rng.range(0, 0.25) * (s - 1),
          tire: rng.chance(0.25 * s) ? rng.range(0.3, 0.8) : 0,
        },
        secondary: {
          rearWing: rng.range(0, 0.3) * (s - 1),
          floor: rng.range(0, 0.3) * (s - 1),
          suspension: rng.range(0, 0.35) * (s - 1),
          sidepod: rng.range(0.1, 0.4) * (s - 1),
        },
      };
    case "barrier":
      return {
        primary: {
          frontWing: rng.range(0.3, 0.6) * s,
          suspension: rng.range(0.1, 0.5) * s,
          chassis: rng.range(0, 0.4) * (s - 1),
          floor: rng.range(0, 0.3) * (s - 1),
        },
        secondary: {},
      };
    case "spin":
      return {
        primary: { floor: rng.range(0, 0.25) * s, rearWing: rng.range(0, 0.2) * s, tire: rng.range(0, 0.4) * (s - 1) },
        secondary: {},
      };
    case "tire-failure":
      return { primary: { tire: rng.range(0.6, 1.0), floor: rng.range(0, 0.2) * (s - 1) }, secondary: {} };
    case "mechanical": {
      const component = rng.pick(["engine", "gearbox", "brakes", "cooling", "steering"] as const);
      return { primary: { [component]: rng.range(0.4, 1.0) * s } as Partial<DamageState>, secondary: {} };
    }
    case "debris":
      return { primary: { floor: rng.range(0, 0.15) * s, sidepod: rng.range(0, 0.15) * s }, secondary: {} };
    case "pit-lane":
      return {
        primary: { frontWing: rng.range(0.1, 0.4) * s, suspension: rng.range(0, 0.3) * (s - 1) },
        secondary: { frontWing: rng.range(0, 0.2) * (s - 1) },
      };
    case "lock-up":
      return { primary: { tire: rng.range(0.2, 0.5) }, secondary: {} };
    case "aquaplaning":
      return { primary: { frontWing: rng.range(0, 0.3) * s, floor: rng.range(0, 0.2) * s }, secondary: {} };
    case "near-miss":
    default:
      return primaryIsAhead ? empty : { primary: {}, secondary: {} };
  }
}

const NARRATIVE: Record<IncidentKind, string[]> = {
  "near-miss": ["{a} runs wide and takes to the run-off, rejoining without contact.", "{a} has a big moment but keeps it out of the barriers."],
  contact: ["Contact between {a} and {b}. Both cars continue.", "{a} and {b} touch — the stewards will look at that."],
  "rear-end": ["{a} brakes too late and runs into the back of {b}.", "A misjudged braking point sends {a} into {b}."],
  "side-to-side": ["{a} and {b} fight for the same piece of track and make wheel-to-wheel contact.", "{a} and {b} are side by side and touch, both lucky to continue."],
  divebomb: ["{a} dives down the inside of {b} with insufficient space and they collide.", "An optimistic move from {a} on {b} ends in contact."],
  "lock-up": ["{a} locks a front tyre under braking and runs wide.", "{a} has a big lock-up into the corner, flat-spotting a tyre."],
  spin: ["{a} loses the rear on corner exit and spins.", "{a} spins under braking on the slippery surface."],
  aquaplaning: ["{a} aquaplanes on standing water and loses control.", "Heavy spray and standing water catch {a} out."],
  "first-lap": ["A first-lap collision at the congested opening corner involves {a} and {b}.", "Turn 1 chaos — {a} and {b} are caught in the pack."],
  barrier: ["{a} leaves the track and strikes the barrier.", "{a} runs wide and makes heavy contact with the wall."],
  mechanical: ["A mechanical failure leaves {a} with an ill-handling car.", "{a} reports a problem — looks mechanical."],
  "tire-failure": ["A sudden tyre failure for {a}!", "{a} suffers a puncture and loses control."],
  debris: ["Debris on the racing line is collected by {a}.", "{a} runs over debris from an earlier incident."],
  "multi-car": ["A multi-car incident! {a} and {b} are involved as the track becomes blocked.", "Several cars collide — {a} and {b} are caught up."],
  "pit-lane": ["An unsafe moment in the pit lane involves {a}.", "{a} is released into the path of traffic in the pit lane."],
};

function responsibility(
  rng: Rng,
  kind: IncidentKind,
  ctx: IncidentContext,
  other: NearbyCar | null,
): { finding: IncidentResponsibility; responsible: string | null; penalty: RaceIncident["penalty"] } {
  if (kind === "mechanical" || kind === "tire-failure" || kind === "aquaplaning")
    return { finding: kind === "aquaplaning" ? "weather" : "mechanical", responsible: null, penalty: null };
  if (kind === "spin" || kind === "lock-up" || kind === "barrier" || kind === "debris" || kind === "near-miss")
    return { finding: "driver-a", responsible: ctx.driverId, penalty: null };
  if (!other) return { finding: "racing-incident", responsible: null, penalty: null };

  const aggressionA = ctx.driver.attributes.aggression;
  const aggressionB = other.aggression;
  const aIsBehind = other.gap < 0;
  const attackerAgg = aIsBehind ? aggressionA : aggressionB;
  const score = kind === "divebomb" || kind === "rear-end" ? 0.7 : 0.45;
  const roll = rng.next() * (1 + attackerAgg) - score;

  if (roll > 0.55) {
    const responsible = aIsBehind ? (kind === "rear-end" || kind === "divebomb" ? ctx.driverId : other.driverId) : other.driverId;
    const type = rng.pick(["time", "time", "drive-through", "grid"] as const);
    const penalty: RaceIncident["penalty"] =
      type === "time"
        ? { type: "time", seconds: rng.pick([5, 5, 10]), driverId: responsible }
        : type === "drive-through"
          ? { type: "drive-through", driverId: responsible }
          : { type: "grid", places: rng.pick([3, 5, 10]), driverId: responsible };
    return { finding: aIsBehind ? "driver-a" : "driver-b", responsible, penalty };
  }
  if (rng.chance(0.25)) return { finding: "both", responsible: null, penalty: null };
  return { finding: "racing-incident", responsible: null, penalty: null };
}

function neutralisation(severity: IncidentSeverity, kind: IncidentKind, circuit: Circuit, rng: Rng): RaceIncident["neutralisation"] {
  if (severity <= 1) return "none";
  if (severity === 2) return rng.chance(0.5) ? "yellow" : rng.chance(0.4) ? "virtual-safety-car" : "none";
  if (severity === 3) return circuit.danger > 0.6 || kind === "barrier" ? "safety-car" : rng.chance(0.6) ? "safety-car" : "virtual-safety-car";
  return rng.chance(0.25) ? "red-flag" : "safety-car";
}

/**
 * Roll a single incident for a car on a lap. Returns null most laps.
 * All randomness flows through the supplied (race-seeded) Rng.
 */
export function generateIncident(rng: Rng, ctx: IncidentContext, raceId: string): RaceIncident | null {
  const p = computeLapIncidentRisk(ctx);
  if (!rng.chance(p)) return null;

  const kind = pickKind(rng, ctx);
  const severity = pickSeverity(rng, ctx, kind);
  const other = kind === "mechanical" || kind === "tire-failure" || kind === "spin" || kind === "lock-up" || kind === "barrier" || kind === "debris" || kind === "aquaplaning" || kind === "near-miss"
    ? null
    : (ctx.nearby.find((n) => Math.abs(n.gap) < 1.2) ?? null);

  const involvedIds = [ctx.driverId, ...(other ? [other.driverId] : [])];
  const aIsBehind = other ? other.gap < 0 : false;
  const primaryIsAhead = !aIsBehind;
  const dmg = damageForKind(rng, kind, severity, primaryIsAhead);

  const damage: Record<string, Partial<DamageState>> = { [ctx.driverId]: dmg.primary };
  if (other) damage[other.driverId] = dmg.secondary;

  const { finding, responsible, penalty } = responsibility(rng, kind, ctx, other);

  const template = rng.pick(NARRATIVE[kind]);
  const names: Record<string, string> = { a: ctx.driver.name };
  if (other) names.b = other.driverId;

  const factors: string[] = [];
  if (ctx.weather.trackWetness > 0.3) factors.push(`wet track (${Math.round(ctx.weather.trackWetness * 100)}%)`);
  if (ctx.tireAge > 15) factors.push(`worn tyres (${ctx.tireAge} laps)`);
  if (ctx.tireGrip < 0.9) factors.push(`reduced grip (${Math.round(ctx.tireGrip * 100)}%)`);
  if (dmg.primary && Object.keys(dmg.primary).length) factors.push("light contact");
  if (ctx.isFirstLap) factors.push("first-lap congestion");
  if (ctx.nearby.length) factors.push("wheel-to-wheel battle");
  const overallDamage = Object.values(ctx.damage).reduce((s, v) => s + v, 0);
  if (overallDamage > 0.3) factors.push("pre-existing damage");
  if (factors.length === 0) factors.push("loss of grip");

  const narrative = template.replace("{a}", ctx.driver.name).replace("{b}", other ? lookupName(ctx, other.driverId) : "");

  return {
    id: `${raceId}:inc:${ctx.lap}:${ctx.driverId}:${Math.floor(rng.next() * 1e6)}`,
    raceId,
    lap: ctx.lap,
    trackPosition: rng.range(0, 1),
    corner: `Turn ${rng.int(1, ctx.circuit.corners)}`,
    kind,
    severity,
    involvedDriverIds: involvedIds,
    responsibility: finding,
    responsibleDriverId: responsible,
    damage,
    narrative,
    factors,
    penalty,
    neutralisation: neutralisation(severity, kind, ctx.circuit, rng),
  };
}

function lookupName(_ctx: IncidentContext, id: string): string {
  return id;
}
