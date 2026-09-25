import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError, consumeCredit } from "@/lib/ai/planDay";
import { computeAreas, computeInsights, type Area, type Insight } from "@/lib/persona/insights";
import { addDays } from "@/utils/date";
import {
  parseAIProfile,
  parseStyle,
  personaActive,
  type OnboardingStatus,
  type Profile,
} from "@/types/persona";
import type { Usage } from "@/lib/persona/types";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";
import type { Task } from "@/types/task";

export type PersonaData = {
  profile: Profile;
  projects: Project[];
  goals: Goal[];
  tasks: Task[]; // last 35 days, next 60 days, and undated open tasks
  areas: Area[]; // same order as projects, then goals
  insights: Insight[];
};

export function toProfile(userId: string, row: Record<string, unknown> | null): Profile {
  return {
    id: userId,
    display_name: typeof row?.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : null,
    ai_personality: parseStyle(row?.ai_personality),
    ai_profile: parseAIProfile(row?.ai_profile),
    onboarding_status: (["pending", "skipped", "done"].includes(row?.onboarding_status as string)
      ? row?.onboarding_status
      : "pending") as OnboardingStatus,
  };
}

export async function loadPersona(
  supabase: SupabaseClient,
  userId: string,
  today: string
): Promise<PersonaData> {
  const [profile, projects, goals, dated, undated] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, ai_personality, ai_profile, onboarding_status")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("projects").select("*").order("created_at").limit(60),
    supabase.from("goals").select("*").order("created_at").limit(40),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .gte("due_date", addDays(today, -35))
      .lte("due_date", addDays(today, 60))
      .order("due_date")
      .limit(400),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .is("due_date", null)
      .not("status", "in", "(done,skipped)")
      .limit(60),
  ]);

  if (profile.error || projects.error || goals.error || dated.error || undated.error) {
    console.error(
      "loadPersona failed:",
      profile.error?.message ?? projects.error?.message ?? goals.error?.message ?? dated.error?.message ?? undated.error?.message
    );
    throw new AIError("Couldn't load your profile.", 500);
  }

  const p = toProfile(userId, profile.data);
  const tasks = [...(dated.data as Task[]), ...(undated.data as Task[])];
  const projectList = projects.data as Project[];
  const goalList = goals.data as Goal[];
  return {
    profile: p,
    projects: projectList,
    goals: goalList,
    tasks,
    areas: computeAreas(projectList, goalList, tasks, today, p.ai_profile.ignored),
    insights: computeInsights(tasks, today),
  };
}

// Persona AI and onboarding don't use the 10 daily messages. Their
// counters only enforce a high fair-use ceiling against abuse.
export async function consumeExtraCredit(
  supabase: SupabaseClient,
  kind: "onboarding" | "persona"
): Promise<number> {
  const { data, error } = await supabase.rpc("consume_extra_ai_credit", { credit_kind: kind });
  if (error) {
    console.error("consume_extra_ai_credit failed:", error.message);
    throw new AIError("Couldn't check your AI usage. Try again.", 500);
  }
  if (data === -1) {
    throw new AIError(
      "You've reached today's fair-use limit for Persona AI. It resets tomorrow.",
      429
    );
  }
  return data as number;
}

export type { Usage };

// The core usage rule: with an active persona the request is unlimited
// (Persona Mode); without one it uses one of the 10 daily AI messages.
export async function consumeUsage(
  supabase: SupabaseClient,
  profile: Profile
): Promise<Usage> {
  if (personaActive(profile)) {
    await consumeExtraCredit(supabase, "persona");
    return { persona: true };
  }
  return { persona: false, remaining: await consumeCredit(supabase) };
}

export async function loadProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, ai_personality, ai_profile, onboarding_status")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("loadProfile failed:", error.message);
    throw new AIError("Couldn't load your profile.", 500);
  }
  return toProfile(userId, data);
}
