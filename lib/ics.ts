import { addDays, toLocalDateString, WEEKDAYS, weekdayOf, type Weekday } from "@/utils/date";
import { newId, type BusyBlock } from "@/types/persona";

// Reads a calendar export (.ics from Google Calendar, Outlook, a university
// timetable): weekly repeating events become busy hours, one-off events in
// the coming months become fixed tasks. Runs in the browser; nothing is
// uploaded anywhere.

export type IcsEvent = { title: string; date: string; start: string | null; end: string | null };
export type IcsImport = { blocks: BusyBlock[]; events: IcsEvent[] };

const BYDAY: Record<string, Weekday> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };

// "20260915T090000Z" / "20260915T090000" / "20260915" -> local date + time
function parseStamp(value: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , utc] = m;
  if (!h) return { date: `${y}-${mo}-${d}`, time: null };
  if (utc) {
    const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    return {
      date: toLocalDateString(local),
      time: `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
    };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

function unescape(text: string): string {
  return text.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

export function parseIcs(text: string, today = toLocalDateString()): IcsImport {
  // Long lines are folded: a line starting with a space continues the previous one
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const blocks: BusyBlock[] = [];
  const events: IcsEvent[] = [];
  const horizon = addDays(today, 120);

  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT" && current) {
      const ev = current;
      current = null;
      const title = unescape(ev.SUMMARY ?? "Busy").slice(0, 40) || "Busy";
      const start = ev.DTSTART ? parseStamp(ev.DTSTART) : null;
      const end = ev.DTEND ? parseStamp(ev.DTEND) : null;
      if (!start) continue;
      const rule = Object.fromEntries(
        (ev.RRULE ?? "").split(";").map((part) => part.split("=") as [string, string])
      ) as Record<string, string>;

      if (rule.FREQ === "WEEKLY" && start.time && end?.time) {
        const until = rule.UNTIL ? parseStamp(rule.UNTIL)?.date : undefined;
        if (until && until < today) continue; // ended
        const days = (rule.BYDAY ? rule.BYDAY.split(",").map((d) => BYDAY[d.slice(-2)]) : [weekdayOf(start.date)]).filter(
          (d): d is Weekday => !!d
        );
        if (!days.length || start.time === end.time) continue;
        // Same event on several days = one block
        const existing = blocks.find((b) => b.label === title && b.start === start.time && b.end === end.time);
        if (existing) {
          existing.days = WEEKDAYS.filter((d) => existing.days.includes(d) || days.includes(d));
          continue;
        }
        blocks.push({
          id: newId(),
          label: title,
          days: WEEKDAYS.filter((d) => days.includes(d)),
          start: start.time,
          end: end.time,
          ...(start.date > today && { valid_from: start.date }),
          ...(until && { valid_until: until }),
        });
        continue;
      }

      if (!ev.RRULE && start.date >= today && start.date <= horizon) {
        events.push({ title: unescape(ev.SUMMARY ?? "Event").slice(0, 150), date: start.date, start: start.time, end: end?.time ?? null });
      }
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(";")[0].toUpperCase();
    if (["SUMMARY", "DTSTART", "DTEND", "RRULE"].includes(key)) current[key] = line.slice(colon + 1);
  }

  return {
    blocks: blocks.slice(0, 20),
    events: events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 200),
  };
}
