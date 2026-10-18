/**
 * Local, offline-capable backend.
 *
 * This is the fully working "development mode" backend. It is the authoritative
 * game server for local play: every state change goes through the engine here,
 * exactly as the Supabase path does server-side. It persists to IndexedDB (and
 * an in-memory cache) and uses BroadcastChannel + storage events to notify other
 * tabs, which is enough for two browser windows to share one career locally.
 *
 * It does NOT persist only to localStorage: the career lives in structured
 * IndexedDB records keyed by lobby id.
 */
import type {
  CareerAction,
  CareerActionExtra,
  Backend,
  AuthUser,
} from "./types";
import { DEFAULT_LOBBY_SETTINGS, settingsFromLobby } from "./types";
import type { Lobby, LobbyMember, LobbySettings, ChatMessage, RaceResult, FacilityKind, UpgradeArea } from "../engine/types";
import type { CareerBundle } from "../engine/season";
import {
  addPlayerTeam,
  advanceCalendar,
  aiDevelopmentRound,
  commitRaceResult,
  createCareerBundle,
  processRaceResult,
  releaseDriver,
  runPracticeSession,
  runRaceWeekend,
  signDriver,
  startNextSeason,
  teamDevelopmentModifiers,
} from "../engine/season";
import {
  createUpgradeProject,
  facilityLevel,
  FACILITY_META,
  facilityUpgradeCost,
  installUpgrade,
  UPGRADE_META,
} from "../engine/development";
import { makeTxn } from "../engine/finance";
import { sanitizeSetup } from "../engine/car";
import { negotiate } from "../engine/drivermarket";
import type { ContractOffer } from "../engine/drivermarket";
import { Rng } from "../engine/rng";

const DB_NAME = "f1-team-principal";
const DB_VERSION = 1;
const STORES = ["users", "lobbies", "chats", "bundles"] as const;
type Store = (typeof STORES)[number];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: Store, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store: Store, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll<T>(store: Store): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

interface StoredUser {
  id: string;
  username: string;
  email: string;
  salt: string;
  hash: string;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const SESSION_KEY = "f1tp.session";

export class LocalBackend implements Backend {
  readonly mode = "local" as const;
  private listeners = new Map<string, Set<() => void>>();
  private channels = new Map<string, BroadcastChannel>();

  // ---- auth ---------------------------------------------------------------
  auth = {
    register: async (username: string, email: string, password: string): Promise<AuthUser> => {
      const existing = (await idbAll<StoredUser>("users")).find((u) => u.email === email.toLowerCase());
      if (existing) throw new Error("An account with that email already exists.");
      const salt = randomId("s");
      const user: StoredUser = {
        id: randomId("u"),
        username,
        email: email.toLowerCase(),
        salt,
        hash: await hashPassword(password, salt),
      };
      await idbPut("users", user.id, user);
      const authUser: AuthUser = { id: user.id, username: user.username, email: user.email };
      localStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
      return authUser;
    },
    login: async (email: string, password: string): Promise<AuthUser> => {
      const user = (await idbAll<StoredUser>("users")).find((u) => u.email === email.toLowerCase());
      if (!user) throw new Error("No account found for that email.");
      const hash = await hashPassword(password, user.salt);
      if (hash !== user.hash) throw new Error("Incorrect password.");
      const authUser: AuthUser = { id: user.id, username: user.username, email: user.email };
      localStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
      return authUser;
    },
    logout: async () => {
      localStorage.removeItem(SESSION_KEY);
    },
    current: async () => {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AuthUser;
      } catch {
        return null;
      }
    },
  };

