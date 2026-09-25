import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError } from "@/lib/ai/planDay";
import { askJSON, chatCompletion } from "@/lib/ai/openai";
import { WEEKDAYS } from "@/lib/assistant/patterns";
import { describeAreas, describePersona } from "@/lib/persona/describe";
import { sectionStatus } from "@/lib/persona/sections";
import type { PersonaData } from "@/lib/persona/server";
import {
  AI_STYLES,
  ROLE_OPTIONS,
  parseRoles,
  cleanList,
  cleanNumber,
  cleanText,
  INTEREST_OPTIONS,
  mergeBlocks,
  newId,
  oneOf,
  parseAIProfile,
  parseHabit,
  record,
  SECTIONS,
  type AIProfile,
  type AIStyle,
  type SectionKey,
} from "@/types/persona";
import { PROJECT_KINDS, type ProjectKind } from "@/types/project";
import type { ChatMessage } from "@/lib/assistant/types";

// The conversational onboarding. Every turn the AI must call `respond`,
// which carries both its next message and everything it learned; the
// server saves what it learned right away, so nothing is lost if the user
// stops halfway.

export type OnboardingWidget = "none" | "interests" | "style" | "finish";

export type OnboardingResponse = {
  reply: string;
  quickReplies: string[];
  multiSelect: boolean;
  widget: OnboardingWidget;
  sections: Record<SectionKey, boolean>;
  finished: boolean;
  remaining?: number;
};

const SECTION_KEYS = SECTIONS.map((s) => s.key);
const IMPORTANCE = ["low", "medium", "high", "very_high"] as const;
const DIFFICULTY = ["easy", "medium", "hard"] as const;
const KINDS = PROJECT_KINDS.map((k) => k.value).filter((k) => k !== "course");

const patternSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["daily", "weekdays", "weekends", "days_of_week", "every_n_days", "on_off"],
    },
    days: { type: "array", items: { type: "string", enum: [...WEEKDAYS] } },
    n: { type: "integer" },
    on_days: { type: "integer" },
    off_days: { type: "integer" },
  },
  required: ["type"],
};

