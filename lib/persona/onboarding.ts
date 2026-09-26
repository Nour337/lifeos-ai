import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError } from "@/lib/ai/server";
import { completeJSON, complete, parseArgs } from "@/lib/ai/llm";
import type { Meter } from "@/lib/ai/usage";
import { PATTERN_SCHEMA, parsePattern } from "@/lib/assistant/patterns";
import type { ChatMessage } from "@/lib/assistant/types";
import { describeAreas, describePersona } from "@/lib/persona/describe";
import { quickStartDone, sectionStatus } from "@/lib/persona/sections";
import type { PersonaData } from "@/lib/persona/server";
import { createSeries } from "@/lib/series";
import { WEEKDAYS } from "@/utils/date";
import {
  AI_STYLES,
  ROLE_OPTIONS,
  parseRoles,
  cleanDate,
  cleanDays,
  cleanList,
  cleanNumber,
  cleanText,
  cleanTime,
  INTEREST_OPTIONS,
  mergeBlocks,
  newId,
  oneOf,
  parseAIProfile,
  record,
  SECTIONS,
  type AIProfile,
  type AIStyle,
  type SectionKey,
  type Skill,
} from "@/types/persona";
import { PICKABLE_KINDS, type ProjectKind } from "@/types/project";

// The conversational onboarding. Every turn the AI must call `respond`,
// which carries both its next message and everything it learned; the
// server saves what it learned right away, so nothing is lost if the user
// stops halfway. The first run is a quick start (who you are, what you're
// working on, when you're busy); the rest is asked later, when relevant.

export type OnboardingWidget = "none" | "interests" | "style" | "finish";

export type OnboardingResponse = {
  reply: string;
  quickReplies: string[];
  multiSelect: boolean;
  widget: OnboardingWidget;
  sections: Record<SectionKey, boolean>;
  finished: boolean;
};

const SECTION_KEYS = SECTIONS.map((s) => s.key);
const IMPORTANCE = ["low", "medium", "high", "very_high"] as const;
const DIFFICULTY = ["easy", "medium", "hard"] as const;
const KINDS = PICKABLE_KINDS.map((k) => k.value).filter((k) => k !== "course");
const DAYS = { type: "array", items: { type: "string", enum: [...WEEKDAYS] } };

