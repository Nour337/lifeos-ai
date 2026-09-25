import { supabase } from "@/lib/supabaseClient";
import { addDays, minutesToTime, timeToMinutes, toLocalDateString } from "@/utils/date";
import type { NowStep, Suggestion } from "@/lib/persona/types";
import { blocksOn, type AIProfile, type BusyBlock } from "@/types/persona";
import type { Task } from "@/types/task";

// Turning AI suggestions and "do this now" plans into real, timed tasks.

const DEFAULT_MINUTES = 30;
const LATEST_END = 23 * 60 + 30;

// Timed tasks plus fixed busy blocks (work, university) on that date
function busyBlocks(tasks: Task[], date: string, fixed: BusyBlock[] = []) {
  return [
    ...tasks
      .filter((t) => t.due_date === date && t.due_time && t.status !== "done" && t.status !== "skipped")
      .map((t) => {
        const start = timeToMinutes(t.due_time!);
        const end = t.end_time
          ? timeToMinutes(t.end_time)
          : start + (t.estimated_duration ?? DEFAULT_MINUTES);
        return { start, end: Math.max(end, start + 1) };
      }),
    ...blocksOn(fixed, date).map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) })),
  ].sort((a, b) => a.start - b.start);
}

// First free gap of `length` minutes on `date` between `from` and `until`,
// on quarter hours. Null when the day is full.
export function findSlot(
  tasks: Task[],
  date: string,
  from: number,
  length: number,
  until = LATEST_END,
  fixed: BusyBlock[] = []
): number | null {
  const busy = busyBlocks(tasks, date, fixed);
  let candidate = Math.ceil(from / 15) * 15;
  for (let guard = 0; guard < 200; guard++) {
    if (candidate + length > until) return null;
    const hit = busy.find((b) => b.start < candidate + length && candidate < b.end);
    if (!hit) return candidate;
    candidate = Math.ceil(hit.end / 15) * 15;
  }
  return null;
}

function dayWindow(profile: AIProfile | null) {
  const wake = profile?.schedule.wake ? timeToMinutes(profile.schedule.wake) : 8 * 60;
  const sleep = profile?.schedule.sleep ? timeToMinutes(profile.schedule.sleep) : LATEST_END + 30;
  // Tasks start an hour after waking and end half an hour before bed
  const start = Math.max(wake + 60, profile?.preferences.energy === "evening" ? 12 * 60 : 9 * 60);
  const end = sleep > start ? Math.min(sleep - 30, LATEST_END) : LATEST_END;
  return { start, end };
}

// Today if there's room from now on, otherwise the next days.
export function nextFreeSlot(
  tasks: Task[],
  length: number,
  profile: AIProfile | null,
  now = new Date()
): { date: string; time: string } | null {
  const window = dayWindow(profile);
  const today = toLocalDateString(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + 10;
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const from = i === 0 ? Math.max(nowMinutes, window.start) : window.start;
    const slot = findSlot(tasks, date, from, length, window.end, profile?.blocks ?? []);
    if (slot !== null) return { date, time: minutesToTime(slot) };
  }
  return null;
}

function taskFields(
  item: Pick<Suggestion, "title" | "minutes" | "projectId" | "goalId" | "area">,
  priority: Task["priority"]
) {
  return {
    title: item.title,
    priority,
    status: "todo" as const,
    estimated_duration: item.minutes,
    project_id: item.projectId,
    goal_id: item.goalId,
    category: item.area,
  };
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
      ...taskFields(suggestion, suggestion.priority),
      description: suggestion.why || null,
      due_date: when.date,
      due_time: when.time,
      end_time: end && timeToMinutes(end) > timeToMinutes(when.time!) ? end : null,
    })
    .select()
    .single();
  if (error) {
    console.error("Error adding suggestion:", error.message);
    return null;
  }
  return data as Task;
}

// "Start": lay the plan out back to back from now. Existing tasks move to
// the new time, new steps become tasks, breaks just leave a gap. The first
// step is marked "in progress". Returns the ids of the created tasks (so
// Undo can delete them) and the previous state of moved tasks.
export async function startPlan(
  userId: string,
  steps: NowStep[],
  tasks: Task[],
  now = new Date()
): Promise<{ created: string[]; moved: Task[] } | null> {
  const today = toLocalDateString(now);
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
    if (cursor + length > 24 * 60 - 1) break;
    const timing = {
      due_date: today,
      due_time: minutesToTime(cursor),
      end_time: minutesToTime(cursor + length),
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
          ...taskFields(step, "medium"),
          ...timing,
          description: step.reason || null,
        })
        .select("id")
        .single();
      if (error) {
        console.error("Error creating task:", error.message);
        return null;
      }
      created.push(data.id);
    }
    cursor += length;
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
