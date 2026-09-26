import type { SupabaseClient } from "@supabase/supabase-js";
import { occurrencesBetween, parsePattern, type Pattern } from "@/lib/assistant/patterns";
import { addDays } from "@/utils/date";
import type { Series, Task, TaskEnergy, TaskPriority } from "@/types/task";

// Routines and repeating tasks. A series stores the rule; its occurrences
// are ordinary task rows (series_id + occurrence_date) created a few weeks
// ahead. Works with the browser client and the server's user client alike.

export const SERIES_WINDOW_DAYS = 28;

export type SeriesDraft = {
  title: string;
  description?: string | null;
  pattern: Pattern;
  start_date: string;
  until?: string | null;
  count?: number | null;
  due_time?: string | null;
  end_time?: string | null;
  estimated_duration?: number | null;
  priority?: TaskPriority;
  category?: string | null;
  energy?: TaskEnergy | null;
  project_id?: string | null;
  goal_id?: string | null;
  is_routine?: boolean;
};

export function toSeries(row: Record<string, unknown>): Series | null {
  const pattern = parsePattern(row.pattern);
  if (!pattern) return null;
  return { ...(row as unknown as Series), pattern, exceptions: (row.exceptions as string[] | null) ?? [] };
}

// The task row for one occurrence
export function occurrenceRow(series: Series | (SeriesDraft & { id: string; user_id: string }), date: string) {
  return {
    user_id: series.user_id,
    title: series.title,
    description: series.description ?? null,
    due_date: date,
    due_time: series.due_time ?? null,
    end_time: series.due_time ? (series.end_time ?? null) : null,
    estimated_duration: series.estimated_duration ?? null,
    priority: series.priority ?? "medium",
    category: series.category ?? null,
    energy: series.energy ?? null,
    project_id: series.project_id ?? null,
    goal_id: series.goal_id ?? null,
    status: "todo",
    source: "system",
    series_id: series.id,
    occurrence_date: date,
  };
}

export async function getSeries(supabase: SupabaseClient): Promise<Series[]> {
  const { data, error } = await supabase.from("task_series").select("*").order("created_at");
  if (error) {
    console.error("Error loading series:", error.message);
    throw new Error("Couldn't load your routines.");
  }
  return (data ?? []).map(toSeries).filter((s): s is Series => !!s);
}

// Creates any missing occurrences from today to the end of the window, and
// marks routine occurrences from before today that were never done as
// skipped (so missed routines don't pile up as overdue).
export async function ensureOccurrences(
  supabase: SupabaseClient,
  today: string,
  seriesList?: Series[]
): Promise<number> {
  const all = seriesList ?? (await getSeries(supabase));
  const active = all.filter((s) => !s.until || s.until >= today);
  const to = addDays(today, SERIES_WINDOW_DAYS);

  await supabase.rpc("skip_missed_occurrences", { p_before: today });
  if (!active.length) return 0;

  const { data: existing, error } = await supabase
    .from("tasks")
    .select("series_id, occurrence_date")
    .in(
      "series_id",
      active.map((s) => s.id)
    )
    .gte("occurrence_date", today)
    .lte("occurrence_date", to);
  if (error) {
    console.error("Error checking occurrences:", error.message);
    return 0;
  }
  const have = new Set((existing ?? []).map((r) => `${r.series_id}:${r.occurrence_date}`));

  const rows = active.flatMap((s) =>
    occurrencesBetween(s, today, to)
      .filter((date) => !have.has(`${s.id}:${date}`))
      .map((date) => occurrenceRow(s, date))
  );
  if (!rows.length) return 0;

  const { error: insertError } = await supabase
    .from("tasks")
    .upsert(rows, { onConflict: "series_id,occurrence_date", ignoreDuplicates: true });
  if (insertError) {
    console.error("Error creating occurrences:", insertError.message);
    return 0;
  }
  return rows.length;
}

// Browser: do the housekeeping at most once per day per tab
let ensuredFor: string | null = null;
export async function ensureOccurrencesOnce(supabase: SupabaseClient, today: string): Promise<boolean> {
  if (ensuredFor === today) return false;
  ensuredFor = today;
  try {
    return (await ensureOccurrences(supabase, today)) > 0;
  } catch {
    ensuredFor = null;
    return false;
  }
}