  // ---- lobby --------------------------------------------------------------
  async createLobby(userId: string, username: string, name: string, settings: Partial<LobbySettings>): Promise<Lobby> {
    const lobbyId = randomId("lobby");
    const careerId = randomId("career");
    const merged: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, ...settings };
    const member: LobbyMember = { userId, username, teamId: null, isHost: true, joinedAt: Date.now(), lastSeen: Date.now(), online: true };
    const lobby: Lobby = {
      id: lobbyId,
      name,
      inviteCode: randomId("inv").slice(4, 12).toUpperCase(),
      hostUserId: userId,
      settings: merged,
      members: [member],
      careerId,
      createdAt: Date.now(),
      paused: false,
    };
    const bundle = createCareerBundle({ careerId, lobbyId, name, settings: settingsFromLobby(merged) });
    await idbPut("lobbies", lobbyId, lobby);
    await idbPut("bundles", lobbyId, bundle);
    this.notify(lobbyId);
    return lobby;
  }

  async joinLobby(userId: string, username: string, inviteCode: string): Promise<Lobby> {
    const lobbies = await idbAll<Lobby>("lobbies");
    const lobby = lobbies.find((l) => l.inviteCode.toUpperCase() === inviteCode.toUpperCase());
    if (!lobby) throw new Error("No lobby found with that invitation code.");
    if (lobby.members.some((m) => m.userId === userId)) return lobby;
    if (lobby.members.length >= lobby.settings.maxPlayers) throw new Error("This lobby is full.");
    if (lobby.settings.requireApproval) throw new Error("This lobby requires host approval to join.");
    const member: LobbyMember = { userId, username, teamId: null, isHost: false, joinedAt: Date.now(), lastSeen: Date.now(), online: true };
    const updated: Lobby = { ...lobby, members: [...lobby.members, member] };
    await idbPut("lobbies", lobby.id, updated);
    this.notify(lobby.id);
    return updated;
  }

  async listMyLobbies(userId: string): Promise<Lobby[]> {
    const lobbies = await idbAll<Lobby>("lobbies");
    return lobbies.filter((l) => l.members.some((m) => m.userId === userId));
  }

  async listPublicLobbies(): Promise<Lobby[]> {
    const lobbies = await idbAll<Lobby>("lobbies");
    return lobbies.filter((l) => l.settings.isPublic);
  }

  async getLobby(lobbyId: string): Promise<Lobby | null> {
    return (await idbGet<Lobby>("lobbies", lobbyId)) ?? null;
  }

  async leaveLobby(lobbyId: string, userId: string): Promise<void> {
    const lobby = await idbGet<Lobby>("lobbies", lobbyId);
    if (!lobby) return;
    const remaining = lobby.members.filter((m) => m.userId !== userId);
    const hostUserId = lobby.hostUserId === userId ? remaining[0]?.userId ?? lobby.hostUserId : lobby.hostUserId;
    const members = remaining.map((m) => ({ ...m, isHost: m.userId === hostUserId }));
    await idbPut("lobbies", lobbyId, { ...lobby, members, hostUserId });
    this.notify(lobbyId);
  }

  async heartbeat(lobbyId: string, userId: string, online: boolean): Promise<void> {
    const lobby = await idbGet<Lobby>("lobbies", lobbyId);
    if (!lobby) return;
    const members = lobby.members.map((m) => (m.userId === userId ? { ...m, online, lastSeen: Date.now() } : m));
    await idbPut("lobbies", lobbyId, { ...lobby, members });
    this.notify(lobbyId);
  }

  async setReady(lobbyId: string, userId: string, ready: boolean): Promise<Lobby> {
    const bundle = await this.getBundle(lobbyId);
    const set = new Set(bundle.weekend.readyUserIds);
    if (ready) set.add(userId);
    else set.delete(userId);
    await idbPut("bundles", lobbyId, { ...bundle, weekend: { ...bundle.weekend, readyUserIds: [...set] } });
    this.notify(lobbyId);
    const lobby = await this.getLobby(lobbyId);
    return lobby as Lobby;
  }

  async transferHost(lobbyId: string, fromUserId: string, toUserId: string): Promise<Lobby> {
    const lobby = await idbGet<Lobby>("lobbies", lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.hostUserId !== fromUserId) throw new Error("Only the host can transfer host privileges.");
    const members = lobby.members.map((m) => ({ ...m, isHost: m.userId === toUserId }));
    const updated = { ...lobby, hostUserId: toUserId, members };
    await idbPut("lobbies", lobbyId, updated);
    this.notify(lobbyId);
    return updated;
  }

  async removeMember(lobbyId: string, hostUserId: string, memberUserId: string): Promise<Lobby> {
    const lobby = await idbGet<Lobby>("lobbies", lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.hostUserId !== hostUserId) throw new Error("Only the host can remove members.");
    const updated = { ...lobby, members: lobby.members.filter((m) => m.userId !== memberUserId) };
    await idbPut("lobbies", lobbyId, updated);
    this.notify(lobbyId);
    return updated;
  }

  async setPaused(lobbyId: string, hostUserId: string, paused: boolean): Promise<Lobby> {
    const lobby = await idbGet<Lobby>("lobbies", lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.hostUserId !== hostUserId) throw new Error("Only the host can pause the career.");
    const updated = { ...lobby, paused };
    await idbPut("lobbies", lobbyId, updated);
    this.notify(lobbyId);
    return updated;
  }

  // ---- chat ---------------------------------------------------------------
  async listChat(lobbyId: string): Promise<ChatMessage[]> {
    return (await idbGet<ChatMessage[]>("chats", lobbyId)) ?? [];
  }

  async sendChat(lobbyId: string, userId: string, username: string, body: string): Promise<ChatMessage> {
    // Rate limit: max 1 message per 700ms per user.
    const existing = (await idbGet<ChatMessage[]>("chats", lobbyId)) ?? [];
    const recent = existing.filter((m) => m.userId === userId && Date.now() - m.createdAt < 700);
    if (recent.length >= 1) throw new Error("Slow down — sending messages too quickly.");
    const msg: ChatMessage = { id: randomId("msg"), lobbyId, userId, username, body: body.slice(0, 500), createdAt: Date.now() };
    const next = [...existing, msg].slice(-200);
    await idbPut("chats", lobbyId, next);
    this.notify(lobbyId);
    return msg;
  }

  // ---- career -------------------------------------------------------------
  async getBundle(lobbyId: string): Promise<CareerBundle> {
    const bundle = await idbGet<CareerBundle>("bundles", lobbyId);
    if (!bundle) throw new Error("Career not found for this lobby.");
    return bundle;
  }

  private async save(lobbyId: string, bundle: CareerBundle): Promise<void> {
    await idbPut("bundles", lobbyId, bundle);
    this.notify(lobbyId);
  }

  private assertMember(lobby: Lobby, userId: string): void {
    if (!lobby.members.some((m) => m.userId === userId)) throw new Error("You are not a member of this lobby.");
  }

  private assertOwnsTeam(bundle: CareerBundle, userId: string, teamId: string): void {
    const team = bundle.teams.find((t) => t.id === teamId);
    if (!team) throw new Error("Team not found.");
    if (!team.isPlayerTeam || team.ownerUserId !== userId) throw new Error("You can only manage your own team.");
  }

  async applyAction(lobbyId: string, userId: string, action: CareerAction): Promise<{ bundle: CareerBundle; extra: CareerActionExtra }> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found.");
    let bundle = await this.getBundle(lobbyId);
    const extra: CareerActionExtra = {};

    // Host-only actions.
    if (["advance-calendar", "start-next-season", "run-race"].includes(action.type)) {
      if (lobby.hostUserId !== userId) throw new Error("Only the host can advance the career.");
    }
    this.assertMember(lobby, userId);

    switch (action.type) {
      case "create-team": {
        const member = lobby.members.find((m) => m.userId === userId)!;
        if (member.teamId) throw new Error("You already own a team in this career.");
        if (bundle.teams.some((t) => t.isPlayerTeam && t.ownerUserId === userId)) throw new Error("You already own a team in this career.");
        const res = addPlayerTeam(bundle, { budget: bundle.settings.startBudget, ...action.request, userId });
        bundle = res.bundle;
        await idbPut("lobbies", lobbyId, {
          ...lobby,
          members: lobby.members.map((m) => (m.userId === userId ? { ...m, teamId: res.teamId } : m)),
        });
        small(bundle, res.teamId);
        break;
      }
      case "set-setup": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        bundle = { ...bundle, setups: { ...bundle.setups, [action.teamId]: { ...(bundle.setups[action.teamId] ?? { practiceTicks: 0 }), setup: sanitizeSetup(action.setup) } } };
        break;
      }
      case "sign-driver": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        bundle = signDriver(bundle, action);
        break;
      }
      case "release-driver": {
        const contract = bundle.driverContracts.find((c) => c.driverId === action.driverId && c.active);
        if (contract) this.assertOwnsTeam(bundle, userId, contract.teamId);
        bundle = releaseDriver(bundle, action.driverId);
        break;
      }
      case "start-project": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        if (!(action.area in UPGRADE_META)) throw new Error("Unknown research area.");
        const mods = teamDevelopmentModifiers(bundle, action.teamId);
        const active = bundle.upgrades.filter((u) => u.teamId === action.teamId && !u.completed);
        if (active.length >= mods.maxConcurrent) throw new Error("Research capacity reached — build a bigger wind tunnel or wait for projects to finish.");
        const rng = new Rng(`proj:${lobbyId}:${action.teamId}:${action.area}:${Date.now()}`);
        const project = createUpgradeProject(rng, { careerId: bundle.career.id, teamId: action.teamId, area: action.area, season: bundle.season.number, mods });
        const fin = bundle.finances.find((f) => f.teamId === action.teamId)!;
        if (fin.balance - project.cost < -20_000_000) throw new Error("Insufficient funds for this research project.");
        const txn = makeTxn({ careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex }, "research", -project.cost, `Research: ${project.name}`);
        bundle = {
          ...bundle,
          upgrades: [...bundle.upgrades, project],
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance - project.cost } : f)),
          transactions: [...bundle.transactions, txn],
        };
        break;
      }
      case "install-project": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        const project = bundle.upgrades.find((u) => u.id === action.projectId);
        if (!project || project.teamId !== action.teamId) throw new Error("Project not found.");
        if (!project.completed) throw new Error("This upgrade is still in development.");
        if (project.installed) throw new Error("This upgrade has already been installed.");
        const carIndex = bundle.cars.findIndex((c) => c.teamId === action.teamId);
        const cars = [...bundle.cars];
        cars[carIndex] = installUpgrade(cars[carIndex], project);
        bundle = {
          ...bundle,
          cars,
          upgrades: bundle.upgrades.map((u) => (u.id === project.id ? { ...u, installed: true } : u)),
        };
        break;
      }
      case "upgrade-facility": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        const fac = bundle.facilities.find((f) => f.teamId === action.teamId && f.kind === action.kind);
        if (!fac) throw new Error("Facility not found.");
        if (fac.level >= 5) throw new Error("This facility is already at its maximum level.");
        const cost = facilityUpgradeCost(action.kind, fac.level);
        const fin = bundle.finances.find((f) => f.teamId === action.teamId)!;
        if (fin.balance - cost < -20_000_000) throw new Error("Insufficient funds to upgrade this facility.");
        const txn = makeTxn({ careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex }, "manufacturing", -cost, `Facility upgrade: ${FACILITY_META[action.kind].name}`);
        bundle = {
          ...bundle,
          facilities: bundle.facilities.map((f) => (f.kind === action.kind && f.teamId === action.teamId ? { ...f, level: f.level + 1 } : f)),
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance - cost } : f)),
          transactions: [...bundle.transactions, txn],
        };
        break;
      }
      case "hire-staff": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        const staff = bundle.staffMarket.find((s) => s.id === action.staffId);
        if (!staff) throw new Error("Staff member no longer available.");
        const existing = bundle.staff.find((s) => s.teamId === action.teamId && s.role === staff.role);
        if (existing) throw new Error(`You already employ a ${staff.role}. Release them first.`);
        bundle = {
          ...bundle,
          staff: [...bundle.staff, { ...staff, teamId: action.teamId }],
          staffMarket: bundle.staffMarket.filter((s) => s.id !== action.staffId),
        };
        break;
      }
      case "fire-staff": {
        const staff = bundle.staff.find((s) => s.id === action.staffId);
        if (staff?.teamId) this.assertOwnsTeam(bundle, userId, staff.teamId);
        bundle = {
          ...bundle,
          staff: bundle.staff.filter((s) => s.id !== action.staffId),
          staffMarket: staff ? [...bundle.staffMarket, { ...staff, teamId: null }] : bundle.staffMarket,
        };
        break;
      }
      case "sign-sponsor": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        const sponsor = bundle.sponsors.find((s) => s.id === action.sponsorId);
        if (!sponsor) throw new Error("Sponsor not found.");
        if (bundle.sponsorContracts.some((c) => c.teamId === action.teamId && c.sponsorId === sponsor.id && c.active)) {
          throw new Error(`${sponsor.name} is already an active partner.`);
        }
        if (![1, 2, 3].includes(action.seasons)) throw new Error("Sponsorship must run for 1 to 3 seasons.");
        const team = bundle.teams.find((t) => t.id === action.teamId)!;
        if (team.reputation < sponsor.minReputation) throw new Error(`${sponsor.name} requires a higher team reputation.`);
        const txn = makeTxn({ careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex }, "sponsor-upfront", sponsor.upfront, `${sponsor.name} upfront payment`);
        bundle = {
          ...bundle,
          sponsorContracts: [
            ...bundle.sponsorContracts,
            { id: randomId("sc"), careerId: bundle.career.id, teamId: action.teamId, sponsorId: sponsor.id, seasons: action.seasons, startSeason: bundle.season.number, active: true },
          ],
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance + sponsor.upfront } : f)),
          transactions: [...bundle.transactions, txn],
        };
        break;
      }
      case "emergency-funding": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        const fin = bundle.finances.find((f) => f.teamId === action.teamId)!;
        if (fin.balance >= 0) throw new Error("Emergency funding is only available when the balance is negative.");
        const alreadyFunded = bundle.transactions.some((t) => t.teamId === action.teamId && t.description === "Emergency investor funding");
        if (alreadyFunded) throw new Error("Emergency funding can only be drawn once per career.");
        const amount = 25_000_000;
        const txn = makeTxn({ careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex }, "investment", amount, "Emergency investor funding");
        bundle = {
          ...bundle,
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance + amount } : f)),
          transactions: [...bundle.transactions, txn],
        };
        break;
      }
      case "update-team": {
        this.assertOwnsTeam(bundle, userId, action.teamId);
        const patch = action.patch ?? {};
        const safe: Partial<typeof patch> = {
          ...(typeof patch.name === "string" ? { name: patch.name.slice(0, 40) } : {}),
          ...(typeof patch.shortName === "string" ? { shortName: patch.shortName.slice(0, 20) } : {}),
          ...(typeof patch.numberStyle === "string" ? { numberStyle: patch.numberStyle } : {}),
          ...(patch.colors ? { colors: patch.colors } : {}),
          ...(patch.livery ? { livery: patch.livery } : {}),
          ...(patch.logo ? { logo: patch.logo } : {}),
        };
        if (safe.name) {
          const clash = bundle.teams.some((t) => t.id !== action.teamId && t.name.toLowerCase() === String(safe.name).toLowerCase());
          if (clash) throw new Error("Another team already uses that name.");
        }
        bundle = { ...bundle, teams: bundle.teams.map((t) => (t.id === action.teamId ? { ...t, ...safe, id: t.id, careerId: t.careerId } : t)) };
        break;
      }
      case "run-practice": {
        const res = runPracticeSession(bundle, action.session);
        bundle = res.bundle;
        extra.practice = res.result;
        break;
      }
      case "run-race": {
        const res = runRaceWeekend(bundle);
        bundle = res.bundle;
        extra.result = res.result;
        break;
      }
      case "advance-calendar": {
        bundle = aiDevelopmentRound(advanceCalendar(bundle));
        break;
      }
      case "start-next-season": {
        bundle = startNextSeason(bundle);
        break;
      }
      default:
        throw new Error(`Unknown action`);
    }

    await this.save(lobbyId, bundle);
    void processRaceResult;
    return { bundle, extra };
  }

  async negotiate(lobbyId: string, userId: string, driverId: string, teamId: string, offer: ContractOffer) {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found.");
    this.assertMember(lobby, userId);
    const bundle = await this.getBundle(lobbyId);
    this.assertOwnsTeam(bundle, userId, teamId);
    const driver = bundle.drivers.find((d) => d.id === driverId);
    if (!driver) throw new Error("Driver not found.");
    const team = bundle.teams.find((t) => t.id === teamId)!;
    const rng = new Rng(`${lobbyId}:${driverId}:${Date.now()}`);
    return negotiate(rng, driver, team, offer, team.objective);
  }

  async startRace(lobbyId: string, userId: string): Promise<{ bundle: CareerBundle; result: RaceResult }> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found.");
    if (lobby.hostUserId !== userId) throw new Error("Only the host can start the race.");
    const bundle = await this.getBundle(lobbyId);
    if (bundle.weekend.resultId) {
      const existing = bundle.results.find((r) => r.id === bundle.weekend.resultId)!;
      return { bundle, result: existing };
    }
    // Readiness: all active human players who own a team must be ready.
    const required = lobby.members.filter((m) => m.online);
    const ready = new Set(bundle.weekend.readyUserIds);
    const notReady = required.filter((m) => !ready.has(m.userId));
    if (notReady.length > 0) throw new Error(`Cannot start: ${notReady.map((m) => m.username).join(", ")} not ready.`);
    const res = runRaceWeekend(bundle);
    await this.save(lobbyId, res.bundle);
    return { bundle: res.bundle, result: res.result };
  }

  /**
   * Commit a result produced by the interactive live race. The local client is
   * the authority in offline mode, so we only sanity-check that every classified
   * driver/team actually belongs to this career before processing it.
   */
  async commitRace(lobbyId: string, userId: string, result: RaceResult): Promise<{ bundle: CareerBundle; result: RaceResult }> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found.");
    if (lobby.hostUserId !== userId) throw new Error("Only the host can submit the race result.");
    const bundle = await this.getBundle(lobbyId);
    if (bundle.weekend.resultId) {
      const existing = bundle.results.find((r) => r.id === bundle.weekend.resultId);
      if (existing) return { bundle, result: existing };
    }

    const driverIds = new Set(bundle.drivers.map((d) => d.id));
    const teamIds = new Set(bundle.teams.map((t) => t.id));
    const resultId = `${bundle.career.id}:s${bundle.season.number}:r${bundle.weekend.raceIndex}`;
    const safe: RaceResult = {
      ...result,
      id: resultId,
      careerId: bundle.career.id,
      season: bundle.season.number,
      raceIndex: bundle.weekend.raceIndex,
      processed: false,
      qualifying: result.qualifying ?? [],
      classification: (result.classification ?? []).filter((c) => driverIds.has(c.driverId) && teamIds.has(c.teamId)),
      laps: result.laps ?? [],
    };
    if (safe.classification.length < 2) throw new Error("Race result is incomplete.");

    const res = commitRaceResult(bundle, safe);
    await this.save(lobbyId, res.bundle);
    return { bundle: res.bundle, result: res.result };
  }

  // ---- realtime -----------------------------------------------------------
  subscribeLobby(lobbyId: string, onChange: () => void): () => void {
    if (!this.listeners.has(lobbyId)) this.listeners.set(lobbyId, new Set());
    this.listeners.get(lobbyId)!.add(onChange);

    let channel: BroadcastChannel | undefined;
    if (typeof BroadcastChannel !== "undefined") {
      channel = this.channels.get(lobbyId) ?? new BroadcastChannel(`f1tp:${lobbyId}`);
      this.channels.set(lobbyId, channel);
      channel.onmessage = () => onChange();
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === `f1tp:notify:${lobbyId}`) onChange();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      this.listeners.get(lobbyId)?.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  }

  private notify(lobbyId: string): void {
    this.listeners.get(lobbyId)?.forEach((l) => l());
    const channel = this.channels.get(lobbyId);
    channel?.postMessage("changed");
    try {
      localStorage.setItem(`f1tp:notify:${lobbyId}`, String(Date.now()));
    } catch {
      /* storage may be unavailable */
    }
  }
}

function small(_bundle: CareerBundle, _teamId: string): void {
  /* hook for future logging */
}

export { facilityLevel, FACILITY_META, facilityUpgradeCost };
export type { UpgradeArea, FacilityKind };
