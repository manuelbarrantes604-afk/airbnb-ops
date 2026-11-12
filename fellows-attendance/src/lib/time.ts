// All fellowship times are shown and entered in America/New_York.
// Instants are stored in UTC; conversions go through Intl so daylight-saving
// changes are handled by the platform's time-zone database.

export const TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function nyParts(d: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant, in New York. */
export function nyDateKey(at: Date | string): string {
  const { y, m, d } = nyParts(typeof at === "string" ? new Date(at) : at);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** HH:MM (24h) of an instant, in New York. */
export function nyTimeKey(at: Date | string): string {
  const { hh, mm } = nyParts(typeof at === "string" ? new Date(at) : at);
  return `${pad(hh)}:${pad(mm)}`;
}

/** Offset (ms) of New York from UTC at a given instant. */
function offsetAt(ms: number): number {
  const p = nyParts(new Date(ms));
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/**
 * Convert a New York wall-clock date+time to a UTC Date.
 * During the spring-forward gap (e.g. 2:30am that doesn't exist), the time is
 * moved forward by an hour; during the fall-back overlap the earlier instant is used.
 */
export function nyToUtc(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  // Prefer the earlier of two valid instants in the fall-back hour.
  const earlier = guess - 3600_000;
  if (wall - offsetAt(earlier) === earlier) return new Date(earlier);
  return new Date(guess);
}

export function todayKey(now: Date = new Date()): string {
  return nyDateKey(now);
}

/** Add days to a YYYY-MM-DD key (calendar arithmetic, no time zone). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD key. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}

export function addMonths(monthK: string, n: number): string {
  const [y, m] = monthK.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

const keyToNoonUtc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

export function fmtDateLong(key: string): string {
  return keyToNoonUtc(key).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function fmtDateMedium(key: string): string {
  return keyToNoonUtc(key).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function fmtDateShort(key: string): string {
  return keyToNoonUtc(key).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function fmtMonth(monthK: string): string {
  return keyToNoonUtc(`${monthK}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function fmtWeekdayShort(key: string): string {
  return keyToNoonUtc(key).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fmtTimeRange(startIso: string, endIso: string): string {
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" })
    .formatToParts(new Date(startIso)).find((p) => p.type === "timeZoneName")?.value ?? "ET";
  return `${fmtTime(startIso)} – ${fmtTime(endIso)} ${tzName}`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ, timeZoneName: "short",
  });
}

export function relativeDay(key: string, now: Date = new Date()): string | null {
  const t = todayKey(now);
  if (key === t) return "Today";
  if (key === addDays(t, 1)) return "Tomorrow";
  if (key === addDays(t, -1)) return "Yesterday";
  return null;
}
