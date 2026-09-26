import { addDays, minutesToTime, timeToMinutes, weekdayOf } from "@/utils/date";
import { blockActive, type AIProfile, type BusyBlock } from "@/types/persona";
import { isOpen, type Task } from "@/types/task";

// The one scheduling engine, shared by the AI (server) and every screen.
// It knows about:
// - fixed time: busy blocks (work, university; overnight and semester-limited),
//   tasks marked fixed (an exam at 10:00), and commute around work
// - flexible time: every other timed task
// - the user's day: wake/sleep, rest days
// - capacity: how many focused hours a day they can realistically do
// Times are minutes after midnight on a given date.

export const DEFAULT_MINUTES = 30; // assumed length of a task with no duration

export type Interval = {
  start: number;
  end: number;
  label: string;
  fixed: boolean; // can't move (busy block, fixed task)
  taskId?: string;
};

export type ScheduleInput = {
  blocks: BusyBlock[];
  tasks: Task[];
  schedule: AIProfile["schedule"];
  commuteMinutes?: number;
};

export function scheduleInput(profile: AIProfile | null, tasks: Task[]): ScheduleInput {
  return {
    blocks: profile?.blocks ?? [],
    tasks,
    schedule: profile?.schedule ?? {},
    commuteMinutes: profile?.work.commute_minutes,
  };
}

export function taskMinutes(task: Pick<Task, "estimated_duration" | "due_time" | "end_time">): number {
  if (task.estimated_duration) return task.estimated_duration;
  if (task.due_time && task.end_time) {
    const span = timeToMinutes(task.end_time) - timeToMinutes(task.due_time);
    if (span > 0) return span;
  }
  return DEFAULT_MINUTES;
}

// A timed task as an interval (clamped to the day)
export function taskInterval(task: Pick<Task, "estimated_duration" | "due_time" | "end_time">): { start: number; end: number } | null {
  if (!task.due_time) return null;
  const start = timeToMinutes(task.due_time);
  let end = task.end_time ? timeToMinutes(task.end_time) : start + (task.estimated_duration ?? DEFAULT_MINUTES);
  if (end <= start) end = start + (task.estimated_duration ?? DEFAULT_MINUTES);
  return { start, end: Math.min(Math.max(end, start + 1), 24 * 60) };
}

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

const isWorkLabel = (label: string) => /work|job|shift|office|عمل|شغل/i.test(label);

// Busy blocks on a date, including the part of last night's overnight block
// that spills past midnight
export function blockIntervals(input: Pick<ScheduleInput, "blocks" | "commuteMinutes">, date: string): Interval[] {
  const out: Interval[] = [];
  const yesterday = addDays(date, -1);
  const commute = input.commuteMinutes ?? 0;
  for (const b of input.blocks) {
    const pad = commute && isWorkLabel(b.label) ? commute : 0;
    const start = timeToMinutes(b.start);
    const end = timeToMinutes(b.end);
    const overnight = end < start;
    if (b.days.includes(weekdayOf(date)) && blockActive(b, date)) {
      out.push({
        start: Math.max(start - pad, 0),
        end: overnight ? 24 * 60 : Math.min(end + pad, 24 * 60),
        label: b.label,
        fixed: true,
      });
    }
    if (overnight && b.days.includes(weekdayOf(yesterday)) && blockActive(b, yesterday)) {
      out.push({ start: 0, end: Math.min(end + pad, 24 * 60), label: b.label, fixed: true });
    }
  }
  return out;
}

