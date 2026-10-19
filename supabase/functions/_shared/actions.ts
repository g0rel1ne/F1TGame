/**
 * Server-authoritative career mutations.
 *
 * This mirrors the LocalBackend switch exactly, but runs inside Supabase Edge
 * Functions with the shared engine. Clients submit intents only; no balances,
 * points or race results are accepted from the browser.
 */
import {
  addPlayerTeam,
  advanceCalendar,
  aiDevelopmentRound,
  releaseDriver,
  respondTransferOffer,
  runPracticeSession,
  runRaceWeekend,
  signDriver,
  startNextSeason,
  teamDevelopmentModifiers,
  type CareerBundle,
} from "./engine/season.ts";
import { Rng } from "./engine/rng.ts";
import { makeTxn } from "./engine/finance.ts";
import { sanitizeSetup } from "./engine/car.ts";
import { expectedSalary } from "./engine/drivermarket.ts";
import {
  createUpgradeProject,
  facilityUpgradeCost,
  installUpgrade,
  FACILITY_META,
  UPGRADE_META,
} from "./engine/development.ts";

// deno-lint-ignore no-explicit-any
type Action = Record<string, any>;

export interface ActionContext {
  userId: string;
  lobbyId: string;
  isHost: boolean;
}

export interface ActionResult {
  bundle: CareerBundle;
  extra: Record<string, unknown>;
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function requireTeam(bundle: CareerBundle, teamId: string) {
  const team = bundle.teams.find((t) => t.id === teamId);
  if (!team) throw new Error("Team not found.");
  return team;
}

function assertOwnsTeam(bundle: CareerBundle, userId: string, teamId: string): void {
  const team = requireTeam(bundle, teamId);
  if (team.ownerUserId !== userId) throw new Error("You can only manage your own team.");
}

export function applyCareerAction(bundle: CareerBundle, action: Action, ctx: ActionContext): ActionResult {
  const extra: Record<string, unknown> = {};
  const hostOnly = ["advance-calendar", "start-next-season", "run-race"];

  if (hostOnly.includes(action.type) && !ctx.isHost) {
    throw new Error("Only the host can advance the career or run the race.");
  }

  switch (action.type) {
    case "create-team": {
      if (bundle.teams.some((t) => t.ownerUserId === ctx.userId)) {
        throw new Error("You already own a team in this career.");
      }
      const res = addPlayerTeam(bundle, {
        ...(action.request ?? {}),
        userId: ctx.userId,
        budget: bundle.settings.startBudget,
      });
      extra.teamId = res.teamId;
      return { bundle: res.bundle, extra };
    }

    case "set-setup": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const df = Number(action.setup?.downforce);
      const balance = Number(action.setup?.balance);
      if (!Number.isFinite(df) || !Number.isFinite(balance)) throw new Error("Invalid setup values.");
      const setup = sanitizeSetup(action.setup);
      const next = {
        ...bundle,
        setups: {
          ...bundle.setups,
          [action.teamId]: {
            ...(bundle.setups[action.teamId] ?? { practiceTicks: 0 }),
            setup,
          },
        },
      };
      return { bundle: next, extra };
    }

    case "sign-driver": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const driver = bundle.drivers.find((d) => d.id === action.driverId);
      if (!driver) throw new Error("Driver not found.");
      if (bundle.driverContracts.some((c) => c.driverId === driver.id && c.active)) {
        throw new Error(`${driver.name} already has an active contract.`);
      }
      const team = requireTeam(bundle, action.teamId);
      const money = ["salary", "signingBonus", "winBonus", "podiumBonus"] as const;
      for (const key of money) {
        if (!Number.isFinite(Number(action[key])) || Number(action[key]) < 0) {
          throw new Error(`Invalid ${key}.`);
        }
      }
      const years = Math.round(Number(action.years));
      if (!Number.isFinite(years) || years < 1 || years > 5) throw new Error("Contract length must be 1-5 years.");
      // Guards against client-side lowball offers that bypass negotiation.
      if (Number(action.salary) < expectedSalary(driver, team.reputation) * 0.5) {
        throw new Error("That salary is too far below the driver's expectations.");
      }
      const clause = action.performanceClausePosition;
      if (clause !== null && (!Number.isFinite(Number(clause)) || Number(clause) < 1 || Number(clause) > 20)) {
        throw new Error("Invalid performance clause.");
      }
      return {
        bundle: signDriver(bundle, {
          driverId: driver.id,
          teamId: action.teamId,
          salary: Number(action.salary),
          signingBonus: Number(action.signingBonus),
          winBonus: Number(action.winBonus),
          podiumBonus: Number(action.podiumBonus),
          years,
          performanceClausePosition: clause === null ? null : Number(clause),
        }),
        extra,
      };
    }

