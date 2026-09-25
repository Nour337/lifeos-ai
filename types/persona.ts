import { parsePattern, WEEKDAYS, type Pattern, type Weekday } from "@/lib/assistant/patterns";

// The user's AI profile ("persona"). Courses and work live in the projects
// table and goals in the goals table; everything else the AI should know is
// stored as one JSON document in profiles.ai_profile.

export type AIStyle = "friendly" | "direct" | "coach" | "professional" | "teacher" | "balanced";
export type Importance = "low" | "medium" | "high" | "very_high";
export type Difficulty = "easy" | "medium" | "hard";
export type OnboardingStatus = "pending" | "skipped" | "done";

export const AI_STYLES: { value: AIStyle; label: string; emoji: string; text: string; prompt: string }[] = [
  {
    value: "friendly",
    label: "Friendly",
    emoji: "😊",
    text: "Supportive and conversational.",
    prompt: "Be warm, encouraging and conversational. Celebrate progress.",
  },
  {
    value: "direct",
    label: "Direct",
    emoji: "🎯",
    text: "Short, clear and action-oriented.",
    prompt: "Be very brief and action-oriented. No small talk, no filler.",
  },
  {
    value: "coach",
    label: "Coach",
    emoji: "💪",
    text: "Pushes you toward your goals.",
    prompt: "Act like a coach: motivating, a little demanding, hold the user accountable to their goals.",
  },
  {
    value: "professional",
    label: "Professional",
    emoji: "💼",
    text: "Structured and business-like.",
    prompt: "Be structured, precise and business-like.",
  },
  {
    value: "teacher",
    label: "Teacher",
    emoji: "📚",
    text: "Explains things and helps you learn.",
    prompt: "Explain your reasoning simply and help the user learn. Suggest learning steps.",
  },
  {
    value: "balanced",
    label: "Balanced",
    emoji: "⚖️",
    text: "A mix of all of the above.",
    prompt: "Be friendly but concise, and gently keep the user moving toward their goals.",
  },
];

export const INTEREST_OPTIONS = [
  "AI",
  "AI Automation",
  "Programming",
  "Software Engineering",
  "Business",
  "Entrepreneurship",
  "Marketing",
  "Sales",
  "Finance",
  "Leadership",
  "Communication",
  "Cloud",
  "Cybersecurity",
  "Data",
  "Engineering",
  "Design",
];

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export type Habit = {
  id: string;
  name: string;
  pattern: Pattern;
  time: string | null; // "HH:MM"
  duration: number | null; // minutes
};

// Fixed weekly busy time (university, work shifts). The AI never plans
// inside these, and the app flags any task that overlaps one.
export type BusyBlock = {
  id: string;
  label: string; // "University", "Work"
  days: Weekday[];
  start: string; // "HH:MM"
  end: string;
};

export type MemoryItem = {
  id: string;
  text: string;
  source: "user" | "ai";
  created_at: string;
};

// A person can be several things at once: student + working + entrepreneur.
export type Role = "student" | "working" | "entrepreneur" | "freelancer" | "other";

export const ROLE_OPTIONS: { value: Role; label: string; emoji: string }[] = [
  { value: "student", label: "Student", emoji: "🎓" },
  { value: "working", label: "Working", emoji: "💼" },
  { value: "entrepreneur", label: "Entrepreneur", emoji: "🚀" },
  { value: "freelancer", label: "Freelancer", emoji: "💻" },
  { value: "other", label: "Something else", emoji: "✨" },
];

export function roleOf(role: Role) {
  return ROLE_OPTIONS.find((r) => r.value === role) ?? ROLE_OPTIONS[ROLE_OPTIONS.length - 1];
}

