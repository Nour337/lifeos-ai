import { parsePattern, type Pattern } from "@/lib/assistant/patterns";

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

export type MemoryItem = {
  id: string;
  text: string;
  source: "user" | "ai";
  created_at: string;
};

export type AIProfile = {
  about: {
    role?: string; // "Engineering student"
    occupation?: string; // student / employee / entrepreneur / freelancer / other
    organization?: string;
    field?: string;
    term?: string;
  };
  interests: string[];
  skills: string[];
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
  about: {},
  interests: [],
  skills: [],
  schedule: {},
  preferences: {},
  habits: [],
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

// Anything read from the database or sent by the AI goes through here, so
// the rest of the app can trust the shape.
export function parseAIProfile(raw: unknown): AIProfile {
  const p = record(raw);
  const about = record(p.about);
  const schedule = record(p.schedule);
  const prefs = record(p.preferences);
  const ignored = record(p.ignored);

  return {
    about: compact({
      role: cleanText(about.role, 80),
      occupation: cleanText(about.occupation, 40),
      organization: cleanText(about.organization, 100),
      field: cleanText(about.field, 100),
      term: cleanText(about.term, 60),
    }),
    interests: cleanList(p.interests),
    skills: cleanList(p.skills),
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
