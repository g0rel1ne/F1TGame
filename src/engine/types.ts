/**
 * Core domain model for F1 Team Principal Online.
 *
 * Everything here is plain, serialisable data so it can be stored in the
 * database, the local IndexedDB backend, or sent over the wire unchanged.
 */

export type Compound = "soft" | "medium" | "hard" | "intermediate" | "wet";

export type Weather = "dry" | "cloudy" | "light-rain" | "heavy-rain";

export type SessionType = "practice" | "qualifying" | "sprint" | "race";

/** Scoring and sporting configuration. Season data drives this; nothing is hardcoded. */
export interface Ruleset {
  id: string;
  name: string;
  /** Points for finishing positions, index 0 => P1. */
  racePoints: number[];
  /** Points for a sprint, index 0 => P1. Empty when sprints are disabled. */
  sprintPoints: number[];
  /** Points awarded for fastest lap, if the driver finishes inside fastestLapTopN. */
  fastestLapPoints: number;
  fastestLapTopN: number;
  /** Cars eliminated after Q1 and Q2 (rest qualify). */
  q1Eliminated: number;
  q2Eliminated: number;
  /** Whether a mandatory pit stop / two-compound rule applies. */
  mandatoryPitStop: boolean;
  /** Cost cap in USD millions, 0 == disabled. */
  costCap: number;
  /** Whether safety cars can be deployed. */
  safetyCars: boolean;
  virtualSafetyCars: boolean;
  redFlags: boolean;
}

export interface Sector {
  /** 0..1 normalised position where the sector ends. */
  end: number;
}

export interface DrsZone {
  /** 0..1 normalised start/end positions of the detection/activation zone. */
  start: number;
  end: number;
  label: string;
}

export interface TrackPoint {
  x: number;
  y: number;
}

export interface Circuit {
  id: string;
  name: string;
  officialName: string;
  location: string;
  country: string;
  countryCode: string;
  /** Lap distance in kilometres. */
  lengthKm: number;
  corners: number;
  /** Typical race lap count at full distance. */
  laps: number;
  /** Reference competitive lap time in seconds (dry, low fuel). */
  referenceLapSeconds: number;
  drsZones: DrsZone[];
  /** Extra seconds lost per pit stop (pit lane transit + stop), typical. */
  pitLossSeconds: number;
  /** 0..1, ease of overtaking (higher == easier). */
  overtaking: number;
  /** 0..1, how hard the surface is on tyres (higher == more wear). */
  tyreWear: number;
  /** 0..1, importance of mechanical grip vs aero (higher == more mechanical). */
  tractionDemand: number;
  /** 0..1, how much aero efficiency matters (higher == more aero). */
  aeroDemand: number;
  /** 0..1, braking severity. */
  brakingDemand: number;
  /** 0..1, likelihood of rain during a race weekend. */
  rainChance: number;
  /** 0..1, how much the track rubbers in over a weekend. */
  surfaceEvolution: number;
  /** 0..1, risk factor for incidents (street circuits higher). */
  danger: number;
  sectors: Sector[];
  /** Real circuit outline derived from open map data (normalised 0..1). */
  outline: TrackPoint[];
  /** Brief circuit note shown on the info page. */
  blurb: string;
  /** Provenance note for the data shown. */
  dataSource: string;
}

export type DriverTrait =
  | "aggressive"
  | "consistent"
  | "tire-whisperer"
  | "qualifying-specialist"
  | "wet-master"
  | "rookie"
  | "veteran"
  | "fast-but-error-prone"
  | "defensive";

export interface Driver {
  id: string;
  name: string;
  /** Three-letter timing abbreviation. */
  code: string;
  nationality: string;
  country: string;
  age: number;
  /** Whether the name refers to a real person. Real names are used only where a season permits. */
  isRealPerson: boolean;
  /** Disclosed portrait info; fictional drivers use generated avatars. */
  portraitSeed: string;
  attributes: {
    pace: number;
    qualifying: number;
    racecraft: number;
    overtaking: number;
    defending: number;
    tireManagement: number;
    wet: number;
    consistency: number;
    concentration: number;
    /** 0..1 additional aggression in wheel-to-wheel situations. */
    aggression: number;
    /** 0..100 experience; grows with starts. */
    experience: number;
  };
  potential: number;
  /** Peak age beyond which pace declines. */
  peakAge: number;
  /** USD per season salary demand. */
  salaryDemand: number;
  /** Long-term value to sponsors, 0..1. */
  marketability: number;
  /** Narrative reputation, 0..100. */
  reputation: number;
  morale: number;
  traits: DriverTrait[];
  /** Free agents have no teamId. */
  teamId: string | null;
  /** Hidden talent rating (scouting reveals it). 0..100. */
  scoutedAbility?: number;
  /** Number of career starts. */
  starts: number;
  careerWins: number;
  careerPodiums: number;
  careerPoles: number;
  careerPoints: number;
  championships: number;
}

