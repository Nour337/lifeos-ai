"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTasks, deleteTask, toggleTaskStatus } from "@/lib/queries/tasks";
import TaskList from "@/components/TaskList";
import TaskForm from "@/components/TaskForm";
import TaskFilters, { type TaskFilterState } from "@/components/TaskFilters";
import type { Task } from "@/types/task";

export default function TasksPage() {
  const { user, loading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filters, setFilters] = useState<TaskFilterState>({
    status: "all",
    priority: "all",
    search: "",
  });

  const refreshTasks = useCallback(() => {
    getTasks().then(setTasks);
  }, []);

  useEffect(() => {
    if (user) refreshTasks();
  }, [user, refreshTasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const statusMatch =
        filters.status === "all" || task.status === filters.status;
      const priorityMatch =
        filters.priority === "all" || task.priority === filters.priority;
      const searchMatch =
        filters.search.trim() === "" ||
        task.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        (task.description ?? "")
          .toLowerCase()
          .includes(filters.search.toLowerCase());
      return statusMatch && priorityMatch && searchMatch;
    });
  }, [tasks, filters]);

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

  const handleToggleStatus = async (task: Task) => {
    const success = await toggleTaskStatus(task.id, task.status);
    if (success) refreshTasks();
  };

  if (loading) return <p className="p-8">Loading...</p>;

  return (
    <div className="flex flex-col items-center gap-6 p-4 sm:p-8">
      <h1 className="w-full max-w-2xl text-2xl font-semibold text-black dark:text-white">
        Tasks
      </h1>

      <TaskForm
        key={editingTask?.id ?? "new"}
        onTaskSaved={handleTaskSaved}
        editingTask={editingTask}
        onCancelEdit={() => setEditingTask(null)}
      />

      <TaskFilters filters={filters} onChange={setFilters} />

      <TaskList
        tasks={filteredTasks}
        onEditTask={setEditingTask}
        onDeleteTask={handleDeleteTask}
        onToggleStatus={handleToggleStatus}
      />
    </div>
  );
}