const TOOL = {
  type: "function",
  function: {
    name: "respond",
    description:
      "Send your next message AND save everything new you learned about the user in this turn.",
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
        age_range: { type: "string", description: "Only if the user chooses to share it, e.g. 18-24" },
        education: {
          type: "object",
          properties: {
            university: { type: "string" },
            faculty: { type: "string" },
            major: { type: "string" },
            term: { type: "string", description: 'Year/term, e.g. "Last term", "3rd year"' },
            graduation: { type: "string", description: 'Expected graduation, e.g. "June 2027"' },
          },
        },
        job: {
          type: "object",
          description: "Their job, if they work.",
          properties: {
            job: { type: "string", description: "Job title" },
            company: { type: "string", description: "Company or business" },
            hours: { type: "string", description: 'Working hours, e.g. "Sun-Thu 16:00-22:00"' },
            responsibilities: { type: "string" },
          },
        },
        business: {
          type: "object",
          properties: {
            ideas: { type: "array", items: { type: "string" }, description: "Business ideas to ADD." },
            interests: { type: "array", items: { type: "string" }, description: "Business interests to ADD (SaaS, agency...)." },
          },
        },
        interests: { type: "array", items: { type: "string" }, description: "Interests to ADD." },
        skills: { type: "array", items: { type: "string" }, description: "Specific skills to develop, to ADD." },
        tools: { type: "array", items: { type: "string" }, description: "Tools/technologies they want to learn (n8n, Make...), to ADD." },
        tech_stack: { type: "array", items: { type: "string" }, description: "Technologies they already use, to ADD." },
        learning: { type: "array", items: { type: "string" }, description: "Courses or topics they want to take, to ADD." },
        courses: {
          type: "array",
          description: "Courses the user is studying (new or updated, matched by name).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              importance: { type: "string", enum: [...IMPORTANCE] },
              difficulty: { type: "string", enum: [...DIFFICULTY] },
              exam_date: { type: "string", description: "YYYY-MM-DD" },
              progress: { type: "integer", description: "0-100" },
              weekly_hours: { type: "number" },
              ai_help: { type: "boolean" },
            },
            required: ["name"],
          },
        },
        work: {
          type: "array",
          description: "Concrete projects with work to do: graduation project, work projects, freelance clients, a business they are building, research (new or updated, matched by name).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              kind: { type: "string", enum: KINDS },
              description: { type: "string" },
              deadline: { type: "string", description: "YYYY-MM-DD" },
              importance: { type: "string", enum: [...IMPORTANCE] },
              progress: { type: "integer", description: "0-100" },
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
              progress: { type: "integer", description: "0-100" },
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
            busy: { type: "string", description: 'University/work hours, e.g. "University Sun-Thu 09:00-15:00"' },
            free: { type: "string", description: "When they are usually free" },
            study_time: { type: "string" },
            project_time: { type: "string" },
            daily_hours: { type: "number", description: "Realistic hours per day for goals" },
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
          },
        },
        busy_blocks: {
          type: "array",
          description: "Fixed weekly busy times: university hours, work shifts. Replaces blocks with the same label.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: 'e.g. "University", "Work"' },
              days: { type: "array", items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
              start: { type: "string", description: "HH:MM" },
              end: { type: "string", description: "HH:MM" },
            },
            required: ["label", "days", "start", "end"],
          },
        },
        habits: {
          type: "array",
          description: "Recurring activities (gym, prayer, reading...).",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              pattern: patternSchema,
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
          description: "Names of interests, skills, tools, business ideas or recurring activities the user no longer has.",
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
          description: "0-8 short tappable answers for your question (always include a skip option like \"Skip for now\" when the question is optional).",
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

function systemPrompt(data: PersonaData, today: string, mode: "onboarding" | "update"): string {
  const status = sectionStatus(data.profile.ai_profile, data.projects, data.goals);
  const missing = SECTIONS.filter((s) => !status[s.key]).map((s) => s.key);
  const courses = data.projects.filter((p) => p.kind === "course");
  const work = data.projects.filter((p) => p.kind !== "course");

  const intro =
    mode === "onboarding"
      ? `You are onboarding a new user of LifeOS, an AI planner. Get to know them through a natural, friendly conversation (not a form) so you can later act as their personal planner, task manager, learning assistant and productivity coach.`
      : `The user is updating what their LifeOS AI knows about them. Ask what changed, save updates, and confirm briefly. Don't re-ask things you already know unless they want to change them.`;

  return `${intro}

Rules:
- Reply in the user's language. Keep messages short (1-3 sentences). Warm, human, no bullet-point interrogations.
- Always call the respond tool. First write "learned", then save EVERY fact from the user's last message in the matching fields of the same call (name, about, courses, work, goals, schedule, habits, interests, skills...). Your reply is only shown to the user; anything not in the fields is lost. Only send facts from the LAST message (new or changed); never re-send what is already saved, so nothing gets overwritten by mistake. Example: "Database Systems, exam December 15, hard" → courses: [{name: "Database Systems", exam_date: "YYYY-12-15", difficulty: "hard"}]. Infer sensibly: "engineering student in my last term, and I work part-time as a developer" → roles ["student", "working"], headline "Engineering student & part-time developer", education.term "Last term", job.job "Developer".
- A person can have SEVERAL roles at once (student + working + entrepreneur...). Never make them choose one. roles is always the complete list; if they say "I started working", send their old roles plus "working".
- Cover what matters for their roles: students → university, faculty, major, year/term, graduation, courses and exams; working → job, company, working hours, responsibilities, work projects; entrepreneurs → business ideas and goals; everyone → interests, AI/tech tools, skills, goals, schedule, routines (fitness, prayer...), AI style. Age range only if they volunteer it.
- A graduation project, thesis, job, internship or business goes in work (with its kind), not courses.
- Fixed weekly hours (university classes, work shifts) go in busy_blocks with days and HH:MM times, e.g. "University Sun-Thu 9 to 3" → {label: "University", days: ["sun","mon","tue","wed","thu"], start: "09:00", end: "15:00"}. Also keep the text in schedule.busy / job.hours.
- Rules about how to plan or behave ("never schedule on Friday mornings", "remind me to take breaks") go in instructions. Don't invent values the user didn't give.
- Briefly reflect what you understood ("Nice. So your main areas are engineering, business and AI automation."), then ask ONE next question. You may combine 2-3 tightly related small questions (e.g. wake and sleep time).
- Decide the next question from what you know, and skip what doesn't apply to their roles.
- Courses: ask the names first, then in one question the key details for them (exam dates, how important/hard, progress, hours per week). Accept rough answers; never insist.
- Goals: for each, try to learn why it matters, target date, priority and weekly hours, but at most one follow-up question for all goals together.
- Offer quick_replies whenever there are natural choices, and always a "Skip for now" option. Use multi_select=true when several answers can be true at once (roles, interests, days). If the user skips, add that section to covered_sections and move on.
- When asking about interests use widget "interests" (the app shows a picker with: ${INTEREST_OPTIONS.join(", ")}). When asking how the AI should behave use widget "style" (Friendly, Direct, Coach, Professional, Teacher, Balanced) and also ask for any custom instructions.
- Add a section to covered_sections once it's answered or skipped. Sections: ${SECTION_KEYS.join(", ")}.
- Aim for about 8-12 questions in total. Don't ask about things already known.
- Dates: today is ${today}. Convert relative dates to YYYY-MM-DD. Times are 24-hour HH:MM.
- Finish when all sections are covered (or the user wants to stop). If the user's last answer covers the last missing section, finish in THIS reply; don't ask "ready to wrap up?". To finish: set finished=true, widget "finish", write the summary bullets, and reply with something like: "Based on what I know about you, you have three important areas right now: 🎓 University, 🤖 AI & Automation, 💼 Business. You have an upcoming Database exam and you're also building your AI automation skills. Would you like me to create a balanced plan for this week?" (use their real areas, deadlines and goals).

Sections still missing: ${missing.length ? missing.join(", ") : "none (you can finish)"}

What you know so far:
${describePersona(data.profile)}
Courses: ${courses.map((c) => `${c.name}${c.deadline ? ` (exam ${c.deadline})` : ""}`).join("; ") || "none"}
Work & projects: ${work.map((w) => `${w.name} [${w.kind}]${w.deadline ? ` (deadline ${w.deadline})` : ""}`).join("; ") || "none"}
Goals: ${data.goals.map((g) => `${g.name}${g.target_date ? ` (target ${g.target_date})` : ""}`).join("; ") || "none"}`;
}

export async function askOnboarding(
  data: PersonaData,
  history: ChatMessage[],
  today: string,
  mode: "onboarding" | "update"
): Promise<Record<string, unknown>> {
  const { toolCalls, content } = await chatCompletion({
    messages: [{ role: "system", content: systemPrompt(data, today, mode) }, ...history.slice(-30)],
    tools: [TOOL],
    toolChoice: { type: "function", function: { name: "respond" } },
    temperature: 0.5,
    maxTokens: 1800,
    timeoutMs: 60_000,
  });
  const call = toolCalls.find((c) => c.name === "respond");
  if (!call) {
    if (content) return { reply: content };
    throw new AIError("The AI didn't answer. Try again.", 502);
  }
  try {
    return JSON.parse(call.arguments);
  } catch {
    throw new AIError("The AI's answer was incomplete. Try again.", 502);
  }
}

// ---------------------------------------------------------------- saving

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : undefined);
const percent = (v: unknown) => {
  const n = cleanNumber(v, 0, 100);
  return n === undefined ? undefined : Math.round(n);
};
const items = (v: unknown) => (Array.isArray(v) ? v.map(record) : []);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
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

  const habits = [...current.habits];
  for (const raw of items(args.habits)) {
    const habit = parseHabit({
      ...raw,
      duration: raw.duration_minutes ?? raw.duration,
    });
    if (!habit) continue;
    const index = habits.findIndex((h) => same(h.name, habit.name));
    if (index >= 0) habits[index] = { ...habit, id: habits[index].id };
    else habits.push(habit);
  }

  const now = new Date().toISOString();
  const memory = [...current.memory];
  for (const text of cleanList(args.remember, 10, 200)) {
    if (!memory.some((m) => same(m.text, text))) {
      memory.push({ id: newId(), text, source: "ai", created_at: now });
    }
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
      age_range: cleanText(args.age_range, 20) ?? current.about.age_range,
    },
    education: { ...current.education, ...defined(education) },
    work: {
      ...current.work,
      ...defined({
        job: job.job,
        company: job.company,
        hours: job.hours,
        responsibilities: job.responsibilities,
      }),
    },
    business: {
      ideas: [...current.business.ideas, ...cleanList(business.ideas, 10, 150)].filter(keep),
      interests: [...current.business.interests, ...cleanList(business.interests)].filter(keep),
    },
    interests: [...current.interests, ...cleanList(args.interests)].filter(keep),
    skills: [...current.skills, ...cleanList(args.skills)].filter(keep),
    tools: [...current.tools, ...cleanList(args.tools)].filter(keep),
    tech_stack: [...current.tech_stack, ...cleanList(args.tech_stack)].filter(keep),
    learning: [...current.learning, ...cleanList(args.learning)].filter(keep),
    schedule: { ...current.schedule, ...defined(schedule) },
    preferences: { ...current.preferences, ...defined(preferences) },
    habits: habits.filter((h) => keep(h.name)),
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
    upsertProjects(supabase, userId, data, items(args.courses), "course"),
    upsertProjects(supabase, userId, data, items(args.work), null),
    upsertGoals(supabase, userId, data, items(args.goals)),
  ]);

  return { profile: next, finished };
}