export type AIProfile = {
  about: {
    roles: Role[];
    headline?: string; // "Engineering student & junior developer"
    age_range?: string; // only if the user wants to share it
  };
  education: {
    university?: string;
    faculty?: string;
    major?: string;
    term?: string; // "Last term", "3rd year"
    graduation?: string; // "June 2027" or YYYY-MM-DD
  };
  work: {
    job?: string;
    company?: string;
    hours?: string; // "Sun-Thu 16:00-22:00"
    responsibilities?: string;
  };
  business: {
    ideas: string[];
    interests: string[]; // SaaS, agencies, e-commerce...
  };
  interests: string[];
  skills: string[]; // skills they want to develop
  tools: string[]; // tools/technologies they want to learn (n8n, Make...)
  tech_stack: string[]; // technologies they already use
  learning: string[]; // courses or topics they want to take
  schedule: {
    wake?: string; // "HH:MM"
    sleep?: string;
    busy?: string; // free text: "University Sun-Thu 9:00-15:00"
    free?: string; // free text: "evenings and Friday"
    study_time?: string; // "evening", "after 20:00"
    project_time?: string;
    daily_hours?: number; // realistic hours per day for goals
  };
  preferences: {
    energy?: "morning" | "evening" | "flexible";
    session?: "long" | "short" | "mixed";
    tasks_per_day?: number;
    intensity?: "relaxed" | "balanced" | "aggressive";
    free_time?: string; // "at least 2 hours a day"
  };
  habits: Habit[];
  blocks: BusyBlock[];
  instructions: string;
  summary: string[]; // the AI's short description of the user
  memory: MemoryItem[];
  ignored: Record<string, number>; // suggestion area -> times ignored
  covered: SectionKey[]; // onboarding sections already asked (answered or skipped)
};

export type Profile = {
  id: string;
  display_name: string | null;
  ai_personality: AIStyle;
  ai_profile: AIProfile;
  onboarding_status: OnboardingStatus;
};

export const EMPTY_PROFILE: AIProfile = {
  about: { roles: [] },
  education: {},
  work: {},
  business: { ideas: [], interests: [] },
  interests: [],
  skills: [],
  tools: [],
  tech_stack: [],
  learning: [],
  schedule: {},
  preferences: {},
  habits: [],
  blocks: [],
  instructions: "",
  summary: [],
  memory: [],
  ignored: {},
  covered: [],
};

// ---------------------------------------------------------------- validation

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const cleanText = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export const cleanTime = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().padStart(5, "0");
  return TIME.test(t) ? t : undefined;
};

export const cleanNumber = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export const oneOf = <T extends string>(v: unknown, options: readonly T[]): T | undefined =>
  options.includes(v as T) ? (v as T) : undefined;

export const cleanList = (v: unknown, maxItems = 30, maxLength = 60): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    const text = cleanText(item, maxLength);
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push(text);
    }
  }
  return out.slice(0, maxItems);
};

export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Drop undefined keys so JSON stays tidy
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function parseHabit(v: unknown): Habit | null {
  const h = record(v);
  const name = cleanText(h.name, 60);
  const pattern = parsePattern(h.pattern);
  if (!name || !pattern) return null;
  return {
    id: cleanText(h.id, 20) ?? newId(),
    name,
    pattern,
    time: cleanTime(h.time) ?? null,
    duration: cleanNumber(h.duration, 5, 720) ?? null,
  };
}

export function parseBlock(v: unknown): BusyBlock | null {
  const b = record(v);
  const label = cleanText(b.label, 40);
  const start = cleanTime(b.start);
  const end = cleanTime(b.end);
  const days = (Array.isArray(b.days) ? b.days : [])
    .map((d) => String(d).toLowerCase().slice(0, 3))
    .filter((d, i, all): d is Weekday => (WEEKDAYS as readonly string[]).includes(d) && all.indexOf(d) === i);
  if (!label || !start || !end || start >= end || !days.length) return null;
  return { id: cleanText(b.id, 20) ?? newId(), label, days, start, end };
}

