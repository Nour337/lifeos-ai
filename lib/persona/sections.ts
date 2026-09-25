import type { AIProfile, SectionKey } from "@/types/persona";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";

// Which onboarding sections are done: answered, or asked and skipped.
export function sectionStatus(
  profile: AIProfile,
  projects: Pick<Project, "kind">[],
  goals: Pick<Goal, "id">[]
): Record<SectionKey, boolean> {
  const covered = new Set(profile.covered);
  const has = (key: SectionKey, filled: boolean) => filled || covered.has(key);
  return {
    about: has("about", profile.about.roles.length > 0 || !!profile.about.headline),
    education: has(
      "education",
      projects.some((p) => p.kind === "course") || Object.keys(profile.education).length > 0
    ),
    work: has(
      "work",
      projects.some((p) => p.kind !== "course") ||
        Object.keys(profile.work).length > 0 ||
        profile.business.ideas.length > 0
    ),
    interests: has(
      "interests",
      profile.interests.length > 0 || profile.skills.length > 0 || profile.tools.length > 0
    ),
    goals: has("goals", goals.length > 0),
    schedule: has(
      "schedule",
      Object.keys(profile.schedule).length > 0 || Object.keys(profile.preferences).length > 0
    ),
    habits: has("habits", profile.habits.length > 0),
    style: covered.has("style"),
  };
}
