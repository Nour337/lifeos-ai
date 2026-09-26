import { WEEKDAYS, type Weekday } from "@/utils/date";

// The user's AI profile ("persona"). Courses, work and goals live in their
// own tables; routines are task series; everything else the AI should know
// is stored as one JSON document in profiles.ai_profile. Older documents are
// converted to this shape when they're read (parseAIProfile), so there's no
// data migration to run.

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

// Fixed weekly busy time (university, work shifts). The AI never plans
// inside these, and the app flags any task that overlaps one.
// end < start means the block runs past midnight (a 22:00–06:00 night shift).
export type BusyBlock = {
  id: string;
  label: string; // "University", "Work", "Database lecture"
  days: Weekday[]; // the days it starts on
  start: string; // "HH:MM"
  end: string;
  valid_from?: string; // YYYY-MM-DD, e.g. semester start
  valid_until?: string; // e.g. semester end
  course_id?: string; // a lecture of this course (projects.id)
};

export type MemoryCategory = "fact" | "preference" | "constraint" | "event";

export const MEMORY_CATEGORIES: { value: MemoryCategory; label: string }[] = [
  { value: "fact", label: "Fact" },
  { value: "preference", label: "Preference" },
  { value: "constraint", label: "Constraint" },
  { value: "event", label: "Event" },
];

export type MemoryItem = {
  id: string;
  text: string;
  source: "user" | "ai";
  category: MemoryCategory;
  pinned: boolean; // never merged away
  expires_at: string | null; // YYYY-MM-DD, e.g. "on holiday until Oct 3"
  created_at: string;
};

export const MEMORY_LIMIT = 60;

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

// One list for interests-turned-skills: what they already know, are learning,
// or want to learn (replaces skills / tools / tech stack / learning lists)
export type SkillStatus = "have" | "learning" | "want";
export type Skill = { name: string; status: SkillStatus };

export const SKILL_STATUSES: { value: SkillStatus; label: string }[] = [
  { value: "have", label: "Know it" },
  { value: "learning", label: "Learning" },
  { value: "want", label: "Want to learn" },
];

export type Employment = "full_time" | "part_time" | "shifts" | "freelance";
export const EMPLOYMENT_LABELS: Record<Employment, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  shifts: "Shift work",
  freelance: "Freelance",
};

export type BusinessStage = "idea" | "validating" | "launched" | "growing";
export const BUSINESS_STAGE_LABELS: Record<BusinessStage, string> = {
  idea: "Idea",
  validating: "Validating",
  launched: "Launched",
  growing: "Growing",
};

// Default session lengths the AI uses when the user doesn't say
export const DURATION_KEYS = ["study", "work", "project", "exercise", "reading"] as const;
export type DurationKey = (typeof DURATION_KEYS)[number];

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
    semester_start?: string; // YYYY-MM-DD
    semester_end?: string;
    exam_period_start?: string;
    exam_period_end?: string;
  };
  work: {
    job?: string;
    company?: string;
    responsibilities?: string;
    employment?: Employment;
    days_off?: Weekday[];
    commute_minutes?: number; // each way
  };
  business: {
    ideas: string[];
    interests: string[]; // SaaS, agencies, e-commerce...
    stage?: BusinessStage;
  };
  interests: string[];
  skills: Skill[];
  schedule: {
    wake?: string; // "HH:MM"
    sleep?: string;
    study_time?: string; // "evening", "after 20:00"
    project_time?: string;
    daily_hours?: number; // realistic focused hours per day for goals (capacity)
    rest_days?: Weekday[]; // no planned work on these days
  };
  preferences: {
    energy?: "morning" | "evening" | "flexible";
    session?: "long" | "short" | "mixed";
    tasks_per_day?: number;
    intensity?: "relaxed" | "balanced" | "aggressive";
    free_time?: string; // "at least 2 hours a day"
    durations?: Partial<Record<DurationKey, number>>; // minutes
    language?: string; // "English", "Arabic"
    balance?: Partial<Record<Role, number>>; // intended share of time per role, %
  };
  blocks: BusyBlock[];
  instructions: string;
  summary: string[]; // the AI's short description of the user
  memory: MemoryItem[];
  // suggestion area (project/goal id) -> how often suggestions for it were ignored
  ignored: Record<string, { count: number; last: string }>;
  covered: SectionKey[]; // onboarding sections already asked (answered or skipped)
};

