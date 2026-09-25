import { describePattern, IMPORTANCE_LABELS, styleOf, type Profile } from "@/types/persona";
import { kindOf } from "@/types/project";
import type { Area, Insight } from "@/lib/persona/insights";

// Turns the persona into compact text for AI prompts.

function areaLine(area: Area): string {
  const kind = area.type === "goal" ? "Goal" : kindOf(area.kind as never).label;
  const parts: string[] = [];
  if (area.importance) parts.push(`importance ${IMPORTANCE_LABELS[area.importance].toLowerCase()}`);
  if (area.deadline) {
    const label = area.kind === "course" ? "exam" : area.type === "goal" ? "target" : "deadline";
    parts.push(
      area.daysLeft !== null && area.daysLeft < 0
        ? `${label} was ${area.deadline} (passed)`
        : `${label} ${area.deadline} (in ${area.daysLeft} days)`
    );
  }
  if (area.weeklyTargetMinutes) parts.push(`wants ${Math.round(area.weeklyTargetMinutes / 6) / 10}h/week`);
  parts.push(`last 7 days: ${area.sessionsLast7} sessions, ${area.minutesLast7} min`);
  parts.push(
    area.daysSinceLast === null
      ? "no completed session yet"
      : `last session ${area.daysSinceLast === 0 ? "today" : `${area.daysSinceLast} days ago`}`
  );
  parts.push(`progress ${area.progress}%`);
  parts.push(`${area.openTasks} open tasks, ${area.plannedNext7} planned in the next 7 days`);
  if (area.ignored) parts.push(`user ignored ${area.ignored} suggestions for it`);
  if (!area.aiHelp) parts.push("user does NOT want AI suggestions for it");
  return `${kind} "${area.name}": ${parts.join("; ")}`;
}

export function describeAreas(areas: Area[], refPrefix = "a"): string {
  return areas.map((a, i) => `[${refPrefix}${i + 1}] ${areaLine(a)}`).join("\n") || "(none yet)";
}

export function describePersona(profile: Profile | null, insights: Insight[] = []): string {
  if (!profile) return "No profile yet.";
  const p = profile.ai_profile;
  const lines: string[] = [];
  const about = [
    p.about.role,
    p.about.occupation,
    p.about.field && `field: ${p.about.field}`,
    p.about.organization && `at ${p.about.organization}`,
    p.about.term && `term/year: ${p.about.term}`,
  ].filter(Boolean);

  if (profile.display_name) lines.push(`Name: ${profile.display_name}`);
  if (about.length) lines.push(`About: ${about.join(", ")}`);
  if (p.summary.length) lines.push(`Summary: ${p.summary.join("; ")}`);
  if (p.interests.length) lines.push(`Interests: ${p.interests.join(", ")}`);
  if (p.skills.length) lines.push(`Skills to develop: ${p.skills.join(", ")}`);

  const s = p.schedule;
  const schedule = [
    s.wake && `wakes ${s.wake}`,
    s.sleep && `sleeps ${s.sleep}`,
    s.busy && `busy: ${s.busy}`,
    s.free && `usually free: ${s.free}`,
    s.study_time && `prefers to study: ${s.study_time}`,
    s.project_time && `prefers project work: ${s.project_time}`,
    s.daily_hours !== undefined && `realistic ${s.daily_hours}h/day for goals`,
  ].filter(Boolean);
  if (schedule.length) lines.push(`Schedule: ${schedule.join("; ")}`);

  const pr = p.preferences;
  const prefs = [
    pr.energy && `works best: ${pr.energy}`,
    pr.session && `sessions: ${pr.session}`,
    pr.tasks_per_day && `about ${pr.tasks_per_day} tasks/day`,
    pr.intensity && `schedule style: ${pr.intensity}`,
    pr.free_time && `wants free time: ${pr.free_time}`,
  ].filter(Boolean);
  if (prefs.length) lines.push(`Preferences: ${prefs.join("; ")}`);

  if (p.habits.length) {
    lines.push(
      `Recurring activities: ${p.habits
        .map(
          (h) =>
            `${h.name} (${describePattern(h.pattern)}${h.time ? ` at ${h.time}` : ""}${
              h.duration ? `, ${h.duration} min` : ""
            })`
        )
        .join("; ")}`
    );
  }
  if (p.memory.length) lines.push(`Things to remember: ${p.memory.map((m) => m.text).join("; ")}`);
  if (insights.length) lines.push(`Learned from their activity: ${insights.map((i) => i.text).join(" ")}`);
  if (p.instructions) lines.push(`Their instructions for you: ${p.instructions}`);

  return lines.join("\n") || "Profile is mostly empty.";
}

export function styleInstruction(profile: Profile | null): string {
  const style = styleOf(profile?.ai_personality ?? "balanced");
  return `Personality the user chose: ${style.label}. ${style.prompt}`;
}
