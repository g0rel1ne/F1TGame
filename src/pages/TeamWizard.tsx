import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Flag, Loader2 } from "lucide-react";
import { useSession } from "../state/session";
import { CarSvg, DEFAULT_PAINT, type CarPaint } from "../components/CarSvg";
import { LiveryEditor } from "../components/LiveryEditor";
import { Badge, SectionHeading } from "../components/ui";

const NATIONS = ["British", "Italian", "German", "French", "Spanish", "Dutch", "American", "Japanese", "Brazilian", "Australian", "Canadian", "Swiss", "Austrian", "Belgian", "Mexican"];
const ENGINES = ["Aurora Power", "Mercedes", "Ferrari", "Honda", "Renault", "Audi", "RB Powertrains"];
const PHILOSOPHIES = ["Aero-first attack", "Balanced development", "Mechanical grip & traction", "Power and efficiency", "Reliability above all", "Youth academy project"];
const HEADQUARTERS = ["London, UK", "Maranello, Italy", "Stuttgart, Germany", "Woking, UK", "Milton Keynes, UK", "Enstone, UK", "Hinwil, Switzerland", "Silverstone, UK"];

export function TeamWizardPage() {
  const { user, applyAction, pushToast, refresh } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("Apex Grand Prix");
  const [shortName, setShortName] = useState("Apex");
  const [abbreviation, setAbbreviation] = useState("APX");
  const [nationality, setNationality] = useState("British");
  const [headquarters, setHeadquarters] = useState(HEADQUARTERS[0]);
  const [engineSupplier, setEngineSupplier] = useState(ENGINES[0]);
  const [philosophy, setPhilosophy] = useState(PHILOSOPHIES[0]);
  const [numberStyle, setNumberStyle] = useState("classic");
  const [paint, setPaint] = useState<CarPaint>(DEFAULT_PAINT);

  if (!user) return null;

  const steps = ["Identity", "Livery", "Engineering", "Review"];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await applyAction({
        type: "create-team",
        userId: user.id,
        request: {
          name: name.trim(),
          shortName: shortName.trim() || name.trim().split(" ")[0],
          abbreviation: abbreviation.trim().toUpperCase(),
          nationality,
          headquarters,
          engineSupplier,
          philosophy,
          numberStyle,
          colors: { primary: paint.primary, secondary: paint.secondary, accent: paint.accent },
          livery: {
            nose: paint.nose,
            frontWing: paint.frontWing,
            sidepod: paint.sidepod,
            engineCover: paint.engineCover,
            rearWing: paint.rearWing,
            accentStripe: paint.accentStripe,
            halo: paint.halo,
          },
          logo: { symbol: "bolt", background: paint.secondary },
        },
      });
      await refresh();
      pushToast("success", "Team created. Welcome to the grid.");
      navigate("/career/dashboard");
    } catch (e) {
      setErr((e as Error).message);
      pushToast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const validIdentity =
    name.trim().length >= 3 && abbreviation.trim().length === 3 && shortName.trim().length >= 2;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <SectionHeading title="Create your team" subtitle="Build the identity, livery and engineering philosophy that will define your career." right={<Badge tone="info">Step {step + 1} / 4</Badge>} />

      <div className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${i <= step ? "bg-race-red text-white" : "bg-carbon-700 text-gray-500"}`}>{i + 1}</span>
            <span className={`hidden text-xs font-semibold uppercase tracking-wide sm:block ${i === step ? "text-white" : "text-gray-500"}`}>{s}</span>
            {i < steps.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-race-red/60" : "bg-carbon-700"}`} />}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="panel panel-pad">
          {step === 0 && (
            <div className="space-y-4">
              <label className="block">
                <span className="label">Team name</span>
                <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Apex Grand Prix" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Short name</span>
                  <input className="input mt-1" value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={20} />
                </label>
                <label className="block">
                  <span className="label">Abbreviation (3 letters)</span>
                  <input className="input mt-1 font-mono uppercase tracking-[0.3em]" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase())} maxLength={3} />
                </label>
                <label className="block">
                  <span className="label">Nationality</span>
                  <select className="input mt-1" value={nationality} onChange={(e) => setNationality(e.target.value)}>
                    {NATIONS.map((n) => <option key={n}>{n}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Headquarters</span>
                  <select className="input mt-1" value={headquarters} onChange={(e) => setHeadquarters(e.target.value)}>
                    {HEADQUARTERS.map((n) => <option key={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="label">Race number style</span>
                <select className="input mt-1" value={numberStyle} onChange={(e) => setNumberStyle(e.target.value)}>
                  {["classic", "italic", "block", "outline"].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="mb-4 text-sm text-gray-400">Paint each section independently. The preview updates live.</p>
              <LiveryEditor paint={paint} onChange={setPaint} number={abbreviation} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <label className="block">
                <span className="label">Engine supplier</span>
                <select className="input mt-1" value={engineSupplier} onChange={(e) => setEngineSupplier(e.target.value)}>
                  {ENGINES.map((n) => <option key={n}>{n}</option>)}
                </select>
                <span className="mt-1 block text-xs text-gray-500">Engine choice affects power, reliability and development focus.</span>
              </label>
              <label className="block">
                <span className="label">Team philosophy</span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {PHILOSOPHIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPhilosophy(p)}
                      className={`rounded-lg border p-2.5 text-left text-sm transition-colors ${philosophy === p ? "border-race-teal bg-race-teal/10 text-white" : "border-carbon-700 bg-carbon-900/60 text-gray-300 hover:border-carbon-500"}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </label>
              <div className="rounded-lg border border-carbon-700 bg-carbon-900/60 p-3 text-xs text-gray-400">
                You start with a new-entrant car and a full staff roster. Your budget and facilities can be upgraded from the team pages. Use the driver market to sign your first two drivers before the opening round.
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-carbon-700 bg-carbon-900/60 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-lg font-display text-lg font-bold text-white" style={{ background: paint.primary, border: `2px solid ${paint.accent}` }}>
                    {abbreviation || "?"}
                  </span>
                  <div>
                    <div className="font-display text-xl font-bold text-white">{name}</div>
                    <div className="text-sm text-gray-400">{shortName} · {nationality} · {headquarters}</div>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["Engine", engineSupplier],
                    ["Philosophy", philosophy],
                    ["Number style", numberStyle],
                    ["Grid status", "New entrant"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded bg-carbon-800 p-2">
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{k}</dt>
                      <dd className="text-gray-200">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {err && <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">{err}</div>}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button className="btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft size={16} /> Back
            </button>
            {step < 3 ? (
              <button className="btn-primary" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !validIdentity}>
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button className="btn-primary" onClick={() => void submit()} disabled={busy || !validIdentity}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Create team
              </button>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="border-b border-carbon-700 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                <Flag size={14} /> Live livery preview
              </div>
            </div>
            <div className="bg-gradient-to-b from-carbon-800 via-carbon-850 to-carbon-900 p-4">
              <CarSvg paint={paint} number={abbreviation} className="h-44 w-full" />
            </div>
            <div className="grid grid-cols-3 gap-2 p-3">
              {[
                [paint.primary, "Primary"],
                [paint.secondary, "Secondary"],
                [paint.accent, "Accent"],
              ].map(([c, l]) => (
                <div key={l} className="rounded border border-carbon-700 p-2 text-center">
                  <div className="mx-auto h-5 w-5 rounded" style={{ background: c }} />
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel panel-pad text-xs text-gray-500">
            Team names and abbreviations must be unique within the lobby. You can change colours later, but the identity is fixed for the season.
          </div>
        </aside>
      </div>
    </div>
  );
}