    case "release-driver": {
      const contract = bundle.driverContracts.find((c) => c.driverId === action.driverId && c.active);
      if (contract) assertOwnsTeam(bundle, ctx.userId, contract.teamId);
      return { bundle: releaseDriver(bundle, action.driverId), extra };
    }

    case "respond-transfer-offer": {
      const offer = (bundle.transferOffers ?? []).find((o) => o.id === action.offerId && o.status === "open");
      if (!offer) throw new Error("This transfer offer is no longer available.");
      const contract = bundle.driverContracts.find((c) => c.driverId === offer.driverId && c.active);
      if (!contract) throw new Error("That driver is no longer under contract.");
      assertOwnsTeam(bundle, ctx.userId, contract.teamId);
      return { bundle: respondTransferOffer(bundle, action.offerId, Boolean(action.accept)), extra };
    }

    case "start-project": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      if (!(action.area in UPGRADE_META)) throw new Error("Unknown upgrade area.");
      const mods = teamDevelopmentModifiers(bundle, action.teamId);
      const active = bundle.upgrades.filter((u) => u.teamId === action.teamId && !u.completed);
      if (active.length >= mods.maxConcurrent) {
        throw new Error("Research capacity reached — build a bigger wind tunnel or wait for projects to finish.");
      }
      const rng = new Rng(`proj:${ctx.lobbyId}:${action.teamId}:${action.area}:${Date.now()}:${crypto.randomUUID()}`);
      const project = createUpgradeProject(rng, {
        careerId: bundle.career.id,
        teamId: action.teamId,
        area: action.area,
        season: bundle.season.number,
        mods,
      });
      const fin = bundle.finances.find((f) => f.teamId === action.teamId);
      if (!fin) throw new Error("Team finances not found.");
      if (fin.balance - project.cost < -20_000_000) throw new Error("Insufficient funds for this research project.");
      const txn = makeTxn(
        { careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex },
        "research",
        -project.cost,
        `Research: ${project.name}`,
      );
      return {
        bundle: {
          ...bundle,
          upgrades: [...bundle.upgrades, project],
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance - project.cost } : f)),
          transactions: [...bundle.transactions, txn],
        },
        extra,
      };
    }

    case "install-project": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const project = bundle.upgrades.find((u) => u.id === action.projectId);
      if (!project || project.teamId !== action.teamId) throw new Error("Project not found.");
      if (!project.completed) throw new Error("This upgrade is still in development.");
      const carIndex = bundle.cars.findIndex((c) => c.teamId === action.teamId);
      if (carIndex < 0) throw new Error("Car not found.");
      const cars = [...bundle.cars];
      cars[carIndex] = installUpgrade(cars[carIndex], project);
      return {
        bundle: {
          ...bundle,
          cars,
          upgrades: bundle.upgrades.map((u) => (u.id === project.id ? { ...u, installed: true } : u)),
        },
        extra,
      };
    }

    case "upgrade-facility": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      if (!(action.kind in FACILITY_META)) throw new Error("Unknown facility.");
      const facility = bundle.facilities.find((f) => f.teamId === action.teamId && f.kind === action.kind);
      if (!facility) throw new Error("Facility not found.");
      if (facility.level >= 5) throw new Error("This facility is fully upgraded.");
      const cost = facilityUpgradeCost(action.kind, facility.level);
      const fin = bundle.finances.find((f) => f.teamId === action.teamId);
      if (!fin) throw new Error("Team finances not found.");
      if (fin.balance - cost < -20_000_000) throw new Error("Insufficient funds to upgrade this facility.");
      const txn = makeTxn(
        { careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex },
        "manufacturing",
        -cost,
        `Facility upgrade: ${FACILITY_META[action.kind as keyof typeof FACILITY_META].name}`,
      );
      return {
        bundle: {
          ...bundle,
          facilities: bundle.facilities.map((f) =>
            f.teamId === action.teamId && f.kind === action.kind ? { ...f, level: f.level + 1 } : f,
          ),
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance - cost } : f)),
          transactions: [...bundle.transactions, txn],
        },
        extra,
      };
    }

    case "hire-staff": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const staff = bundle.staffMarket.find((s) => s.id === action.staffId);
      if (!staff) throw new Error("Staff member no longer available.");
      const existing = bundle.staff.find((s) => s.teamId === action.teamId && s.role === staff.role);
      if (existing) throw new Error(`You already employ a ${staff.role}. Release them first.`);
      return {
        bundle: {
          ...bundle,
          staff: [...bundle.staff, { ...staff, teamId: action.teamId }],
          staffMarket: bundle.staffMarket.filter((s) => s.id !== action.staffId),
        },
        extra,
      };
    }

    case "fire-staff": {
      const staff = bundle.staff.find((s) => s.id === action.staffId);
      if (staff?.teamId) assertOwnsTeam(bundle, ctx.userId, staff.teamId);
      return {
        bundle: {
          ...bundle,
          staff: bundle.staff.filter((s) => s.id !== action.staffId),
          staffMarket: staff ? [...bundle.staffMarket, { ...staff, teamId: null }] : bundle.staffMarket,
        },
        extra,
      };
    }

    case "sign-sponsor": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const sponsor = bundle.sponsors.find((s) => s.id === action.sponsorId);
      if (!sponsor) throw new Error("Sponsor not found.");
      const exists = bundle.sponsorContracts.some((sc) => sc.teamId === action.teamId && sc.sponsorId === sponsor.id && sc.active);
      if (exists) throw new Error("That sponsor is already contracted to your team.");
      const team = requireTeam(bundle, action.teamId);
      if (team.reputation < sponsor.minReputation) throw new Error(`${sponsor.name} requires a higher team reputation.`);
      const txn = makeTxn(
        { careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex },
        "sponsor-upfront",
        sponsor.upfront,
        `${sponsor.name} upfront payment`,
      );
      return {
        bundle: {
          ...bundle,
          sponsorContracts: [
            ...bundle.sponsorContracts,
            {
              id: randomId("sc"),
              careerId: bundle.career.id,
              teamId: action.teamId,
              sponsorId: sponsor.id,
              seasons: Math.max(1, Math.min(3, Number(action.seasons) || 1)),
              startSeason: bundle.season.number,
              active: true,
            },
          ],
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance + sponsor.upfront } : f)),
          transactions: [...bundle.transactions, txn],
        },
        extra,
      };
    }

    case "emergency-funding": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const fin = bundle.finances.find((f) => f.teamId === action.teamId);
      if (!fin) throw new Error("Team finances not found.");
      if (fin.balance >= 0) throw new Error("Emergency funding is only available when the balance is negative.");
      const alreadyFunded = bundle.transactions.some((t) => t.teamId === action.teamId && t.description === "Emergency investor funding");
      if (alreadyFunded) throw new Error("Emergency funding can only be drawn once per career.");
      const amount = 25_000_000;
      const txn = makeTxn(
        { careerId: bundle.career.id, teamId: action.teamId, season: bundle.season.number, raceIndex: bundle.weekend.raceIndex },
        "investment",
        amount,
        "Emergency investor funding",
      );
      return {
        bundle: {
          ...bundle,
          finances: bundle.finances.map((f) => (f.teamId === action.teamId ? { ...f, balance: f.balance + amount } : f)),
          transactions: [...bundle.transactions, txn],
        },
        extra,
      };
    }

    case "update-team": {
      assertOwnsTeam(bundle, ctx.userId, action.teamId);
      const patch = action.patch ?? {};
      const safe = {
        ...(typeof patch.name === "string" ? { name: patch.name.slice(0, 40) } : {}),
        ...(typeof patch.shortName === "string" ? { shortName: patch.shortName.slice(0, 20) } : {}),
        ...(typeof patch.numberStyle === "string" ? { numberStyle: patch.numberStyle } : {}),
        ...(patch.colors ? { colors: patch.colors } : {}),
        ...(patch.livery ? { livery: patch.livery } : {}),
        ...(patch.logo ? { logo: patch.logo } : {}),
      };
      if (safe.name) {
        const clash = bundle.teams.some(
          (t) => t.id !== action.teamId && t.name.toLowerCase() === String(safe.name).toLowerCase(),
        );
        if (clash) throw new Error("Another team already uses that name.");
      }
      return {
        bundle: {
          ...bundle,
          teams: bundle.teams.map((t) => (t.id === action.teamId ? { ...t, ...safe, id: t.id, careerId: t.careerId } : t)),
        },
        extra,
      };
    }

    case "run-practice": {
      const session = Math.round(Number(action.session));
      if (!Number.isFinite(session) || session < 0 || session > 4) throw new Error("Practice session must be 0-4.");
      const res = runPracticeSession(bundle, session);
      extra.practice = res.result;
      return { bundle: res.bundle, extra };
    }

    case "run-race": {
      const res = runRaceWeekend(bundle);
      extra.result = res.result;
      return { bundle: res.bundle, extra };
    }

    case "advance-calendar": {
      return { bundle: aiDevelopmentRound(advanceCalendar(bundle)), extra };
    }

    case "start-next-season": {
      return { bundle: startNextSeason(bundle), extra };
    }

    default:
      throw new Error(`Unknown action: ${String(action.type)}`);
  }
}