// New busy blocks replace existing ones with the same label
export function mergeBlocks(current: BusyBlock[], raw: unknown): BusyBlock[] {
  const next = [...current];
  for (const item of Array.isArray(raw) ? raw : []) {
    const block = parseBlock(item);
    if (!block) continue;
    const i = next.findIndex((b) => b.label.toLowerCase() === block.label.toLowerCase());
    if (i >= 0) next[i] = { ...block, id: next[i].id };
    else next.push(block);
  }
  return next.slice(0, 15);
}

// Busy blocks that apply on a date (YYYY-MM-DD)
export function blocksOn(blocks: BusyBlock[], date: string): BusyBlock[] {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
  return blocks.filter((b) => b.days.includes(weekday));
}

export function describeDays(days: Weekday[]): string {
  const order = WEEKDAYS.filter((d) => days.includes(d));
  if (order.length === 7) return "Every day";
  const name = (i: number) => WEEKDAYS[i][0].toUpperCase() + WEEKDAYS[i].slice(1);
  const idx = order.map((d) => WEEKDAYS.indexOf(d));
  // A run of 3+ days reads better as a range, also across the week end: "Sun–Thu"
  if (idx.length > 2) {
    const set = new Set(idx);
    for (const start of idx) {
      if (idx.every((_, k) => set.has((start + k) % 7))) {
        return `${name(start)}–${name((start + idx.length - 1) % 7)}`;
      }
    }
  }
  return idx.map(name).join(", ");
}

// Anything read from the database or sent by the AI goes through here, so
// the rest of the app can trust the shape.
export function parseAIProfile(raw: unknown): AIProfile {
  const p = record(raw);
  const about = record(p.about);
  const education = record(p.education);
  const work = record(p.work);
  const business = record(p.business);
  const schedule = record(p.schedule);
  const prefs = record(p.preferences);
  const ignored = record(p.ignored);

  const roles = parseRoles(about.roles ?? about.occupation);
  // Older profiles kept organization / field / term in "about"
  const isStudent = roles.includes("student");

  return {
    about: {
      roles,
      ...compact({
        headline: cleanText(about.headline ?? about.role, 100),
        age_range: cleanText(about.age_range, 20),
      }),
    },
    education: compact({
      university: cleanText(education.university ?? (isStudent ? about.organization : undefined), 100),
      faculty: cleanText(education.faculty, 100),
      major: cleanText(education.major ?? about.field, 100),
      term: cleanText(education.term ?? about.term, 60),
      graduation: cleanText(education.graduation, 40),
    }),
    work: compact({
      job: cleanText(work.job, 100),
      company: cleanText(work.company ?? (!isStudent ? about.organization : undefined), 100),
      hours: cleanText(work.hours, 150),
      responsibilities: cleanText(work.responsibilities, 400),
    }),
    business: {
      ideas: cleanList(business.ideas, 15, 150),
      interests: cleanList(business.interests),
    },
    interests: cleanList(p.interests),
    skills: cleanList(p.skills),
    tools: cleanList(p.tools),
    tech_stack: cleanList(p.tech_stack),
    learning: cleanList(p.learning, 20, 100),
    schedule: compact({
      wake: cleanTime(schedule.wake),
      sleep: cleanTime(schedule.sleep),
      busy: cleanText(schedule.busy, 300),
      free: cleanText(schedule.free, 300),
      study_time: cleanText(schedule.study_time, 100),
      project_time: cleanText(schedule.project_time, 100),
      daily_hours: cleanNumber(schedule.daily_hours, 0, 16),
    }),
    preferences: compact({
      energy: oneOf(prefs.energy, ["morning", "evening", "flexible"] as const),
      session: oneOf(prefs.session, ["long", "short", "mixed"] as const),
      tasks_per_day: cleanNumber(prefs.tasks_per_day, 1, 30),
      intensity: oneOf(prefs.intensity, ["relaxed", "balanced", "aggressive"] as const),
      free_time: cleanText(prefs.free_time, 100),
    }),
    habits: (Array.isArray(p.habits) ? p.habits : [])
      .map(parseHabit)
      .filter((h): h is Habit => !!h)
      .slice(0, 20),
    blocks: (Array.isArray(p.blocks) ? p.blocks : [])
      .map(parseBlock)
      .filter((b): b is BusyBlock => !!b)
      .slice(0, 15),
    instructions: cleanText(p.instructions, 1000) ?? "",
    summary: cleanList(p.summary, 12, 160),
    memory: (Array.isArray(p.memory) ? p.memory : [])
      .map((m) => {
        const item = record(m);
        const text = cleanText(item.text, 200);
        if (!text) return null;
        return {
          id: cleanText(item.id, 20) ?? newId(),
          text,
          source: item.source === "user" ? "user" : "ai",
          created_at: cleanText(item.created_at, 40) ?? new Date().toISOString(),
        } satisfies MemoryItem;
      })
      .filter((m): m is MemoryItem => !!m)
      .slice(-50),
    ignored: Object.fromEntries(
      Object.entries(ignored)
        .map(([k, v]) => [k.slice(0, 80), Math.max(0, Math.round(Number(v)) || 0)] as const)
        .filter(([, v]) => v > 0)
        .slice(0, 50)
    ),
    covered: (Array.isArray(p.covered) ? p.covered : []).filter(
      (k, i, all): k is SectionKey =>
        SECTIONS.some((s) => s.key === k) && all.indexOf(k) === i
    ),
  };
}

