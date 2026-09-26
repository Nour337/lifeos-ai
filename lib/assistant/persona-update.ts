import type { Context } from "@/lib/assistant/context";
import { checkProposal, emptyProposal } from "@/lib/assistant/proposal";
import type { PersonaUndo, Proposal, Remembered } from "@/lib/assistant/types";
import { busyIntervals, overlaps, place, taskInterval, taskMinutes } from "@/lib/schedule";
import { addDays, minutesToTime, WEEKDAYS } from "@/utils/date";
import {
  cleanDate,
  cleanDays,
  cleanList,
  cleanNumber,
  cleanText,
  cleanTime,
  DURATION_KEYS,
  MEMORY_LIMIT,
  mergeBlocks,
  newId,
  oneOf,
  parseAIProfile,
  parseRoles,
  record,
  ROLE_OPTIONS,
  roleOf,
  type AIProfile,
  type MemoryItem,
} from "@/types/persona";
import { ASSESSMENT_TYPES } from "@/types/project";
import type { Task } from "@/types/task";

// The assistant's structured memory. When the user says something lasting
// about themselves, the AI calls update_persona: facts go to the real
// records first (a course's exam date, a goal's target, busy hours), and
// only what fits nowhere else becomes a note. Every change can be undone.

const IMPORTANCE = ["low", "medium", "high", "very_high"] as const;
const DAYS = { type: "array", items: { type: "string", enum: [...WEEKDAYS] } };

export const PERSONA_TOOL = {
  type: "function",
  function: {
    name: "update_persona",
    description:
      "Save lasting information about the user (visible and editable on their persona page). Prefer the structured fields; use facts only for what fits nowhere else.",
    parameters: {
      type: "object",
      properties: {
        roles: {
          type: "array",
          items: { type: "string", enum: ROLE_OPTIONS.map((r) => r.value) },
          description: "The COMPLETE new list of roles, only if it changed.",
        },
        headline: { type: "string" },
        education: {
          type: "object",
          properties: {
            university: { type: "string" },
            faculty: { type: "string" },
            major: { type: "string" },
            term: { type: "string" },
            graduation: { type: "string" },
            semester_start: { type: "string", description: "YYYY-MM-DD" },
            semester_end: { type: "string", description: "YYYY-MM-DD" },
            exam_period_start: { type: "string", description: "YYYY-MM-DD" },
            exam_period_end: { type: "string", description: "YYYY-MM-DD" },
          },
        },
        job: {
          type: "object",
          properties: {
            job: { type: "string" },
            company: { type: "string" },
            responsibilities: { type: "string" },
            employment: { type: "string", enum: ["full_time", "part_time", "shifts", "freelance"] },
            days_off: DAYS,
            commute_minutes: { type: "integer" },
          },
        },
        business: {
          type: "object",
          properties: {
            stage: { type: "string", enum: ["idea", "validating", "launched", "growing"] },
            add_ideas: { type: "array", items: { type: "string" } },
            add_interests: { type: "array", items: { type: "string" } },
          },
        },
        add_interests: { type: "array", items: { type: "string" } },
        skills: {
          type: "array",
          description: "Skills/tools/topics with their status (adds or updates by name).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              status: { type: "string", enum: ["have", "learning", "want"] },
            },
            required: ["name", "status"],
          },
        },
        schedule: {
          type: "object",
          properties: {
            wake: { type: "string", description: "HH:MM" },
            sleep: { type: "string", description: "HH:MM" },
            daily_hours: { type: "number", description: "Realistic focused hours per day" },
            rest_days: DAYS,
            study_time: { type: "string" },
            project_time: { type: "string" },
          },
        },
        preferences: {
          type: "object",
          properties: {
            energy: { type: "string", enum: ["morning", "evening", "flexible"] },
            session: { type: "string", enum: ["long", "short", "mixed"] },
            intensity: { type: "string", enum: ["relaxed", "balanced", "aggressive"] },
            tasks_per_day: { type: "integer" },
            language: { type: "string" },
            durations: {
              type: "object",
              description: "Default session minutes",
              properties: Object.fromEntries(DURATION_KEYS.map((k) => [k, { type: "integer" }])),
            },
          },
        },
        busy_blocks: {
          type: "array",
          description:
            "Fixed weekly busy times: university hours, lectures, work shifts. Replaces blocks with the same label. end before start = overnight (22:00-06:00).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: 'e.g. "University", "Work", "Database lecture"' },
              days: DAYS,
              start: { type: "string", description: "HH:MM" },
              end: { type: "string", description: "HH:MM" },
              valid_from: { type: "string", description: "YYYY-MM-DD (e.g. semester start)" },
              valid_until: { type: "string", description: "YYYY-MM-DD (e.g. semester end)" },
              course: { type: "string", description: "Course ref (p1) if this is a lecture" },
            },
            required: ["label", "days", "start", "end"],
          },
        },
        remove_busy_blocks: { type: "array", items: { type: "string" }, description: "Labels of busy blocks that ended." },
        update_projects: {
          type: "array",
          description: "Changes to existing courses/projects (e.g. an exam or deadline moved).",
          items: {
            type: "object",
            properties: {
              project: { type: "string", description: "Ref, e.g. p2" },
              deadline: { type: "string", description: "YYYY-MM-DD" },
              importance: { type: "string", enum: [...IMPORTANCE] },
              weekly_hours: { type: "number" },
            },
            required: ["project"],
          },
        },
        new_courses: {
          type: "array",
          description: "Courses the user just told you about.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              importance: { type: "string", enum: [...IMPORTANCE] },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              weekly_hours: { type: "number" },
            },
            required: ["name"],
          },
        },
        assessments: {
          type: "array",
          description: "Exams, quizzes, assignments of a course (new ones, or a date change by title).",
          items: {
            type: "object",
            properties: {
              course: { type: "string", description: "Course ref (p1), or the name of a course in new_courses" },
              type: { type: "string", enum: ASSESSMENT_TYPES.map((t) => t.value) },
              title: { type: "string" },
              date: { type: "string", description: "YYYY-MM-DD" },
              time: { type: "string", description: "HH:MM" },
              weight: { type: "number", description: "% of the grade" },
            },
            required: ["course", "title", "date"],
          },
        },
        update_goals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              goal: { type: "string", description: "Ref, e.g. g1" },
              target_date: { type: "string", description: "YYYY-MM-DD" },
              priority: { type: "string", enum: [...IMPORTANCE] },
              weekly_hours: { type: "number" },
              why: { type: "string" },
            },
            required: ["goal"],
          },
        },
        facts: {
          type: "array",
          description: "Other lasting facts that fit no field above.",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              category: { type: "string", enum: ["fact", "preference", "constraint", "event"] },
              expires: { type: "string", description: "YYYY-MM-DD when it stops being true (optional)" },
            },
            required: ["text"],
          },
        },
      },
    },
  },
};

