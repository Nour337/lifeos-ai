// Dates are stored as "YYYY-MM-DD". toISOString() uses UTC, which gives the
// wrong day near midnight, so build the string from local time instead.
export function toLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Calendar arithmetic on "YYYY-MM-DD" strings. Done in UTC so daylight
// saving changes can never shift the result by a day.
function parse(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateString: string, days: number): string {
  return format(parse(dateString) + days * 86_400_000);
}

// Whole days from `from` to `to` (negative if `to` is earlier)
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weekdayOf(dateString: string): Weekday {
  return WEEKDAYS[(new Date(parse(dateString)).getUTCDay() + 6) % 7];
}

// "Mon", "Tue"...
export function weekdayShort(dateString: string): string {
  const w = weekdayOf(dateString);
  return w[0].toUpperCase() + w.slice(1);
}

// ---------------------------------------------------------------- time zones

// The user's date and time in their own timezone, e.g. for "Africa/Cairo".
// Works the same on the server and in the browser.
export function nowInZone(timeZone: string, now: Date = new Date()): { today: string; localTime: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    return { today: `${get("year")}-${get("month")}-${get("day")}`, localTime: `${get("hour")}:${get("minute")}` };
  } catch {
    // Unknown zone: UTC
    return { today: now.toISOString().slice(0, 10), localTime: now.toISOString().slice(11, 16) };
  }
}

// The browser's timezone ("Africa/Cairo"), saved to the profile on login
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------- times

// "14:30:00" -> "14:30"
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

// Minutes from "HH:MM" to "HH:MM" (negative if end is before start)
export function minutesBetween(start: string, end: string): number {
  return timeToMinutes(end) - timeToMinutes(start);
}

export function timeToMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60 - 1));
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export type DayPart = "morning" | "afternoon" | "evening" | "anytime";

export function getDayPart(time: string | null): DayPart {
  if (!time) return "anytime";
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// Monday-first week containing the given date
export function getWeekDays(dateString: string): string[] {
  const monday = addDays(dateString, -WEEKDAYS.indexOf(weekdayOf(dateString)));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function weekStartOf(dateString: string): string {
  return getWeekDays(dateString)[0];
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatDate(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export type DueTone = "overdue" | "today" | "soon" | "later";

// Human label for a due date relative to today: "Today", "Tomorrow", "Overdue · Mon, Sep 21"...
export function describeDue(
  due: string,
  today: string
): { label: string; tone: DueTone } {
  if (due < today) return { label: `Overdue · ${formatDate(due)}`, tone: "overdue" };
  if (due === today) return { label: "Today", tone: "today" };
  if (due === addDays(today, 1)) return { label: "Tomorrow", tone: "soon" };
  if (due <= addDays(today, 6)) {
    const [year, month, day] = due.split("-").map(Number);
    const weekday = new Date(year, month - 1, day).toLocaleDateString(undefined, {
      weekday: "long",
    });
    return { label: weekday, tone: "soon" };
  }
  return { label: formatDate(due), tone: "later" };
}
