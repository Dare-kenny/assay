export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export function usd(x: number, d?: number): string {
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(d ?? 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(d ?? 1)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(d ?? 0)}K`;
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: d ?? 0 })}`;
}

export function compact(x: number, d = 1): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toFixed(d)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(d)}M`;
  if (a >= 1e4) return `${(x / 1e3).toFixed(a >= 1e5 ? 0 : d)}K`;
  return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export const int = (x: number) => Math.round(x).toLocaleString("en-US");

export function dateLong(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function dateShort(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export const withBase = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
