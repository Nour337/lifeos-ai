import type { AIProfile, SectionKey } from "@/types/persona";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";
import type { Series } from "@/types/task";

// Which onboarding sections are done: answered, or asked and skipped.
export function sectionStatus(
  profile: AIProfile,
  projects: Pick<Project, "kind">[],
  goals: Pick<Goal, "id">[],
  series: Pick<Series, "is_routine">[] = []
): Record<SectionKey, boolean> {
  const covered = new Set(profile.covered);
  const has = (key: SectionKey, filled: boolean) => filled || covered.has(key);
  const areas = projects.filter((p) => p.kind !== "milestone");
  return {
    about: has("about", profile.about.roles.length > 0 || !!profile.about.headline),
    education: has(
      "education",
      areas.some((p) => p.kind === "course") || Object.keys(profile.education).length > 0
    ),
    work: has(
      "work",
      areas.some((p) => p.kind !== "course") ||
        Object.keys(profile.work).length > 0 ||
        profile.business.ideas.length > 0
    ),
    goals: has("goals", goals.length > 0),
    schedule: has("schedule", profile.blocks.length > 0 || !!profile.schedule.wake || !!profile.schedule.sleep),
    routines: has("routines", series.some((s) => s.is_routine)),
    interests: has("interests", profile.interests.length > 0 || profile.skills.length > 0),
    style: covered.has("style"),
  };
}

// The quick start is done once the AI knows who you are, what you're
// working on (studies, work or a goal) and when you're busy.
export function quickStartDone(status: Record<SectionKey, boolean>): boolean {
  return status.about && status.schedule && (status.education || status.work || status.goals);
}
