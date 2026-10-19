import { useMemo, useState } from "react";
import { AlertTriangle, Search, UserMinus, UserPlus, Users } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Modal, Panel, Progress, SectionHeading } from "../components/ui";
import { TeamBadge } from "../components/LiveryEditor";
import { balanceOf, findTeam, teamDrivers } from "../lib/career";
import { money } from "../lib/format";
import { acceptanceProbability, expectedSalary, type ContractOffer } from "../engine/drivermarket";
import type { Driver } from "../engine/types";

const ATTRS: Array<{ key: keyof Driver["attributes"]; label: string }> = [
  { key: "pace", label: "Pace" },
  { key: "qualifying", label: "Qualifying" },
  { key: "racecraft", label: "Racecraft" },
  { key: "overtaking", label: "Overtaking" },
  { key: "defending", label: "Defending" },
  { key: "tireManagement", label: "Tyre management" },
  { key: "wet", label: "Wet weather" },
  { key: "consistency", label: "Consistency" },
  { key: "concentration", label: "Concentration" },
  { key: "aggression", label: "Aggression" },
];

type SortKey = "pace" | "potential" | "age" | "value";

export function DriversPage() {
  const { bundle, myTeamId, applyAction, negotiate, pushToast } = useSession();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("pace");
  const [target, setTarget] = useState<Driver | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyOffer, setBusyOffer] = useState<string | null>(null);

  const respond = async (offerId: string, accept: boolean) => {
    setBusyOffer(offerId);
    try {
      await applyAction({ type: "respond-transfer-offer", offerId, accept });
      pushToast("success", accept ? "Transfer accepted" : "Offer rejected");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusyOffer(null);
    }
  };

  if (!bundle || !myTeamId) return null;
  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const roster = teamDrivers(bundle, myTeamId);
  const balance = balanceOf(bundle, myTeamId);
  const incoming = (bundle.transferOffers ?? []).filter((o) => o.status === "open" && roster.some((d) => d.id === o.driverId));

  const freeAgents = useMemo(() => {
    const list = bundle.drivers.filter((d) => d.teamId === null);
    const filtered = query.trim()
      ? list.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()) || d.nationality.toLowerCase().includes(query.toLowerCase()))
      : list;
    return [...filtered].sort((a, b) => {
      if (sort === "potential") return b.potential - a.potential;
      if (sort === "age") return a.age - b.age;
      if (sort === "value") return b.attributes.pace / Math.max(1, b.salaryDemand) - a.attributes.pace / Math.max(1, a.salaryDemand);
      return b.attributes.pace - a.attributes.pace;
    });
  }, [bundle.drivers, query, sort]);

  const release = async (driver: Driver) => {
    if (!confirm(`Release ${driver.name}? Termination costs may apply.`)) return;
    setBusyId(driver.id);
    try {
      await applyAction({ type: "release-driver", driverId: driver.id });
      pushToast("success", `${driver.name} released`);
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Drivers"
        subtitle="Your race line-up and the free-agent market. Negotiate contracts; offers are evaluated by the driver."
        right={<Badge tone="info">{roster.length} contracted / 2 race seats</Badge>}
      />

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Panel title="Race line-up" right={<Users size={15} className="text-gray-500" />}>
            {roster.length === 0 ? (
              <Empty title="No drivers signed" hint="Sign at least two drivers from the market before the next race." />
            ) : (
              <div className="space-y-3">
                {roster.map((d) => {
                  const contract = bundle.driverContracts.find((c) => c.driverId === d.id && c.active);
                  return (
                    <div key={d.id} className="rounded-lg border border-carbon-700 bg-carbon-900/50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <TeamBadge team={team} size={30} />
                          <div>
                            <div className="text-sm font-semibold text-white">{d.name}</div>
                            <div className="text-[11px] text-gray-500">{d.nationality} · {d.age} · {d.code}</div>
                          </div>
                        </div>
                        <button className="btn-subtle p-1 text-red-300" title="Release driver" disabled={busyId === d.id} onClick={() => void release(d)}>
                          <UserMinus size={15} />
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                        {ATTRS.slice(0, 6).map((a) => (
                          <div key={a.key}>
                            <div className="flex justify-between text-[10px] text-gray-500"><span>{a.label}</span><span className="font-mono">{d.attributes[a.key]}</span></div>
                            <Progress value={d.attributes[a.key]} color="#00d2be" />
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                        <span className="chip">Morale {Math.round(d.morale)}</span>
                        <span className="chip">Contract {contract ? `${money(contract.salary, { compact: true })} / ${contract.years}y` : "—"}</span>
                        {d.traits.slice(0, 2).map((t) => <span key={t} className="chip capitalize">{t.replace(/-/g, " ")}</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 rounded bg-carbon-900/60 p-2 text-[11px] text-gray-500">
              Budget available: <span className="font-mono text-gray-300">{money(balance, { compact: true })}</span>. Signing bonuses are paid immediately; salaries are paid per race across the season.
            </div>
          </Panel>

          <Panel title="Incoming offers" right={<Badge tone={incoming.length ? "warn" : "default"}>{incoming.length}</Badge>}>
            {incoming.length === 0 ? (
              <p className="text-xs text-gray-500">
                No bids right now. Rival teams scout the grid through the season — offers for your drivers appear here when they come in.
              </p>
            ) : (
              <div className="space-y-3">
                {incoming.map((o) => {
                  const driver = bundle.drivers.find((d) => d.id === o.driverId);
                  const bidder = findTeam(bundle, o.fromTeamId);
                  if (!driver || !bidder) return null;
                  return (
                    <div key={o.id} className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <TeamBadge team={bidder} size={30} />
                          <div>
                            <div className="text-sm font-semibold text-white">{bidder.name} want {driver.name}</div>
                            <div className="text-[11px] text-gray-500">Offer expires at season's end</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-400">
                        <span className="chip">Fee {money(o.fee, { compact: true })}</span>
                        <span className="chip">Salary {money(o.salary, { compact: true })}/y</span>
                        <span className="chip">{o.years} years</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button className="btn-primary px-3 py-1 text-xs" disabled={busyOffer === o.id} onClick={() => void respond(o.id, true)}>
                          Accept transfer
                        </button>
                        <button className="btn-ghost px-3 py-1 text-xs" disabled={busyOffer === o.id} onClick={() => void respond(o.id, false)}>
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <div className="panel panel-pad text-xs text-gray-500">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-gray-400"><AlertTriangle size={13} /> Driver data</div>
            The default roster is fictional. Real driver names are available only in modes where a season roster permits them, and are always flagged as real people.
          </div>
        </div>

        <Panel
          title="Free agents"
          right={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input className="input h-8 w-40 pl-7 text-xs" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select className="input h-8 w-28 text-xs" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="pace">Pace</option>
                <option value="potential">Potential</option>
                <option value="age">Youngest</option>
                <option value="value">Value</option>
              </select>
            </div>
          }
        >
          {freeAgents.length === 0 ? (
            <Empty title="No free agents available" hint="All drivers are under contract. Check back next season." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="pb-2">Driver</th><th className="pb-2">Age</th><th className="pb-2">PAC</th><th className="pb-2">POT</th>
                    <th className="pb-2">Rep</th><th className="pb-2">Demand</th><th className="pb-2">Morale</th><th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {freeAgents.slice(0, 40).map((d) => (
                    <tr key={d.id} className="border-t border-carbon-800">
                      <td className="py-1.5">
                        <div className="font-medium text-gray-100">{d.name}</div>
                        <div className="text-[10px] text-gray-500">{d.nationality} · {d.traits.slice(0, 2).map((t) => t.replace(/-/g, " ")).join(", ") || "no notable traits"}</div>
                      </td>
                      <td className="py-1.5 font-mono text-xs text-gray-400">{d.age}</td>
                      <td className="py-1.5 font-mono text-xs text-gray-300">{d.attributes.pace}</td>
                      <td className="py-1.5 font-mono text-xs text-gray-400">{Math.round(d.potential)}</td>
                      <td className="py-1.5 font-mono text-xs text-gray-400">{Math.round(d.reputation)}</td>
                      <td className="py-1.5 font-mono text-xs text-gray-300">{money(expectedSalary(d, team.reputation), { compact: true })}</td>
                      <td className="py-1.5 font-mono text-xs text-gray-400">{Math.round(d.morale)}</td>
                      <td className="py-1.5 text-right">
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setTarget(d)}>
                          <UserPlus size={13} /> Offer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <OfferModal
        driver={target}
        onClose={() => setTarget(null)}
        onSubmit={async (offer) => {
          if (!target) return null;
          const res = await negotiate(target.id, team.id, offer);
          if (res.accepted) {
            await applyAction({
              type: "sign-driver",
              teamId: team.id,
              driverId: target.id,
              salary: offer.salary,
              signingBonus: offer.signingBonus,
              winBonus: offer.winBonus,
              podiumBonus: offer.podiumBonus,
              years: offer.years,
              performanceClausePosition: offer.performanceClausePosition,
            });
            pushToast("success", `${target.name} has signed for the team.`);
            setTarget(null);
            return null;
          }
          return res;
        }}
        teamReputation={team.reputation}
        balance={balance}
      />
    </div>
  );
}

function OfferModal({
  driver,
  onClose,
  onSubmit,
  teamReputation,
  balance,
}: {
  driver: Driver | null;
  onClose: () => void;
  onSubmit: (offer: ContractOffer) => Promise<import("../engine/drivermarket").NegotiationResult | null>;
  teamReputation: number;
  balance: number;
}) {
  const [offer, setOffer] = useState<ContractOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<import("../engine/drivermarket").NegotiationResult | null>(null);

  if (!driver) return null;
  const base = offer ?? {
    salary: expectedSalary(driver, teamReputation),
    years: 2,
    signingBonus: 0,
    winBonus: 100_000,
    podiumBonus: 50_000,
    role: "second" as const,
    performanceClausePosition: null,
  };
  const set = <K extends keyof ContractOffer>(k: K, v: ContractOffer[K]) => setOffer({ ...base, [k]: v });
  const expected = expectedSalary(driver, teamReputation);
  const probability = acceptanceProbability(driver, { reputation: teamReputation } as never, base, 10);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await onSubmit(base);
      if (res) {
        setReply(res);
        if (res.counterOffer) setOffer(res.counterOffer);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!driver}
      onClose={onClose}
      title={`Contract offer — ${driver.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
            <UserPlus size={15} /> Submit offer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-carbon-700 bg-carbon-900/60 p-3 text-xs">
          <div>
            <div className="font-semibold text-gray-200">{driver.name}</div>
            <div className="text-gray-500">{driver.nationality} · age {driver.age} · rep {Math.round(driver.reputation)}</div>
          </div>
          <div className="text-right">
            <div className="text-gray-500">Expected salary</div>
            <div className="font-mono text-sm text-race-teal">{money(expected, { compact: true })}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Salary / season</span>
            <input type="number" className="input mt-1" value={base.salary} min={0} step={100_000}
              onChange={(e) => set("salary", Math.max(0, Number(e.target.value)))} />
          </label>
          <label className="block">
            <span className="label">Contract years</span>
            <select className="input mt-1" value={base.years} onChange={(e) => set("years", Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Signing bonus</span>
            <input type="number" className="input mt-1" value={base.signingBonus} min={0} step={50_000}
              onChange={(e) => set("signingBonus", Math.max(0, Number(e.target.value)))} />
          </label>
          <label className="block">
            <span className="label">Role</span>
            <select className="input mt-1" value={base.role} onChange={(e) => set("role", e.target.value as ContractOffer["role"])}>
              <option value="lead">Team leader</option>
              <option value="second">Second driver</option>
              <option value="development">Development</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Win bonus</span>
            <input type="number" className="input mt-1" value={base.winBonus} min={0} step={25_000}
              onChange={(e) => set("winBonus", Math.max(0, Number(e.target.value)))} />
          </label>
          <label className="block">
            <span className="label">Podium bonus</span>
            <input type="number" className="input mt-1" value={base.podiumBonus} min={0} step={10_000}
              onChange={(e) => set("podiumBonus", Math.max(0, Number(e.target.value)))} />
          </label>
        </div>

        <div className="rounded-lg border border-carbon-700 bg-carbon-900/60 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Estimated acceptance chance</span>
            <span className={`font-mono font-semibold ${probability > 0.65 ? "text-emerald-400" : probability > 0.35 ? "text-amber-400" : "text-red-400"}`}>
              {Math.round(probability * 100)}%
            </span>
          </div>
          <div className="mt-1"><Progress value={probability * 100} color={probability > 0.65 ? "#34d399" : probability > 0.35 ? "#fbbf24" : "#f87171"} /></div>
          <div className="mt-2 flex justify-between text-[11px] text-gray-500">
            <span>Signing bonus affordability: {money(balance, { compact: true })} cash</span>
            <span>{base.signingBonus > balance ? "Over budget" : "Within budget"}</span>
          </div>
        </div>

        {reply && (
          <div className={`rounded-lg border p-3 text-xs ${reply.accepted ? "border-emerald-800 bg-emerald-950/40 text-emerald-200" : "border-amber-800 bg-amber-950/40 text-amber-200"}`}>
            {reply.message}
            {reply.counterOffer && (
              <div className="mt-1 text-amber-300/80">
                Counter: {money(reply.counterOffer.salary, { compact: true })} / season, {money(reply.counterOffer.signingBonus, { compact: true })} bonus, {reply.counterOffer.years} years.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
