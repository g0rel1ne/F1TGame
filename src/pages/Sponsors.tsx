import { useState } from "react";
import { BadgeDollarSign, Handshake, Star } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, SectionHeading, Stat } from "../components/ui";
import { activeSponsors, findTeam } from "../lib/career";
import { money } from "../lib/format";

export function SponsorsPage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [seasons, setSeasons] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!bundle || !myTeamId) return null;
  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const active = activeSponsors(bundle, myTeamId);
  const activeIds = new Set(active.map((a) => a.contract.sponsorId));
  const available = bundle.sponsors.filter((s) => !activeIds.has(s.id));
  const perRace = active.reduce((s, a) => s + (a.sponsor?.perRace ?? 0), 0);
  const upfrontPotential = available.reduce((s, x) => s + x.upfront, 0);
  const eligible = available.filter((s) => team.reputation >= s.minReputation);

  const sign = async (sponsorId: string) => {
    setBusy(sponsorId);
    try {
      await applyAction({ type: "sign-sponsor", teamId: myTeamId, sponsorId, seasons: seasons[sponsorId] ?? 2 });
      pushToast("success", "Sponsorship signed");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Sponsors"
        subtitle="Commercial partners pay an upfront fee, a per-race retainer and a season-end position bonus."
        right={<Badge tone="info">Reputation {Math.round(team.reputation)}/100</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active partners" value={active.length} hint="Paying per race" />
        <Stat label="Income per race" value={money(perRace, { compact: true })} hint="From active partners" />
        <Stat label="Available deals" value={eligible.length} hint={`${available.length - eligible.length} locked by reputation`} />
        <Stat label="Upfront on the table" value={money(upfrontPotential, { compact: true })} hint="If every deal was signed" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Active partners" right={<Handshake size={15} className="text-gray-500" />}>
          {active.length === 0 ? (
            <Empty title="No sponsors yet" hint="Sign a partner to receive per-race income and a season bonus." />
          ) : (
            <div className="space-y-2">
              {active.map(({ contract, sponsor }) => sponsor && (
                <div key={contract.id} className="rounded-lg border border-carbon-700 bg-carbon-900/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-gray-100">{sponsor.name}</div>
                      <div className="text-[11px] text-gray-500">{sponsor.industry} · {sponsor.placement.replace("-", " ")} placement</div>
                    </div>
                    <Badge tone="good">{money(sponsor.perRace, { compact: true })}/race</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div><span className="text-gray-500">Upfront paid</span><div className="font-mono text-gray-300">{money(sponsor.upfront, { compact: true })}</div></div>
                    <div><span className="text-gray-500">Position bonus</span><div className="font-mono text-gray-300">{money(sponsor.positionBonus, { compact: true })}</div></div>
                    <div><span className="text-gray-500">Seasons</span><div className="font-mono text-gray-300">{contract.seasons} (from S{contract.startSeason})</div></div>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">Bonus if you finish P{sponsor.targetPosition} or better in the constructors' championship.</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Sponsorship market" right={<BadgeDollarSign size={15} className="text-gray-500" />}>
          {available.length === 0 ? (
            <Empty title="No further partners available" hint="All sponsors are already contracted to your team." />
          ) : (
            <div className="space-y-2">
              {available.map((s) => {
                const locked = team.reputation < s.minReputation;
                return (
                  <div key={s.id} className={`rounded-lg border p-3 ${locked ? "border-carbon-800 opacity-60" : "border-carbon-700 bg-carbon-900/50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
                          {s.name}
                          {s.minReputation >= 70 && <Star size={12} className="text-amber-400" />}
                        </div>
                        <div className="text-[11px] text-gray-500">{s.industry} · needs rep {s.minReputation}</div>
                      </div>
                      <Badge tone={locked ? "bad" : "default"}>{locked ? `Rep ${s.minReputation}+` : "Available"}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div><span className="text-gray-500">Upfront</span><div className="font-mono text-gray-300">{money(s.upfront, { compact: true })}</div></div>
                      <div><span className="text-gray-500">Per race</span><div className="font-mono text-gray-300">{money(s.perRace, { compact: true })}</div></div>
                      <div><span className="text-gray-500">P{s.targetPosition} bonus</span><div className="font-mono text-gray-300">{money(s.positionBonus, { compact: true })}</div></div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <select className="input h-8 w-24 text-xs" value={seasons[s.id] ?? 2} onChange={(e) => setSeasons((v) => ({ ...v, [s.id]: Number(e.target.value) }))} disabled={locked}>
                        {[1, 2, 3].map((n) => <option key={n} value={n}>{n} season{n > 1 ? "s" : ""}</option>)}
                      </select>
                      <button className="btn-primary py-1 text-xs" disabled={locked || busy === s.id} onClick={() => void sign(s.id)}>
                        Sign deal
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-500">All sponsor brands are fictional. Position bonuses are paid at the end of the season.</p>
        </Panel>
      </div>
    </div>
  );
}
