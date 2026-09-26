import { describePattern } from "@/lib/assistant/patterns";
import {
  BUSINESS_STAGE_LABELS,
  describeBlock,
  describeDays,
  EMPLOYMENT_LABELS,
  IMPORTANCE_LABELS,
  liveMemory,
  roleOf,
  SKILL_STATUSES,
  styleOf,
  type Profile,
} from "@/types/persona";
import { kindOf } from "@/types/project";
import type { Area, Insight } from "@/lib/persona/insights";
import type { Series } from "@/types/task";

// Turns the persona into compact text for AI prompts. Only what planning
// needs is included (no age, no raw conversation).

export function areaLine(area: Area): string {
  const kind =
    area.type === "goal"
      ? area.daysLeft === null
        ? "Goal"
        : area.daysLeft <= 92
          ? "Short-term goal"
          : "Long-term goal"
      : kindOf(area.kind as never).label;
  const parts: string[] = [];
  if (area.role) parts.push(`${roleOf(area.role).label.toLowerCase()} area`);
  if (area.importance) parts.push(`importance ${IMPORTANCE_LABELS[area.importance].toLowerCase()}`);
  if (area.deadline) {
    const label = area.deadlineLabel ?? "deadline";
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
  parts.push(`${area.openTasks} open tasks (${area.overdueTasks} overdue), ${area.plannedNext7} planned in the next 7 days`);
  if (area.ignored >= 1) parts.push(`user ignored suggestions for it (weight ${area.ignored})`);
  if (area.suggestionsAccepted) {
    parts.push(`accepted ${area.suggestionsAccepted} suggestions, finished ${area.suggestionsDone}`);
  }
  if (!area.aiHelp) parts.push("user does NOT want AI suggestions for it");
  return `${kind} "${area.name}": ${parts.join("; ")}`;
}

export function describeAreas(areas: Area[], refPrefix = "a"): string {
  return areas.map((a, i) => `[${refPrefix}${i + 1}] ${areaLine(a)}`).join("\n") || "(none yet)";
}

export function describeRoutines(series: Series[], today: string): string {
  const active = series.filter((s) => s.is_routine && (!s.until || s.until >= today));
  return active
    .map(
      (s) =>
        `${s.title} (${describePattern(s.pattern)}${s.due_time ? ` at ${s.due_time.slice(0, 5)}` : ""}${
          s.estimated_duration ? `, ${s.estimated_duration} min` : ""
        })`
    )
    .join("; ");
}

export function describePersona(
  profile: Profile | null,
  insights: Insight[] = [],
  series: Series[] = [],
  today = new Date().toISOString().slice(0, 10)
): string {
  if (!profile) return "No profile yet.";
  const p = profile.ai_profile;
  const lines: string[] = [];
  const list = (items: (string | false | undefined | null)[]) => items.filter(Boolean).join(", ");

  if (profile.display_name) lines.push(`Name: ${profile.display_name}`);
  if (p.about.roles.length) {
    lines.push(
      `Roles (all at the same time): ${p.about.roles.map((r) => roleOf(r).label).join(" + ")}${
        p.about.headline ? ` — ${p.about.headline}` : ""
      }`
    );
  } else if (p.about.headline) {
    lines.push(`About: ${p.about.headline}`);
  }

  const e = p.education;
  const education = list([
    e.major && `studies ${e.major}`,
    e.faculty && `faculty: ${e.faculty}`,
    e.university && `at ${e.university}`,
    e.term && `term/year: ${e.term}`,
    e.graduation && `graduates ${e.graduation}`,
    (e.semester_start || e.semester_end) && `semester ${e.semester_start ?? "?"} to ${e.semester_end ?? "?"}`,
    (e.exam_period_start || e.exam_period_end) &&
      `exam period ${e.exam_period_start ?? "?"} to ${e.exam_period_end ?? "?"}`,
  ]);
  if (education) lines.push(`Education: ${education}`);

  const w = p.work;
  const work = list([
    w.job && `works as ${w.job}`,
    w.company && `at ${w.company}`,
    w.employment && EMPLOYMENT_LABELS[w.employment].toLowerCase(),
    !!w.days_off?.length && `days off: ${describeDays(w.days_off)}`,
    !!w.commute_minutes && `commute ${w.commute_minutes} min each way`,
    w.responsibilities && `responsibilities: ${w.responsibilities}`,
  ]);
  if (work) lines.push(`Work: ${work}`);

  if (p.business.ideas.length || p.business.interests.length || p.business.stage) {
    lines.push(
      `Business: ${list([
        p.business.stage && `stage: ${BUSINESS_STAGE_LABELS[p.business.stage].toLowerCase()}`,
        p.business.interests.length > 0 && `interested in ${p.business.interests.join(", ")}`,
        p.business.ideas.length > 0 && `ideas: ${p.business.ideas.join("; ")}`,
      ])}`
    );
  }
  if (p.summary.length) lines.push(`Summary: ${p.summary.join("; ")}`);
  if (p.interests.length) lines.push(`Interests: ${p.interests.join(", ")}`);
  for (const status of SKILL_STATUSES) {
    const names = p.skills.filter((s) => s.status === status.value).map((s) => s.name);
    if (names.length) lines.push(`Skills (${status.label.toLowerCase()}): ${names.join(", ")}`);
  }

  const s = p.schedule;
  const schedule = [
    s.wake && `wakes ${s.wake}`,
    s.sleep && `sleeps ${s.sleep}`,
    s.study_time && `prefers to study: ${s.study_time}`,
    s.project_time && `prefers project work: ${s.project_time}`,
    s.daily_hours !== undefined && `realistic ${s.daily_hours}h/day of focused work (capacity)`,
    s.rest_days?.length && `rest days (plan nothing): ${describeDays(s.rest_days)}`,
  ].filter(Boolean);
  if (schedule.length) lines.push(`Schedule: ${schedule.join("; ")}`);
  if (p.blocks.length) {
    lines.push(
      `BUSY, never schedule anything during: ${p.blocks.map((b) => `${b.label} ${describeBlock(b)}`).join("; ")}`
    );
  }

  const pr = p.preferences;
  const prefs = [
    pr.energy && `works best: ${pr.energy}`,
    pr.session && `sessions: ${pr.session}`,
    pr.tasks_per_day && `about ${pr.tasks_per_day} tasks/day`,
    pr.intensity && `schedule style: ${pr.intensity}`,
    pr.free_time && `wants free time: ${pr.free_time}`,
    pr.durations &&
      `default durations: ${Object.entries(pr.durations)
        .map(([k, v]) => `${k} ${v} min`)
        .join(", ")}`,
    pr.language && `reply in ${pr.language}`,
    pr.balance &&
      `intended time split: ${Object.entries(pr.balance)
        .map(([role, share]) => `${roleOf(role as never).label} ${share}%`)
        .join(", ")}`,
  ].filter(Boolean);
  if (prefs.length) lines.push(`Preferences: ${prefs.join("; ")}`);

  const routines = describeRoutines(series, today);
  if (routines) lines.push(`Routines (already on the calendar): ${routines}`);

  const memory = liveMemory(p.memory, today);
  if (memory.length) {
    lines.push(
      `Things to remember: ${memory
        .map((m) => `${m.text}${m.expires_at ? ` (until ${m.expires_at})` : ""}`)
        .join("; ")}`
    );
  }
  if (insights.length) lines.push(`Learned from their activity: ${insights.map((i) => i.text).join(" ")}`);
  if (p.instructions) lines.push(`Their instructions for you: ${p.instructions}`);

  return lines.join("\n") || "Profile is mostly empty.";
}

export function styleInstruction(profile: Profile | null): string {
  const style = styleOf(profile?.ai_personality ?? "balanced");
  return `Personality the user chose: ${style.label}. ${style.prompt}`;
}
