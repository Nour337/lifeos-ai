"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProjectById } from "@/lib/queries/projects";
import { getGoalById } from "@/lib/queries/goals";
import { getTasksByProject } from "@/lib/queries/tasks";
import { useTaskActions } from "@/lib/useTaskActions";
import { useTasksChanged } from "@/lib/QuickAdd";
import { computeProgress } from "@/lib/progress";
import TaskList from "@/components/TaskList";
import TaskForm from "@/components/TaskForm";
import ProgressBar from "@/components/ProgressBar";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Modal,
  Skeleton,
} from "@/components/ui";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChecklistIcon,
  PlusIcon,
  TargetIcon,
} from "@/components/icons";
import { formatDate } from "@/utils/date";
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
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<{ task: Task | null } | null>(null);

  const load = useCallback(() => {
    Promise.all([getProjectById(projectId), getTasksByProject(projectId)])
      .then(async ([projectData, tasksData]) => {
        setProject(projectData);
        setTasks(tasksData);
        setLoadError("");
        if (projectData?.goal_id) {
          setGoal(await getGoalById(projectData.goal_id).catch(() => null));
        }
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const refreshTasks = useCallback(() => {
    getTasksByProject(projectId)
      .then(setTasks)
      .catch((e: Error) => setLoadError(e.message));
  }, [projectId]);

  useEffect(() => {
    if (projectId) load();
  }, [projectId, load]);

  useTasksChanged(refreshTasks);

  const { toggle, remove } = useTaskActions(setTasks, refreshTasks);

  const closeForm = useCallback(() => setForm(null), []);

  const handleTaskSaved = () => {
    setForm(null);
    refreshTasks();
  };

  const backLink = (
    <Link
      href="/projects"
      className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      Projects
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-5">
        {backLink}
        <Skeleton className="h-32" />
        <ListSkeleton rows={3} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-5">
        {backLink}
        <ErrorState message={loadError} onRetry={load} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-5">
        {backLink}
        <EmptyState
          icon={<ChecklistIcon />}
          title="Project not found"
          text="It may have been deleted."
        />
      </div>
    );
  }

  const openTasks = tasks.filter((t) => t.status !== "done");
  const doneTasks = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-5">
      {backLink}

      <Card>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {project.name}
        </h1>
        {project.description && (
          <p className="mt-1.5 text-muted">{project.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {project.deadline && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-muted">
              <CalendarIcon className="h-4 w-4" />
              Due {formatDate(project.deadline)}
            </span>
          )}
          {goal && (
            <Link
              href="/goals"
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-accent"
            >
              <TargetIcon className="h-4 w-4" />
              {goal.name}
            </Link>
          )}
        </div>
        <div className="mt-5">
          <ProgressBar progress={computeProgress(tasks)} />
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">
          Tasks <span className="font-normal text-muted">({tasks.length})</span>
        </h2>
        <Button size="sm" onClick={() => setForm({ task: null })}>
          <PlusIcon className="h-4 w-4" />
          Add task
        </Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<ChecklistIcon />}
          title="No tasks in this project"
          text="Break the project into small steps you can finish."
        />
      ) : (
        <TaskList
          tasks={[...openTasks, ...doneTasks]}
          onEditTask={(task) => setForm({ task })}
          onDeleteTask={remove}
          onToggleStatus={toggle}
        />
      )}

      <Modal
        open={form !== null}
        title={form?.task ? "Edit task" : "New task"}
        onClose={closeForm}
      >
        {form && (
          <TaskForm
            editingTask={form.task}
            defaultProjectId={projectId}
            onTaskSaved={handleTaskSaved}
            onCancel={closeForm}
          />
        )}
      </Modal>
    </div>
  );
}
