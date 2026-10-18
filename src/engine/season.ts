import type {
  Career,
  CarSpec,
  ChampionshipStandings,
  Circuit,
  Driver,
  DriverContract,
  Facility,
  FinanceState,
  LobbySettings,
  NewsItem,
  QualifyingResultRow,
  RaceResult,
  Ruleset,
  Season,
  Sponsor,
  SponsorContract,
  StaffMember,
  TeamSpec,
  Transaction,
  UpgradeProject,
  WeatherState,
} from "./types";
import { Rng, clamp, hashSeed, round } from "./rng";
import { getRuleset, DEFAULT_RULESET_ID } from "./rulesets";
import { CIRCUITS, getCircuit } from "../data/circuits";
import { SPONSORS } from "../data/sponsors";
import { buildFictionalDrivers, buildRealDrivers } from "../data/drivers";
import { TEAM_SEEDS, buildAiTeam } from "../data/teams";
import { buildStaff, buildStaffMarket, CORE_ROLES } from "../data/staff";
import { simulateQualifying, type QualiEntrant } from "./qualifying";
import { simulateRace, type RaceSimEntrant, type RaceSimOutput } from "./race";
import { simulatePractice, type PracticeProgram, type PracticeResult } from "./practice";
import { computeStandings } from "./standings";
import { initialWeather } from "./weather";
import { defaultStrategy, makeStrategyPlan } from "./strategy";
import { constructorsPrize, makeTxn } from "./finance";
import { repairCost } from "./damage";
import { tickProject, installUpgrade, facilityLevel, developmentModifiers, emptyInstalled } from "./development";
import { aiDriverMarket } from "./drivermarket";
import { convergeSetup, type Setup } from "./car";

/** Config for whether the real-world AI driver names are used. */
export const ROSTER_CONFIG = { useRealDrivers: false };

export interface CareerSettings {
  aiDifficulty: LobbySettings["aiDifficulty"];
  raceDistancePct: number;
  simSpeed: number;
  startingSeason: number;
  incidentSeverity: LobbySettings["incidentSeverity"];
  driverAvailability: boolean;
  seasonLength: number;
  startBudget: number;
}

export interface TeamSetupState {
  setup: Setup;
  practiceTicks: number;
}

export interface CareerBundle {
  version: number;
  career: Career;
  settings: CareerSettings;
  /** All seasons, including history. Current season is `season`. */
  seasons: Season[];
  season: Season;
  teams: TeamSpec[];
  cars: CarSpec[];
  drivers: Driver[];
  driverContracts: DriverContract[];
  staff: StaffMember[];
  staffMarket: StaffMember[];
  facilities: Facility[];
  finances: FinanceState[];
  transactions: Transaction[];
  upgrades: UpgradeProject[];
  sponsors: Sponsor[];
  sponsorContracts: SponsorContract[];
  standings: ChampionshipStandings;
  results: RaceResult[];
  news: NewsItem[];
  practice: PracticeResult[];
  setups: Record<string, TeamSetupState>;
  /** Grid penalties (driverId -> places) to apply at the next race. */
  gridPenalties: Record<string, number>;
  weekend: {
    season: number;
    raceIndex: number;
    circuitId: string;
    session: string;
    weather: import("./types").WeatherState;
    readyUserIds: string[];
    resultId: string | null;
    startedAt: number | null;
  };
}

export const BUNDLE_VERSION = 1;

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export function generateCalendar(rng: Rng, seasonLength: number): { calendar: string[]; sprintRaces: number[] } {
  const all = CIRCUITS.map((c) => c.id);
  const baseOrder = [
    "bahrain", "jeddah", "albert-park", "suzuka", "shanghai", "miami", "monaco", "barcelona",
    "montreal", "silverstone", "spa", "hungaroring", "zandvoort", "monza", "singapore",
    "cota", "mexico", "interlagos", "las-vegas", "lusail", "yas-marina",
  ].filter((id) => all.includes(id));

  let calendar = baseOrder;
  if (seasonLength < baseOrder.length) {
    // Keep a spread of the season: opening rounds, classics and the finale.
    const must = ["bahrain", "monaco", "silverstone", "monza", "interlagos", "yas-marina"].filter((c) => baseOrder.includes(c));
    const rest = rng.shuffle(baseOrder.filter((c) => !must.includes(c)));
    calendar = [...must, ...rest].sort((a, b) => baseOrder.indexOf(a) - baseOrder.indexOf(b)).slice(0, seasonLength);
    calendar = baseOrder.filter((c) => calendar.includes(c));
  }

  const sprintCount = Math.max(0, Math.min(6, Math.round(seasonLength / 5)));
  const sprintRaces = rng.shuffle(calendar.map((_, i) => i)).slice(0, sprintCount).sort((a, b) => a - b);
  return { calendar, sprintRaces };
}

// ---------------------------------------------------------------------------
// Career creation
// ---------------------------------------------------------------------------