export type NotifySettings = {
  enabled: boolean;
  reminder_minutes: number;
  morning: string; // "HH:MM"
  evening: string;
  weekly_review: boolean;
  deadlines: boolean;
  quiet_start: string;
  quiet_end: string;
};

export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: false,
  reminder_minutes: 10,
  morning: "07:30",
  evening: "21:00",
  weekly_review: true,
  deadlines: true,
  quiet_start: "23:00",
  quiet_end: "07:00",
};

export type Profile = {
  id: string;
  display_name: string | null;
  ai_personality: AIStyle;
  ai_profile: AIProfile;
  onboarding_status: OnboardingStatus;
  timezone: string;
  notify: NotifySettings;
};

// ---------------------------------------------------------------- validation

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const cleanText = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export const cleanTime = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, 5).padStart(5, "0");
  return TIME.test(t) ? t : undefined;
};

export const cleanDate = (v: unknown): string | undefined =>
  typeof v === "string" && DATE.test(v.trim()) ? v.trim() : undefined;

export const cleanNumber = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return v !== null && v !== "" && v !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
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

export const cleanDays = (v: unknown): Weekday[] =>
  (Array.isArray(v) ? v : [])
    .map((d) => String(d).toLowerCase().slice(0, 3))
    .filter((d, i, all): d is Weekday => (WEEKDAYS as readonly string[]).includes(d) && all.indexOf(d) === i);

export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Drop undefined keys so JSON stays tidy
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
  ) as T;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBlock(v: unknown): BusyBlock | null {
  const b = record(v);
  const label = cleanText(b.label, 40);
  const start = cleanTime(b.start);
  const end = cleanTime(b.end);
  const days = cleanDays(b.days);
  // start > end is a night block that ends the next morning; equal is invalid
  if (!label || !start || !end || start === end || !days.length) return null;
  const valid_from = cleanDate(b.valid_from);
  const valid_until = cleanDate(b.valid_until);
  return compact({
    id: cleanText(b.id, 20) ?? newId(),
    label,
    days,
    start,
    end,
    valid_from,
    valid_until: valid_until && (!valid_from || valid_until >= valid_from) ? valid_until : undefined,
    course_id: typeof b.course_id === "string" && UUID.test(b.course_id) ? b.course_id : undefined,
  }) as BusyBlock;
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
  return next.slice(0, 20);
}

// Is the block in effect on this date (its semester / valid range)?
export function blockActive(block: BusyBlock, date: string): boolean {
  return (!block.valid_from || date >= block.valid_from) && (!block.valid_until || date <= block.valid_until);
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

export function describeBlock(b: BusyBlock): string {
  const overnight = b.end < b.start ? " (overnight)" : "";
  const range =
    b.valid_from || b.valid_until
      ? ` · ${b.valid_from ? `from ${b.valid_from}` : ""}${b.valid_from && b.valid_until ? " " : ""}${b.valid_until ? `until ${b.valid_until}` : ""}`
      : "";
  return `${describeDays(b.days)} ${b.start}–${b.end}${overnight}${range}`;
}

export function parseMemoryItem(v: unknown): MemoryItem | null {
  const item = record(v);
  const text = cleanText(item.text, 200);
  if (!text) return null;
  return {
    id: cleanText(item.id, 20) ?? newId(),
    text,
    source: item.source === "user" ? "user" : "ai",
    category: oneOf(item.category, ["fact", "preference", "constraint", "event"] as const) ?? "fact",
    pinned: item.pinned === true,
    expires_at: cleanDate(item.expires_at) ?? null,
    created_at: cleanText(item.created_at, 40) ?? new Date().toISOString(),
  };
}

// Memory that still applies today (expired items are dropped)
export function liveMemory(memory: MemoryItem[], today: string): MemoryItem[] {
  return memory.filter((m) => !m.expires_at || m.expires_at >= today);
}

function parseSkills(p: Record<string, unknown>): Skill[] {
  const out: Skill[] = [];
  const add = (name: string, status: SkillStatus) => {
    const existing = out.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!existing) out.push({ name, status });
  };
  for (const raw of Array.isArray(p.skills) ? p.skills : []) {
    if (typeof raw === "string") {
      // Old shape: "skills they want to develop"
      const name = cleanText(raw, 60);
      if (name) add(name, "want");
    } else {
      const s = record(raw);
      const name = cleanText(s.name, 60);
      if (name) add(name, oneOf(s.status, ["have", "learning", "want"] as const) ?? "want");
    }
  }
  // Old separate lists
  for (const name of cleanList(p.tech_stack)) add(name, "have");
  for (const name of cleanList(p.tools)) add(name, "want");
  for (const name of cleanList(p.learning, 20, 100)) add(name.slice(0, 60), "want");
  return out.slice(0, 40);
}

