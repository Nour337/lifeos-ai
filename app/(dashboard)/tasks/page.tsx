"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTasks, deleteTask, toggleTaskStatus } from "@/lib/queries/tasks";
import { getProjects } from "@/lib/queries/projects";
import TaskList from "@/components/TaskList";
import TaskForm from "@/components/TaskForm";
import TaskFilters, { type TaskFilterState } from "@/components/TaskFilters";
import { Button, EmptyState, ListSkeleton, Modal, PageHeader } from "@/components/ui";
import { ChecklistIcon, PlusIcon, SearchIcon } from "@/components/icons";
import type { Task } from "@/types/task";

// Open tasks first, then by due date (undated last), newest first as tiebreak
function sortTasks(a: Task, b: Task) {
  const doneDiff = Number(a.status === "done") - Number(b.status === "done");
  if (doneDiff !== 0) return doneDiff;
  const byDue = (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  if (byDue !== 0) return byDue;
  return b.created_at.localeCompare(a.created_at);
}

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  // null = closed, { task: null } = new task, { task } = editing
  const [form, setForm] = useState<{ task: Task | null } | null>(null);
  const [filters, setFilters] = useState<TaskFilterState>({
    status: "all",
    priority: "all",
    search: "",
  });

  const refreshTasks = useCallback(() => {
    getTasks().then((data) => {
      setTasks(data);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshTasks();
    getProjects().then((projects) =>
      setProjectNames(Object.fromEntries(projects.map((p) => [p.id, p.name])))
    );
  }, [user, refreshTasks]);

  const filteredTasks = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const statusMatch =
          filters.status === "all" || task.status === filters.status;
        const priorityMatch =
          filters.priority === "all" || task.priority === filters.priority;
        const searchMatch =
          search === "" ||
          task.title.toLowerCase().includes(search) ||
          (task.description ?? "").toLowerCase().includes(search);
        return statusMatch && priorityMatch && searchMatch;
      })
      .sort(sortTasks);
  }, [tasks, filters]);

  const closeForm = useCallback(() => setForm(null), []);

  const handleTaskSaved = () => {
    setForm(null);
    refreshTasks();
  };

  const handleDeleteTask = async (id: string) => {
    if (await deleteTask(id)) refreshTasks();
  };

  const handleToggleStatus = async (task: Task) => {
    // Update the UI immediately, then sync with the database
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, status: task.status === "done" ? "todo" : "done" }
          : t
      )
    );
    if (!(await toggleTaskStatus(task.id, task.status))) refreshTasks();
  };

  const openCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle={loaded ? `${openCount} open` : undefined}
        action={
          <Button onClick={() => setForm({ task: null })}>
            <PlusIcon className="h-4 w-4" />
            New task
          </Button>
        }
      />

      <TaskFilters filters={filters} onChange={setFilters} />

      {!loaded ? (
        <ListSkeleton rows={4} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ChecklistIcon />}
          title="No tasks yet"
          text="Add your first task and it will show up here."
          action={
            <Button onClick={() => setForm({ task: null })}>
              <PlusIcon className="h-4 w-4" />
              Add a task
            </Button>
          }
        />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No matching tasks"
          text="Try a different search or filter."
        />
      ) : (
        <TaskList
          tasks={filteredTasks}
          projectNames={projectNames}
          onEditTask={(task) => setForm({ task })}
          onDeleteTask={handleDeleteTask}
          onToggleStatus={handleToggleStatus}
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
            onTaskSaved={handleTaskSaved}
            onCancel={closeForm}
          />
        )}
      </Modal>
    </div>
  );
}