export function createCareerBundle(params: {
  careerId: string;
  lobbyId: string;
  name: string;
  settings: CareerSettings;
}): CareerBundle {
  const rng = new Rng(`career:${params.careerId}`);
  const rulesetId = DEFAULT_RULESET_ID;
  const { calendar, sprintRaces } = generateCalendar(rng, params.settings.seasonLength);

  const season: Season = {
    id: `${params.careerId}:s1`,
    careerId: params.careerId,
    number: 1,
    rulesetId,
    calendar,
    currentRaceIndex: 0,
    completed: false,
    championDriverId: null,
    championTeamId: null,
    sprintRaces,
  };

  const career: Career = {
    id: params.careerId,
    lobbyId: params.lobbyId,
    name: params.name,
    createdAt: Date.now(),
    currentSeason: 1,
    rulesHistory: { 1: rulesetId },
    phase: "setup",
  };

  // AI teams + cars
  const teams: TeamSpec[] = [];
  const cars: CarSpec[] = [];
  const facilities: Facility[] = [];
  const finances: FinanceState[] = [];
  const staff: StaffMember[] = [];
  TEAM_SEEDS.forEach((seed, i) => {
    const { team, car } = buildAiTeam(seed, i, params.careerId, params.settings.aiDifficulty);
    teams.push(team);
    car.season = 1;
    cars.push(car);
    facilities.push(...initialFacilities(team.id));
    finances.push({ teamId: team.id, balance: team.budget, season: 1 });
    const quality = team.reputation / 100;
    staff.push(...buildStaff(params.careerId, team.id, quality, `${team.id}:s1`));
  });

  // Driver pool
  const drivers = ROSTER_CONFIG.useRealDrivers
    ? [...buildRealDrivers(), ...buildFictionalDrivers(params.careerId).map((d, i) => ({ ...d, id: `f-driver-${i}` }))]
    : buildFictionalDrivers(params.careerId);

  // Assign two drivers per AI team, strongest teams pick first.
  const assigned = new Set<string>();
  const byTier = [...teams].sort((a, b) => b.reputation - a.reputation);
  const sortedDrivers = ROSTER_CONFIG.useRealDrivers
    ? [...drivers].sort((a, b) => b.reputation - a.reputation)
    : [...drivers].sort((a, b) => b.attributes.pace + b.potential - (a.attributes.pace + a.potential));
  let di = 0;
  for (const team of byTier) {
    for (let s = 0; s < 2 && di < sortedDrivers.length; s++) {
      const d = findNextDriver(sortedDrivers, assigned, di);
      if (!d) break;
      assigned.add(d.id);
      d.teamId = team.id;
      di = sortedDrivers.indexOf(d) + 1;
    }
  }

  // Add a third driver to the backmarker teams so there are spares.
  const driverContracts: DriverContract[] = [];
  for (const d of drivers) {
    if (!d.teamId) continue;
    driverContracts.push(makeDriverContract(params.careerId, d.id, d.teamId, 1, 2));
  }

  const weekendCircuit = calendar[0];
  const bundle: CareerBundle = {
    version: BUNDLE_VERSION,
    career,
    settings: params.settings,
    seasons: [season],
    season,
    teams,
    cars,
    drivers,
    driverContracts,
    staff,
    staffMarket: buildStaffMarket(params.careerId, 24),
    facilities,
    finances,
    transactions: [],
    upgrades: [],
    sponsors: SPONSORS,
    sponsorContracts: [],
    standings: { season: 1, drivers: [], constructors: [] },
    results: [],
    news: [],
    practice: [],
    setups: {},
    gridPenalties: {},
    weekend: {
      season: 1,
      raceIndex: 0,
      circuitId: weekendCircuit,
      session: "preparation",
      weather: initialWeather(rng, getCircuit(weekendCircuit)),
      readyUserIds: [],
      resultId: null,
      startedAt: null,
    },
  };

  // Initialise per-team setups and give AI teams some sponsor deals.
  for (const team of teams) {
    bundle.setups[team.id] = { setup: { downforce: 3, balance: 0 }, practiceTicks: 0 };
    if (!team.isPlayerTeam) {
      const sponsor = pickSponsorForTeam(rng, team);
      if (sponsor) {
        bundle.sponsorContracts.push({
          id: `sc-${team.id}-${sponsor.id}`,
          careerId: params.careerId,
          teamId: team.id,
          sponsorId: sponsor.id,
          seasons: 2,
          startSeason: 1,
          active: true,
        });
      }
    }
  }

  return bundle;
}

function findNextDriver(sorted: Driver[], assigned: Set<string>, from: number): Driver | null {
  for (let i = from; i < sorted.length; i++) {
    if (!assigned.has(sorted[i].id)) return sorted[i];
  }
  return null;
}

export function initialFacilities(teamId: string): Facility[] {
  const kinds = [
    "factory", "design-office", "wind-tunnel", "simulator",
    "driver-academy", "pit-crew", "commercial", "reliability-lab", "hospitality",
  ] as const;
  return kinds.map((kind, i) => ({
    id: `${teamId}:${kind}`,
    teamId,
    kind,
    level: kind === "factory" ? 2 : i % 3 === 0 ? 2 : 1,
  }));
}

function makeDriverContract(careerId: string, driverId: string, teamId: string, season: number, years: number): DriverContract {
  const d = { id: `dc-${driverId}-${teamId}-${season}` } as const;
  return {
    id: d.id,
    careerId,
    driverId,
    teamId,
    season,
    salary: 0,
    signingBonus: 0,
    winBonus: 0,
    podiumBonus: 0,
    championshipBonus: 0,
    years,
    performanceClausePosition: null,
    active: true,
  };
}

function pickSponsorForTeam(rng: Rng, team: TeamSpec): Sponsor | undefined {
  const eligible = SPONSORS.filter((s) => team.reputation >= s.minReputation - 6);
  if (eligible.length === 0) return undefined;
  return eligible[rng.int(0, eligible.length - 1)];
}

// ---------------------------------------------------------------------------
// Player teams
// ---------------------------------------------------------------------------

