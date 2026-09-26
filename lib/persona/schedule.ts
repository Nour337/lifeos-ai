import { supabase } from "@/lib/supabaseClient";
import { busyIntervals, findSlot, place, preferredStart, scheduleInput } from "@/lib/schedule";
import { minutesToTime, timeToMinutes, toLocalDateString, addDays } from "@/utils/date";
import type { NowStep, Suggestion } from "@/lib/persona/types";
import type { AIProfile } from "@/types/persona";
import type { Task } from "@/types/task";

// Turning AI suggestions and "do this now" plans into real, timed tasks,
// using the shared scheduling engine (busy hours, rest days, capacity).

// Today if there's room from now on, otherwise the next days.
export function nextFreeSlot(
  tasks: Task[],
  length: number,
  profile: AIProfile | null,
  now = new Date()
): { date: string; time: string } | null {
  const today = toLocalDateString(now);
  return place(scheduleInput(profile, tasks), length, {
    fromDate: today,
    toDate: addDays(today, 6),
    notBefore: now.getHours() * 60 + now.getMinutes() + 10,
    preferAfter: preferredStart(profile),
  });
}

export async function addSuggestion(
  userId: string,
  suggestion: Suggestion,
  when: { date: string; time: string | null }
): Promise<Task | null> {
  const end = when.time ? minutesToTime(timeToMinutes(when.time) + suggestion.minutes) : null;
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: suggestion.title,
      priority: suggestion.priority,
      status: "todo",
      source: "suggestion",
      energy: suggestion.energy,
      estimated_duration: suggestion.minutes,
      project_id: suggestion.projectId,
      goal_id: suggestion.goalId,
      description: suggestion.why || null,
      due_date: when.date,
      due_time: when.time,
      end_time: end && when.time && timeToMinutes(end) > timeToMinutes(when.time) ? end : null,
    })
    .select()
    .single();
  if (error) {
    console.error("Error adding suggestion:", error.message);
    return null;
  }
  return data as Task;
}

// "Start": lay the plan out from now, around anything already booked
// (work, classes, timed tasks). Existing tasks move to the new time, new
// steps become tasks, breaks leave a gap. The first step is marked "in
// progress". Returns what to undo: created ids and the moved tasks' old state.
export async function startPlan(
  userId: string,
  steps: NowStep[],
  tasks: Task[],
  profile: AIProfile | null,
  now = new Date()
): Promise<{ created: string[]; moved: Task[] } | null> {
  const today = toLocalDateString(now);
  const moving = new Set(steps.map((s) => s.taskId).filter((id): id is string => !!id));
  const busy = busyIntervals(scheduleInput(profile, tasks), today, moving);
  let cursor = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  const created: string[] = [];
  const moved: Task[] = [];
  let first = true;

  for (const step of steps) {
    const length = Math.max(5, step.minutes);
    if (step.isBreak) {
      cursor += length;
      continue;
    }
    const slot = findSlot(busy, cursor, length, 24 * 60 - 1);
    if (slot === null) break;
    const timing = {
      due_date: today,
      due_time: minutesToTime(slot),
      end_time: minutesToTime(slot + length),
      estimated_duration: length,
      status: first ? ("in_progress" as const) : ("todo" as const),
    };

    const existing = step.taskId ? tasks.find((t) => t.id === step.taskId) : undefined;
    if (existing) {
      const { error } = await supabase.from("tasks").update(timing).eq("id", existing.id);
      if (error) {
        console.error("Error scheduling task:", error.message);
        return null;
      }
      moved.push(existing);
    } else {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title: step.title,
          priority: "medium",
          source: "suggestion",
          project_id: step.projectId,
          goal_id: step.goalId,
          description: step.reason || null,
          ...timing,
        })
        .select("id")
        .single();
      if (error) {
        console.error("Error creating task:", error.message);
        return null;
      }
      created.push(data.id);
    }
    busy.push({ start: slot, end: slot + length, label: step.title, fixed: false });
    cursor = slot + length;
    first = false;
  }
  return { created, moved };
}

export async function undoPlan(result: { created: string[]; moved: Task[] }): Promise<boolean> {
  const results = await Promise.all([
    result.created.length
      ? supabase.from("tasks").delete().in("id", result.created)
      : Promise.resolve({ error: null }),
    ...result.moved.map((t) =>
      supabase
        .from("tasks")
        .update({
          due_date: t.due_date,
          due_time: t.due_time,
          end_time: t.end_time,
          estimated_duration: t.estimated_duration,
          status: t.status,
        })
        .eq("id", t.id)
    ),
  ]);
  return results.every((r) => !r.error);
}
