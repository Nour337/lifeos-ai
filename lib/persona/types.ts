import type { Budget } from "@/lib/ai/budget";
import type { Balance } from "@/lib/persona/insights";
import type { TaskEnergy, TaskPriority } from "@/types/task";

// Shapes shared by the coaching API (/api/coach) and the screens.

export type { Budget };

export type Suggestion = {
  id: string;
  title: string;
  minutes: number;
  emoji: string;
  reason: string; // one line under the title
  why: string; // "Why am I seeing this?"
  priority: TaskPriority;
  energy: TaskEnergy | null;
  projectId: string | null;
  goalId: string | null;
  areaId: string | null; // project / goal id, used for "ignored" learning
  area: string | null; // its name
  kind: "new" | "recover"; // recover = one of the user's own overdue tasks
  taskId: string | null; // for "recover": the task to reschedule
};

export type SuggestionSet = {
  day: string;
  items: Suggestion[];
  handled: string[];
  recovery: boolean; // backlog is high: suggestions are about catching up
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
    moved: number; // times tasks were postponed this week
    routines: { title: string; done: number; total: number }[];
    progress: AreaProgress[];
    balance?: Balance; // time per role vs. intended split
  };
  ai: {
    headline: string;
    highlights: string[];
    suggestions: string[];
  };
  generatedAt: string;
};
