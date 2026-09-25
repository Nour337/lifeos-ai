import { supabase } from "@/lib/supabaseClient";
import {
  parseAIProfile,
  parseStyle,
  type AIProfile,
  type AIStyle,
  type OnboardingStatus,
  type Profile,
} from "@/types/persona";

// The signed-in user's AI profile. Rows are created by a database trigger
// on signup; a missing row is treated as a fresh, not-yet-onboarded profile.
export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, ai_personality, ai_profile, onboarding_status")
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
  };
}

export async function saveProfile(
  userId: string,
  changes: Partial<{
    display_name: string | null;
    ai_personality: AIStyle;
    ai_profile: AIProfile;
    onboarding_status: OnboardingStatus;
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

// "Ignore" on a suggestion teaches the AI to suggest that area less often.
export function recordIgnored(userId: string, area: string) {
  return updateAIProfile(userId, (p) => ({
    ...p,
    ignored: { ...p.ignored, [area]: (p.ignored[area] ?? 0) + 1 },
  }));
}
