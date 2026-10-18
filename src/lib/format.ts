export function money(n: number, opts: { compact?: boolean } = {}): string {
  const abs = Math.abs(n);
  if (opts.compact) {
    if (abs >= 1e9) return `${n < 0 ? "-" : ""}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(0)}K`;
  }
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function lapTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export function gap(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds <= 0) return "LEADER";
  return `+${seconds.toFixed(3)}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