export function addPlayerTeam(
  bundle: CareerBundle,
  params: {
    userId: string;
    name: string;
    shortName: string;
    abbreviation: string;
    nationality: string;
    colors: { primary: string; secondary: string; accent: string };
    livery?: TeamSpec["livery"];
    logo?: TeamSpec["logo"];
    headquarters: string;
    engineSupplier: string;
    philosophy: string;
    numberStyle: string;
    budget: number;
  },
): { bundle: CareerBundle; teamId: string } {
  const nameTaken = bundle.teams.some(
    (t) => t.name.toLowerCase() === params.name.toLowerCase() || t.abbreviation.toLowerCase() === params.abbreviation.toLowerCase(),
  );
  if (nameTaken) throw new Error("Team name or abbreviation already in use in this lobby.");

  const teamId = `player-team-${bundle.teams.filter((t) => t.isPlayerTeam).length + 1}`;
  const team: TeamSpec = {
    id: teamId,
    careerId: bundle.career.id,
    name: params.name,
    shortName: params.shortName,
    abbreviation: params.abbreviation.toUpperCase().slice(0, 3),
    nationality: params.nationality,
    isPlayerTeam: true,
    ownerUserId: params.userId,
    colors: params.colors,
    livery:
      params.livery ??
      {
        nose: params.colors.primary,
        frontWing: params.colors.secondary,
        sidepod: params.colors.primary,
        engineCover: params.colors.primary,
        rearWing: params.colors.secondary,
        accentStripe: params.colors.accent,
        halo: params.colors.secondary,
      },
    numberStyle: params.numberStyle,
    logo: params.logo ?? { symbol: "bolt", background: params.colors.primary },
    headquarters: params.headquarters,
    engineSupplier: params.engineSupplier,
    philosophy: params.philosophy,
    budget: params.budget,
    reputation: 55,
    objective: 10,
    aiProfile: null,
  };

  // Player cars start at a "new entrant" level, slightly below midfield.
  const rng = new Rng(`playercar:${teamId}:${bundle.career.id}`);
  const car: CarSpec = {
    teamId,
    season: bundle.season.number,
    aeroEfficiency: round(72 + rng.gaussian(0, 1.5)),
    downforce: round(72 + rng.gaussian(0, 1.5)),
    drag: round(24 + rng.gaussian(0, 2)),
    cornering: round(72 + rng.gaussian(0, 1.5)),
    straightLine: round(74 + rng.gaussian(0, 1.5)),
    braking: round(72 + rng.gaussian(0, 1.5)),
    mechanicalGrip: round(72 + rng.gaussian(0, 1.5)),
    tireFriendliness: round(72 + rng.gaussian(0, 1.5)),
    fuelEfficiency: round(75 + rng.gaussian(0, 1.5)),
    reliability: round(78 + rng.gaussian(0, 1.5)),
    cooling: round(74 + rng.gaussian(0, 1.5)),
    wetPerformance: round(72 + rng.gaussian(0, 1.5)),
    weight: round(810 + rng.gaussian(0, 6)),
    installed: emptyInstalled(),
  };

  const newTeams = [...bundle.teams, team];
  const newCars = [...bundle.cars, car];
  const newFacilities = [...bundle.facilities, ...initialFacilities(teamId)];
  const newFinances = [...bundle.finances, { teamId, balance: params.budget, season: bundle.season.number }];
  const newSetups = { ...bundle.setups, [teamId]: { setup: { downforce: 3, balance: 0 as const }, practiceTicks: 0 } };

  const startingTxn: Transaction = {
    ...makeTxn({ careerId: bundle.career.id, teamId, season: bundle.season.number, raceIndex: 0 }, "starting-capital", params.budget, "Starting capital"),
  };

  return {
    bundle: {
      ...bundle,
      teams: newTeams,
      cars: newCars,
      facilities: newFacilities,
      finances: newFinances,
      setups: newSetups,
      transactions: [...bundle.transactions, startingTxn],
      career: { ...bundle.career, phase: "in-season" },
    },
    teamId,
  };
}

export function signDriver(
  bundle: CareerBundle,
  params: { driverId: string; teamId: string; salary: number; signingBonus: number; winBonus: number; podiumBonus: number; years: number; performanceClausePosition: number | null },
): CareerBundle {
  const driver = bundle.drivers.find((d) => d.id === params.driverId);
  if (!driver) throw new Error("Driver not found");
  if (driver.teamId && driver.teamId !== params.teamId) throw new Error(`${driver.name} is already contracted to another team.`);
  const teamDrivers = bundle.drivers.filter((d) => d.teamId === params.teamId);
  if (teamDrivers.length >= 3) throw new Error("A team may contract at most three drivers.");

  const contract: DriverContract = {
    id: `dc-${params.driverId}-${params.teamId}-${Date.now().toString(36)}`,
    careerId: bundle.career.id,
    driverId: params.driverId,
    teamId: params.teamId,
    season: bundle.season.number,
    salary: params.salary,
    signingBonus: params.signingBonus,
    winBonus: params.winBonus,
    podiumBonus: params.podiumBonus,
    championshipBonus: params.salary,
    years: params.years,
    performanceClausePosition: params.performanceClausePosition,
    active: true,
  };

  const finance = bundle.finances.find((f) => f.teamId === params.teamId);
  const txn = makeTxn(
    { careerId: bundle.career.id, teamId: params.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex },
    "driver-salary",
    -params.signingBonus,
    `Signing bonus: ${driver.name}`,
  );

  return {
    ...bundle,
    drivers: bundle.drivers.map((d) => (d.id === params.driverId ? { ...d, teamId: params.teamId, morale: clamp(d.morale + 6, 0, 100) } : d)),
    driverContracts: [...bundle.driverContracts, contract],
    finances: bundle.finances.map((f) => (f.teamId === params.teamId ? { ...f, balance: f.balance - params.signingBonus } : f)),
    transactions: [...bundle.transactions, txn],
    news: [
      ...bundle.news,
      makeNews(bundle, "contract", "Driver signed", `${driver.name} joins the team.`, bundle.weekend.raceIndex, bundle.season.number),
    ],
    ...(finance ? {} : {}),
  };
}

