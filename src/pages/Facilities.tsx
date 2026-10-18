import { useState } from "react";
import { ArrowUpCircle, Building2 } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Panel, SectionHeading, Stat } from "../components/ui";
import { FACILITY_META, facilityLevel, facilityUpgradeCost } from "../engine/development";
import { teamDevelopmentModifiers } from "../engine/season";
import { balanceOf, findTeam } from "../lib/career";
import { money } from "../lib/format";
import type { FacilityKind } from "../engine/types";

const KINDS = Object.keys(FACILITY_META) as FacilityKind[];
const MAX_LEVEL = 5;

export function FacilitiesPage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  if (!bundle || !myTeamId) return null;
  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const facilities = bundle.facilities.filter((f) => f.teamId === myTeamId);
  const balance = balanceOf(bundle, myTeamId);
  const mods = teamDevelopmentModifiers(bundle, myTeamId);
  const upkeepPerSeason = facilities.reduce((s, f) => s + 2_000_000 * (1 + f.level * 0.5), 0);

  const upgrade = async (kind: FacilityKind) => {
    setBusy(kind);
    try {
      await applyAction({ type: "upgrade-facility", teamId: myTeamId, kind });
      pushToast("success", `${FACILITY_META[kind].name} upgraded`);
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Facilities"
        subtitle="Invest in your factory to speed up development, improve pit stops and support the team."
        right={<Badge tone="info">Level cap {MAX_LEVEL}</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Development speed" value={`${mods.speed.toFixed(2)}×`} hint="Design office, wind tunnel, staff" />
        <Stat label="Max concurrent projects" value={mods.maxConcurrent} hint="Research capacity" />
        <Stat label="Pit stop bonus" value={`${Math.round(mods.pitStopBonus * 100)}%`} hint="Pit crew training" />
        <Stat label="Season upkeep" value={money(upkeepPerSeason, { compact: true })} hint={money(balance, { compact: true }) + " available"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {KINDS.map((kind) => {
          const level = facilityLevel(facilities, kind);
          const maxed = level >= MAX_LEVEL;
          const cost = facilityUpgradeCost(kind, level);
          return (
            <Panel key={kind} title={FACILITY_META[kind].name} right={<Building2 size={14} className="text-gray-500" />}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: MAX_LEVEL }).map((_, i) => (
                      <span key={i} className={`h-2.5 w-4 rounded-sm ${i < level ? "bg-race-teal" : "bg-carbon-700"}`} />
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">Level {level} / {MAX_LEVEL}</div>
                </div>
                <Badge tone={maxed ? "good" : "default"}>{maxed ? "Max" : money(cost, { compact: true })}</Badge>
              </div>
              <p className="mt-2 min-h-[2.5rem] text-xs text-gray-500">{FACILITY_META[kind].effect}</p>
              <button
                className="btn-primary mt-2 w-full justify-center py-1.5 text-xs"
                disabled={maxed || busy === kind}
                onClick={() => void upgrade(kind)}
              >
                <ArrowUpCircle size={14} /> {maxed ? "Fully upgraded" : "Upgrade"}
              </button>
            </Panel>
          );
        })}
      </div>

      <div className="panel panel-pad mt-4 text-xs text-gray-500">
        Facility upgrades are charged immediately and increase season upkeep. They are permanent and carry across seasons. Development projects tick once per completed race weekend.
      </div>
    </div>
  );
}
