import { supabase } from "@/lib/supabaseClient";
import { addDays, minutesToTime, timeToMinutes, toLocalDateString } from "@/utils/date";
import { normalizeTask, type Task, type TaskEvent, type TaskStatus } from "@/types/task";

// Loaders throw so screens can show "Couldn't load..." instead of looking
// empty. Mutations return false on failure so callers can show a message.

const toTasks = (rows: unknown[] | null) => (rows ?? []).map((t) => normalizeTask(t as Task));

// Screens load a window of tasks, not everything ever created: every open
// task (any date), plus done / skipped ones from `pastDays` ago to
// `futureDays` ahead. Pass `all` for the full history (the Tasks list).
export async function getTasks(
  options: { pastDays?: number; futureDays?: number; all?: boolean } = {}
): Promise<Task[]> {
  if (options.all) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null) // subtasks are shown inside their parent
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      console.error("Error fetching tasks:", error.message);
      throw new Error("Couldn't load your tasks.");
    }
    return toTasks(data);
  }

  const today = toLocalDateString();
  const from = addDays(today, -(options.pastDays ?? 60));
  const to = addDays(today, options.futureDays ?? 120);
  const [open, window] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .in("status", ["todo", "in_progress"])
      .or(`due_date.is.null,due_date.lte.${to}`)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .in("status", ["done", "skipped"])
      .gte("due_date", from)
      .lte("due_date", to)
      .limit(1500),
  ]);
  if (open.error || window.error) {
    console.error("Error fetching tasks:", (open.error ?? window.error)!.message);
    throw new Error("Couldn't load your tasks.");
  }
  return [...toTasks(open.data), ...toTasks(window.data)];
}

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .is("parent_id", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching project tasks:", error.message);
    throw new Error("Couldn't load this project's tasks.");
  }
  return toTasks(data);
}

// What happened recently (moves, completions, skips) for insights and reviews
export async function getTaskEvents(sinceDays = 35): Promise<TaskEvent[]> {
  const { data, error } = await supabase
    .from("task_events")
    .select("*")
    .gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(600);
  if (error) {
    console.error("Error fetching task history:", error.message);
    return [];
  }
  return (data ?? []) as TaskEvent[];
}

export async function deleteTask(id: string): Promise<boolean> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);

  if (error) {
    console.error("Error deleting task:", error.message);
    return false;
  }

  return true;
}

// Puts a deleted task back exactly as it was (used by "Undo").
export async function restoreTask(task: Task): Promise<boolean> {
  const { error } = await supabase.from("tasks").insert(task);

  if (error) {
    console.error("Error restoring task:", error.message);
    return false;
  }

  return true;
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<boolean> {
  const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
  if (error) {
    console.error("Error updating task status:", error.message);
    return false;
  }
  return true;
}

// Done <-> to do. The database records when it was completed.
export async function toggleTaskStatus(task: Task): Promise<boolean> {
  return setTaskStatus(task.id, task.status === "done" ? "todo" : "done");
}

// Used by calendar drag and drop. `time` undefined = keep the time,
// null = make it an "anytime" task. The duration is kept when moving.
export async function moveTask(
  task: Task,
  date: string | null,
  time?: string | null
): Promise<Partial<Task> | null> {
  const changes: Partial<Task> = { due_date: date };
  if (time !== undefined) {
    changes.due_time = time;
    changes.end_time = null;
    if (time) {
      const length =
        task.due_time && task.end_time
          ? timeToMinutes(task.end_time) - timeToMinutes(task.due_time)
          : (task.estimated_duration ?? 0);
      if (length > 0) changes.end_time = minutesToTime(timeToMinutes(time) + length);
    }
  }

  const { error } = await supabase.from("tasks").update(changes).eq("id", task.id);
  if (error) {
    console.error("Error moving task:", error.message);
    return null;
  }
  return changes;
}

// Several tasks at once (recovery card, evening check-in)
export async function updateTasks(
  changes: { id: string; fields: Partial<Task> }[]
): Promise<boolean> {
  const results = await Promise.all(
    changes.map(({ id, fields }) => supabase.from("tasks").update(fields).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) console.error("Error updating tasks:", failed.error.message);
  return !failed;
}
