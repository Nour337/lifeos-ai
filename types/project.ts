import type { Difficulty, Importance, Role } from "@/types/persona";

// Courses are projects with kind "course" (their exams and assignments are
// assessments), so their study tasks link to them like any other project.
// Milestones of a goal are projects with kind "milestone": they are shown
// under their goal, not in the Projects list.
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
  | "milestone"
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
  { value: "milestone", label: "Milestone", emoji: "🏁" },
  { value: "other", label: "Other", emoji: "📌" },
];

// Kinds the user picks from (milestones are made from a goal)
export const PICKABLE_KINDS = PROJECT_KINDS.filter((k) => k.value !== "milestone");

export function kindOf(kind: ProjectKind) {
  return PROJECT_KINDS.find((k) => k.value === kind) ?? PROJECT_KINDS[0];
}

// Which part of the user's life an area belongs to, for the balance report
export const ROLE_OF_KIND: Partial<Record<ProjectKind, Role>> = {
  course: "student",
  university: "student",
  graduation: "student",
  research: "student",
  job: "working",
  internship: "working",
  business: "entrepreneur",
  freelance: "freelancer",
};

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  deadline: string | null; // for courses, the next exam is also an assessment
  goal_id: string | null;
  kind: ProjectKind;
  importance: Importance | null;
  difficulty: Difficulty | null;
  weekly_hours: number | null;
  progress: number; // 0-100, used only when progress_manual
  progress_manual: boolean; // false = calculated from its tasks
  ai_help: boolean;
  created_at: string;
}

export type AssessmentType = "exam" | "midterm" | "final" | "quiz" | "assignment" | "presentation" | "other";

export const ASSESSMENT_TYPES: { value: AssessmentType; label: string }[] = [
  { value: "exam", label: "Exam" },
  { value: "midterm", label: "Midterm" },
  { value: "final", label: "Final exam" },
  { value: "quiz", label: "Quiz" },
  { value: "assignment", label: "Assignment" },
  { value: "presentation", label: "Presentation" },
  { value: "other", label: "Other" },
];

export interface Assessment {
  id: string;
  user_id: string;
  project_id: string;
  type: AssessmentType;
  title: string;
  due_date: string;
  due_time: string | null;
  weight: number | null; // % of the grade
  done: boolean;
  created_at: string;
}
