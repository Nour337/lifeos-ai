import type { Difficulty, Importance } from "@/types/persona";

// Courses are projects with kind "course" (deadline = exam date), so their
// study tasks link to them like any other project.
export type ProjectKind =
  | "course"
  | "university"
  | "graduation"
  | "personal"
  | "freelance"
  | "business"
  | "internship"
  | "job"
  | "research"
  | "project"
  | "other";

export const PROJECT_KINDS: { value: ProjectKind; label: string; emoji: string }[] = [
  { value: "project", label: "Project", emoji: "📁" },
  { value: "course", label: "Course", emoji: "📚" },
  { value: "university", label: "University project", emoji: "🏫" },
  { value: "graduation", label: "Graduation project", emoji: "🎓" },
  { value: "personal", label: "Personal project", emoji: "🛠️" },
  { value: "freelance", label: "Freelance", emoji: "💻" },
  { value: "business", label: "Business idea", emoji: "🚀" },
  { value: "internship", label: "Internship", emoji: "🧑‍💼" },
  { value: "job", label: "Job", emoji: "💼" },
  { value: "research", label: "Research", emoji: "🔬" },
  { value: "other", label: "Other", emoji: "📌" },
];

export function kindOf(kind: ProjectKind) {
  return PROJECT_KINDS.find((k) => k.value === kind) ?? PROJECT_KINDS[0];
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  deadline: string | null; // exam date for courses
  goal_id: string | null;
  kind: ProjectKind;
  importance: Importance | null;
  difficulty: Difficulty | null;
  weekly_hours: number | null;
  progress: number; // 0-100, the user's own estimate
  ai_help: boolean;
  created_at: string;
}