export interface DriverContract {
  id: string;
  careerId: string;
  driverId: string;
  teamId: string;
  season: number;
  /** Salary per season in USD. */
  salary: number;
  signingBonus: number;
  /** Bonus per race win. */
  winBonus: number;
  /** Bonus per podium. */
  podiumBonus: number;
  /** Bonus if the team wins the constructors' title. */
  championshipBonus: number;
  years: number;
  /** Performance clause: finish above this position or the driver can leave. */
  performanceClausePosition: number | null;
  active: boolean;
}

/** Cosmetic bodywork shapes selectable in the Garage. */
export type FrontWingStyle = "swept" | "straight" | "multi";
export type RearWingStyle = "swept" | "box" | "biplane";
export type SidepodStyle = "tapered" | "wide" | "tunnel";
export type NoseStyle = "slender" | "thumb" | "blunt";
export type HaloStyle = "standard" | "aero";

export interface TeamSpec {
  id: string;
  careerId: string;
  name: string;
  shortName: string;
  /** Three-letter timing abbreviation, unique within a lobby. */
  abbreviation: string;
  nationality: string;
  isPlayerTeam: boolean;
  ownerUserId: string | null;
  /** Colors used by the SVG livery renderer. */
  colors: { primary: string; secondary: string; accent: string };
  /** Independent paintable livery sections plus optional bodywork shapes. */
  livery: {
    nose: string;
    frontWing: string;
    sidepod: string;
    engineCover: string;
    rearWing: string;
    accentStripe: string;
    halo: string;
    /** Cosmetic bodywork variants (Garage > Bodywork). */
    frontWingStyle?: FrontWingStyle;
    rearWingStyle?: RearWingStyle;
    sidepodStyle?: SidepodStyle;
    noseStyle?: NoseStyle;
    haloStyle?: HaloStyle;
  };
  numberStyle: string;
  logo: { symbol: string; background: string };
  headquarters: string;
  engineSupplier: string;
  philosophy: string;
  budget: number;
  reputation: number;
  /** Season objective: target constructors' position. */
  objective: number;
  aiProfile: AiProfile | null;
}

export type AiDifficulty = "beginner" | "normal" | "expert" | "elite";

export interface AiProfile {
  difficulty: AiDifficulty;
  /** Relative focus weights for development, 0..1. */
  focusAero: number;
  focusMechanical: number;
  focusReliability: number;
  /** 0..1 risk appetite in race strategy. */
  riskAppetite: number;
  /** 0..1 quality of strategic decision making. */
  strategyIQ: number;
  /** 0..1 efficiency converting budget into performance. */
  developmentEfficiency: number;
}

export interface CarSpec {
  teamId: string;
  season: number;
  /** Baseline performance attributes, roughly 0..100. */
  aeroEfficiency: number;
  downforce: number;
  drag: number; // higher == more drag (worse)
  cornering: number;
  straightLine: number;
  braking: number;
  mechanicalGrip: number;
  /** Higher == tyre degradation reduced. */
  tireFriendliness: number;
  fuelEfficiency: number;
  reliability: number;
  cooling: number;
  wetPerformance: number;
  /** Weight in kg. */
  weight: number;
  /** Performance points assigned to each area via upgrades. */
  installed: Record<UpgradeArea, number>;
}

export type UpgradeArea =
  | "front-wing"
  | "rear-wing"
  | "floor"
  | "sidepods"
  | "suspension"
  | "chassis"
  | "brakes"
  | "cooling"
  | "engine"
  | "gearbox"
  | "reliability";

export interface UpgradeProject {
  id: string;
  careerId: string;
  teamId: string;
  area: UpgradeArea;
  name: string;
  /** 0..100 quality rolled at creation. Drives the resulting performance gain. */
  quality: number;
  cost: number;
  /** Total research ticks required. */
  durationTicks: number;
  ticksRemaining: number;
  /** Performance points this project will add, before quality roll. */
  nominalGain: number;
  completed: boolean;
  installed: boolean;
  season: number;
  createdAt: number;
}

export interface Facility {
  id: string;
  teamId: string;
  kind: FacilityKind;
  level: number;
}

export type FacilityKind =
  | "factory"
  | "design-office"
  | "wind-tunnel"
  | "simulator"
  | "driver-academy"
  | "pit-crew"
  | "commercial"
  | "reliability-lab"
  | "hospitality";