type Args = Record<string, unknown>;
const items = (v: unknown) => (Array.isArray(v) ? v.map(record) : []);

// Applies an update_persona call. Returns what changed (shown under the
// reply) with the data to undo it, or null when nothing changed.
export async function savePersonaUpdate(ctx: Context, update: Args): Promise<Remembered | null> {
  const { supabase, data } = ctx;
  const current = data.profile.ai_profile;
  const changes: string[] = [];
  const undo: PersonaUndo = { profile: {}, rows: [] };
  const next: AIProfile = structuredClone(current);
  const touch = (key: keyof AIProfile) => {
    if (!(key in undo.profile)) undo.profile[key] = structuredClone(current[key]);
  };

  // Roles and headline
  if (update.roles !== undefined) {
    const roles = parseRoles(update.roles);
    if (roles.length && roles.join() !== current.about.roles.join()) {
      touch("about");
      roles.filter((r) => !current.about.roles.includes(r)).forEach((r) => changes.push(`Added role: ${roleOf(r).label}`));
      current.about.roles.filter((r) => !roles.includes(r)).forEach((r) => changes.push(`Removed role: ${roleOf(r).label}`));
      next.about.roles = roles;
    }
  }
  const headline = cleanText(update.headline, 100);
  if (headline && headline !== current.about.headline) {
    touch("about");
    next.about.headline = headline;
    changes.push(`About: ${headline}`);
  }

  // Flat objects: set the given fields
  const setFields = <K extends "education" | "work" | "schedule" | "preferences">(
    key: K,
    values: Record<string, unknown>,
    label: string
  ) => {
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined || (Array.isArray(value) && !value.length)) continue;
      const before = (current[key] as Record<string, unknown>)[field];
      if (JSON.stringify(before) === JSON.stringify(value)) continue;
      touch(key);
      (next[key] as Record<string, unknown>)[field] = value;
      changes.push(`${label}: ${Array.isArray(value) ? value.join(", ") : typeof value === "object" ? "updated" : String(value)}`);
    }
  };

  const edu = record(update.education);
  setFields(
    "education",
    {
      university: cleanText(edu.university, 100),
      faculty: cleanText(edu.faculty, 100),
      major: cleanText(edu.major, 100),
      term: cleanText(edu.term, 60),
      graduation: cleanText(edu.graduation, 40),
      semester_start: cleanDate(edu.semester_start),
      semester_end: cleanDate(edu.semester_end),
      exam_period_start: cleanDate(edu.exam_period_start),
      exam_period_end: cleanDate(edu.exam_period_end),
    },
    "Education"
  );
  const job = record(update.job);
  setFields(
    "work",
    {
      job: cleanText(job.job, 100),
      company: cleanText(job.company, 100),
      responsibilities: cleanText(job.responsibilities, 400),
      employment: oneOf(job.employment, ["full_time", "part_time", "shifts", "freelance"] as const),
      days_off: cleanDays(job.days_off),
      commute_minutes: cleanNumber(job.commute_minutes, 0, 300),
    },
    "Work"
  );
  const sched = record(update.schedule);
  setFields(
    "schedule",
    {
      wake: cleanTime(sched.wake),
      sleep: cleanTime(sched.sleep),
      daily_hours: cleanNumber(sched.daily_hours, 0, 16),
      rest_days: cleanDays(sched.rest_days),
      study_time: cleanText(sched.study_time, 100),
      project_time: cleanText(sched.project_time, 100),
    },
    "Schedule"
  );
  const prefs = record(update.preferences);
  const durations = record(prefs.durations);
  const cleanDurations = Object.fromEntries(
    DURATION_KEYS.map((k) => [k, cleanNumber(durations[k], 5, 480)]).filter(([, v]) => v !== undefined)
  );
  setFields(
    "preferences",
    {
      energy: oneOf(prefs.energy, ["morning", "evening", "flexible"] as const),
      session: oneOf(prefs.session, ["long", "short", "mixed"] as const),
      intensity: oneOf(prefs.intensity, ["relaxed", "balanced", "aggressive"] as const),
      tasks_per_day: cleanNumber(prefs.tasks_per_day, 1, 30),
      language: cleanText(prefs.language, 40),
      durations: Object.keys(cleanDurations).length
        ? { ...(current.preferences.durations ?? {}), ...cleanDurations }
        : undefined,
    },
    "Preference"
  );

  // Lists: add new entries
  const addTo = (list: string[], raw: unknown, label: string, key: "interests" | "ideas" | "biz") => {
    const out = [...list];
    for (const text of cleanList(raw, 20, 150)) {
      if (!out.some((x) => x.toLowerCase() === text.toLowerCase())) {
        out.push(text);
        changes.push(`${label}: ${text}`);
      }
    }
    if (out.length !== list.length) touch(key === "interests" ? "interests" : "business");
    return out;
  };
  next.interests = addTo(current.interests, update.add_interests, "Interest", "interests");
  const business = record(update.business);
  next.business.ideas = addTo(current.business.ideas, business.add_ideas, "Business idea", "ideas");
  next.business.interests = addTo(current.business.interests, business.add_interests, "Business interest", "biz");
  const stage = oneOf(business.stage, ["idea", "validating", "launched", "growing"] as const);
  if (stage && stage !== current.business.stage) {
    touch("business");
    next.business.stage = stage;
    changes.push(`Business stage: ${stage}`);
  }

  for (const raw of items(update.skills)) {
    const name = cleanText(raw.name, 60);
    const status = oneOf(raw.status, ["have", "learning", "want"] as const);
    if (!name || !status) continue;
    const existing = next.skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing?.status === status) continue;
    touch("skills");
    if (existing) existing.status = status;
    else next.skills.push({ name, status });
    changes.push(`Skill: ${name} (${status === "have" ? "knows it" : status})`);
  }

  // Busy blocks (lectures can point at their course)
  const blocksRaw = items(update.busy_blocks).map((b) => ({
    ...b,
    course_id: ctx.projectRef.get(String(b.course ?? ""))?.id,
  }));
  let blocks = mergeBlocks(current.blocks, blocksRaw);
  const removeLabels = cleanList(update.remove_busy_blocks, 10, 40).map((l) => l.toLowerCase());
  if (removeLabels.length) blocks = blocks.filter((b) => !removeLabels.includes(b.label.toLowerCase()));
  const blocksChanged = JSON.stringify(blocks) !== JSON.stringify(current.blocks);
  if (blocksChanged) {
    touch("blocks");
    next.blocks = blocks;
    for (const b of blocks) {
      const before = current.blocks.find((c) => c.id === b.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(b)) changes.push(`Busy: ${b.label} ${b.start}–${b.end}`);
    }
    for (const b of current.blocks) {
      if (!blocks.some((x) => x.id === b.id)) changes.push(`Removed busy time: ${b.label}`);
    }
  }

  // Facts that fit nowhere else
  const now = new Date().toISOString();
  for (const raw of items(update.facts)) {
    const text = cleanText(raw.text, 200);
    if (!text || next.memory.some((m) => m.text.toLowerCase() === text.toLowerCase())) continue;
    touch("memory");
    next.memory.push({
      id: newId(),
      text,
      source: "ai",
      category: oneOf(raw.category, ["fact", "preference", "constraint", "event"] as const) ?? "fact",
      pinned: false,
      expires_at: cleanDate(raw.expires) ?? null,
      created_at: now,
    } satisfies MemoryItem);
    changes.push(text);
  }
  if (next.memory.length > MEMORY_LIMIT) {
    // Over the limit: expired and oldest unpinned notes make room (the
    // compaction step merges notes before it gets here in normal use)
    touch("memory");
    const expired = (m: MemoryItem) => !!m.expires_at && m.expires_at < ctx.today;
    next.memory = next.memory.filter((m) => !expired(m));
    while (next.memory.length > MEMORY_LIMIT) {
      const i = next.memory.findIndex((m) => !m.pinned);
      if (i < 0) break;
      next.memory.splice(i, 1);
    }
  }

  // ---- records in their own tables
  const rowChanges = await saveRecords(ctx, update, undo, changes);

  if (!changes.length) return null;

  if (Object.keys(undo.profile).length) {
    const { error } = await supabase
      .from("profiles")
      .update({ ai_profile: parseAIProfile(next), updated_at: now })
      .eq("id", data.profile.id);
    if (error) {
      console.error("Saving persona update failed:", error.message);
      if (!rowChanges) return null;
    } else {
      data.profile.ai_profile = parseAIProfile(next);
      ctx.input.blocks = data.profile.ai_profile.blocks;
      ctx.input.schedule = data.profile.ai_profile.schedule;
    }
  }
  return { changes: changes.slice(0, 10), undo };
}

