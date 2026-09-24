"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { addSubtasks } from "@/lib/queries/subtasks";
import { callAI } from "@/lib/ai/client";
import { useToast } from "@/components/Toast";
import SubtaskEditor from "@/components/SubtaskEditor";
import { Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";
import { formatDuration, minutesBetween } from "@/utils/date";
import {
  statusLabels,
  type Task,
  type TaskPriority,
  type TaskRepeat,
  type TaskStatus,
} from "@/types/task";
import type { Project } from "@/types/project";
import type { Goal } from "@/types/goal";

type TaskFormProps = {
  onTaskSaved: () => void;
  editingTask?: Task | null;
  onCancel?: () => void;
  defaultProjectId?: string;
  defaultDueDate?: string;
  defaultDueTime?: string;
  categories?: string[];
};

const priorities: TaskPriority[] = ["low", "medium", "high"];
const durations = [15, 30, 45, 60, 90, 120, 180, 240];

export default function TaskForm({
  onTaskSaved,
  editingTask,
  onCancel,
  defaultProjectId,
  defaultDueDate,
  defaultDueTime,
  categories = [],
}: TaskFormProps) {
  const { user, session } = useAuth();
  const toast = useToast();
  // Initial values come from editingTask; the form is remounted (it lives in
  // a modal) whenever a different task is edited.
  const [title, setTitle] = useState(editingTask?.title ?? "");
  const [description, setDescription] = useState(editingTask?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(editingTask?.priority ?? "medium");
  const [status, setStatus] = useState<TaskStatus>(editingTask?.status ?? "todo");
  const [dueDate, setDueDate] = useState(editingTask?.due_date ?? defaultDueDate ?? "");
  const [startTime, setStartTime] = useState(
    editingTask?.due_time?.slice(0, 5) ?? defaultDueTime ?? ""
  );
  const [endTime, setEndTime] = useState(editingTask?.end_time?.slice(0, 5) ?? "");
  const [duration, setDuration] = useState(
    editingTask?.estimated_duration ? String(editingTask.estimated_duration) : ""
  );
  const [category, setCategory] = useState(editingTask?.category ?? "");
  const [repeat, setRepeat] = useState<TaskRepeat | "">(editingTask?.repeat ?? "");
  const [projectId, setProjectId] = useState(
    editingTask?.project_id ?? defaultProjectId ?? ""
  );
  const [goalId, setGoalId] = useState(editingTask?.goal_id ?? "");
  const [progress, setProgress] = useState(editingTask?.progress ?? 0);
  const [subtaskCount, setSubtaskCount] = useState(0);
  const [pendingSubtasks, setPendingSubtasks] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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

  // With both start and end, the duration is known exactly
  const spanMinutes = startTime && endTime ? minutesBetween(startTime, endTime) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (spanMinutes !== null && spanMinutes <= 0) {
      setError("End time must be after the start time.");
      return;
    }

    setSaving(true);
    setError("");

    const taskData = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status,
      due_date: dueDate || null,
      due_time: startTime || null,
      end_time: startTime && endTime ? endTime : null,
      estimated_duration: spanMinutes ?? (duration ? Number(duration) : null),
      category: category.trim() || null,
      repeat: repeat || null,
      project_id: projectId || null,
      goal_id: goalId || null,
      // Subtasks drive progress; otherwise it's the slider (100% when done)
      ...(subtaskCount === 0 && { progress: status === "done" ? 100 : progress }),
    };

    if (editingTask) {
      const { error } = await supabase.from("tasks").update(taskData).eq("id", editingTask.id);
      setSaving(false);
      if (error) return setError(error.message);
      return onTaskSaved();
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: user.id, ...taskData })
      .select()
      .single();
    if (error) {
      setSaving(false);
      return setError(error.message);
    }
    if (pendingSubtasks.length && !(await addSubtasks(data as Task, pendingSubtasks))) {
      toast("Task saved, but the subtasks couldn't be added.", { tone: "error" });
    }
    setSaving(false);
    onTaskSaved();
  };

  const handleSplit = async () => {
    if (!session || !editingTask) return;
    setSplitting(true);
    setError("");
    try {
      const { result } = await callAI(session, { mode: "steps", taskId: editingTask.id });
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
    if (!editingTask) return;
    const chosen = steps.filter((_, i) => selectedSteps[i]);
    if (chosen.length === 0) return;

    setSaving(true);
    const ok = await addSubtasks(editingTask, chosen);
    setSaving(false);
    if (!ok) return setError("Couldn't add the steps. Try again.");
    toast(`Added ${chosen.length} ${chosen.length === 1 ? "subtask" : "subtasks"}`);
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
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
          {priorities.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`rounded-lg py-1.5 text-sm font-medium capitalize transition ${
                priority === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <Field label="Date">
        {(id) => (
          <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        )}
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Start">
          {(id) => (
            <Input id={id} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          )}
        </Field>
        <Field label="End">
          {(id) => (
            <Input
              id={id}
              type="time"
              value={endTime}
              disabled={!startTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          )}
        </Field>
        <Field label="Duration">
          {(id) =>
            spanMinutes !== null && spanMinutes > 0 ? (
              <p id={id} className="flex h-[46px] items-center rounded-xl bg-surface-2 px-3 text-[15px] text-ink">
                {formatDuration(spanMinutes)}
              </p>
            ) : (
              <Select id={id} value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option value="">—</option>
                {durations.map((m) => (
                  <option key={m} value={m}>
                    {formatDuration(m)}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeat">
          {(id) => (
            <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as TaskRepeat | "")}>
              <option value="">Never</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
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
            <Select id={id} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
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
            <Select id={id} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
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
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {(Object.keys(statusLabels) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {editingTask ? (
        <SubtaskEditor
          parent={editingTask}
          onProgress={(percent, count) => {
            setSubtaskCount(count);
            if (count > 0) setProgress(percent);
          }}
        />
      ) : (
        <SubtaskEditor pending={pendingSubtasks} onPendingChange={setPendingSubtasks} />
      )}

      {editingTask && status !== "done" && (
        <div>
          <p className="mb-1.5 flex justify-between text-sm font-medium text-ink">
            Progress
            <span className="font-semibold text-accent">{progress}%</span>
          </p>
          {subtaskCount > 0 ? (
            <p className="text-xs text-muted">Calculated from subtasks.</p>
          ) : (
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
              aria-label="Progress"
            />
          )}
        </div>
      )}

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
              {splitting ? "Thinking..." : "Break into subtasks with AI"}
            </button>
          ) : (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Add these as subtasks:</p>
              <ul className="space-y-1.5">
                {steps.map((step, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={selectedSteps[i]}
                        onChange={(e) =>
                          setSelectedSteps((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))
                        }
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      />
                      {step}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setSteps([])}>
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={addSteps}
                  disabled={saving || !selectedSteps.some(Boolean)}
                >
                  Add {selectedSteps.filter(Boolean).length} subtasks
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
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
