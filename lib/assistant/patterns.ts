import { addDays, daysBetween, weekdayOf, WEEKDAYS, type Weekday } from "@/utils/date";

// Repeating schedules. The AI only describes the pattern; the actual dates
// are calculated here, because language models are bad at calendar
// arithmetic. A series (task_series) stores a pattern and its start date;
// its occurrences are created a few weeks ahead (lib/series.ts).

export { WEEKDAYS, type Weekday };

export type Pattern =
  | { type: "daily" }
  | { type: "weekdays" } // Mon–Fri
  | { type: "weekends" } // Sat, Sun
  | { type: "days_of_week"; days: Weekday[] }
  | { type: "every_n_days"; n: number }
  | { type: "on_off"; on_days: number; off_days: number } // e.g. 3 on, 1 off
  | { type: "monthly"; day: number }; // day of the month (31 = last day in short months)

export const MAX_OCCURRENCES = 90;

function lastDayOfMonth(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Does the pattern (anchored at `anchor`, its first possible day) fall on `date`?
export function matches(pattern: Pattern, anchor: string, date: string): boolean {
  const dayIndex = daysBetween(anchor, date);
  if (dayIndex < 0) return false;
  const weekday = weekdayOf(date);
  switch (pattern.type) {
    case "daily":
      return true;
    case "weekdays":
      return weekday !== "sat" && weekday !== "sun";
    case "weekends":
      return weekday === "sat" || weekday === "sun";
    case "days_of_week":
      return pattern.days.includes(weekday);
    case "every_n_days":
      return dayIndex % Math.max(1, pattern.n) === 0;
    case "on_off": {
      const cycle = Math.max(1, pattern.on_days) + Math.max(0, pattern.off_days);
      return dayIndex % cycle < Math.max(1, pattern.on_days);
    }
    case "monthly": {
      const day = Number(date.slice(8, 10));
      return day === Math.min(pattern.day, lastDayOfMonth(date));
    }
  }
}

// Occurrences of a stored series between `from` and `to` (inclusive),
// respecting its start, end date, number of sessions and exceptions.
export function occurrencesBetween(
  series: {
    pattern: Pattern;
    start_date: string;
    until: string | null;
    count: number | null;
    exceptions?: string[] | null;
  },
  from: string,
  to: string
): string[] {
  const end = series.until && series.until < to ? series.until : to;
  if (end < series.start_date) return [];
  const skip = new Set(series.exceptions ?? []);
  const dates: string[] = [];
  let index = 0; // occurrence number, for count-limited series
  // Walk from the start (needed for count and cycle-based patterns); cap at ~3 years
  const total = Math.min(daysBetween(series.start_date, end), 1100);
  for (let i = 0; i <= total; i++) {
    const date = addDays(series.start_date, i);
    if (!matches(series.pattern, series.start_date, date)) continue;
    index++;
    if (series.count && index > series.count) break;
    if (date >= from && !skip.has(date)) dates.push(date);
  }
  return dates;
}

// Validate a pattern object coming from the AI or the database; null if unusable.
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
        .filter((d, i, all): d is Weekday => (WEEKDAYS as readonly string[]).includes(d) && all.indexOf(d) === i);
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
    case "monthly": {
      const day = Math.round(Number(p.day));
      return day >= 1 && day <= 31 ? { type: "monthly", day } : null;
    }
    default:
      return null;
  }
}

const DAY_NAMES: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export function describePattern(pattern: Pattern): string {
  switch (pattern.type) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Weekdays";
    case "weekends":
      return "Weekends";
    case "days_of_week":
      return pattern.days.length === 7
        ? "Every day"
        : WEEKDAYS.filter((d) => pattern.days.includes(d)).map((d) => DAY_NAMES[d]).join(", ");
    case "every_n_days":
      return pattern.n === 1 ? "Every day" : pattern.n === 2 ? "Every other day" : `Every ${pattern.n} days`;
    case "on_off":
      return `${pattern.on_days} days on, ${pattern.off_days} off`;
    case "monthly":
      return `Monthly on day ${pattern.day}`;
  }
}

// The JSON schema of a pattern, shared by the AI tools
export const PATTERN_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["daily", "weekdays", "weekends", "days_of_week", "every_n_days", "on_off", "monthly"],
    },
    days: { type: "array", items: { type: "string", enum: [...WEEKDAYS] } },
    n: { type: "integer", description: "every_n_days: gap in days" },
    on_days: { type: "integer", description: "on_off: days on" },
    off_days: { type: "integer", description: "on_off: days off" },
    day: { type: "integer", description: "monthly: day of the month" },
  },
  required: ["type"],
};