export function releaseDriver(bundle: CareerBundle, driverId: string): CareerBundle {
  const driver = bundle.drivers.find((d) => d.id === driverId);
  if (!driver || !driver.teamId) return bundle;
  const contract = bundle.driverContracts.find((c) => c.driverId === driverId && c.active);
  const termination = contract ? Math.round(contract.salary * 0.4 * contract.years) : 0;
  const txn = contract
    ? makeTxn({ careerId: bundle.career.id, teamId: contract.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex }, "termination", -termination, `Contract termination: ${driver.name}`)
    : null;

  return {
    ...bundle,
    drivers: bundle.drivers.map((d) => (d.id === driverId ? { ...d, teamId: null, morale: clamp(d.morale - 8, 0, 100) } : d)),
    driverContracts: bundle.driverContracts.map((c) => (c.driverId === driverId ? { ...c, active: false } : c)),
    finances: contract ? bundle.finances.map((f) => (f.teamId === contract.teamId ? { ...f, balance: f.balance - termination } : f)) : bundle.finances,
    transactions: txn ? [...bundle.transactions, txn] : bundle.transactions,
  };
}

// ---------------------------------------------------------------------------
// Practice / qualifying / race weekend
// ---------------------------------------------------------------------------

function buildRaceEntrants(bundle: CareerBundle): RaceSimEntrant[] {
  const ruleset = getRuleset(bundle.season.rulesetId);
  const circuit = getCircuit(bundle.weekend.circuitId);
  const totalLaps = Math.max(5, Math.round(circuit.laps * (bundle.settings.raceDistancePct / 100)));
  const entrants: RaceSimEntrant[] = [];
  for (const team of bundle.teams) {
    const car = bundle.cars.find((c) => c.teamId === team.id);
    if (!car) continue;
    const teamDrivers = bundle.drivers.filter((d) => d.teamId === team.id).slice(0, 2);
    teamDrivers.forEach((driver, idx) => {
      const planned = defaultStrategy(totalLaps, circuit, ruleset);
      const plan = makeStrategyPlan(driver.id, planned);
      entrants.push({
        driverId: driver.id,
        teamId: team.id,
        car,
        driver,
        gridPosition: 0,
        strategy: plan,
        setup: bundle.setups[team.id]?.setup ?? { downforce: 3, balance: 0 },
        decisionSkill: team.isPlayerTeam ? 0.95 : clamp(team.aiProfile?.strategyIQ ?? 0.6, 0.2, 0.98),
      });
      void idx;
    });
  }
  return entrants;
}

export function runPracticeSession(bundle: CareerBundle, session: number): { bundle: CareerBundle; result: PracticeResult } {
  const circuit = getCircuit(bundle.weekend.circuitId);
  const rng = new Rng(`practice:${bundle.career.id}:${bundle.season.number}:${bundle.weekend.raceIndex}:${session}`);
  const programs: PracticeProgram[] = ["setup", "long-run", "quali-sim", "tire-test", "reliability"];
  const entrants = bundle.teams.flatMap((team) => {
    const car = bundle.cars.find((c) => c.teamId === team.id)!;
    return bundle.drivers
      .filter((d) => d.teamId === team.id)
      .slice(0, 2)
      .map((driver, i) => ({
        driverId: driver.id,
        teamId: team.id,
        car,
        driver,
        program: programs[(session + i) % programs.length],
      }));
  });

  const currentSetup = bundle.setups[bundle.teams[0]?.id]?.setup ?? { downforce: 3, balance: 0 };
  const result = simulatePractice(rng, { session, circuit, weather: bundle.weekend.weather, entrants, currentSetup });

  // Apply setup convergence to each team.
  const setups = { ...bundle.setups };
  for (const team of bundle.teams) {
    const drivers = bundle.drivers.filter((d) => d.teamId === team.id);
    const relevant = result.entries.filter((e) => drivers.some((d) => d.id === e.driverId));
    const doSetup = relevant.some((e) => e.driverId);
    if (!doSetup) continue;
    const prev = setups[team.id] ?? { setup: { downforce: 3, balance: 0 }, practiceTicks: 0 };
    const suggested = result.suggestedSetup;
    const blend = clamp(0.4 + session * 0.15, 0, 1);
    setups[team.id] = {
      setup: convergeSetup(prev.setup, suggested, blend),
      practiceTicks: prev.practiceTicks + 1,
    };
  }

  return {
    bundle: { ...bundle, practice: [...bundle.practice, result], setups, weekend: { ...bundle.weekend, session: `practice-${session}` } },
    result,
  };
}

export interface PreparedRace {
  raceId: string;
  seed: number;
  circuit: Circuit;
  totalLaps: number;
  ruleset: Ruleset;
  weatherStart: WeatherState;
  entrants: RaceSimEntrant[];
  qualifying: QualifyingResultRow[];
  poleDriverId: string | null;
}

/**
 * Everything needed to run the race, computed once from the career bundle:
 * qualifying classification, the applied grid, the entrants and the seed.
 * Shared by the instant simulation and the interactive live race so both
 * produce a result in exactly the same shape.
 */