const TOOL = {
  type: "function",
  function: {
    name: "respond",
    description: "Send your next message AND save everything new you learned about the user in this turn.",
    parameters: {
      type: "object",
      properties: {
        learned: {
          type: "string",
          description:
            "FIRST, list every NEW fact in the user's LAST message only (names, courses, exam dates, projects, deadlines, goals, times, routines, preferences). Then put each one in the matching field below.",
        },
        name: { type: "string", description: "What the user wants to be called." },
        roles: {
          type: "array",
          items: { type: "string", enum: ROLE_OPTIONS.map((r) => r.value) },
          description: "ALL roles the user has at the same time (e.g. student AND working). Send the full list.",
        },
        headline: { type: "string", description: 'Short description, e.g. "Engineering student & junior developer"' },
        education: {
          type: "object",
          properties: {
            university: { type: "string" },
            faculty: { type: "string" },
            major: { type: "string" },
            term: { type: "string", description: 'Year/term, e.g. "Last term", "3rd year"' },
            graduation: { type: "string", description: 'Expected graduation, e.g. "June 2027"' },
            semester_start: { type: "string", description: "YYYY-MM-DD" },
            semester_end: { type: "string", description: "YYYY-MM-DD" },
          },
        },
        job: {
          type: "object",
          description: "Their job, if they work.",
          properties: {
            job: { type: "string", description: "Job title" },
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
            ideas: { type: "array", items: { type: "string" }, description: "Business ideas to ADD." },
            interests: { type: "array", items: { type: "string" }, description: "Business interests to ADD (SaaS, agency...)." },
            stage: { type: "string", enum: ["idea", "validating", "launched", "growing"] },
          },
        },
        interests: { type: "array", items: { type: "string" }, description: "Interests to ADD." },
        skills: {
          type: "array",
          description: "Skills, tools, technologies and topics, with status: have (already use), learning, want (to learn).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              status: { type: "string", enum: ["have", "learning", "want"] },
            },
            required: ["name", "status"],
          },
        },
        courses: {
          type: "array",
          description: "Courses the user is studying (new or updated, matched by name).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              importance: { type: "string", enum: [...IMPORTANCE] },
              difficulty: { type: "string", enum: [...DIFFICULTY] },
              exams: {
                type: "array",
                description: "Its exams / quizzes / assignments with dates.",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["exam", "midterm", "final", "quiz", "assignment", "presentation", "other"] },
                    title: { type: "string" },
                    date: { type: "string", description: "YYYY-MM-DD" },
                  },
                  required: ["date"],
                },
              },
              weekly_hours: { type: "number" },
              ai_help: { type: "boolean" },
            },
            required: ["name"],
          },
        },
        work: {
          type: "array",
          description:
            "Concrete projects with work to do: graduation project, work projects, freelance clients, a business they are building, research (new or updated, matched by name).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              kind: { type: "string", enum: KINDS },
              description: { type: "string" },
              deadline: { type: "string", description: "YYYY-MM-DD" },
              importance: { type: "string", enum: [...IMPORTANCE] },
              weekly_hours: { type: "number" },
            },
            required: ["name"],
          },
        },
        goals: {
          type: "array",
          description: "Goals (new or updated, matched by name).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              why: { type: "string" },
              target_date: { type: "string", description: "YYYY-MM-DD" },
              priority: { type: "string", enum: [...IMPORTANCE] },
              weekly_hours: { type: "number" },
            },
            required: ["name"],
          },
        },
        schedule: {
          type: "object",
          properties: {
            wake: { type: "string", description: "HH:MM" },
            sleep: { type: "string", description: "HH:MM" },
            study_time: { type: "string" },
            project_time: { type: "string" },
            daily_hours: { type: "number", description: "Realistic focused hours per day" },
            rest_days: DAYS,
          },
        },
        preferences: {
          type: "object",
          properties: {
            energy: { type: "string", enum: ["morning", "evening", "flexible"] },
            session: { type: "string", enum: ["long", "short", "mixed"] },
            tasks_per_day: { type: "integer" },
            intensity: { type: "string", enum: ["relaxed", "balanced", "aggressive"] },
            free_time: { type: "string", description: 'Free time to keep daily, e.g. "2 hours"' },
            language: { type: "string", description: "Language they want replies in" },
          },
        },
        busy_blocks: {
          type: "array",
          description:
            "Fixed weekly busy times: university hours, work shifts. Replaces blocks with the same label. end before start = overnight.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: 'e.g. "University", "Work"' },
              days: DAYS,
              start: { type: "string", description: "HH:MM" },
              end: { type: "string", description: "HH:MM" },
              valid_until: { type: "string", description: "YYYY-MM-DD, e.g. semester end" },
            },
            required: ["label", "days", "start", "end"],
          },
        },
        routines: {
          type: "array",
          description: "Recurring activities (gym, prayer, reading...). They're put on the calendar.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              pattern: PATTERN_SCHEMA,
              time: { type: "string", description: "HH:MM" },
              duration_minutes: { type: "integer" },
            },
            required: ["name", "pattern"],
          },
        },
        style: { type: "string", enum: AI_STYLES.map((s) => s.value) },
        instructions: { type: "string", description: "Custom instructions about how they like to work." },
        remember: {
          type: "array",
          items: { type: "string" },
          description: "Other useful long-term facts for planning (short sentences).",
        },
        remove: {
          type: "array",
          items: { type: "string" },
          description: "Names of interests, skills, business ideas or busy blocks the user no longer has.",
        },
        covered_sections: {
          type: "array",
          items: { type: "string", enum: SECTION_KEYS },
          description: "Sections that are now answered or that the user skipped.",
        },
        summary: {
          type: "array",
          items: { type: "string" },
          description: "When finishing: 5-10 short bullets describing the user (their persona).",
        },
        finished: { type: "boolean", description: "True only when onboarding is complete." },
        reply: {
          type: "string",
          description: "Your message to the user: a short reaction to their answer, then ONE question (or 2-3 tightly related small ones).",
        },
        quick_replies: {
          type: "array",
          items: { type: "string" },
          description: '0-8 short tappable answers for your question (always include a skip option like "Skip for now" when the question is optional).',
        },
        multi_select: { type: "boolean", description: "True when the user may pick several quick replies." },
        widget: {
          type: "string",
          enum: ["none", "interests", "style", "finish"],
          description: "interests = show the interest picker; style = show the AI personality cards; finish = onboarding complete.",
        },
      },
      required: ["learned", "reply"],
    },
  },
};

