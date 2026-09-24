// Dates are stored as "YYYY-MM-DD". toISOString() uses UTC, which gives the
// wrong day near midnight, so build the string from local time instead.
export function toLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  return toLocalDateString(new Date(year, month - 1, day + days));
}

function addMonths(dateString: string, months: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  // Clamp to the last day of the target month (Jan 31 + 1 month = Feb 28/29)
  const lastDay = new Date(year, month - 1 + months + 1, 0).getDate();
  return toLocalDateString(
    new Date(year, month - 1 + months, Math.min(day, lastDay))
  );
}

// Next due date for a repeating task, never earlier than today.
export function nextOccurrence(
  from: string,
  repeat: "daily" | "weekly" | "monthly",
  today: string
): string {
  const step = (date: string) =>
    repeat === "daily"
      ? addDays(date, 1)
      : repeat === "weekly"
        ? addDays(date, 7)
        : addMonths(date, 1);
  let next = step(from);
  while (next < today) next = step(next);
  return next;
}

// "14:30:00" -> "14:30"
export function formatTime(time: string): string {
  return time.slice(0, 5);
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
  const [year, month, day] = dateString.split("-").map(Number);
  const weekday = (new Date(year, month - 1, day).getDay() + 6) % 7; // Mon = 0
  const monday = addDays(dateString, -weekday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
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
