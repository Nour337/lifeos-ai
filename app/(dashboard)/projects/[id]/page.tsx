"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProjectById } from "@/lib/queries/projects";
import { getGoalById } from "@/lib/queries/goals";
import {
  getTasksByProject,
  deleteTask,
  toggleTaskStatus,
} from "@/lib/queries/tasks";
import { computeProgress } from "@/lib/progress";
import TaskList from "@/components/TaskList";
import ProgressBar from "@/components/ProgressBar";
import type { Project } from "@/types/project";
import type { Goal } from "@/types/goal";
import type { Task } from "@/types/task";

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshTasks = useCallback(() => {
    getTasksByProject(projectId).then(setTasks);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    Promise.all([
      getProjectById(projectId),
      getTasksByProject(projectId),
    ]).then(async ([projectData, tasksData]) => {
      setProject(projectData);
      setTasks(tasksData);
      if (projectData?.goal_id) {
        setGoal(await getGoalById(projectData.goal_id));
      }
      setLoading(false);
    });
  }, [projectId]);

  const handleDeleteTask = async (id: string) => {
    if (await deleteTask(id)) refreshTasks();
  };

  const handleToggleStatus = async (task: Task) => {
    if (await toggleTaskStatus(task.id, task.status)) refreshTasks();
  };

  if (loading) return <p className="p-8">Loading...</p>;

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-red-500">Project not found.</p>
        <Link href="/projects" className="text-blue-500 underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 p-4 sm:p-8">
      <div className="w-full max-w-2xl">
        <Link href="/projects" className="text-sm text-blue-500 underline">
          ← Back to Projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-white">
          {project.name}
        </h1>
        {project.description && (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {project.description}
          </p>
        )}
        {project.deadline && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Deadline: {project.deadline}
          </p>
        )}
        {goal && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Goal: <span className="font-medium">{goal.name}</span>
          </p>
        )}
        <div className="mt-4">
          <ProgressBar progress={computeProgress(tasks)} />
        </div>
      </div>

      <h2 className="w-full max-w-2xl text-lg font-medium text-black dark:text-white">
        Tasks in this project ({tasks.length})
      </h2>

      <TaskList
        tasks={tasks}
        onEditTask={() => {}}
        onDeleteTask={handleDeleteTask}
        onToggleStatus={handleToggleStatus}
      />
    </div>
  );
}