function parseDurations(v: unknown): Partial<Record<DurationKey, number>> | undefined {
  const r = record(v);
  const out: Partial<Record<DurationKey, number>> = {};
  for (const key of DURATION_KEYS) {
    const n = cleanNumber(r[key], 5, 480);
    if (n !== undefined) out[key] = Math.round(n);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseBalance(v: unknown): Partial<Record<Role, number>> | undefined {
  const r = record(v);
  const out: Partial<Record<Role, number>> = {};
  for (const role of ROLE_OPTIONS.map((o) => o.value)) {
    const n = cleanNumber(r[role], 0, 100);
    if (n !== undefined && n > 0) out[role] = Math.round(n);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseIgnored(v: unknown): AIProfile["ignored"] {
  const out: AIProfile["ignored"] = {};
  for (const [key, value] of Object.entries(record(v)).slice(0, 60)) {
    const k = key.slice(0, 80);
    if (typeof value === "number") {
      // Old shape: a plain count, keyed by area name
      if (value > 0) out[k] = { count: Math.round(value), last: new Date(0).toISOString() };
    } else {
      const r = record(value);
      const count = Math.round(Number(r.count)) || 0;
      if (count > 0) out[k] = { count, last: cleanText(r.last, 40) ?? new Date(0).toISOString() };
    }
  }
  return out;
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

  const roles = parseRoles(about.roles ?? about.occupation);
  // Older profiles kept organization / field / term in "about"
  const isStudent = roles.includes("student");

  const memory = (Array.isArray(p.memory) ? p.memory : [])
    .map(parseMemoryItem)
    .filter((m): m is MemoryItem => !!m);

  const blocks = (Array.isArray(p.blocks) ? p.blocks : [])
    .map(parseBlock)
    .filter((b): b is BusyBlock => !!b)
    .slice(0, 20);

  // Old free-text busy hours: kept as a note until real busy blocks exist
  if (!blocks.length) {
    const notes = [
      cleanText(schedule.busy, 300) && `Busy: ${cleanText(schedule.busy, 300)}`,
      cleanText(work.hours, 150) && `Work hours: ${cleanText(work.hours, 150)}`,
      cleanText(schedule.free, 300) && `Usually free: ${cleanText(schedule.free, 300)}`,
    ].filter((n): n is string => !!n);
    for (const text of notes) {
      if (!memory.some((m) => m.text === text)) {
        memory.push({
          id: `legacy${memory.length}`,
          text,
          source: "user",
          category: "constraint",
          pinned: true,
          expires_at: null,
          created_at: new Date(0).toISOString(),
        });
      }
    }
  }

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
      semester_start: cleanDate(education.semester_start),
      semester_end: cleanDate(education.semester_end),
      exam_period_start: cleanDate(education.exam_period_start),
      exam_period_end: cleanDate(education.exam_period_end),
    }),
    work: compact({
      job: cleanText(work.job, 100),
      company: cleanText(work.company ?? (!isStudent ? about.organization : undefined), 100),
      responsibilities: cleanText(work.responsibilities, 400),
      employment: oneOf(work.employment, ["full_time", "part_time", "shifts", "freelance"] as const),
      days_off: cleanDays(work.days_off),
      commute_minutes: cleanNumber(work.commute_minutes, 0, 300),
    }),
    business: {
      ideas: cleanList(business.ideas, 15, 150),
      interests: cleanList(business.interests),
      ...compact({ stage: oneOf(business.stage, ["idea", "validating", "launched", "growing"] as const) }),
    },
    interests: cleanList(p.interests),
    skills: parseSkills(p),
    schedule: compact({
      wake: cleanTime(schedule.wake),
      sleep: cleanTime(schedule.sleep),
      study_time: cleanText(schedule.study_time, 100),
      project_time: cleanText(schedule.project_time, 100),
      daily_hours: cleanNumber(schedule.daily_hours, 0, 16),
      rest_days: cleanDays(schedule.rest_days),
    }),
    preferences: compact({
      energy: oneOf(prefs.energy, ["morning", "evening", "flexible"] as const),
      session: oneOf(prefs.session, ["long", "short", "mixed"] as const),
      tasks_per_day: cleanNumber(prefs.tasks_per_day, 1, 30),
      intensity: oneOf(prefs.intensity, ["relaxed", "balanced", "aggressive"] as const),
      free_time: cleanText(prefs.free_time, 100),
      durations: parseDurations(prefs.durations),
      language: cleanText(prefs.language, 40),
      balance: parseBalance(prefs.balance),
    }),
    blocks,
    instructions: cleanText(p.instructions, 1000) ?? "",
    summary: cleanList(p.summary, 12, 160),
    memory: memory.slice(-MEMORY_LIMIT * 2),
    ignored: parseIgnored(p.ignored),
    covered: (Array.isArray(p.covered) ? p.covered : [])
      .map((k) => (k === "habits" ? "routines" : k))
      .filter(
        (k, i, all): k is SectionKey => SECTIONS.some((s) => s.key === k) && all.indexOf(k) === i
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

// Has the user told the AI who they are? (Only changes wording now: the
// persona is always used, and it no longer affects AI limits.)
export function hasPersona(profile: Pick<Profile, "ai_profile"> | null): boolean {
  if (!profile) return false;
  const p = profile.ai_profile;
  return p.about.roles.length > 0 || !!p.about.headline || p.summary.length > 0;
}

export function parseStyle(v: unknown): AIStyle {
  return oneOf(v, AI_STYLES.map((s) => s.value)) ?? "balanced";
}

export function styleOf(style: AIStyle) {
  return AI_STYLES.find((s) => s.value === style) ?? AI_STYLES[AI_STYLES.length - 1];
}

export function parseNotify(v: unknown): NotifySettings {
  const r = record(v);
  return {
    enabled: r.enabled === true,
    reminder_minutes: Math.round(cleanNumber(r.reminder_minutes, 0, 240) ?? DEFAULT_NOTIFY.reminder_minutes),
    morning: cleanTime(r.morning) ?? DEFAULT_NOTIFY.morning,
    evening: cleanTime(r.evening) ?? DEFAULT_NOTIFY.evening,
    weekly_review: r.weekly_review !== false,
    deadlines: r.deadlines !== false,
    quiet_start: cleanTime(r.quiet_start) ?? DEFAULT_NOTIFY.quiet_start,
    quiet_end: cleanTime(r.quiet_end) ?? DEFAULT_NOTIFY.quiet_end,
  };
}

// ---------------------------------------------------------------- sections

// Onboarding covers these. The quick start only needs the essentials (who
// you are, what you're working on, when you're busy); the AI asks about the
// rest later, when it becomes relevant.
export type SectionKey =
  | "about"
  | "education"
  | "work"
  | "goals"
  | "schedule"
  | "routines"
  | "interests"
  | "style";

export const SECTIONS: { key: SectionKey; label: string; emoji: string }[] = [
  { key: "about", label: "About you", emoji: "👋" },
  { key: "education", label: "Studies", emoji: "🎓" },
  { key: "work", label: "Work", emoji: "💼" },
  { key: "goals", label: "Goals", emoji: "🎯" },
  { key: "schedule", label: "Schedule", emoji: "🕒" },
  { key: "routines", label: "Routines", emoji: "🔁" },
  { key: "interests", label: "Skills & interests", emoji: "💡" },
  { key: "style", label: "AI style", emoji: "✨" },
];