function systemPrompt(data: PersonaData, mode: "onboarding" | "update"): string {
  const { today } = data.clock;
  const status = sectionStatus(data.profile.ai_profile, data.projects, data.goals, data.series);
  const quick = quickStartDone(status);
  const missing = SECTIONS.filter((s) => !status[s.key]).map((s) => s.key);
  const courses = data.projects.filter((p) => p.kind === "course");
  const work = data.projects.filter((p) => p.kind !== "course" && p.kind !== "milestone");

  const intro =
    mode === "onboarding"
      ? `You are onboarding a new user of LifeOS, an AI planner. This is a QUICK START: in about 4-5 questions learn (1) who they are (name, roles — they can be several at once), (2) what they're working on right now (courses with exam dates, work, projects, or a main goal), and (3) when they're busy (university / work hours as busy blocks, wake and sleep). Then finish. Everything else (interests, routines, AI style, details) is optional: ask only if the user seems happy to continue; the assistant will learn it later when it becomes relevant.`
      : `The user is updating what their LifeOS AI knows about them. Ask what changed, save updates, and confirm briefly. Don't re-ask things you already know unless they want to change them. You may cover any section.`;

  return `${intro}

Rules:
- Reply in the user's language. Keep messages short (1-3 sentences). Warm, human, no bullet-point interrogations.
- Always call the respond tool. First write "learned", then save EVERY fact from the user's last message in the matching fields of the same call. Your reply is only shown to the user; anything not in the fields is lost. Only send facts from the LAST message (new or changed); never re-send what is already saved. Example: "Database Systems, midterm November 3, final December 15, hard" → courses: [{name: "Database Systems", difficulty: "hard", exams: [{type: "midterm", date: "YYYY-11-03"}, {type: "final", date: "YYYY-12-15"}]}]. Infer sensibly: "engineering student in my last term, and I work part-time as a developer" → roles ["student", "working"], headline "Engineering student & part-time developer", education.term "Last term", job {job: "Developer", employment: "part_time"}.
- A person can have SEVERAL roles at once (student + working + entrepreneur...). Never make them choose one. roles is always the complete list.
- A graduation project, thesis, job, internship or business goes in work (with its kind), not courses.
- Fixed weekly hours go in busy_blocks with days and HH:MM times, e.g. "University Sun-Thu 9 to 3" → {label: "University", days: ["sun","mon","tue","wed","thu"], start: "09:00", end: "15:00"}. A night shift 22:00-06:00 is start "22:00", end "06:00".
- Rules about how to plan or behave ("never schedule on Friday mornings") go in instructions. Don't invent values the user didn't give.
- Briefly reflect what you understood, then ask ONE next question (2-3 tightly related small ones are fine, e.g. wake and sleep time).
- Offer quick_replies whenever there are natural choices, and always a "Skip for now" option. Use multi_select=true when several answers can be true at once (roles, days). If the user skips, add that section to covered_sections and move on.
- If you ask about interests use widget "interests" (picker: ${INTEREST_OPTIONS.join(", ")}); if you ask how the AI should behave use widget "style".
- Add a section to covered_sections once it's answered or skipped. Sections: ${SECTION_KEYS.join(", ")}.
- Dates: today is ${today}. Convert relative dates to YYYY-MM-DD. Times are 24-hour HH:MM.
- ${
    mode === "onboarding"
      ? `Finish as soon as the quick start is covered${quick ? " (it IS covered now: finish in this reply unless the user is in the middle of telling you something)" : ""}, or when the user wants to stop.`
      : "Finish when the user is done."
  } To finish: set finished=true, widget "finish", write the summary bullets, and reply with something like: "Based on what I know about you, you have three important areas right now: 🎓 University, 🤖 AI & Automation, 💼 Business. You have an upcoming Database exam and you're also building your AI automation skills. Would you like me to create a balanced plan for this week?" (use their real areas, deadlines and goals).

Quick start covered: ${quick ? "yes" : "no"}. Sections not covered yet: ${missing.length ? missing.join(", ") : "none"}

What you know so far:
${describePersona(data.profile, [], data.series, today)}
Courses: ${courses.map((c) => c.name).join("; ") || "none"}
Exams: ${data.assessments.map((a) => `${a.title} ${a.due_date}`).join("; ") || "none"}
Work & projects: ${work.map((w) => `${w.name} [${w.kind}]${w.deadline ? ` (deadline ${w.deadline})` : ""}`).join("; ") || "none"}
Goals: ${data.goals.map((g) => `${g.name}${g.target_date ? ` (target ${g.target_date})` : ""}`).join("; ") || "none"}`;
}

