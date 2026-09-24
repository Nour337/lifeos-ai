"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { Task, TaskPriority, TaskStatus } from "@/types/task";
import type { Project } from "@/types/project";
import type { Goal } from "@/types/goal";

type TaskFormProps = {
  onTaskSaved: () => void;
  editingTask?: Task | null;
  onCancel?: () => void;
  defaultProjectId?: string;
};

const priorities: TaskPriority[] = ["low", "medium", "high"];

export default function TaskForm({
  onTaskSaved,
  editingTask,
  onCancel,
  defaultProjectId,
}: TaskFormProps) {
  const { user } = useAuth();
  // Initial values come from editingTask; the form is remounted (it lives in
  // a modal, or gets a new `key`) whenever a different task is edited.
  const [title, setTitle] = useState(editingTask?.title ?? "");
  const [description, setDescription] = useState(
    editingTask?.description ?? ""
  );
  const [priority, setPriority] = useState<TaskPriority>(
    editingTask?.priority ?? "medium"
  );
  const [status, setStatus] = useState<TaskStatus>(
    editingTask?.status ?? "todo"
  );
  const [dueDate, setDueDate] = useState(editingTask?.due_date ?? "");
  const [projectId, setProjectId] = useState(
    editingTask?.project_id ?? defaultProjectId ?? ""
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [goalId, setGoalId] = useState(editingTask?.goal_id ?? "");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load the user's projects and goals once, to populate the dropdowns
  useEffect(() => {
    if (user) {
      getProjects().then(setProjects);
      getGoals().then(setGoals);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    const taskData = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status,
      due_date: dueDate || null,
      project_id: projectId || null,
      goal_id: goalId || null,
    };

    const result = editingTask
      ? await supabase.from("tasks").update(taskData).eq("id", editingTask.id)
      : await supabase.from("tasks").insert({ user_id: user.id, ...taskData });

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    onTaskSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Title">
        {(id) => (
          <Input
            id={id}
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus={!editingTask}
          />
        )}
      </Field>

      <Field label="Notes">
        {(id) => (
          <Textarea
            id={id}
            placeholder="Optional details"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Priority</p>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
          {priorities.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`rounded-md py-1.5 text-sm font-medium capitalize transition ${
                priority === p
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Due date">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </Select>
          )}
        </Field>
        <Field label="Project">
          {(id) => (
            <Select
              id={id}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Goal">
          {(id) => (
            <Select
              id={id}
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value="">None</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving ? "Saving..." : editingTask ? "Save changes" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
