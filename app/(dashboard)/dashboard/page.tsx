"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getTasks, deleteTask } from "@/lib/queries/tasks";
import TaskList from "@/components/TaskList";
import TaskForm from "@/components/TaskForm";
import type { Task } from "@/types/task";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const refreshTasks = useCallback(() => {
    getTasks().then(setTasks);
  }, []);

  useEffect(() => {
    if (user) refreshTasks();
  }, [user, refreshTasks]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleTaskSaved = () => {
    setEditingTask(null);
    refreshTasks();
  };

  const handleDeleteTask = async (id: string) => {
    const success = await deleteTask(id);
    if (success) {
      if (editingTask?.id === id) setEditingTask(null);
      refreshTasks();
    }
  };

  if (loading) return <p className="p-8">Loading...</p>;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-50 p-8 dark:bg-black">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-white">
          Welcome, {user?.email ?? "Guest"}
        </h1>
        <button
          onClick={handleLogout}
          className="rounded-md bg-red-600 px-4 py-2 text-white transition hover:bg-red-700"
        >
          Log Out
        </button>
      </div>

      <TaskForm
        onTaskSaved={handleTaskSaved}
        editingTask={editingTask}
        onCancelEdit={() => setEditingTask(null)}
      />
      <TaskList
        tasks={tasks}
        onEditTask={setEditingTask}
        onDeleteTask={handleDeleteTask}
      />
    </div>
  );
}