export async function askOnboarding(
  data: PersonaData,
  history: ChatMessage[],
  mode: "onboarding" | "update",
  meter: Meter
): Promise<Record<string, unknown>> {
  const result = await complete({
    messages: [{ role: "system", content: systemPrompt(data, mode) }, ...history.slice(-30)],
    tools: [TOOL],
    toolChoice: { type: "function", function: { name: "respond" } },
    temperature: 0.5,
    maxTokens: 1800,
    timeoutMs: 55_000,
  });
  meter.add(result);
  const call = result.toolCalls.find((c) => c.name === "respond");
  const args = parseArgs(call);
  if (args) return args;
  if (result.content) return { reply: result.content };
  throw new AIError("The AI's answer was incomplete. Try again.", 502);
}

// ---------------------------------------------------------------- saving

const percent = (v: unknown) => {
  const n = cleanNumber(v, 0, 100);
  return n === undefined ? undefined : Math.round(n);
};
const items = (v: unknown) => (Array.isArray(v) ? v.map(record) : []);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))
  ) as Partial<T>;
}

export async function saveOnboardingTurn(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  args: Record<string, unknown>
): Promise<{ profile: AIProfile; finished: boolean }> {
  const current = data.profile.ai_profile;
  const education = record(args.education);
  const job = record(args.job);
  const business = record(args.business);
  const schedule = record(args.schedule);
  const preferences = record(args.preferences);
  const remove = cleanList(args.remove, 20, 60).map((r) => r.toLowerCase());
  const keep = (name: string) => !remove.includes(name.toLowerCase());

  const now = new Date().toISOString();
  const memory = [...current.memory];
  for (const text of cleanList(args.remember, 10, 200)) {
    if (!memory.some((m) => same(m.text, text))) {
      memory.push({ id: newId(), text, source: "ai", category: "fact", pinned: false, expires_at: null, created_at: now });
    }
  }

  const skills: Skill[] = [...current.skills];
  for (const raw of items(args.skills)) {
    const name = cleanText(raw.name, 60);
    const status = oneOf(raw.status, ["have", "learning", "want"] as const);
    if (!name || !status) continue;
    const existing = skills.find((s) => same(s.name, name));
    if (existing) existing.status = status;
    else skills.push({ name, status });
  }

  const summary = cleanList(args.summary, 12, 160);
  const covered = new Set<SectionKey>(current.covered);
  for (const key of Array.isArray(args.covered_sections) ? args.covered_sections : []) {
    if (SECTION_KEYS.includes(key as SectionKey)) covered.add(key as SectionKey);
  }
  const style = oneOf(args.style, AI_STYLES.map((s) => s.value)) as AIStyle | undefined;
  if (style) covered.add("style");

  // parseAIProfile validates the merged result
  const next = parseAIProfile({
    ...current,
    about: {
      roles: args.roles !== undefined ? parseRoles(args.roles) : current.about.roles,
      headline: cleanText(args.headline, 100) ?? current.about.headline,
      age_range: current.about.age_range,
    },
    education: {
      ...current.education,
      ...defined({
        university: cleanText(education.university, 100),
        faculty: cleanText(education.faculty, 100),
        major: cleanText(education.major, 100),
        term: cleanText(education.term, 60),
        graduation: cleanText(education.graduation, 40),
        semester_start: cleanDate(education.semester_start),
        semester_end: cleanDate(education.semester_end),
      }),
    },
    work: {
      ...current.work,
      ...defined({
        job: cleanText(job.job, 100),
        company: cleanText(job.company, 100),
        responsibilities: cleanText(job.responsibilities, 400),
        employment: oneOf(job.employment, ["full_time", "part_time", "shifts", "freelance"] as const),
        days_off: cleanDays(job.days_off),
        commute_minutes: cleanNumber(job.commute_minutes, 0, 300),
      }),
    },
    business: {
      ideas: [...current.business.ideas, ...cleanList(business.ideas, 10, 150)].filter(keep),
      interests: [...current.business.interests, ...cleanList(business.interests)].filter(keep),
      stage: oneOf(business.stage, ["idea", "validating", "launched", "growing"] as const) ?? current.business.stage,
    },
    interests: [...current.interests, ...cleanList(args.interests)].filter(keep),
    skills: skills.filter((s) => keep(s.name)),
    schedule: {
      ...current.schedule,
      ...defined({
        wake: cleanTime(schedule.wake),
        sleep: cleanTime(schedule.sleep),
        study_time: cleanText(schedule.study_time, 100),
        project_time: cleanText(schedule.project_time, 100),
        daily_hours: cleanNumber(schedule.daily_hours, 0, 16),
        rest_days: cleanDays(schedule.rest_days),
      }),
    },
    preferences: { ...current.preferences, ...defined(preferences) },
    blocks: mergeBlocks(current.blocks, args.busy_blocks).filter((b) => keep(b.label)),
    instructions: cleanText(args.instructions, 1000) ?? current.instructions,
    summary: summary.length ? summary : current.summary,
    memory: memory.filter((m) => keep(m.text)),
    covered: [...covered],
  });

  const finished = args.finished === true;
  const name = cleanText(args.name, 50);
  const { error } = await supabase
    .from("profiles")
    .update({
      ai_profile: next,
      updated_at: now,
      ...(name && { display_name: name }),
      ...(style && { ai_personality: style }),
      ...(finished && { onboarding_status: "done" }),
    })
    .eq("id", userId);
  if (error) {
    console.error("Saving profile failed:", error.message);
    throw new AIError("Couldn't save your profile. Try again.", 500);
  }

  await Promise.all([
    upsertCourses(supabase, userId, data, items(args.courses)),
    upsertProjects(supabase, userId, data, items(args.work)),
    upsertGoals(supabase, userId, data, items(args.goals)),
    saveRoutines(supabase, userId, data, items(args.routines)),
  ]);

  return { profile: next, finished };
}

