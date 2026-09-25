import type { TaskPriority } from "@/types/task";

// Shapes shared by the coaching API (/api/coach) and the screens.

// How a request was counted: Persona AI (unlimited) or one of the 10
// daily AI messages
export type Usage = { persona: true } | { persona: false; remaining: number };

export type Suggestion = {
  id: string;
  title: string;
  minutes: number;
  emoji: string;
  reason: string; // one line under the title
  why: string; // "Why am I seeing this?"
  priority: TaskPriority;
  projectId: string | null;
  goalId: string | null;
  area: string | null; // project / goal name, used for "ignored" learning
};

export type NowStep = {
  taskId: string | null; // existing task, or null for a new one
  title: string;
  minutes: number;
  reason: string;
  isBreak: boolean;
  projectId: string | null;
  goalId: string | null;
  area: string | null;
};

export type NowResult = {
  minutes: number; // time the plan is for
  message: string;
  plan: NowStep[];
  options: NowStep[]; // single alternatives ("I have free time")
};

export type AreaProgress = {
  id: string;
  type: "project" | "goal";
  name: string;
  now: number;
  before: number | null; // from last week's review
};

export type WeeklyReview = {
  weekStart: string;
  weekEnd: string;
  stats: {
    completed: number;
    planned: number;
    minutes: number;
    byKind: { label: string; count: number }[]; // "study sessions", "project sessions"...
    byArea: { name: string; count: number; minutes: number }[];
    missed: { title: string; date: string; area: string | null }[];
    progress: AreaProgress[];
  };
  ai: {
    headline: string;
    highlights: string[];
    suggestions: string[];
  };
  generatedAt: string;
};