export type StaffRole =
  | "technical-director"
  | "chief-designer"
  | "aero-chief"
  | "race-engineer"
  | "performance-engineer"
  | "sporting-director"
  | "chief-mechanic"
  | "pit-crew"
  | "commercial-director"
  | "scout";

export interface StaffMember {
  id: string;
  careerId: string;
  teamId: string | null;
  name: string;
  role: StaffRole;
  nationality: string;
  age: number;
  skill: number; // 0..100
  potential: number;
  wage: number; // per season
  morale: number;
  experience: number;
}

export interface Sponsor {
  id: string;
  name: string;
  industry: string;
  /** Upfront payment on signing. */
  upfront: number;
  /** Payment every race weekend. */
  perRace: number;
  /** Bonus if the team finishes at or above targetPosition at season end. */
  positionBonus: number;
  targetPosition: number;
  /** Minimum team reputation required. */
  minReputation: number;
  /** 0..1 negotiation difficulty. */
  difficulty: number;
  /** Preferred livery placement. */
  placement: "nose" | "sidepod" | "engine-cover" | "rear-wing" | "accent";
  /** Whether the brand is fictional. */
  fictional: boolean;
}

export interface SponsorContract {
  id: string;
  careerId: string;
  teamId: string;
  sponsorId: string;
  seasons: number;
  startSeason: number;
  active: boolean;
}

export interface FinanceState {
  teamId: string;
  balance: number;
  season: number;
}

export interface Transaction {
  id: string;
  careerId: string;
  teamId: string;
  season: number;
  /** Race index within the season, or 0 for pre-season. */
  raceIndex: number;
  category:
    | "prize-money"
    | "sponsor-upfront"
    | "sponsor-per-race"
    | "sponsor-bonus"
    | "driver-salary"
    | "staff-wage"
    | "facility-upkeep"
    | "research"
    | "manufacturing"
    | "repairs"
    | "travel"
    | "termination"
    | "investment"
    | "starting-capital";
  amount: number; // negative == expense
  description: string;
  createdAt: number;
}

/** Component damage tracking, values 0..1 (1 == terminal). */
export interface DamageState {
  frontWing: number;
  rearWing: number;
  floor: number;
  sidepod: number;
  suspension: number;
  steering: number;
  brakes: number;
  chassis: number;
  cooling: number;
  gearbox: number;
  engine: number;
  tire: number;
}

export interface CarRuntime {
  driverId: string;
  teamId: string;
  damage: DamageState;
  compound: Compound;
  tireAgeLaps: number;
  fuelLaps: number;
  pitsMade: number;
  penaltySeconds: number;
  retired: boolean;
  retiredReason: string | null;
  /** Seconds behind the leader at the last completed lap (0 for leader). */
  gapToLeader: number;
  trackPosition: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  lapTimes: number[];
  /** 0..1 progress around the lap, used for the map. */
  trackProgress: number;
  outOfRace: boolean;
}

export type IncidentSeverity = 0 | 1 | 2 | 3 | 4;

export type IncidentKind =
  | "near-miss"
  | "contact"
  | "rear-end"
  | "side-to-side"
  | "divebomb"
  | "lock-up"
  | "spin"
  | "aquaplaning"
  | "first-lap"
  | "barrier"
  | "mechanical"
  | "tire-failure"
  | "debris"
  | "multi-car"
  | "pit-lane";

export type IncidentResponsibility =
  | "racing-incident"
  | "driver-a"
  | "driver-b"
  | "both"
  | "mechanical"
  | "weather"
  | "unavoidable";

export interface RaceIncident {
  id: string;
  /** Unique per race; used for idempotent processing. */
  raceId: string;
  lap: number;
  /** 0..1 position on track where it happened. */
  trackPosition: number;
  corner: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  involvedDriverIds: string[];
  responsibility: IncidentResponsibility;
  responsibleDriverId: string | null;
  /** Damage applied per driver id. */
  damage: Record<string, Partial<DamageState>>;
  narrative: string;
  /** Contributing factors, for the incident report. */
  factors: string[];
  penalty:
    | { type: "time"; seconds: number; driverId: string }
    | { type: "drive-through"; driverId: string }
    | { type: "stop-go"; seconds: number; driverId: string }
    | { type: "grid"; places: number; driverId: string }
    | null;
  /** Race control reaction. */
  neutralisation: "none" | "yellow" | "virtual-safety-car" | "safety-car" | "red-flag";
}

export type FlagState = "green" | "yellow" | "safety-car" | "virtual-safety-car" | "red-flag" | "chequered";

