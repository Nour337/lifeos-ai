import { busyIntervals, overlaps, place, scheduleInput, taskInterval, taskMinutes } from "@/lib/schedule";
import { addDays, minutesToTime, timeToMinutes } from "@/utils/date";
import type { AIProfile } from "@/types/persona";
import type { Task } from "@/types/task";

// After busy hours change: which upcoming flexible tasks now overlap fixed
// time, and where each could move instead (no AI).

const HORIZON_DAYS = 14;

export function busyConflictsAfterEdit(profile: AIProfile, tasks: Task[], today: string): Task[] {
  const input = scheduleInput(profile, tasks);
  const horizon = addDays(today, HORIZON_DAYS);
  return tasks.filter((t) => {
    if (!t.due_date || !t.due_time || t.due_date < today || t.due_date > horizon) return false;
    if (t.status === "done" || t.status === "skipped" || t.is_fixed || t.parent_id) return false;
    const span = taskInterval(t)!;
    return busyIntervals(input, t.due_date, new Set([t.id])).some((b) => b.fixed && overlaps(b, span));
  });
}

export function fixesFor(
  profile: AIProfile,
  tasks: Task[],
  clashing: Task[]
): { id: string; fields: Partial<Task> }[] {
  const input = scheduleInput(profile, tasks.filter((t) => !clashing.includes(t)));
  const changes: { id: string; fields: Partial<Task> }[] = [];
  for (const t of clashing) {
    const length = taskMinutes(t);
    const slot = place(input, length, { fromDate: t.due_date!, toDate: addDays(t.due_date!, 6), respectCapacity: false });
    if (!slot) continue;
    const fields = {
      due_date: slot.date,
      due_time: slot.time,
      end_time: minutesToTime(timeToMinutes(slot.time) + length),
    };
    changes.push({ id: t.id, fields });
    input.tasks = [...input.tasks, { ...t, ...fields, estimated_duration: length }];
  }
  return changes;
}
