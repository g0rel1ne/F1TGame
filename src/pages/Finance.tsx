import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleDollarSign, LifeBuoy } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, SectionHeading, Stat } from "../components/ui";
import { balanceOf, findTeam } from "../lib/career";
import { money } from "../lib/format";
import type { Transaction } from "../engine/types";

const CATEGORY_LABEL: Record<Transaction["category"], string> = {
  "prize-money": "Prize money",
  "sponsor-upfront": "Sponsor upfront",
  "sponsor-per-race": "Sponsor per race",
  "sponsor-bonus": "Sponsor bonus",
  "driver-salary": "Driver salaries",
  "staff-wage": "Staff wages",
  "facility-upkeep": "Facility upkeep",
  research: "Research",
  manufacturing: "Facilities & manufacturing",
  repairs: "Repairs",
  travel: "Travel",
  termination: "Contract termination",
  transfer: "Transfer fees",
  investment: "Investment",
  "starting-capital": "Starting capital",
};

export function FinancePage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [busy, setBusy] = useState(false);
  if (!bundle || !myTeamId) return null;
  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const balance = balanceOf(bundle, myTeamId);
  const txns = bundle.transactions.filter((t) => t.teamId === myTeamId);
  const seasonTxns = txns.filter((t) => t.season === bundle.season.number);

  const totals = useMemo(() => {
    const income = seasonTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = seasonTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const byCategory = new Map<string, number>();
    for (const t of seasonTxns) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    return { income, expenses, net: income + expenses, byCategory };
  }, [seasonTxns]);

  const shown = [...txns]
    .filter((t) => (filter === "income" ? t.amount > 0 : filter === "expense" ? t.amount < 0 : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);

  const emergency = async () => {
    setBusy(true);
    try {
      await applyAction({ type: "emergency-funding", teamId: myTeamId });
      pushToast("success", "Emergency funding secured: +$25M");
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Finance"
        subtitle="Cash flow, prize money, salaries and capital expenditure. Salaries, wages and upkeep are charged per race."
        right={<Badge tone={balance < 0 ? "bad" : "good"}>{balance < 0 ? "In the red" : "Solvent"}</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Cash balance" value={money(balance, { compact: true })} hint="Available now" accent={balance < 0 ? "#f87171" : "#34d399"} />
        <Stat label="Season income" value={money(totals.income, { compact: true })} hint="Prizes and sponsors" />
        <Stat label="Season expenses" value={money(Math.abs(totals.expenses), { compact: true })} hint="Salaries, staff, upkeep, R&D" />
        <Stat label="Net this season" value={money(totals.net, { compact: true })} hint={`${seasonTxns.length} transactions`} accent={totals.net < 0 ? "#fbbf24" : "#34d399"} />
      </div>

      {balance < 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-800 bg-red-950/40 p-3">
          <div className="flex items-start gap-2 text-sm text-red-200">
            <AlertTriangle size={16} className="mt-0.5" />
            <span>The team is running a negative balance. Emergency investor funding is available once while in the red.</span>
          </div>
          <button className="btn-primary" onClick={() => void emergency()} disabled={busy}>
            <LifeBuoy size={15} /> Secure $25M funding
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Panel title="Breakdown this season" right={<CircleDollarSign size={15} className="text-gray-500" />}>
            <div className="space-y-2">
              {[...totals.byCategory.entries()]
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([cat, amount]) => (
                  <div key={cat} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-gray-400">
                      {amount >= 0 ? <ArrowUpRight size={13} className="text-emerald-400" /> : <ArrowDownRight size={13} className="text-red-400" />}
                      {CATEGORY_LABEL[cat as Transaction["category"]]}
                    </span>
                    <span className={`font-mono ${amount >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(amount, { compact: true })}</span>
                  </div>
                ))}
              {totals.byCategory.size === 0 && <Empty title="No transactions yet" hint="Complete a race weekend to see prize money and costs." />}
            </div>
          </Panel>

          <Panel title="Cost control">
            <ul className="space-y-1.5 text-xs text-gray-400">
              <li>• Driver salaries and staff wages are paid in equal instalments each race.</li>
              <li>• Facility upkeep scales with level and is charged per race.</li>
              <li>• Research and facility upgrades are paid up front.</li>
              <li>• Constructors' prize money is paid at season end.</li>
            </ul>
          </Panel>
        </div>

        <Panel
          title="Transactions"
          right={
            <div className="flex gap-1">
              {(["all", "income", "expense"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-1 text-[11px] font-semibold capitalize ${filter === f ? "bg-carbon-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                  {f}
                </button>
              ))}
            </div>
          }
        >
          {shown.length === 0 ? (
            <Empty title="No transactions" hint="This ledger fills up as you race, sign drivers and invest." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="pb-2">Season / Rd</th><th className="pb-2">Description</th><th className="pb-2">Category</th><th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className="border-t border-carbon-800">
                      <td className="py-1.5 font-mono text-xs text-gray-500">S{t.season} · {t.raceIndex > 90 ? "End" : `R${t.raceIndex + 1}`}</td>
                      <td className="py-1.5 text-gray-200">{t.description}</td>
                      <td className="py-1.5 text-xs text-gray-500">{CATEGORY_LABEL[t.category]}</td>
                      <td className={`py-1.5 text-right font-mono ${t.amount >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
