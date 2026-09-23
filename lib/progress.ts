import type { Task } from "@/types/task";
import type { Project } from "@/types/project";

export type Progress = {
  done: number;
  total: number;
  percent: number;
};

export function computeProgress(tasks: Task[]): Progress {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

export function getProjectProgress(projectId: string, tasks: Task[]): Progress {
  return computeProgress(tasks.filter((task) => task.project_id === projectId));
}

// A goal's tasks are the ones linked to it directly, plus every task in a
// project that belongs to the goal (see docs/schema.md).
export function getGoalProgress(
  goalId: string,
  tasks: Task[],
  projects: Project[]
): Progress {
  const goalProjectIds = new Set(
    projects.filter((p) => p.goal_id === goalId).map((p) => p.id)
  );
  return computeProgress(
    tasks.filter(
      (task) =>
        task.goal_id === goalId ||
        (task.project_id !== null && goalProjectIds.has(task.project_id))
    )
  );
}