export async function createSeries(
  supabase: SupabaseClient,
  userId: string,
  draft: SeriesDraft,
  today: string
): Promise<Series | null> {
  const { data, error } = await supabase
    .from("task_series")
    .insert({
      user_id: userId,
      title: draft.title,
      description: draft.description ?? null,
      pattern: draft.pattern,
      start_date: draft.start_date,
      until: draft.until ?? null,
      count: draft.count ?? null,
      due_time: draft.due_time ?? null,
      end_time: draft.due_time ? (draft.end_time ?? null) : null,
      estimated_duration: draft.estimated_duration ?? null,
      priority: draft.priority ?? "medium",
      category: draft.category ?? null,
      energy: draft.energy ?? null,
      project_id: draft.project_id ?? null,
      goal_id: draft.goal_id ?? null,
      is_routine: draft.is_routine ?? false,
    })
    .select()
    .single();
  if (error) {
    console.error("Error creating series:", error.message);
    return null;
  }
  const series = toSeries(data);
  // (a series starting later simply has no sessions before its start date)
  if (series) await ensureOccurrences(supabase, today, [series]);
  return series;
}

export type SeriesScope = "this" | "future" | "all";

// Fields that can change on a whole series
export type SeriesChanges = Partial<
  Pick<
    Series,
    | "title"
    | "description"
    | "pattern"
    | "due_time"
    | "end_time"
    | "estimated_duration"
    | "priority"
    | "category"
    | "energy"
    | "project_id"
    | "goal_id"
    | "until"
    | "is_routine"
  >
>;

// Removes the open occurrences on or after `from` (done ones stay as history)
async function clearOpenFrom(supabase: SupabaseClient, seriesId: string, from: string) {
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("series_id", seriesId)
    .gte("occurrence_date", from)
    .in("status", ["todo", "in_progress"]);
  if (error) throw new Error(error.message);
}

// "All" changes the series and every open occurrence from today; "future"
// ends the series the day before `from` and starts a new one from `from`.
// Occurrences are then recreated from the (new) rule.
export async function updateSeries(
  supabase: SupabaseClient,
  series: Series,
  changes: SeriesChanges,
  scope: Exclude<SeriesScope, "this">,
  from: string,
  today: string
): Promise<boolean> {
  try {
    if (scope === "future" && from > series.start_date) {
      const { error } = await supabase
        .from("task_series")
        .update({ until: addDays(from, -1), updated_at: new Date().toISOString() })
        .eq("id", series.id);
      if (error) throw new Error(error.message);
      await clearOpenFrom(supabase, series.id, from);
      const created = await createSeries(
        supabase,
        series.user_id,
        { ...series, ...changes, start_date: from, count: null },
        today
      );
      return !!created;
    }

    const { error } = await supabase
      .from("task_series")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", series.id);
    if (error) throw new Error(error.message);
    await clearOpenFrom(supabase, series.id, today);
    // The deletes above added exceptions for those dates; the rule changed,
    // so start clean from today
    const keep = series.exceptions.filter((d) => d < today);
    await supabase.from("task_series").update({ exceptions: keep }).eq("id", series.id);
    await ensureOccurrences(supabase, today, [{ ...series, ...changes, exceptions: keep }]);
    return true;
  } catch (e) {
    console.error("Error updating series:", (e as Error).message);
    return false;
  }
}

// Stop a routine: nothing new from today, past sessions stay as history
export async function stopSeries(supabase: SupabaseClient, series: Series, today: string): Promise<boolean> {
  const { error } = await supabase
    .from("task_series")
    .update({ until: addDays(today, -1), updated_at: new Date().toISOString() })
    .eq("id", series.id);
  if (error) {
    console.error("Error stopping series:", error.message);
    return false;
  }
  try {
    await clearOpenFrom(supabase, series.id, today);
  } catch {
    return false;
  }
  return true;
}

export async function resumeSeries(supabase: SupabaseClient, series: Series, today: string): Promise<boolean> {
  const { error } = await supabase
    .from("task_series")
    .update({ until: null, updated_at: new Date().toISOString() })
    .eq("id", series.id);
  if (error) return false;
  await ensureOccurrences(supabase, today, [{ ...series, until: null }]);
  return true;
}

// Delete a routine entirely: its open occurrences go, done ones stay (unlinked)
export async function deleteSeries(supabase: SupabaseClient, series: Series): Promise<boolean> {
  try {
    await clearOpenFrom(supabase, series.id, "0000-01-01");
  } catch {
    return false;
  }
  const { error } = await supabase.from("task_series").delete().eq("id", series.id);
  return !error;
}

// Consecutive completed sessions, counting back from the most recent one
// (today's session doesn't break the streak until the day is over)
export function streakOf(seriesId: string, tasks: Task[], today: string): number {
  const sessions = tasks
    .filter((t) => t.series_id === seriesId && t.occurrence_date && t.occurrence_date <= today)
    .sort((a, b) => b.occurrence_date!.localeCompare(a.occurrence_date!));
  let streak = 0;
  for (const t of sessions) {
    if (t.status === "done") streak++;
    else if (t.occurrence_date === today) continue;
    else break;
  }
  return streak;
}

export function isActive(series: Series, today: string): boolean {
  return !series.until || series.until >= today;
}