export function prepareRace(bundle: CareerBundle): PreparedRace {
  const careerId = bundle.career.id;
  const season = bundle.season;
  const raceIndex = bundle.weekend.raceIndex;
  const circuit = getCircuit(bundle.weekend.circuitId);
  const ruleset = getRuleset(season.rulesetId);
  const raceId = `${careerId}:s${season.number}:r${raceIndex}`;
  const seed = hashSeed(raceId);

  // ---- Qualifying ----
  const qualRng = new Rng(`${raceId}:quali`);
  const qualiEntrants: QualiEntrant[] = buildRaceEntrants(bundle).map((e) => ({
    driverId: e.driverId,
    teamId: e.teamId,
    car: e.car,
    driver: e.driver,
  }));
  const qualifying = simulateQualifying(qualRng, {
    circuit,
    entries: qualiEntrants,
    weather: bundle.weekend.weather,
    ruleset,
    setupFor: (teamId) => bundle.setups[teamId]?.setup ?? { downforce: 3, balance: 0 },
  });

  // Grid: qualifying order, with penalties applied then cleared.
  const gridDriverIds = qualifying.map((q) => q.driverId);
  const penalised = [...gridDriverIds];
  for (const [driverId, places] of Object.entries(bundle.gridPenalties)) {
    const idx = penalised.indexOf(driverId);
    if (idx >= 0) {
      const target = Math.min(penalised.length - 1, idx + places);
      penalised.splice(idx, 1);
      penalised.splice(target, 0, driverId);
    }
  }

  const totalLaps = Math.max(5, Math.round(circuit.laps * (bundle.settings.raceDistancePct / 100)));
  const entrants = buildRaceEntrants(bundle).map((e) => {
    const idx = penalised.indexOf(e.driverId);
    return { ...e, gridPosition: idx >= 0 ? idx + 1 : e.gridPosition };
  });

  return {
    raceId,
    seed,
    circuit,
    totalLaps,
    ruleset,
    weatherStart: bundle.weekend.weather,
    entrants,
    qualifying,
    poleDriverId: qualifying[0]?.driverId ?? null,
  };
}

/** Insert a finished race into the career and process it exactly once. */
export function commitRaceResult(
  bundle: CareerBundle,
  result: RaceResult,
): { bundle: CareerBundle; result: RaceResult; alreadyProcessed: boolean } {
  if (bundle.weekend.resultId) {
    const existing = bundle.results.find((r) => r.id === bundle.weekend.resultId);
    if (existing) return { bundle, result: existing, alreadyProcessed: existing.processed };
  }
  let next: CareerBundle = {
    ...bundle,
    results: [...bundle.results, result],
    gridPenalties: {},
    weekend: { ...bundle.weekend, resultId: result.id, session: "race" },
  };
  const processed = processRaceResult(next, result.id);
  next = processed.bundle;
  return { bundle: next, result, alreadyProcessed: false };
}

export function runRaceWeekend(bundle: CareerBundle): { bundle: CareerBundle; result: RaceResult; alreadyProcessed: boolean } {
  if (bundle.weekend.resultId) {
    const existing = bundle.results.find((r) => r.id === bundle.weekend.resultId);
    if (existing) return { bundle, result: existing, alreadyProcessed: existing.processed };
  }

  const prep = prepareRace(bundle);

  const out: RaceSimOutput = simulateRace({
    raceId: prep.raceId,
    seed: prep.seed,
    circuit: prep.circuit,
    totalLaps: prep.totalLaps,
    ruleset: prep.ruleset,
    weatherStart: prep.weatherStart,
    entrants: prep.entrants,
    severitySetting: bundle.settings.incidentSeverity,
  });

  const result: RaceResult = {
    ...out.result,
    careerId: bundle.career.id,
    season: bundle.season.number,
    raceIndex: bundle.weekend.raceIndex,
    qualifying: prep.qualifying,
    poleDriverId: prep.poleDriverId,
    finalDamage: out.damageByDriver,
  };

  return commitRaceResult(bundle, result);
}

/**
 * Idempotently apply a race result: points, standings, finance, driver stats,
 * morale, reputation, development and repairs. Re-processing a processed result
 * is a no-op, so it can never be double-counted.
 */
