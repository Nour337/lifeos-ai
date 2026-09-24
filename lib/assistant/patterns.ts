import { addDays } from "@/utils/date";

// Repeating schedules the AI can ask for. The AI only describes the pattern;
// the actual dates are calculated here, because language models are bad at
// calendar arithmetic.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Pattern =
  | { type: "daily" }
  | { type: "weekdays" } // Mon–Fri
  | { type: "weekends" } // Sat, Sun
  | { type: "days_of_week"; days: Weekday[] }
  | { type: "every_n_days"; n: number }
  | { type: "on_off"; on_days: number; off_days: number }; // e.g. 3 on, 1 off

export const MAX_OCCURRENCES = 90;
const DEFAULT_SPAN_DAYS = 28; // when neither count nor until is given

function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
}

function matches(pattern: Pattern, date: string, dayIndex: number): boolean {
  const weekday = weekdayOf(date);
  switch (pattern.type) {
    case "daily":
      return true;
    case "weekdays":
      return !["sat", "sun"].includes(weekday);
    case "weekends":
      return ["sat", "sun"].includes(weekday);
    case "days_of_week":
      return pattern.days.includes(weekday);
    case "every_n_days":
      return dayIndex % Math.max(1, pattern.n) === 0;
    case "on_off": {
      const cycle = Math.max(1, pattern.on_days) + Math.max(0, pattern.off_days);
      return dayIndex % cycle < Math.max(1, pattern.on_days);
    }
  }
}

// Dates on which the task happens, starting at `start` (inclusive).
// Stops after `count` occurrences, after `until` (inclusive), or after four
// weeks if neither is given — and never more than MAX_OCCURRENCES.
export function expandPattern(
  pattern: Pattern,
  start: string,
  options: { count?: number | null; until?: string | null } = {}
): string[] {
  const count = options.count && options.count > 0 ? Math.min(options.count, MAX_OCCURRENCES) : null;
  const until =
    options.until ?? (count ? null : addDays(start, DEFAULT_SPAN_DAYS - 1));
  const dates: string[] = [];

  // Hard stop so a bad pattern can never loop forever (~1 year)
  for (let i = 0; i < 366 && dates.length < (count ?? MAX_OCCURRENCES); i++) {
    const date = addDays(start, i);
    if (until && date > until) break;
    if (matches(pattern, date, i)) dates.push(date);
  }
  return dates;
}

// Validate a pattern object coming from the AI; returns null if unusable.
export function parsePattern(raw: unknown): Pattern | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  switch (p.type) {
    case "daily":
    case "weekdays":
    case "weekends":
      return { type: p.type };
    case "days_of_week": {
      const days = (Array.isArray(p.days) ? p.days : [])
        .map((d) => String(d).toLowerCase().slice(0, 3))
        .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
      return days.length ? { type: "days_of_week", days } : null;
    }
    case "every_n_days": {
      const n = Math.round(Number(p.n));
      return n >= 1 && n <= 60 ? { type: "every_n_days", n } : null;
    }
    case "on_off": {
      const on = Math.round(Number(p.on_days));
      const off = Math.round(Number(p.off_days));
      return on >= 1 && on <= 30 && off >= 0 && off <= 30
        ? { type: "on_off", on_days: on, off_days: off }
        : null;
    }
    default:
      return null;
  }
}
