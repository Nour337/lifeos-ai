import type { Task } from "@/types/task";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";

export type Progress = {
  done: number;
  total: number;
  percent: number;
  manual?: boolean; // the user set the percentage by hand
};

export function computeProgress(tasks: Task[]): Progress {
  // Skipped tasks were deliberately dropped, so they don't count either way
  const counted = tasks.filter((task) => task.status !== "skipped" && !task.parent_id);
  const total = counted.length;
  const done = counted.filter((task) => task.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

// Calculated from its tasks, unless the user set it by hand
export function getProjectProgress(project: Project | string, tasks: Task[]): Progress {
  const id = typeof project === "string" ? project : project.id;
  const computed = computeProgress(tasks.filter((task) => task.project_id === id));
  if (typeof project !== "string" && project.progress_manual) {
    return { ...computed, percent: project.progress, manual: true };
  }
  return computed;
}

// A goal's tasks are the ones linked to it directly, plus every task in a
// project or milestone that belongs to the goal (see docs/schema.md).
export function getGoalProgress(goal: Goal | string, tasks: Task[], projects: Project[]): Progress {
  const goalId = typeof goal === "string" ? goal : goal.id;
  const goalProjectIds = new Set(projects.filter((p) => p.goal_id === goalId).map((p) => p.id));
  const computed = computeProgress(
    tasks.filter(
      (task) => task.goal_id === goalId || (task.project_id !== null && goalProjectIds.has(task.project_id))
    )
  );
  if (typeof goal !== "string" && goal.progress_manual) {
    return { ...computed, percent: goal.progress, manual: true };
  }
  return computed;
}