export function processRaceResult(bundle: CareerBundle, resultId: string): { bundle: CareerBundle; applied: boolean } {
  const idx = bundle.results.findIndex((r) => r.id === resultId);
  if (idx < 0) throw new Error("Result not found");
  const result = bundle.results[idx];
  if (result.processed) return { bundle, applied: false };

  const careerId = bundle.career.id;
  const ruleset = getRuleset(bundle.season.rulesetId);
  const circuit = getCircuit(result.circuitId);
  const racesInSeason = bundle.season.calendar.length || 1;
  const rng = new Rng(`process:${resultId}`);

  const transactions: Transaction[] = [...bundle.transactions];
  const finances = bundle.finances.map((f) => ({ ...f }));
  const news: NewsItem[] = [...bundle.news];
  const upgrades = bundle.upgrades.map((u) => ({ ...u }));

  // Development ticks (one per race weekend).
  for (const u of upgrades) {
    if (!u.completed && u.season === bundle.season.number) {
      const ticked = tickProject(u);
      upgrades[upgrades.indexOf(u)] = ticked;
    }
  }

  for (const team of bundle.teams) {
    const car = bundle.cars.find((c) => c.teamId === team.id)!;
    const teamEntries = result.classification.filter((c) => c.teamId === team.id);
    const teamStaff = bundle.staff.filter((s) => s.teamId === team.id);
    const facilities = bundle.facilities.filter((f) => f.teamId === team.id);
    const contracts = bundle.driverContracts.filter((c) => c.teamId === team.id && c.active);
    const sponsorContracts = bundle.sponsorContracts.filter((s) => s.teamId === team.id && s.active);

    const constructionPos = teamEntries.length ? Math.min(...teamEntries.map((e) => e.position)) : 10;

    // Finance: prize money, sponsors, salaries, travel, repairs.
    const racePrizes = teamEntries.map((e) => ({ driverId: e.driverId, position: e.position, points: e.points }));
    let repairTotal = 0;
    for (const e of teamEntries) {
      const dmg = result.finalDamage?.[e.driverId];
      if (!dmg) continue;
      const hasAny = Object.keys(dmg).length > 0;
      if (!hasAny) continue;
      repairTotal += repairCost(
        {
          frontWing: dmg.frontWing ?? 0,
          rearWing: dmg.rearWing ?? 0,
          floor: dmg.floor ?? 0,
          sidepod: dmg.sidepod ?? 0,
          suspension: dmg.suspension ?? 0,
          steering: dmg.steering ?? 0,
          brakes: dmg.brakes ?? 0,
          chassis: dmg.chassis ?? 0,
          cooling: dmg.cooling ?? 0,
          gearbox: dmg.gearbox ?? 0,
          engine: dmg.engine ?? 0,
          tire: dmg.tire ?? 0,
        },
        facilityLevel(facilities, "factory"),
      );
    }

    const ctx = { careerId, teamId: team.id, season: bundle.season.number, raceIndex: result.raceIndex };
    const prizeTxns = racePrizes.map((p) =>
      makeTxn(ctx, "prize-money", Math.round(200_000 + p.points * 60_000 + (11 - p.position) * 40_000), `Race prize money (P${p.position})`),
    );
    const sponsorTxns = sponsorContracts.map((sc) => {
      const sponsor = bundle.sponsors.find((s) => s.id === sc.sponsorId)!;
      return makeTxn(ctx, "sponsor-per-race", sponsor.perRace, `${sponsor.name} race payment`);
    });
    const salaryTotal = contracts.reduce((s, c) => s + Math.round(c.salary / racesInSeason), 0);
    const staffTotal = teamStaff.reduce((s, st) => s + Math.round(st.wage / racesInSeason), 0);
    const upkeepTotal = facilities.reduce((s, f) => s + Math.round((2_000_000 * (1 + f.level * 0.5)) / racesInSeason), 0);

    const txns = [
      ...prizeTxns,
      ...sponsorTxns,
      makeTxn(ctx, "driver-salary", -salaryTotal, "Driver salaries"),
      makeTxn(ctx, "staff-wage", -staffTotal, "Staff wages"),
      makeTxn(ctx, "facility-upkeep", -upkeepTotal, "Facility upkeep"),
      makeTxn(ctx, "travel", -900_000, "Travel & logistics"),
    ];
    if (repairTotal > 0) txns.push(makeTxn(ctx, "repairs", -repairTotal, "Crash repairs"));

    const delta = txns.reduce((s, t) => s + t.amount, 0);
    const fin = finances.find((f) => f.teamId === team.id)!;
    fin.balance = Math.round(fin.balance + delta);
    transactions.push(...txns);

    // Bankruptcy warning.
    if (fin.balance < 0) {
      news.push(makeNews(bundle, "finance", "Financial warning", `${team.name} is in the red ($${Math.round(fin.balance / 1e6)}M). Emergency funding may be required.`, result.raceIndex, bundle.season.number));
    }

    // Reputation moves with results.
    const avgFinish = teamEntries.reduce((s, e) => s + e.position, 0) / Math.max(1, teamEntries.length);
    const repDelta = clamp((10 - avgFinish) * 0.4, -2.5, 2.5);
    const teamRef = bundle.teams.find((t) => t.id === team.id)!;
    teamRef.reputation = clamp(round(teamRef.reputation + repDelta, 1), 20, 99);

    // Auto-install completed AI upgrades.
    if (!team.isPlayerTeam) {
      for (const u of upgrades) {
        if (u.teamId === team.id && u.completed && !u.installed) {
          const carRef = bundle.cars.find((c) => c.teamId === team.id)!;
          const updated = installUpgrade(carRef, u);
          Object.assign(carRef, updated);
          u.installed = true;
        }
      }
    }
    void car;
    void constructionPos;
    void rng;
    void ruleset;
    void circuit;
  }

  // Driver stats + morale.
  const drivers = bundle.drivers.map((d) => {
    const entry = result.classification.find((c) => c.driverId === d.id);
    if (!entry) return d;
    return {
      ...d,
      starts: d.starts + 1,
      careerPoints: d.careerPoints + entry.points,
      careerWins: d.careerWins + (entry.position === 1 && entry.status === "finished" ? 1 : 0),
      careerPodiums: d.careerPodiums + (entry.position <= 3 && entry.status === "finished" ? 1 : 0),
      careerPoles: d.careerPoles + (result.poleDriverId === d.id ? 1 : 0),
      morale: clamp(d.morale + (entry.status === "finished" ? clamp((11 - entry.position) * 1.5, -6, 8) : -6), 20, 100),
    };
  });

  // Standings from all processed results + this one.
  const processedResults = bundle.results.map((r) => (r.id === resultId ? { ...result, processed: true } : r));
  const standings = computeStandings(processedResults, bundle.season.number);

  // News
  const winner = result.classification[0];
  const winnerDriver = winner ? bundle.drivers.find((d) => d.id === winner.driverId) : undefined;
  if (winnerDriver) {
    news.push(makeNews(bundle, "race", `${winnerDriver.name} wins in ${circuit.location}`, `Round ${result.raceIndex + 1}: ${winnerDriver.name} takes the win.`, result.raceIndex, bundle.season.number));
  }
  for (const inc of result.incidents.filter((i) => i.severity >= 3).slice(0, 3)) {
    news.push(makeNews(bundle, "incident", "Incident report", inc.narrative, result.raceIndex, bundle.season.number));
  }

  const updatedResults = bundle.results.map((r) => (r.id === resultId ? { ...result, processed: true } : r));

  return {
    bundle: {
      ...bundle,
      results: updatedResults,
      standings,
      drivers,
      finances,
      transactions,
      news,
      upgrades,
    },
    applied: true,
  };
}