async function upsertProjects(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  rows: Record<string, unknown>[],
  forcedKind: ProjectKind | null
) {
  for (const raw of rows.slice(0, 15)) {
    const name = cleanText(raw.name, 120);
    if (!name) continue;
    const kind: ProjectKind =
      forcedKind ?? oneOf(raw.kind, KINDS as ProjectKind[]) ?? "project";
    const fields = defined({
      description: cleanText(raw.description, 500),
      deadline: date(raw.exam_date) ?? date(raw.deadline),
      importance: oneOf(raw.importance, IMPORTANCE),
      difficulty: oneOf(raw.difficulty, DIFFICULTY),
      progress: percent(raw.progress),
      weekly_hours: cleanNumber(raw.weekly_hours, 0, 100),
      ai_help: typeof raw.ai_help === "boolean" ? raw.ai_help : undefined,
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
      target_date: date(raw.target_date),
      priority: oneOf(raw.priority, IMPORTANCE),
      progress: percent(raw.progress),
      weekly_hours: cleanNumber(raw.weekly_hours, 0, 100),
    });
    const existing = data.goals.find((g) => same(g.name, name));
    const result = existing
      ? await supabase.from("goals").update(fields).eq("id", existing.id)
      : await supabase.from("goals").insert({ user_id: userId, name, progress: 0, ...fields });
    if (result.error) console.error("Saving goal failed:", result.error.message);
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


// When every section is covered but the AI kept asking, the server wraps
// up: a persona summary plus the "here's what I know about you" message.
export async function finishOnboarding(
  supabase: SupabaseClient,
  userId: string,
  data: PersonaData,
  today: string
): Promise<string> {
  const raw = (await askJSON(
    "You are the AI planner inside LifeOS, finishing the onboarding of a new user. Use only the facts given. Reply in the language of the profile. Answer with JSON only.",
    `Today is ${today}.

Profile:
${describePersona(data.profile)}

Courses, work and goals:
${describeAreas(data.areas)}

Write:
- summary: 5-10 short bullets describing this person for your own future planning (role, main areas, deadlines, goals, schedule, preferences).
- reply: a warm closing message in this shape: "Based on what I know about you, you have three important areas right now: 🎓 University, 🤖 AI & Automation, 💼 Business. You have an upcoming Database exam and you're also building your AI automation skills. Would you like me to create a balanced plan for this week?" That text is only an example of the shape: use THEIR real areas (2-4, each with an emoji), their nearest deadline and one of their goals.

JSON: {"summary": ["..."], "reply": "..."}`,
    900
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
