import { supabase } from "@/lib/supabaseClient";
import {
  DEFAULT_NOTIFY,
  parseAIProfile,
  parseNotify,
  parseStyle,
  type AIProfile,
  type AIStyle,
  type NotifySettings,
  type OnboardingStatus,
  type Profile,
} from "@/types/persona";

// The signed-in user's AI profile. Rows are created by a database trigger
// on signup; a missing row is treated as a fresh, not-yet-onboarded profile.
export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, ai_personality, ai_profile, onboarding_status, timezone, notify")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching profile:", error.message);
    throw new Error("Couldn't load your profile.");
  }

  return {
    id: userId,
    display_name: data?.display_name?.trim() || null,
    ai_personality: parseStyle(data?.ai_personality),
    ai_profile: parseAIProfile(data?.ai_profile),
    onboarding_status: (data?.onboarding_status as OnboardingStatus) ?? "pending",
    timezone: data?.timezone || "UTC",
    notify: data?.notify ? parseNotify(data.notify) : DEFAULT_NOTIFY,
  };
}

export async function saveProfile(
  userId: string,
  changes: Partial<{
    display_name: string | null;
    ai_personality: AIStyle;
    ai_profile: AIProfile;
    onboarding_status: OnboardingStatus;
    timezone: string;
    notify: NotifySettings;
  }>
): Promise<boolean> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...changes, updated_at: new Date().toISOString() });

  if (error) {
    console.error("Error saving profile:", error.message);
    return false;
  }
  return true;
}

// Update just the AI profile JSON, starting from the latest saved version
// so edits from another screen aren't lost.
export async function updateAIProfile(
  userId: string,
  update: (current: AIProfile) => AIProfile
): Promise<AIProfile | null> {
  try {
    const current = (await getProfile(userId)).ai_profile;
    const next = parseAIProfile(update(current));
    return (await saveProfile(userId, { ai_profile: next })) ? next : null;
  } catch {
    return null;
  }
}

// "Ignore" on a suggestion teaches the AI to suggest that area less often
// (the effect fades over a few weeks). Keyed by the project / goal id.
export function recordIgnored(userId: string, areaId: string) {
  return updateAIProfile(userId, (p) => {
    const previous = p.ignored[areaId]?.count ?? 0;
    return { ...p, ignored: { ...p.ignored, [areaId]: { count: previous + 1, last: new Date().toISOString() } } };
  });
}

// The browser's timezone, saved once so the server knows the user's day
export async function saveTimezone(userId: string, timezone: string): Promise<boolean> {
  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", userId);
  return !error;
}
