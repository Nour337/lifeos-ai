import type { Pattern } from "@/lib/assistant/patterns";
import type { Budget } from "@/lib/ai/budget";
import type { Importance } from "@/types/persona";
import type { TaskEnergy, TaskPriority, TaskStatus } from "@/types/task";

// Shapes shared by the assistant API route and the chat screen.

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ConflictChoice = "move_new" | "move_existing" | "keep_both" | "skip";

export type Conflict = {
  existingTaskId: string | null; // null = a fixed busy block (work, university)
  existingTitle: string;
  existingStart: string; // "HH:MM"
  existingEnd: string;
  existingFixed: boolean; // a fixed item can't be moved
  suggestedStart: string | null; // next free slot that day, if any
};

export type DraftTask = {
  key: string;
  title: string;
  notes: string | null;
  date: string; // YYYY-MM-DD
  start: string | null; // "HH:MM"
  end: string | null;
  duration: number | null; // minutes
  priority: TaskPriority;
  category: string | null;
  energy: TaskEnergy | null;
  isFixed: boolean;
  goalId: string | null;
  newGoal: boolean; // link to the goal created by this proposal
  projectId: string | null;
  milestoneKey: string | null; // link to a milestone created by this proposal
  seriesKey: string | null; // an occurrence of a series created by this proposal
  conflict: Conflict | null;
  movedFrom: string | null; // "15:30 (Work)": the app moved it out of fixed busy hours
};

// A new routine / repeating task. Its first weeks are in `creates`; later
// occurrences are created automatically.
export type DraftSeries = {
  key: string;
  title: string;
  notes: string | null;
  pattern: Pattern;
  patternLabel: string; // "3 days on, 1 off"
  startDate: string;
  until: string | null;
  count: number | null;
  totalSessions: number | null; // when it ends, how many sessions in all
  start: string | null;
  end: string | null;
  duration: number | null;
  priority: TaskPriority;
  category: string | null;
  energy: TaskEnergy | null;
  goalId: string | null;
  newGoal: boolean;
  projectId: string | null;
  milestoneKey: string | null;
  isRoutine: boolean;
};

export type TaskChange = {
  taskId: string;
  title: string;
  before: { date: string | null; start: string | null; status: TaskStatus };
  after: Partial<{
    title: string;
    due_date: string | null;
    due_time: string | null;
    end_time: string | null;
    estimated_duration: number | null;
    status: TaskStatus;
    priority: TaskPriority;
  }>;
  warning: string | null; // "Overlaps Work 16:00–22:00"
};

// Stop or change a whole routine from a date on
export type SeriesChange = {
  seriesId: string;
  title: string;
  action: "stop" | "change";
  fromDate: string;
  changes: Partial<{
    title: string;
    due_time: string | null;
    end_time: string | null;
    estimated_duration: number | null;
    pattern: Pattern;
  }>;
  label: string; // human description
};

export type Proposal = {
  id: string; // idempotency key: applying twice does nothing the second time
  summary: string;
  assumptions: string[]; // what the AI assumed ("60 min", "after work")
  newGoal: {
    name: string;
    description: string | null;
    targetDate: string | null;
    why: string | null;
    priority: Importance | null;
    weeklyHours: number | null;
  } | null;
  milestones: { key: string; name: string; deadline: string | null }[];
  series: DraftSeries[];
  creates: DraftTask[];
  updates: TaskChange[];
  seriesChanges: SeriesChange[];
  deletes: { taskId: string; title: string; date: string | null }[];
  overloaded: { date: string; planned: number; capacity: number }[]; // days over capacity after this plan
};

// Persona changes made in one turn, and how to undo them
export type PersonaUndo = {
  profile: Record<string, unknown>; // previous values of the ai_profile keys that changed
  displayName?: string | null;
  rows: { table: "projects" | "goals" | "assessments"; id: string; before: Record<string, unknown> | null }[];
};

export type Remembered = { changes: string[]; undo: PersonaUndo; undone?: boolean };

export type StoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  proposal: Proposal | null;
  proposal_state: "pending" | "applied" | "discarded" | null;
  remembered: Remembered | null;
  created_at: string;
};

export type AssistantResponse = {
  conversationId: string;
  message: StoredMessage; // the assistant's reply, as stored
  userMessageId: number;
  budget?: Budget; // after this message (missing when no AI was needed)
  free?: boolean; // answered without AI (didn't use points)
};
