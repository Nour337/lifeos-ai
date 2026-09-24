"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTasks } from "@/lib/queries/tasks";
import { getProjects } from "@/lib/queries/projects";
import { useTaskActions } from "@/lib/useTaskActions";
import TaskList from "@/components/TaskList";
import TaskForm from "@/components/TaskForm";
import TaskFilters, { type TaskFilterState } from "@/components/TaskFilters";
import {
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Modal,
  PageHeader,
} from "@/components/ui";
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
  const [loadError, setLoadError] = useState("");
  // null = closed, { task: null } = new task, { task } = editing
  const [form, setForm] = useState<{ task: Task | null } | null>(null);
  const [filters, setFilters] = useState<TaskFilterState>({
    status: "all",
    priority: "all",
    category: "all",
    search: "",
  });

  const refreshTasks = useCallback(() => {
    getTasks()
      .then((data) => {
        setTasks(data);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
    getProjects()
      .then((projects) =>
        setProjectNames(Object.fromEntries(projects.map((p) => [p.id, p.name])))
      )
      .catch(() => {}); // project names are optional decoration
  }, []);

  useEffect(() => {
    if (user) refreshTasks();
  }, [user, refreshTasks]);

  const { toggle, remove } = useTaskActions(setTasks, refreshTasks);

  const categories = useMemo(
    () =>
      [...new Set(tasks.map((t) => t.category).filter((c): c is string => !!c))].sort(),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const statusMatch =
          filters.status === "all" || task.status === filters.status;
        const priorityMatch =
          filters.priority === "all" || task.priority === filters.priority;
        const categoryMatch =
          filters.category === "all" || task.category === filters.category;
        const searchMatch =
          search === "" ||
          task.title.toLowerCase().includes(search) ||
          (task.description ?? "").toLowerCase().includes(search);
        return statusMatch && priorityMatch && categoryMatch && searchMatch;
      })
      .sort(sortTasks);
  }, [tasks, filters]);

  const closeForm = useCallback(() => setForm(null), []);

  const handleTaskSaved = () => {
    setForm(null);
    refreshTasks();
  };

  const openCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle={loaded && !loadError ? `${openCount} open` : undefined}
        action={
          <Button onClick={() => setForm({ task: null })}>
            <PlusIcon className="h-4 w-4" />
            New task
          </Button>
        }
      />

      <TaskFilters filters={filters} categories={categories} onChange={setFilters} />

      {!loaded ? (
        <ListSkeleton rows={4} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refreshTasks} />
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
            categories={categories}
            onTaskSaved={handleTaskSaved}
            onCancel={closeForm}
          />
        )}
      </Modal>
    </div>
  );
}
