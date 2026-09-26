import { addDays, minutesToTime, timeToMinutes } from "@/utils/date";
import { place, reserve, taskMinutes, type ScheduleInput } from "@/lib/schedule";
import { isOpen, PRIORITIES, type Task } from "@/types/task";
import type { Assessment, Project } from "@/types/project";

// Missed-task recovery, without AI. Missed = still open and planned before
// today (routine sessions are skipped automatically instead).

export function missedTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter(
    (t) => isOpen(t) && t.due_date && t.due_date < today && !t.series_id && !t.parent_id && !t.is_fixed
  );
}

type Change = { id: string; fields: Partial<Task> };

// The latest day work for a project should happen: the day before its next
// exam or its deadline
export function deadlineFor(
  task: Task,
  today: string,
  projects: Project[],
  assessments: Assessment[]
): string | null {
  if (!task.project_id) return null;
  const exam = assessments
    .filter((a) => a.project_id === task.project_id && !a.done && a.due_date > today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const project = projects.find((p) => p.id === task.project_id);
  const candidates = [exam?.due_date, project?.deadline && project.deadline > today ? project.deadline : null].filter(
    (d): d is string => !!d
  );
  return candidates.length ? addDays(candidates.sort()[0], -1) : null;
}

// Fits missed tasks into free time over the next week (most important and
// closest deadline first), respecting busy hours, rest days and capacity.
// Tasks without a time stay untimed on a day with room.
export function fitIntoWeek(
  missed: Task[],
  input: ScheduleInput,
  today: string,
  nowMinutes: number,
  context: { projects: Project[]; assessments: Assessment[] } = { projects: [], assessments: [] }
): { changes: Change[]; unplaced: Task[] } {
  const working: ScheduleInput = { ...input, tasks: input.tasks.filter((t) => !missed.includes(t)) };
  const deadlineOf = (t: Task) => deadlineFor(t, today, context.projects, context.assessments);
  const ordered = [...missed].sort(
    (a, b) =>
      (deadlineOf(a) ?? "9999").localeCompare(deadlineOf(b) ?? "9999") ||
      PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority)
  );
  const changes: Change[] = [];
  const unplaced: Task[] = [];

  for (const task of ordered) {
    const length = taskMinutes(task);
    const deadline = deadlineOf(task);
    const lastDay = deadline && deadline < addDays(today, 6) ? (deadline < today ? today : deadline) : addDays(today, 6);

    if (!task.due_time) {
      // Untimed: the first day with room
      let placed: string | null = null;
      for (let date = today; date <= lastDay && !placed; date = addDays(date, 1)) {
        const slot = place(working, length, { fromDate: date, toDate: date, notBefore: date === today ? nowMinutes : 0 });
        if (slot) placed = date;
      }
      if (!placed) {
        unplaced.push(task);
        continue;
      }
      changes.push({ id: task.id, fields: { due_date: placed } });
      working.tasks = [...working.tasks, { ...task, due_date: placed }];
      continue;
    }

    const slot = place(working, length, { fromDate: today, toDate: lastDay, notBefore: nowMinutes });
    if (!slot) {
      unplaced.push(task);
      continue;
    }
    changes.push({
      id: task.id,
      fields: {
        due_date: slot.date,
        due_time: slot.time,
        end_time: minutesToTime(timeToMinutes(slot.time) + length),
      },
    });
    reserve(working, slot.date, slot.time, length, task.title);
  }
  return { changes, unplaced };
}

export function allToTomorrow(missed: Task[], today: string): Change[] {
  return missed.map((t) => ({ id: t.id, fields: { due_date: addDays(today, 1) } }));
}

export function letGo(missed: Task[]): Change[] {
  return missed.map((t) => ({ id: t.id, fields: { status: "skipped" as const } }));
}