async function upsertCourses(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  rows: Record<string, unknown>[]
) {
  for (const raw of rows.slice(0, 15)) {
    const name = cleanText(raw.name, 120);
    if (!name) continue;
    const fields = defined({
      importance: oneOf(raw.importance, IMPORTANCE),
      difficulty: oneOf(raw.difficulty, DIFFICULTY),
      weekly_hours: cleanNumber(raw.weekly_hours, 0, 100),
      ai_help: typeof raw.ai_help === "boolean" ? raw.ai_help : undefined,
    });
    const existing = data.projects.find((p) => same(p.name, name));
    let id = existing?.id;
    if (existing) {
      if (Object.keys(fields).length) await supabase.from("projects").update(fields).eq("id", existing.id);
    } else {
      const { data: row, error } = await supabase
        .from("projects")
        .insert({ user_id: userId, name, kind: "course", ...fields })
        .select("id")
        .single();
      if (error) console.error("Saving course failed:", error.message);
      id = row?.id;
    }
    if (!id) continue;

    for (const exam of items(raw.exams).slice(0, 8)) {
      const date = cleanDate(exam.date);
      if (!date) continue;
      const type = oneOf(exam.type, ["exam", "midterm", "final", "quiz", "assignment", "presentation", "other"] as const) ?? "exam";
      const title = cleanText(exam.title, 150) ?? `${name} ${type === "exam" ? "exam" : type}`;
      const existingExam = data.assessments.find((a) => a.project_id === id && same(a.title, title));
      const result = existingExam
        ? await supabase.from("assessments").update({ due_date: date, type }).eq("id", existingExam.id)
        : await supabase.from("assessments").insert({ user_id: userId, project_id: id, type, title, due_date: date });
      if (result.error) console.error("Saving exam failed:", result.error.message);
    }
  }
}

async function upsertProjects(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  rows: Record<string, unknown>[]
) {
  for (const raw of rows.slice(0, 15)) {
    const name = cleanText(raw.name, 120);
    if (!name) continue;
    const kind: ProjectKind = oneOf(raw.kind, KINDS as ProjectKind[]) ?? "project";
    const fields = defined({
      description: cleanText(raw.description, 500),
      deadline: cleanDate(raw.deadline),
      importance: oneOf(raw.importance, IMPORTANCE),
      weekly_hours: cleanNumber(raw.weekly_hours, 0, 100),
      progress: percent(raw.progress),
    });
    const existing = data.projects.find((p) => same(p.name, name));
    const result = existing
      ? await supabase.from("projects").update({ ...fields, kind }).eq("id", existing.id)
      : await supabase.from("projects").insert({ user_id: userId, name, kind, ...fields });
    if (result.error) console.error("Saving project failed:", result.error.message);
  }
}

