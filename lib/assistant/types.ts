import type { TaskPriority, TaskStatus } from "@/types/task";

// Shapes shared by the assistant API route and the chat screen.

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ConflictChoice = "move_new" | "move_existing" | "keep_both" | "skip";

export type Conflict = {
  existingTaskId: string;
  existingTitle: string;
  existingStart: string; // "HH:MM"
  existingEnd: string;
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
  goalId: string | null;
  newGoal: boolean; // link to the goal created by this proposal
  projectId: string | null;
  milestoneKey: string | null; // link to a milestone project created by this proposal
  conflict: Conflict | null;
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
};

export type Proposal = {
  summary: string;
  newGoal: { name: string; description: string | null; targetDate: string | null } | null;
  milestones: { key: string; name: string; deadline: string | null }[];
  creates: DraftTask[];
  updates: TaskChange[];
  deletes: { taskId: string; title: string; date: string | null }[];
};

export type AssistantResponse = {
  reply: string;
  proposal: Proposal | null;
  remembered?: string[]; // facts saved to the user's AI memory
  remaining?: number;
};
