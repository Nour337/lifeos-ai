"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { callAI } from "@/lib/ai/client";
import { useToast } from "@/components/Toast";
import { Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";
import type { Task, TaskPriority, TaskRepeat, TaskStatus } from "@/types/task";
import type { Project } from "@/types/project";
import type { Goal } from "@/types/goal";

type TaskFormProps = {
  onTaskSaved: () => void;
  editingTask?: Task | null;
  onCancel?: () => void;
  defaultProjectId?: string;
  categories?: string[];
};

const priorities: TaskPriority[] = ["low", "medium", "high"];
const durations = [15, 30, 45, 60, 90, 120, 180, 240];

export default function TaskForm({
  onTaskSaved,
  editingTask,
  onCancel,
  defaultProjectId,
  categories = [],
}: TaskFormProps) {
  const { user, session } = useAuth();
  const toast = useToast();
  // Initial values come from editingTask; the form is remounted (it lives in
  // a modal) whenever a different task is edited.
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
  const [duration, setDuration] = useState(
    editingTask?.estimated_duration ? String(editingTask.estimated_duration) : ""
  );
  const [category, setCategory] = useState(editingTask?.category ?? "");
  const [repeat, setRepeat] = useState<TaskRepeat | "">(editingTask?.repeat ?? "");
  const [projectId, setProjectId] = useState(
    editingTask?.project_id ?? defaultProjectId ?? ""
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [goalId, setGoalId] = useState(editingTask?.goal_id ?? "");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // "Break into steps" (AI)
  const [steps, setSteps] = useState<string[]>([]);
  const [selectedSteps, setSelectedSteps] = useState<boolean[]>([]);
  const [splitting, setSplitting] = useState(false);

  // Load the user's projects and goals once, to populate the dropdowns.
  // If this fails the dropdowns just stay empty; saving still works.
  useEffect(() => {
    if (user) {
      getProjects().then(setProjects).catch(() => {});
      getGoals().then(setGoals).catch(() => {});
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
      estimated_duration: duration ? Number(duration) : null,
      category: category.trim() || null,
      repeat: repeat || null,
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

  const handleSplit = async () => {
    if (!session || !editingTask) return;
    setSplitting(true);
    setError("");
    try {
      const { result } = await callAI(session, {
        mode: "steps",
        taskId: editingTask.id,
      });
      if (result.kind === "steps") {
        setSteps(result.steps);
        setSelectedSteps(result.steps.map(() => true));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSplitting(false);
    }
  };

  const addSteps = async () => {
    if (!user || !editingTask) return;
    const chosen = steps.filter((_, i) => selectedSteps[i]);
    if (chosen.length === 0) return;

    setSaving(true);
    // Steps inherit the parent's project, goal, priority and due date
    const { error } = await supabase.from("tasks").insert(
      chosen.map((step) => ({
        user_id: user.id,
        title: step,
        priority: editingTask.priority,
        status: "todo",
        due_date: editingTask.due_date,
        category: editingTask.category,
        project_id: editingTask.project_id,
        goal_id: editingTask.goal_id,
      }))
    );
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }
    toast(`Added ${chosen.length} ${chosen.length === 1 ? "step" : "steps"} as tasks`);
    onTaskSaved();
  };

  const categoryListId = "task-categories";

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
        <Field label="Repeat">
          {(id) => (
            <Select
              id={id}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as TaskRepeat | "")}
            >
              <option value="">Never</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </Select>
          )}
        </Field>
        <Field label="Time needed">
          {(id) => (
            <Select
              id={id}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="">Not sure</option>
              {durations.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <>
              <Input
                id={id}
                list={categoryListId}
                placeholder="e.g. Study"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id={categoryListId}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
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
        {editingTask && (
          <Field label="Status" className="col-span-2">
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
        )}
      </div>

      {editingTask && (
        <div className="rounded-xl border border-accent/25 bg-accent-soft/50 p-3">
          {steps.length === 0 ? (
            <button
              type="button"
              onClick={handleSplit}
              disabled={splitting}
              className="flex w-full items-center justify-center gap-2 text-sm font-medium text-accent disabled:opacity-60"
            >
              {splitting ? <Spinner /> : <SparklesIcon className="h-4 w-4" />}
              {splitting ? "Thinking..." : "Break into smaller steps with AI"}
            </button>
          ) : (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">
                Add these steps as tasks:
              </p>
              <ul className="space-y-1.5">
                {steps.map((step, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={selectedSteps[i]}
                        onChange={(e) =>
                          setSelectedSteps((prev) =>
                            prev.map((v, j) => (j === i ? e.target.checked : v))
                          )
                        }
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      />
                      {step}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSteps([])}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={addSteps}
                  disabled={saving || !selectedSteps.some(Boolean)}
                >
                  Add {selectedSteps.filter(Boolean).length} tasks
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

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
