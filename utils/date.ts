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
