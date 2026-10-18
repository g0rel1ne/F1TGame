import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useSession } from "../state/session";

export function Panel({ children, className = "", title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-carbon-700 px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-gray-300">{title}</h2>
          {right}
        </header>
      )}
      <div className="panel-pad">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-carbon-700 bg-carbon-900/60 p-3">
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "info" }) {
  const tones: Record<string, string> = {
    default: "border-carbon-600 bg-carbon-800 text-gray-300",
    good: "border-emerald-700/60 bg-emerald-900/30 text-emerald-300",
    warn: "border-amber-700/60 bg-amber-900/25 text-amber-300",
    bad: "border-red-800/60 bg-red-900/30 text-red-300",
    info: "border-sky-800/60 bg-sky-900/30 text-sky-300",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Progress({ value, max = 100, color = "#00d2be" }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-carbon-700">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-carbon-600 py-10 text-center">
      <div className="text-sm font-semibold text-gray-300">{title}</div>
      {hint && <div className="max-w-sm text-xs text-gray-500">{hint}</div>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-carbon-700 px-4 py-3">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">{title}</h3>
          <button className="btn-subtle p-1" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="panel-pad max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-carbon-700 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ToastHost() {
  const { toasts } = useSession();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-800 bg-red-950/90 text-red-200"
              : t.kind === "success"
                ? "border-emerald-800 bg-emerald-950/90 text-emerald-200"
                : "border-carbon-600 bg-carbon-850/95 text-gray-200"
          }`}
        >
          {t.kind === "error" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : t.kind === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-carbon-600 border-t-race-teal" />
      {label}
    </div>
  );
}

export function SectionHeading({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-white">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
