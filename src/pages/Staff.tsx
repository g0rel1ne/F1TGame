import { useState } from "react";
import { Briefcase, Search, UserMinus, UserPlus } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, Empty, Panel, Progress, SectionHeading, Stat } from "../components/ui";
import { STAFF_ROLES, roleMeta } from "../data/staff";
import { balanceOf, findTeam } from "../lib/career";
import { money } from "../lib/format";

export function StaffPage() {
  const { bundle, myTeamId, applyAction, pushToast } = useSession();
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!bundle || !myTeamId) return null;
  const team = findTeam(bundle, myTeamId);
  if (!team) return null;

  const staff = bundle.staff.filter((s) => s.teamId === myTeamId);
  const market = bundle.staffMarket
    .filter((s) => roleFilter === "all" || s.role === roleFilter)
    .filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.skill - a.skill);
  const wageTotal = staff.reduce((sum, s) => sum + s.wage, 0);
  const avgSkill = staff.length ? staff.reduce((sum, s) => sum + s.skill, 0) / staff.length : 0;
  const topSkill = staff.length ? Math.max(...staff.map((s) => s.skill)) : 0;

  const act = async (fn: () => Promise<unknown>, id: string, ok: string) => {
    setBusy(id);
    try {
      await fn();
      pushToast("success", ok);
    } catch (e) {
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Staff"
        subtitle="Hire specialists to improve development, strategy, pit stops and commercial performance."
        right={<Badge tone="info">{staff.length}/{STAFF_ROLES.length} roles filled</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Annual wages" value={money(wageTotal, { compact: true })} hint="Paid across the season" />
        <Stat label="Average skill" value={avgSkill.toFixed(1)} hint="All employed staff" />
        <Stat label="Top specialist" value={topSkill.toFixed(0)} hint="Drives development modifiers" />
        <Stat label="Budget" value={money(balanceOf(bundle, myTeamId), { compact: true })} hint="Cash available" accent={balanceOf(bundle, myTeamId) < 0 ? "#f87171" : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Your staff" right={<Briefcase size={15} className="text-gray-500" />}>
          {staff.length === 0 ? (
            <Empty title="No staff employed" hint="Hire from the market to unlock development and strategy bonuses." />
          ) : (
            <div className="space-y-2">
              {STAFF_ROLES.map((meta) => {
                const member = staff.find((s) => s.role === meta.role);
                return (
                  <div key={meta.role} className={`rounded-lg border p-2.5 ${member ? "border-carbon-700 bg-carbon-900/50" : "border-dashed border-carbon-600"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-100">{member?.name ?? "Vacant"}</div>
                        <div className="text-[11px] text-gray-500">{meta.label} · {meta.effect}</div>
                      </div>
                      {member ? (
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <div className="font-mono text-sm text-race-teal">{member.skill}</div>
                            <div className="text-[10px] text-gray-500">{money(member.wage, { compact: true })}/y</div>
                          </div>
                          <button className="btn-subtle p-1 text-red-300" disabled={busy === member.id} onClick={() => void act(() => applyAction({ type: "fire-staff", teamId: myTeamId, staffId: member.id }), member.id, `${member.name} released`)}>
                            <UserMinus size={14} />
                          </button>
                        </div>
                      ) : (
                        <Badge>Vacant</Badge>
                      )}
                    </div>
                    {member && (
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        <div><Progress value={member.skill} color="#00d2be" /></div>
                        <div className="flex items-center justify-between text-[10px] text-gray-500"><span>Morale {Math.round(member.morale)}</span><span>Age {member.age}</span></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="Staff market"
          right={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input className="input h-8 w-32 pl-7 text-xs" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select className="input h-8 w-36 text-xs" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="all">All roles</option>
                {STAFF_ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
              </select>
            </div>
          }
        >
          {market.length === 0 ? (
            <Empty title="No candidates" hint="Try another role or clear the search." />
          ) : (
            <div className="space-y-2">
              {market.slice(0, 24).map((s) => {
                const filled = staff.some((x) => x.role === s.role);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-carbon-900/50 p-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-100">{s.name}</div>
                      <div className="text-[11px] text-gray-500">{roleMeta(s.role).label} · {s.nationality} · age {s.age}</div>
                      <div className="mt-1 text-[10px] text-gray-500">{money(s.wage, { compact: true })}/season · skill {s.skill} · potential {s.potential}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="w-20"><Progress value={s.skill} color="#00d2be" /></div>
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        disabled={filled || busy === s.id}
                        title={filled ? "Role already filled — release the current employee first" : "Hire"}
                        onClick={() => void act(() => applyAction({ type: "hire-staff", teamId: myTeamId, staffId: s.id }), s.id, `${s.name} hired`)}
                      >
                        <UserPlus size={13} /> {filled ? "Filled" : "Hire"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-500">Hiring is immediate and wages are paid per race. Each role may have only one employee at a time.</p>
        </Panel>
      </div>
    </div>
  );
}