export function advanceCalendar(bundle: CareerBundle): CareerBundle {
  const season = bundle.season;
  const nextIndex = season.currentRaceIndex + 1;
  if (nextIndex >= season.calendar.length) {
    return endSeason(bundle);
  }
  const nextCircuit = season.calendar[nextIndex];
  const rng = new Rng(`weekend:${bundle.career.id}:${season.number}:${nextIndex}`);
  const updatedSeason = { ...season, currentRaceIndex: nextIndex };
  return {
    ...bundle,
    season: updatedSeason,
    seasons: bundle.seasons.map((s) => (s.number === season.number ? updatedSeason : s)),
    weekend: {
      season: season.number,
      raceIndex: nextIndex,
      circuitId: nextCircuit,
      session: "preparation",
      weather: initialWeather(rng, getCircuit(nextCircuit)),
      readyUserIds: [],
      resultId: null,
      startedAt: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Season end / start
// ---------------------------------------------------------------------------

export function endSeason(bundle: CareerBundle): CareerBundle {
  const season = bundle.season;
  const standings = computeStandings(bundle.results, season.number);
  const championDriverId = standings.drivers[0]?.driverId ?? null;
  const championTeamId = standings.constructors[0]?.teamId ?? null;

  const finances = bundle.finances.map((f) => ({ ...f }));
  const transactions = [...bundle.transactions];
  for (const fin of finances) {
    const pos = standings.constructors.find((c) => c.teamId === fin.teamId)?.position ?? 10;
    const prize = constructorsPrize(pos);
    fin.balance += prize;
    transactions.push(makeTxn({ careerId: bundle.career.id, teamId: fin.teamId, season: season.number, raceIndex: 99 }, "prize-money", prize, `Constructors' championship prize (P${pos})`));
  }

  // Staff/salary already paid per race; sponsor position bonuses.
  for (const sc of bundle.sponsorContracts.filter((s) => s.active)) {
    const sponsor = bundle.sponsors.find((s) => s.id === sc.sponsorId);
    if (!sponsor) continue;
    const pos = standings.constructors.find((c) => c.teamId === sc.teamId)?.position ?? 10;
    if (pos <= sponsor.targetPosition) {
      const fin = finances.find((f) => f.teamId === sc.teamId)!;
      fin.balance += sponsor.positionBonus;
      transactions.push(makeTxn({ careerId: bundle.career.id, teamId: sc.teamId, season: season.number, raceIndex: 99 }, "sponsor-bonus", sponsor.positionBonus, `${sponsor.name} position bonus (P${pos})`));
    }
  }

  const completedSeason: Season = { ...season, completed: true, championDriverId, championTeamId };
  const newsUpdate = [
    ...bundle.news,
    makeNews(
      bundle,
      "championship",
      "Season complete",
      `${standings.drivers[0] ? bundle.drivers.find((d) => d.id === championDriverId)?.name : "The champion"} wins the ${season.number} Drivers' Championship.`,
      99,
      season.number,
    ),
  ];

  return {
    ...bundle,
    season: completedSeason,
    seasons: bundle.seasons.map((s) => (s.number === season.number ? completedSeason : s)),
    standings,
    finances,
    transactions,
    news: newsUpdate,
    career: { ...bundle.career, phase: "off-season" },
  };
}

export function startNextSeason(bundle: CareerBundle, sameRuleset = true): CareerBundle {
  const rng = new Rng(`nextseason:${bundle.career.id}:${bundle.season.number + 1}`);
  const newNumber = bundle.season.number + 1;
  const { calendar, sprintRaces } = generateCalendar(rng, bundle.settings.seasonLength);
  const rulesetId = sameRuleset ? bundle.season.rulesetId : rng.pick(["classic-25-18", "no-points-fastest-lap"]);

  // Driver progression: age, potential realised, decline past peak.
  const drivers = bundle.drivers.map((d) => {
    const age = d.age + 1;
    const growth = d.age < 24 ? rng.range(1, 4) : d.age > d.peakAge ? -rng.range(0.5, 2) : rng.range(-0.2, 0.8);
    const att = { ...d.attributes };
    att.pace = round(clamp(att.pace + growth, 40, 99));
    att.qualifying = round(clamp(att.qualifying + growth, 40, 99));
    att.racecraft = round(clamp(att.racecraft + Math.max(0, growth), 40, 99));
    att.experience = round(clamp(att.experience + 5, 0, 100));
    return { ...d, age, attributes: att, potential: round(clamp(d.potential - (d.potential - Math.max(...Object.values(att))) * 0.3, 40, 99)) };
  });

  // Driver market: expiring contracts, retirements, rookies, AI signings.
  let driversAfter = drivers;
  const retirements = driversAfter.filter((d) => d.age >= 38 && rng.chance(0.4));
  driversAfter = driversAfter.filter((d) => !retirements.includes(d));
  // Rookies
  const rookiePool = buildFictionalDrivers(`${bundle.career.id}:s${newNumber}`).slice(0, 4).map((d, i) => ({ ...d, id: `rookie-s${newNumber}-${i}`, age: 19 + i }));
  driversAfter = [...driversAfter, ...rookiePool];

  // AI signings to fill seats.
  const freeAgents = driversAfter.filter((d) => d.teamId === null);
  const assigned = new Set<string>();
  const teamObjectives: Record<string, number> = {};
  for (const t of bundle.teams) teamObjectives[t.id] = t.objective;
  const signings = aiDriverMarket(rng, bundle.teams.filter((t) => !t.isPlayerTeam), freeAgents, assigned, teamObjectives);

  const driverContracts = bundle.driverContracts; // keep history
  const newContracts: DriverContract[] = [];
  for (const s of signings) {
    const d = driversAfter.find((x) => x.id === s.driverId)!;
    d.teamId = s.teamId;
    newContracts.push({
      id: `dc-${s.driverId}-${s.teamId}-s${newNumber}`,
      careerId: bundle.career.id,
      driverId: s.driverId,
      teamId: s.teamId,
      season: newNumber,
      salary: s.salary,
      signingBonus: 0,
      winBonus: 0,
      podiumBonus: 0,
      championshipBonus: s.salary,
      years: s.years,
      performanceClausePosition: null,
      active: true,
    });
  }

  // Carry player-team drivers onto the new season automatically.
  for (const d of driversAfter) {
    if (d.teamId && bundle.teams.find((t) => t.id === d.teamId)?.isPlayerTeam) {
      newContracts.push({
        id: `dc-${d.id}-${d.teamId}-s${newNumber}`,
        careerId: bundle.career.id,
        driverId: d.id,
        teamId: d.teamId,
        season: newNumber,
        salary: bundle.driverContracts.find((c) => c.driverId === d.id && c.active)?.salary ?? 3_000_000,
        signingBonus: 0,
        winBonus: 0,
        podiumBonus: 0,
        championshipBonus: 0,
        years: 1,
        performanceClausePosition: null,
        active: true,
      });
    }
  }

  const season: Season = {
    id: `${bundle.career.id}:s${newNumber}`,
    careerId: bundle.career.id,
    number: newNumber,
    rulesetId,
    calendar,
    currentRaceIndex: 0,
    completed: false,
    championDriverId: null,
    championTeamId: null,
    sprintRaces,
  };

  const newCircuit = calendar[0];
  return {
    ...bundle,
    career: { ...bundle.career, currentSeason: newNumber, phase: "in-season", rulesHistory: { ...bundle.career.rulesHistory, [newNumber]: rulesetId } },
    season,
    seasons: [...bundle.seasons, season],
    drivers: driversAfter,
    driverContracts: [...driverContracts, ...newContracts],
    weekend: {
      season: newNumber,
      raceIndex: 0,
      circuitId: newCircuit,
      session: "preparation",
      weather: initialWeather(rng, getCircuit(newCircuit)),
      readyUserIds: [],
      resultId: null,
      startedAt: null,
    },
    cars: bundle.cars.map((c) => ({ ...c, season: newNumber })),
    news: [...bundle.news, makeNews(bundle, "championship", `Season ${newNumber} begins`, `${rookiePool.length} rookies join the grid; ${retirements.length} drivers retired.`, 0, newNumber)],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNews(bundle: CareerBundle, kind: NewsItem["kind"], title: string, body: string, raceIndex: number, season: number): NewsItem {
  return {
    id: `news-${bundle.career.id}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
    careerId: bundle.career.id,
    season,
    raceIndex,
    kind,
    title,
    body,
    createdAt: Date.now(),
    read: false,
  };
}

export function teamSetup(bundle: CareerBundle, teamId: string): Setup {
  return bundle.setups[teamId]?.setup ?? { downforce: 3, balance: 0 };
}

export function teamDevelopmentModifiers(bundle: CareerBundle, teamId: string) {
  const facilities = bundle.facilities.filter((f) => f.teamId === teamId);
  const staff = bundle.staff.filter((s) => s.teamId === teamId);
  const topSkill = Math.max(...CORE_ROLES.map((role) => staff.find((s) => s.role === role)?.skill ?? 0));
  return developmentModifiers(facilities, topSkill);
}

export function aiDevelopmentRound(bundle: CareerBundle): CareerBundle {
  // AI teams start new research projects to keep developing through the season.
  const upgrades = [...bundle.upgrades];
  const rng = new Rng(`aidev:${bundle.career.id}:${bundle.season.number}:${bundle.weekend.raceIndex}`);
  for (const team of bundle.teams.filter((t) => !t.isPlayerTeam)) {
    const active = upgrades.filter((u) => u.teamId === team.id && !u.completed);
    const mods = teamDevelopmentModifiers(bundle, team.id);
    if (active.length >= mods.maxConcurrent) continue;
    if (!rng.chance(0.35 + (team.aiProfile?.developmentEfficiency ?? 0.5) * 0.3)) continue;
    const areas = ["front-wing", "rear-wing", "floor", "sidepods", "suspension", "brakes", "cooling", "engine"] as const;
    const area = rng.pick(areas);
    const project = {
      id: `proj-${team.id}-${area}-${bundle.season.number}-${bundle.weekend.raceIndex}-${rng.int(0, 1e6)}`,
      careerId: bundle.career.id,
      teamId: team.id,
      area,
      name: `${area} upgrade`,
      quality: round(clamp(rng.gaussian(70, 12), 25, 100)),
      cost: Math.round(1_500_000 * rng.range(0.9, 1.2)),
      durationTicks: Math.max(1, Math.round(2 / mods.speed)),
      ticksRemaining: Math.max(1, Math.round(2 / mods.speed)),
      nominalGain: 2.2,
      completed: false,
      installed: false,
      season: bundle.season.number,
      createdAt: Date.now(),
    };
    upgrades.push(project);
  }
  return { ...bundle, upgrades };
}
