"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getGoals, deleteGoal } from "@/lib/queries/goals";
import { getProjects } from "@/lib/queries/projects";
import { getTasks } from "@/lib/queries/tasks";
import { getGoalProgress, type Progress } from "@/lib/progress";
import GoalList from "@/components/GoalList";
import GoalForm from "@/components/GoalForm";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";
import type { Task } from "@/types/task";

export default function GoalsPage() {
  const { user, loading } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  const refreshGoals = useCallback(() => {
    getGoals().then(setGoals);
    getProjects().then(setProjects);
    getTasks().then(setTasks);
  }, []);

  const progressByGoal = useMemo(() => {
    const result: Record<string, Progress> = {};
    for (const goal of goals) {
      result[goal.id] = getGoalProgress(goal.id, tasks, projects);
    }
    return result;
  }, [goals, tasks, projects]);

  useEffect(() => {
    if (user) refreshGoals();
  }, [user, refreshGoals]);

  const handleGoalSaved = () => {
    setEditingGoal(null);
    refreshGoals();
  };

  const handleDeleteGoal = async (id: string) => {
    const success = await deleteGoal(id);
    if (success) {
      if (editingGoal?.id === id) setEditingGoal(null);
      refreshGoals();
    }
  };

  if (loading) return <p className="p-8">Loading...</p>;

  return (
    <div className="flex flex-col items-center gap-6 p-4 sm:p-8">
      <h1 className="w-full max-w-2xl text-2xl font-semibold text-black dark:text-white">
        Goals
      </h1>

      <GoalForm
        key={editingGoal?.id ?? "new"}
        onGoalSaved={handleGoalSaved}
        editingGoal={editingGoal}
        onCancelEdit={() => setEditingGoal(null)}
      />

      <GoalList
        goals={goals}
        progressByGoal={progressByGoal}
        onEditGoal={setEditingGoal}
        onDeleteGoal={handleDeleteGoal}
      />
    </div>
  );
}