// Everything that takes time on a date: busy blocks plus open timed tasks
// (fixed tasks marked as fixed). `exclude` leaves out tasks being moved.
export function busyIntervals(input: ScheduleInput, date: string, exclude: Set<string> = new Set()): Interval[] {
  const out = blockIntervals(input, date);
  for (const t of input.tasks) {
    if (t.due_date !== date || !isOpen(t) || exclude.has(t.id) || t.parent_id) continue;
    const span = taskInterval(t);
    if (span) out.push({ ...span, label: t.title, fixed: t.is_fixed, taskId: t.id });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function isRestDay(schedule: AIProfile["schedule"], date: string): boolean {
  return (schedule.rest_days ?? []).includes(weekdayOf(date));
}

// The part of the day planned tasks may use: half an hour after waking to
// half an hour before bed (bed after midnight = until the end of the day)
export function dayWindow(schedule: AIProfile["schedule"]): { start: number; end: number } {
  const wake = schedule.wake ? timeToMinutes(schedule.wake) : 7 * 60 + 30;
  const start = wake + 30;
  const sleep = schedule.sleep ? timeToMinutes(schedule.sleep) : 23 * 60 + 30;
  const end = sleep > start ? sleep - 30 : 24 * 60 - 15;
  return { start, end: Math.max(end, start + 60) };
}

// First free gap of `length` minutes between `from` and `until`, on quarter hours
export function findSlot(busy: Interval[], from: number, length: number, until: number): number | null {
  let candidate = Math.ceil(from / 15) * 15;
  for (let guard = 0; guard < 200; guard++) {
    if (candidate + length > until) return null;
    const hit = busy.find((b) => overlaps(b, { start: candidate, end: candidate + length }));
    if (!hit) return candidate;
    candidate = Math.ceil(hit.end / 15) * 15;
  }
  return null;
}

// Free minutes inside the day window, from `from` on
export function freeMinutes(input: ScheduleInput, date: string, from = 0): number {
  const window = dayWindow(input.schedule);
  const start = Math.max(window.start, from);
  if (start >= window.end) return 0;
  const busy = busyIntervals(input, date);
  let free = 0;
  let cursor = start;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) free += Math.min(b.start, window.end) - cursor;
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free += window.end - cursor;
  return free;
}

export type DayLoad = {
  planned: number; // minutes of open, flexible work planned that day (timed or not)
  capacity: number; // realistic focused minutes (daily_hours), capped by free time
  free: number; // free minutes in the day window
  over: boolean;
};

// Is the day overloaded? Fixed appointments and routines aren't "work" the
// user must find energy for, so only flexible tasks count toward capacity.
export function loadOf(input: ScheduleInput, date: string): DayLoad {
  const planned = input.tasks
    .filter((t) => t.due_date === date && isOpen(t) && !t.parent_id && !t.is_fixed)
    .reduce((sum, t) => sum + taskMinutes(t), 0);
  const free = freeMinutes(input, date);
  const target = input.schedule.daily_hours !== undefined ? Math.round(input.schedule.daily_hours * 60) : free;
  const capacity = isRestDay(input.schedule, date) ? 0 : Math.min(target, free);
  return { planned, capacity, free, over: planned > capacity && planned > 0 };
}

// What a timed item would collide with on a date
export function conflictsAt(
  input: ScheduleInput,
  date: string,
  start: string,
  length: number,
  excludeTaskId?: string
): Interval[] {
  const span = { start: timeToMinutes(start), end: timeToMinutes(start) + Math.max(length, 1) };
  return busyIntervals(input, date, new Set(excludeTaskId ? [excludeTaskId] : [])).filter((b) => overlaps(b, span));
}

// Finds a time for a task of `length` minutes: from `fromDate` (not before
// `notBefore` minutes on that first day) up to `toDate`, skipping rest days
// and days without capacity left. Returns the first fit.
export function place(
  input: ScheduleInput,
  length: number,
  options: {
    fromDate: string;
    toDate?: string;
    notBefore?: number;
    respectCapacity?: boolean;
    preferAfter?: number; // e.g. evening people: try after 17:00 first
  }
): { date: string; time: string } | null {
  const window = dayWindow(input.schedule);
  const last = options.toDate ?? addDays(options.fromDate, 13);
  for (let date = options.fromDate; date <= last; date = addDays(date, 1)) {
    if (isRestDay(input.schedule, date)) continue;
    if (options.respectCapacity !== false) {
      const load = loadOf(input, date);
      if (load.planned + length > load.capacity) continue;
    }
    const from = date === options.fromDate ? Math.max(window.start, options.notBefore ?? 0) : window.start;
    const busy = busyIntervals(input, date);
    const preferred =
      options.preferAfter !== undefined ? findSlot(busy, Math.max(from, options.preferAfter), length, window.end) : null;
    const slot = preferred ?? findSlot(busy, from, length, window.end);
    if (slot !== null) return { date, time: minutesToTime(slot) };
  }
  return null;
}

// Adds a placed task to the input, so the next placement avoids it
export function reserve(input: ScheduleInput, date: string, time: string, length: number, title = "planned"): void {
  input.tasks = [
    ...input.tasks,
    {
      id: `reserved-${input.tasks.length}`,
      title,
      due_date: date,
      due_time: time,
      end_time: minutesToTime(timeToMinutes(time) + length),
      estimated_duration: length,
      status: "todo",
      parent_id: null,
      is_fixed: false,
    } as Task,
  ];
}

// Evening people get evening slots first
export function preferredStart(profile: AIProfile | null): number | undefined {
  return profile?.preferences.energy === "evening" ? 17 * 60 : undefined;
}