async function upsertGoals(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  rows: Record<string, unknown>[]
) {
  for (const raw of rows.slice(0, 10)) {
    const name = cleanText(raw.name, 120);
    if (!name) continue;
    const fields = defined({
      why: cleanText(raw.why, 500),
      target_date: cleanDate(raw.target_date),
      priority: oneOf(raw.priority, IMPORTANCE),
      weekly_hours: cleanNumber(raw.weekly_hours, 0, 100),
    });
    const existing = data.goals.find((g) => same(g.name, name));
    const result = existing
      ? await supabase.from("goals").update(fields).eq("id", existing.id)
      : await supabase.from("goals").insert({ user_id: userId, name, progress: 0, ...fields });
    if (result.error) console.error("Saving goal failed:", result.error.message);
  }
}

// Routines become series, so they're on the calendar
async function saveRoutines(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  rows: Record<string, unknown>[]
) {
  for (const raw of rows.slice(0, 10)) {
    const name = cleanText(raw.name, 150);
    const pattern = parsePattern(raw.pattern);
    if (!name || !pattern) continue;
    if (data.series.some((s) => s.is_routine && same(s.title, name) && (!s.until || s.until >= data.clock.today))) continue;
    const time = cleanTime(raw.time) ?? null;
    await createSeries(
      supabase,
      userId,
      {
        title: name,
        pattern,
        start_date: data.clock.today,
        due_time: time,
        estimated_duration: cleanNumber(raw.duration_minutes, 5, 720) ?? null,
        is_routine: true,
        priority: "medium",
      },
      data.clock.today
    );
  }
}

export function toResponse(
  args: Record<string, unknown>,
  sections: Record<SectionKey, boolean>,
  finished: boolean
): OnboardingResponse {
  const widget = oneOf(args.widget, ["none", "interests", "style", "finish"] as const) ?? "none";
  return {
    reply: cleanText(args.reply, 2000) ?? "Got it! Tell me a bit more?",
    quickReplies: cleanList(args.quick_replies, 8, 60),
    multiSelect: args.multi_select === true,
    widget: finished ? "finish" : widget === "finish" ? "none" : widget,
    sections,
    finished,
  };
}

// When the quick start is covered but the AI kept asking, the server wraps
// up: a persona summary plus the "here's what I know about you" message.
export async function finishOnboarding(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  meter: Meter
): Promise<string> {
  const raw = (await completeJSON(
    "You are the AI planner inside LifeOS, finishing the onboarding of a new user. Use only the facts given. Reply in the language of the profile. Answer with JSON only.",
    `Today is ${data.clock.today}.

Profile:
${describePersona(data.profile, [], data.series, data.clock.today)}

Courses, work and goals:
${describeAreas(data.areas)}

Write:
- summary: 5-10 short bullets describing this person for your own future planning (roles, main areas, deadlines, goals, schedule, preferences).
- reply: a warm closing message in this shape: "Based on what I know about you, you have three important areas right now: 🎓 University, 🤖 AI & Automation, 💼 Business. You have an upcoming Database exam and you're also building your AI automation skills. Would you like me to create a balanced plan for this week?" That text is only an example of the shape: use THEIR real areas (2-4, each with an emoji), their nearest deadline and one of their goals. Mention they can tell the assistant more anytime.

JSON: {"summary": ["..."], "reply": "..."}`,
    { maxTokens: 900, meter }
  )) as { summary?: unknown; reply?: unknown };

  const summary = cleanList(raw?.summary, 12, 160);
  const { error } = await supabase
    .from("profiles")
    .update({
      ai_profile: { ...data.profile.ai_profile, ...(summary.length && { summary }) },
      onboarding_status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) console.error("Finishing onboarding failed:", error.message);

  return (
    cleanText(raw?.reply, 1500) ??
    "Thanks! I know you much better now. Would you like me to create a balanced plan for this week?"
  );
}