async function saveRecords(ctx: Context, update: Args, undo: PersonaUndo, changes: string[]): Promise<boolean> {
  const { supabase, data } = ctx;
  let changed = false;

  for (const raw of items(update.update_projects).slice(0, 10)) {
    const project = ctx.projectRef.get(String(raw.project ?? ""));
    if (!project) continue;
    const fields: Record<string, unknown> = {};
    const deadline = cleanDate(raw.deadline);
    if (deadline && deadline !== project.deadline) fields.deadline = deadline;
    const importance = oneOf(raw.importance, IMPORTANCE);
    if (importance && importance !== project.importance) fields.importance = importance;
    const hours = cleanNumber(raw.weekly_hours, 0, 100);
    if (hours !== undefined && hours !== project.weekly_hours) fields.weekly_hours = hours;
    if (!Object.keys(fields).length) continue;
    const { error } = await supabase.from("projects").update(fields).eq("id", project.id);
    if (error) continue;
    undo.rows.push({
      table: "projects",
      id: project.id,
      before: Object.fromEntries(Object.keys(fields).map((k) => [k, project[k as keyof typeof project]])),
    });
    Object.assign(project, fields);
    changes.push(`${project.name}: ${Object.entries(fields).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")}`);
    changed = true;
  }

  const createdCourses = new Map<string, string>(); // lowercased name -> id
  for (const raw of items(update.new_courses).slice(0, 8)) {
    const name = cleanText(raw.name, 120);
    if (!name || data.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    const { data: row, error } = await supabase
      .from("projects")
      .insert({
        user_id: data.profile.id,
        name,
        kind: "course",
        importance: oneOf(raw.importance, IMPORTANCE) ?? null,
        difficulty: oneOf(raw.difficulty, ["easy", "medium", "hard"] as const) ?? null,
        weekly_hours: cleanNumber(raw.weekly_hours, 0, 100) ?? null,
      })
      .select("*")
      .single();
    if (error || !row) continue;
    undo.rows.push({ table: "projects", id: row.id, before: null });
    createdCourses.set(name.toLowerCase(), row.id);
    data.projects.push(row);
    ctx.projectRef.set(`p${ctx.projectRef.size + 1}`, row);
    changes.push(`New course: ${name}`);
    changed = true;
  }

  for (const raw of items(update.assessments).slice(0, 12)) {
    const courseRef = String(raw.course ?? "");
    const projectId = ctx.projectRef.get(courseRef)?.id ?? createdCourses.get(courseRef.toLowerCase());
    const title = cleanText(raw.title, 150);
    const due = cleanDate(raw.date);
    if (!projectId || !title || !due) continue;
    const type = oneOf(raw.type, ASSESSMENT_TYPES.map((t) => t.value)) ?? "exam";
    const existing = data.assessments.find(
      (a) => a.project_id === projectId && a.title.toLowerCase() === title.toLowerCase()
    );
    const fields = {
      type,
      title,
      due_date: due,
      due_time: cleanTime(raw.time) ?? null,
      weight: cleanNumber(raw.weight, 0, 100) ?? null,
    };
    if (existing) {
      if (existing.due_date === due && (existing.due_time?.slice(0, 5) ?? null) === fields.due_time) continue;
      const { error } = await supabase.from("assessments").update(fields).eq("id", existing.id);
      if (error) continue;
      undo.rows.push({
        table: "assessments",
        id: existing.id,
        before: { due_date: existing.due_date, due_time: existing.due_time, weight: existing.weight, type: existing.type },
      });
      Object.assign(existing, fields);
      changes.push(`${title} moved to ${due}`);
    } else {
      const { data: row, error } = await supabase
        .from("assessments")
        .insert({ user_id: data.profile.id, project_id: projectId, ...fields })
        .select("*")
        .single();
      if (error || !row) continue;
      undo.rows.push({ table: "assessments", id: row.id, before: null });
      data.assessments.push(row);
      changes.push(`${title}: ${due}`);
    }
    changed = true;
  }

  for (const raw of items(update.update_goals).slice(0, 10)) {
    const goal = ctx.goalRef.get(String(raw.goal ?? ""));
    if (!goal) continue;
    const fields: Record<string, unknown> = {};
    const target = cleanDate(raw.target_date);
    if (target && target !== goal.target_date) fields.target_date = target;
    const priority = oneOf(raw.priority, IMPORTANCE);
    if (priority && priority !== goal.priority) fields.priority = priority;
    const hours = cleanNumber(raw.weekly_hours, 0, 100);
    if (hours !== undefined && hours !== goal.weekly_hours) fields.weekly_hours = hours;
    const why = cleanText(raw.why, 500);
    if (why && why !== goal.why) fields.why = why;
    if (!Object.keys(fields).length) continue;
    const { error } = await supabase.from("goals").update(fields).eq("id", goal.id);
    if (error) continue;
    undo.rows.push({
      table: "goals",
      id: goal.id,
      before: Object.fromEntries(Object.keys(fields).map((k) => [k, goal[k as keyof typeof goal]])),
    });
    Object.assign(goal, fields);
    changes.push(`Goal "${goal.name}" updated`);
    changed = true;
  }
  return changed;
}

// After busy hours change: upcoming flexible tasks that now overlap them,
// with a proposal that moves each to the nearest free time (no AI needed).
export function busyConflictFix(ctx: Context): Proposal | null {
  const horizon = addDays(ctx.today, 14);
  const clashing: Task[] = ctx.input.tasks.filter((t) => {
    if (!t.due_date || !t.due_time || t.due_date < ctx.today || t.due_date > horizon) return false;
    if (t.status === "done" || t.status === "skipped" || t.is_fixed || t.parent_id) return false;
    const span = taskInterval(t)!;
    return busyIntervals(ctx.input, t.due_date, new Set([t.id])).some((b) => b.fixed && overlaps(b, span));
  });
  if (!clashing.length) return null;

  const proposal = emptyProposal(
    `${clashing.length} upcoming task${clashing.length > 1 ? "s" : ""} now overlap${clashing.length > 1 ? "" : "s"} your busy hours. I moved ${clashing.length > 1 ? "them" : "it"} to the nearest free time.`
  );
  const input = { ...ctx.input, tasks: ctx.input.tasks.filter((t) => !clashing.includes(t)) };
  for (const t of clashing) {
    const length = taskMinutes(t);
    const slot = place(input, length, { fromDate: t.due_date!, toDate: addDays(t.due_date!, 6), respectCapacity: false });
    if (!slot) continue;
    const end = taskInterval({ ...t, due_time: slot.time, end_time: null, estimated_duration: length })!.end;
    proposal.updates.push({
      taskId: t.id,
      title: t.title,
      before: { date: t.due_date, start: t.due_time!.slice(0, 5), status: t.status },
      after: { due_date: slot.date, due_time: slot.time, end_time: minutesToTime(end) },
      warning: null,
    });
    input.tasks.push({ ...t, due_date: slot.date, due_time: slot.time, estimated_duration: length } as Task);
  }
  if (!proposal.updates.length) return null;
  checkProposal(proposal, ctx.input);
  return proposal;
}
