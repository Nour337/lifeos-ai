import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError, userClock, type Clock } from "@/lib/ai/server";
import { computeAreas, computeInsights, type Area, type Insight } from "@/lib/persona/insights";
import { ensureOccurrences, toSeries } from "@/lib/series";
import { addDays } from "@/utils/date";
import {
  DEFAULT_NOTIFY,
  parseAIProfile,
  parseNotify,
  parseStyle,
  type OnboardingStatus,
  type Profile,
} from "@/types/persona";
import type { Goal } from "@/types/goal";
import type { Assessment, Project } from "@/types/project";
import { normalizeTask, type Series, type Task, type TaskEvent } from "@/types/task";

// Everything the AI may know about the user, loaded once per request with
// the user's own client (row level security applies).
export type PersonaData = {
  clock: Clock;
  profile: Profile;
  projects: Project[]; // includes milestones
  goals: Goal[];
  assessments: Assessment[];
  series: Series[];
  tasks: Task[]; // last 35 days, next 60 days, and undated open tasks
  events: TaskEvent[]; // last 35 days
  areas: Area[]; // projects (without milestones), then goals
  insights: Insight[];
};

const PROFILE_COLUMNS = "display_name, ai_personality, ai_profile, onboarding_status, timezone, notify";

export function toProfile(userId: string, row: Record<string, unknown> | null): Profile {
  return {
    id: userId,
    display_name:
      typeof row?.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : null,
    ai_personality: parseStyle(row?.ai_personality),
    ai_profile: parseAIProfile(row?.ai_profile),
    onboarding_status: (["pending", "skipped", "done"].includes(row?.onboarding_status as string)
      ? row?.onboarding_status
      : "pending") as OnboardingStatus,
    timezone: typeof row?.timezone === "string" && row.timezone ? row.timezone : "UTC",
    notify: row?.notify ? parseNotify(row.notify) : DEFAULT_NOTIFY,
  };
}

export async function loadProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) {
    console.error("loadProfile failed:", error.message);
    throw new AIError("Couldn't load your profile.", 500);
  }
  return toProfile(userId, data);
}

export async function loadPersona(
  supabase: SupabaseClient,
  userId: string,
  fallbackClock?: { today?: unknown; localTime?: unknown },
  options: { ensureSeries?: boolean } = {}
): Promise<PersonaData> {
  const profile = await loadProfile(supabase, userId);
  const clock = userClock(profile.timezone, fallbackClock);
  const today = clock.today;

  // Routine occurrences must exist before the AI looks at the schedule
  const seriesResult = await supabase.from("task_series").select("*").order("created_at");
  const series = (seriesResult.data ?? []).map(toSeries).filter((s): s is Series => !!s);
  if (options.ensureSeries !== false && series.length) {
    await ensureOccurrences(supabase, today, series).catch(() => 0);
  }

  const [projects, goals, assessments, dated, undated, events] = await Promise.all([
    supabase.from("projects").select("*").order("created_at").limit(100),
    supabase.from("goals").select("*").order("created_at").limit(50),
    supabase.from("assessments").select("*").gte("due_date", addDays(today, -35)).order("due_date").limit(100),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .gte("due_date", addDays(today, -35))
      .lte("due_date", addDays(today, 60))
      .order("due_date")
      .limit(500),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .is("due_date", null)
      .not("status", "in", "(done,skipped)")
      .limit(80),
    supabase
      .from("task_events")
      .select("*")
      .gte("created_at", new Date(Date.now() - 35 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(600),
  ]);

  const failed = [seriesResult, projects, goals, assessments, dated, undated, events].find((r) => r.error);
  if (failed?.error) {
    console.error("loadPersona failed:", failed.error.message);
    throw new AIError("Couldn't load your data.", 500);
  }

  const tasks = [...(dated.data ?? []), ...(undated.data ?? [])].map((t) => normalizeTask(t as Task));
  const projectList = (projects.data ?? []) as Project[];
  const goalList = (goals.data ?? []) as Goal[];
  const assessmentList = (assessments.data ?? []) as Assessment[];
  const eventList = (events.data ?? []) as TaskEvent[];
  return {
    clock,
    profile,
    projects: projectList,
    goals: goalList,
    assessments: assessmentList,
    series,
    tasks,
    events: eventList,
    areas: computeAreas(
      projectList,
      goalList,
      tasks,
      today,
      profile.ai_profile.ignored,
      assessmentList,
      profile.timezone
    ),
    insights: computeInsights(tasks, today, eventList, profile.timezone),
  };
}