export interface WeatherState {
  condition: Weather;
  /** 0..1 intensity for rain, else 0. */
  intensity: number;
  trackWetness: number; // 0..1
  airTempC: number;
  trackTempC: number;
}

export interface StrategyPlan {
  driverId: string;
  /** Planned compound sequence, e.g. ["medium","hard"]. */
  compounds: Compound[];
  /** Lap numbers for the planned pit stops. */
  pitLaps: number[];
  /** Whether the team allows the driver to push or manage. */
  pushLevel: "conserve" | "normal" | "push";
  /** Risk of pushing (incident probability multiplier). */
  risk: "low" | "medium" | "high";
}

export interface LapRecord {
  lap: number;
  entries: Array<{
    driverId: string;
    position: number;
    lapTime: number;
    compound: Compound;
    tireAge: number;
    gapToLeader: number;
    pit: boolean;
    flag: FlagState;
    retired: boolean;
  }>;
}

export interface ClassifiedEntry {
  position: number;
  driverId: string;
  teamId: string;
  laps: number;
  timeSeconds: number | null;
  gap: string;
  bestLap: number | null;
  points: number;
  status: "finished" | "dnf" | "dsq";
  pits: number;
  fastestLap: boolean;
  gridPosition: number;
  penalties: number;
}

export interface QualifyingResultRow {
  position: number;
  driverId: string;
  teamId: string;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  best: number | null;
  eliminated: "none" | "q1" | "q2";
}

export interface RaceResult {
  id: string;
  careerId: string;
  season: number;
  raceIndex: number;
  circuitId: string;
  session: SessionType;
  /** Deterministic seed used for this race. */
  seed: number;
  weatherStart: Weather;
  classification: ClassifiedEntry[];
  qualifying: QualifyingResultRow[];
  incidents: RaceIncident[];
  laps: LapRecord[];
  safetyCarDeployments: number;
  virtualSafetyCarPeriods: number;
  redFlags: number;
  fastestLapDriverId: string | null;
  poleDriverId: string | null;
  winnerDriverId: string | null;
  /** Final component damage per driver, used for repair costs. */
  finalDamage?: Record<string, Partial<DamageState>>;
  processed: boolean;
  createdAt: number;
}

export interface StandingRow {
  driverId?: string;
  teamId: string;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  dnfs: number;
  position: number;
}

export interface ChampionshipStandings {
  season: number;
  drivers: StandingRow[];
  constructors: StandingRow[];
}

export interface Season {
  id: string;
  careerId: string;
  number: number;
  rulesetId: string;
  calendar: string[]; // circuit ids
  currentRaceIndex: number;
  completed: boolean;
  championDriverId: string | null;
  championTeamId: string | null;
  sprintRaces: number[]; // race indexes that are sprint weekends
}

export interface RaceWeekendState {
  season: number;
  raceIndex: number;
  circuitId: string;
  session: SessionType;
  weather: WeatherState;
  readyUserIds: string[];
  resultId: string | null;
  startedAt: number | null;
}

export interface LobbySettings {
  maxPlayers: number;
  isPublic: boolean;
  aiDifficulty: AiDifficulty;
  simSpeed: number; // 1..10
  seasonLength: number;
  qualifyFormat: string;
  raceDistancePct: number;
  startingBudget: number;
  startingSeason: number;
  allowMidSeasonJoin: boolean;
  requireApproval: boolean;
  incidentSeverity: "lenient" | "realistic" | "strict";
  driverAvailability: boolean;
  maxIncidentSeverity: 4;
}

export interface LobbyMember {
  userId: string;
  username: string;
  teamId: string | null;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
  online: boolean;
}

export interface Lobby {
  id: string;
  name: string;
  inviteCode: string;
  hostUserId: string;
  settings: LobbySettings;
  members: LobbyMember[];
  careerId: string;
  createdAt: number;
  paused: boolean;
}

export interface ChatMessage {
  id: string;
  lobbyId: string;
  userId: string;
  username: string;
  body: string;
  createdAt: number;
  system?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  /** Dev backend stores a salted hash; Supabase uses Supabase Auth. */
  createdAt: number;
}

export interface Career {
  id: string;
  lobbyId: string;
  name: string;
  createdAt: number;
  currentSeason: number;
  /** Season numbers that remain in history. */
  rulesHistory: Record<number, string>;
  phase: "setup" | "in-season" | "off-season";
}

export interface NewsItem {
  id: string;
  careerId: string;
  season: number;
  raceIndex: number;
  kind: "race" | "contract" | "finance" | "development" | "incident" | "championship";
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}