const ROLE_ALIASES: Record<string, Role> = {
  student: "student",
  working: "working",
  employee: "working",
  work: "working",
  job: "working",
  entrepreneur: "entrepreneur",
  business: "entrepreneur",
  founder: "entrepreneur",
  freelancer: "freelancer",
  freelance: "freelancer",
  other: "other",
};

export function parseRoles(v: unknown): Role[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const roles: Role[] = [];
  for (const item of list) {
    const role = ROLE_ALIASES[String(item).trim().toLowerCase()];
    if (role && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

// Persona Mode is on once the user has a persona: onboarding finished and
// at least something that says who they are.
export function personaActive(profile: Pick<Profile, "onboarding_status" | "ai_profile"> | null): boolean {
  if (!profile || profile.onboarding_status !== "done") return false;
  const p = profile.ai_profile;
  return p.about.roles.length > 0 || !!p.about.headline || p.summary.length > 0;
}

export function parseStyle(v: unknown): AIStyle {
  return oneOf(v, AI_STYLES.map((s) => s.value)) ?? "balanced";
}

export function styleOf(style: AIStyle) {
  return AI_STYLES.find((s) => s.value === style) ?? AI_STYLES[AI_STYLES.length - 1];
}

// ---------------------------------------------------------------- labels

const DAY_NAMES: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export function describePattern(pattern: Pattern): string {
  switch (pattern.type) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Weekdays";
    case "weekends":
      return "Weekends";
    case "days_of_week":
      return pattern.days.map((d) => DAY_NAMES[d]).join(", ");
    case "every_n_days":
      return pattern.n === 2 ? "Every other day" : `Every ${pattern.n} days`;
    case "on_off":
      return `${pattern.on_days} days on, ${pattern.off_days} off`;
  }
}

// How much of the profile is filled in, for progress dots in onboarding.
export type SectionKey =
  | "about"
  | "education"
  | "work"
  | "interests"
  | "goals"
  | "schedule"
  | "habits"
  | "style";

export const SECTIONS: { key: SectionKey; label: string; emoji: string }[] = [
  { key: "about", label: "About you", emoji: "👋" },
  { key: "education", label: "Studies", emoji: "🎓" },
  { key: "work", label: "Work", emoji: "💼" },
  { key: "interests", label: "Interests", emoji: "💡" },
  { key: "goals", label: "Goals", emoji: "🎯" },
  { key: "schedule", label: "Schedule", emoji: "🕒" },
  { key: "habits", label: "Routines", emoji: "🔁" },
  { key: "style", label: "AI style", emoji: "✨" },
];
