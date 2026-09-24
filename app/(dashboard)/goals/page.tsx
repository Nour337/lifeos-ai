"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getGoals, deleteGoal } from "@/lib/queries/goals";
import { getProjects } from "@/lib/queries/projects";
import { getTasks } from "@/lib/queries/tasks";
import { getGoalProgress, type Progress } from "@/lib/progress";
import GoalList from "@/components/GoalList";
import GoalForm from "@/components/GoalForm";
import { useToast } from "@/components/Toast";
import { Button, EmptyState, ErrorState, ListSkeleton, Modal, PageHeader } from "@/components/ui";
import { PlusIcon, TargetIcon } from "@/components/icons";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";
import type { Task } from "@/types/task";

export default function GoalsPage() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const toast = useToast();
  // null = closed, { goal: null } = new, { goal } = editing
  const [form, setForm] = useState<{ goal: Goal | null } | null>(null);

  const refreshGoals = useCallback(() => {
    Promise.all([getGoals(), getProjects(), getTasks()])
      .then(([goalData, projectData, taskData]) => {
        setGoals(goalData);
        setProjects(projectData);
        setTasks(taskData);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (user) refreshGoals();
  }, [user, refreshGoals]);

  const progressByGoal = useMemo(() => {
    const result: Record<string, Progress> = {};
    for (const goal of goals) {
      result[goal.id] = getGoalProgress(goal.id, tasks, projects);
    }
    return result;
  }, [goals, tasks, projects]);

  const projectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const project of projects) {
      if (project.goal_id) {
        counts[project.goal_id] = (counts[project.goal_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [projects]);

  const closeForm = useCallback(() => setForm(null), []);

  const handleGoalSaved = () => {
    setForm(null);
    refreshGoals();
  };

  const handleDeleteGoal = async (id: string) => {
    if (await deleteGoal(id)) {
      toast("Goal deleted. Its projects and tasks were kept.");
    } else {
      toast("Couldn't delete the goal. Try again.", { tone: "error" });
    }
    refreshGoals();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Goals"
        subtitle="What you're working toward."
        action={
          <Button onClick={() => setForm({ goal: null })}>
            <PlusIcon className="h-4 w-4" />
            New goal
          </Button>
        }
      />

      {!loaded ? (
        <ListSkeleton rows={2} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refreshGoals} />
      ) : goals.length === 0 ? (
        <EmptyState
          icon={<TargetIcon />}
          title="No goals yet"
          text="Set a goal, then link projects and tasks to it to see your progress."
          action={
            <Button onClick={() => setForm({ goal: null })}>
              <PlusIcon className="h-4 w-4" />
              Set a goal
            </Button>
          }
        />
      ) : (
        <GoalList
          goals={goals}
          progressByGoal={progressByGoal}
          projectCounts={projectCounts}
          onEditGoal={(goal) => setForm({ goal })}
          onDeleteGoal={handleDeleteGoal}
        />
      )}

      <Modal
        open={form !== null}
        title={form?.goal ? "Edit goal" : "New goal"}
        onClose={closeForm}
      >
        {form && (
          <GoalForm
            editingGoal={form.goal}
            onGoalSaved={handleGoalSaved}
            onCancel={closeForm}
          />
        )}
      </Modal>
    </div>
  );
}
