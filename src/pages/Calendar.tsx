import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, CloudSun, Flag, Zap } from "lucide-react";
import { useSession } from "../state/session";
import { Badge, SectionHeading } from "../components/ui";
import { getCircuit } from "../data/circuits";
import { findDriver, findTeam, seasonLabel } from "../lib/career";
import { lapTime } from "../lib/format";

export function CalendarPage() {
  const { bundle } = useSession();
  if (!bundle) return null;

  const current = bundle.season.currentRaceIndex;
  const sprints = new Set(bundle.season.sprintRaces);
  const resultAt = (idx: number) => bundle.results.find((r) => r.season === bundle.season.number && r.raceIndex === idx) ?? null;

  return (
    <div>
      <SectionHeading
        title="Calendar"
        subtitle={`${seasonLabel(bundle)} season · ${bundle.season.calendar.length} rounds · ${bundle.settings.raceDistancePct}% race distance`}
        right={<Badge tone="info"><CalendarDays size={12} /> Round {Math.min(current + 1, bundle.season.calendar.length)}</Badge>}
      />

      <div className="space-y-2">
        {bundle.season.calendar.map((circuitId, idx) => {
          const circuit = getCircuit(circuitId);
          const result = resultAt(idx);
          const isCurrent = idx === current && !bundle.season.completed;
          const winner = result?.classification[0];
          const winnerDriver = winner ? findDriver(bundle, winner.driverId) : null;
          const winnerTeam = winner ? findTeam(bundle, winner.teamId) : null;
          const pole = result?.poleDriverId ? findDriver(bundle, result.poleDriverId) : null;
          const fastest = result?.fastestLapDriverId ? findDriver(bundle, result.fastestLapDriverId) : null;
          const fastestLap = result?.classification.find((c) => c.driverId === result.fastestLapDriverId)?.bestLap ?? null;

          return (
            <div
              key={`${circuitId}-${idx}`}
              className={`panel flex flex-wrap items-center gap-3 px-3 py-2.5 ${isCurrent ? "border-race-teal/40 bg-race-teal/[0.03]" : ""}`}
            >
              <div className="flex w-14 shrink-0 flex-col items-center">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Round</span>
                <span className="font-display text-xl font-bold text-gray-200">{idx + 1}</span>
              </div>

              <div className="min-w-[170px] flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-gray-100">{circuit.name}</span>
                  {sprints.has(idx) && <Badge tone="warn"><Zap size={10} /> Sprint</Badge>}
                  {isCurrent && !result && <Badge tone="info">Next up</Badge>}
                  {result && <Badge tone="good"><CheckCircle2 size={10} /> Complete</Badge>}
                </div>
                <div className="text-[11px] text-gray-500">{circuit.location}, {circuit.country} · {circuit.lengthKm.toFixed(3)} km · {circuit.corners} corners</div>
              </div>

              <div className="min-w-[220px] flex-1 text-xs">
                {result && winnerDriver ? (
                  <div className="space-y-0.5">
                    <div className="text-gray-300"><span className="text-gray-500">Winner:</span> {winnerDriver.name} <span className="text-gray-500">({winnerTeam?.shortName})</span></div>
                    <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
                      {pole && <span>Pole {pole.code} {lapTime(result.qualifying[0]?.best)}</span>}
                      {fastest && <span>FL {fastest.code} {lapTime(fastestLap)}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-1"><CloudSun size={12} /> {isCurrent ? bundle.weekend.weather.condition : `${Math.round(circuit.rainChance * 100)}% rain`}</span>
                    <span>{Math.max(5, Math.round(circuit.laps * bundle.settings.raceDistancePct / 100))} laps</span>
                  </div>
                )}
              </div>

              <div className="shrink-0">
                {isCurrent ? (
                  <Link to="/career/race" className="btn-primary py-1.5 text-xs"><Flag size={13} /> Race weekend</Link>
                ) : result ? (
                  <Link to="/career/race" className="btn-ghost py-1.5 text-xs">View result</Link>
                ) : (
                  <span className="text-[11px] text-gray-600">Upcoming</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
