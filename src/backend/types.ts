import type {
  CareerBundle,
  CareerSettings,
} from "../engine/season";
import type { ChatMessage, Lobby, LobbySettings, RaceResult, UpgradeArea } from "../engine/types";
import type { Setup } from "../engine/car";
import type { ContractOffer } from "../engine/drivermarket";
import type { LiveMessage } from "../engine/liveSession";
import type { LiveRaceAudit } from "../engine/liveRace";

/**
 * A best-effort pub/sub channel used by the live race. In offline mode it is a
 * `BroadcastChannel` between tabs of the same browser; online it is a Supabase
 * Realtime broadcast channel scoped to the lobby.
 */
export interface LiveTransport {
  send(message: LiveMessage): void;
  /** Register a listener. Returns an unsubscribe function. */
  listen(handler: (message: LiveMessage, fromUserId: string) => void): () => void;
  close(): void;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

export type TeamCreationRequest = {
  name: string;
  shortName: string;
  abbreviation: string;
  nationality: string;
  colors: { primary: string; secondary: string; accent: string };
  livery?: import("../engine/types").TeamSpec["livery"];
  logo?: import("../engine/types").TeamSpec["logo"];
  headquarters: string;
  engineSupplier: string;
  philosophy: string;
  numberStyle: string;
};

/**
 * Every game-changing career action. The backend validates and applies these
 * authoritatively; the client never sends raw results, balances or points.
 */
export type CareerAction =
  | { type: "run-practice"; session: number }
  | { type: "run-race" }
  | { type: "advance-calendar" }
  | { type: "start-next-season" }
  | { type: "create-team"; userId: string; request: TeamCreationRequest }
  | { type: "set-setup"; teamId: string; setup: Setup }
  | {
      type: "sign-driver";
      teamId: string;
      driverId: string;
      salary: number;
      signingBonus: number;
      winBonus: number;
      podiumBonus: number;
      years: number;
      performanceClausePosition: number | null;
    }
  | { type: "release-driver"; driverId: string }
  | { type: "respond-transfer-offer"; offerId: string; accept: boolean }
  | { type: "start-project"; teamId: string; area: UpgradeArea }
  | { type: "install-project"; teamId: string; projectId: string }
  | { type: "upgrade-facility"; teamId: string; kind: import("../engine/types").FacilityKind }
  | { type: "hire-staff"; teamId: string; staffId: string }
  | { type: "fire-staff"; teamId: string; staffId: string }
  | { type: "sign-sponsor"; teamId: string; sponsorId: string; seasons: number }
  | { type: "emergency-funding"; teamId: string }
  | { type: "update-team"; teamId: string; patch: Partial<import("../engine/types").TeamSpec> };

export interface CareerActionExtra {
  negotiation?: import("../engine/drivermarket").NegotiationResult;
  [key: string]: unknown;
}

export interface Backend {
  readonly mode: "local" | "supabase";

  auth: {
    register(username: string, email: string, password: string): Promise<AuthUser>;
    login(email: string, password: string): Promise<AuthUser>;
    logout(): Promise<void>;
    current(): Promise<AuthUser | null>;
  };

  createLobby(userId: string, username: string, name: string, settings: Partial<LobbySettings>): Promise<Lobby>;
  joinLobby(userId: string, username: string, inviteCode: string): Promise<Lobby>;
  listMyLobbies(userId: string): Promise<Lobby[]>;
  listPublicLobbies(): Promise<Lobby[]>;
  getLobby(lobbyId: string): Promise<Lobby | null>;
  leaveLobby(lobbyId: string, userId: string): Promise<void>;
  heartbeat(lobbyId: string, userId: string, online: boolean): Promise<void>;
  setReady(lobbyId: string, userId: string, ready: boolean): Promise<Lobby>;
  transferHost(lobbyId: string, fromUserId: string, toUserId: string): Promise<Lobby>;
  removeMember(lobbyId: string, hostUserId: string, memberUserId: string): Promise<Lobby>;
  setPaused(lobbyId: string, hostUserId: string, paused: boolean): Promise<Lobby>;

  listChat(lobbyId: string): Promise<ChatMessage[]>;
  sendChat(lobbyId: string, userId: string, username: string, body: string): Promise<ChatMessage>;

  getBundle(lobbyId: string): Promise<CareerBundle>;
  applyAction(lobbyId: string, userId: string, action: CareerAction): Promise<{ bundle: CareerBundle; extra: CareerActionExtra }>;
  negotiate(lobbyId: string, userId: string, driverId: string, teamId: string, offer: ContractOffer): Promise<import("../engine/drivermarket").NegotiationResult>;
  startRace(lobbyId: string, userId: string): Promise<{ bundle: CareerBundle; result: RaceResult }>;
  /** Commit a live-race result. The backend replays the audit and re-scores it. */
  commitRace(lobbyId: string, userId: string, result: RaceResult, audit?: LiveRaceAudit): Promise<{ bundle: CareerBundle; result: RaceResult }>;

  /**
   * Open a live-race channel for this lobby. Messages published here are not
   * persisted and are not authenticated beyond the channel scope, so callers
   * must validate the `fromUserId` of anything they act on.
   */
  openLive(lobbyId: string, userId: string): LiveTransport;

  /** Subscribe to lobby/career changes. Returns an unsubscribe function. */
  subscribeLobby(lobbyId: string, onChange: () => void): () => void;
}

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  maxPlayers: 6,
  isPublic: false,
  aiDifficulty: "normal",
  simSpeed: 5,
  seasonLength: 12,
  qualifyFormat: "q1-q2-q3",
  raceDistancePct: 50,
  startingBudget: 100_000_000,
  startingSeason: 2026,
  allowMidSeasonJoin: true,
  requireApproval: false,
  incidentSeverity: "realistic",
  driverAvailability: false,
  maxIncidentSeverity: 4,
};

export const DEFAULT_CAREER_SETTINGS: CareerSettings = {
  aiDifficulty: "normal",
  raceDistancePct: 50,
  simSpeed: 5,
  startingSeason: 2026,
  incidentSeverity: "realistic",
  driverAvailability: false,
  seasonLength: 12,
  startBudget: 100_000_000,
};

export function settingsFromLobby(settings: LobbySettings): CareerSettings {
  return {
    aiDifficulty: settings.aiDifficulty,
    raceDistancePct: settings.raceDistancePct,
    simSpeed: settings.simSpeed,
    startingSeason: settings.startingSeason,
    incidentSeverity: settings.incidentSeverity,
    driverAvailability: settings.driverAvailability,
    seasonLength: settings.seasonLength,
    startBudget: settings.startingBudget,
  };
}
