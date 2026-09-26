"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { getProfile } from "@/lib/queries/persona";
import { addSubtasks } from "@/lib/queries/subtasks";
import { postAI } from "@/lib/persona/client";
import { describePattern, type Pattern } from "@/lib/assistant/patterns";
import { conflictsAt, loadOf, scheduleInput } from "@/lib/schedule";
import {
  createSeries,
  stopSeries,
  toSeries,
  updateSeries,
  ensureOccurrences,
  type SeriesChanges,
} from "@/lib/series";
import { useToast } from "@/components/Toast";
import SubtaskEditor from "@/components/SubtaskEditor";
import { Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { RepeatIcon, SparklesIcon } from "@/components/icons";
import {
  formatDuration,
  minutesBetween,
  minutesToTime,
  toLocalDateString,
  weekdayOf,
  WEEKDAYS,
  type Weekday,
} from "@/utils/date";
import {
  normalizeTask,
  PRIORITIES,
  priorityLabels,
  statusLabels,
  type Series,
  type Task,
  type TaskEnergy,
  type TaskPriority,
  type TaskStatus,
} from "@/types/task";
import type { AIProfile } from "@/types/persona";
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

const durations = [15, 30, 45, 60, 90, 120, 180, 240];

type RepeatChoice = "" | "daily" | "weekdays" | "weekly" | "days" | "every2" | "monthly";

function patternFor(choice: RepeatChoice, date: string, days: Weekday[]): Pattern | null {
  switch (choice) {
    case "daily":
      return { type: "daily" };
    case "weekdays":
      return { type: "weekdays" };
    case "weekly":
      return { type: "days_of_week", days: [weekdayOf(date)] };
    case "days":
      return days.length ? { type: "days_of_week", days } : null;
    case "every2":
      return { type: "every_n_days", n: 2 };
    case "monthly":
      return { type: "monthly", day: Number(date.slice(8, 10)) };
    default:
      return null;
  }
}

const DAY_LABELS: Record<Weekday, string> = {
  mon: "M",
  tue: "T",
  wed: "W",
  thu: "T",
  fri: "F",
  sat: "S",
  sun: "S",
};

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
  const today = toLocalDateString();
  // Initial values come from editingTask; the form is remounted (it lives in
  // a modal) whenever a different task is edited.
  const [title, setTitle] = useState(editingTask?.title ?? "");
  const [description, setDescription] = useState(editingTask?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(editingTask?.priority ?? "medium");
  const [status, setStatus] = useState<TaskStatus>(editingTask?.status ?? "todo");
  const [dueDate, setDueDate] = useState(editingTask?.due_date ?? defaultDueDate ?? "");
  const [startTime, setStartTime] = useState(editingTask?.due_time?.slice(0, 5) ?? defaultDueTime ?? "");
  const [endTime, setEndTime] = useState(editingTask?.end_time?.slice(0, 5) ?? "");
  const [duration, setDuration] = useState(
    editingTask?.estimated_duration ? String(editingTask.estimated_duration) : ""
  );
  const [category, setCategory] = useState(editingTask?.category ?? "");
  const [energy, setEnergy] = useState<TaskEnergy | "">(editingTask?.energy ?? "");
  const [isFixed, setIsFixed] = useState(editingTask?.is_fixed ?? false);
  const [projectId, setProjectId] = useState(editingTask?.project_id ?? defaultProjectId ?? "");
  const [goalId, setGoalId] = useState(editingTask?.goal_id ?? "");
  const [progress, setProgress] = useState(editingTask?.progress ?? 0);
  const [subtaskCount, setSubtaskCount] = useState(0);
  const [pendingSubtasks, setPendingSubtasks] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(
    !!(editingTask && (editingTask.description || editingTask.project_id || editingTask.goal_id || editingTask.category))
  );

  // Repeating
  const [repeat, setRepeat] = useState<RepeatChoice>("");
  const [repeatDays, setRepeatDays] = useState<Weekday[]>([]);
  const [isRoutine, setIsRoutine] = useState(true);
  const [series, setSeries] = useState<Series | null>(null);
  const [askScope, setAskScope] = useState(false);

  // Conflict warnings
  const [profile, setProfile] = useState<AIProfile | null>(null);
  const [dayTasks, setDayTasks] = useState<Task[]>([]);

  // "Break into steps" (AI)
  const [steps, setSteps] = useState<string[]>([]);
  const [selectedSteps, setSelectedSteps] = useState<boolean[]>([]);
  const [splitting, setSplitting] = useState(false);

  // Load the user's projects, goals and profile once, to populate the
  // dropdowns and check conflicts. If this fails the form still works.
  useEffect(() => {
    if (!user) return;
    getProjects()
      .then((p) => setProjects(p.filter((x) => x.kind !== "milestone" || x.id === editingTask?.project_id)))
      .catch(() => {});
    getGoals().then(setGoals).catch(() => {});
    getProfile(user.id)
      .then((p) => setProfile(p.ai_profile))
      .catch(() => {});
    if (editingTask?.series_id) {
      supabase
        .from("task_series")
        .select("*")
        .eq("id", editingTask.series_id)
        .maybeSingle()
        .then(({ data }) => data && setSeries(toSeries(data)));
    }
  }, [user, editingTask?.series_id, editingTask?.project_id]);

  // The chosen day's tasks, for the conflict check (the check only looks at
  // tasks on the chosen date, so an older list never gives wrong warnings)
  useEffect(() => {
    if (!user || !dueDate) return;
    let cancelled = false;
    supabase
      .from("tasks")
      .select("*")
      .eq("due_date", dueDate)
      .is("parent_id", null)
      .then(({ data }) => !cancelled && setDayTasks((data ?? []).map((t) => normalizeTask(t as Task))));
    return () => {
      cancelled = true;
    };
  }, [user, dueDate]);

  // With both start and end, the duration is known exactly
  const spanMinutes = startTime && endTime ? minutesBetween(startTime, endTime) : null;
  const length = spanMinutes && spanMinutes > 0 ? spanMinutes : duration ? Number(duration) : 30;

  const warnings = useMemo(() => {
    if (!dueDate || isFixed) return [];
    const input = scheduleInput(profile, dayTasks.filter((t) => t.id !== editingTask?.id));
    const out: string[] = [];
    if (startTime) {
      for (const c of conflictsAt(input, dueDate, startTime, length)) {
        out.push(`Overlaps ${c.label} ${minutesToTime(c.start)}–${c.end >= 1440 ? "24:00" : minutesToTime(c.end)}`);
      }
    }
    const draft = normalizeTask({
      id: "draft",
      title,
      due_date: dueDate,
      due_time: startTime || null,
      estimated_duration: length,
    });
    const load = loadOf({ ...input, tasks: [...input.tasks, draft] }, dueDate);
    if (load.over && load.capacity > 0) {
      out.push(`This day would have ${formatDuration(load.planned)} of work for about ${formatDuration(load.capacity)} of realistic time.`);
    }
    return out;
  }, [dueDate, startTime, length, dayTasks, profile, editingTask?.id, isFixed, title]);

  const fields = () => ({
    title: title.trim(),
    description: description.trim() || null,
    priority,
    status,
    due_date: dueDate || null,
    due_time: startTime || null,
    end_time: startTime && endTime ? endTime : null,
    estimated_duration: spanMinutes && spanMinutes > 0 ? spanMinutes : duration ? Number(duration) : null,
    category: category.trim() || null,
    energy: energy || null,
    is_fixed: isFixed,
    project_id: projectId || null,
    goal_id: goalId || null,
    // Subtasks drive progress; otherwise it's the slider (100% when done)
    ...(subtaskCount === 0 && { progress: status === "done" ? 100 : progress }),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (spanMinutes !== null && spanMinutes <= 0) {
      setError("End time must be after the start time.");
      return;
    }
    const pattern = patternFor(repeat, dueDate || today, repeatDays);
    if (repeat && !pattern) {
      setError("Pick at least one day for the repeat.");
      return;
    }
    if (repeat && !dueDate) {
      setError("Pick the first date for the repeat.");
      return;
    }
    // A routine session: ask whether the change is for this one or more
    if (editingTask?.series_id && series && !askScope) {
      const f = fields();
      const seriesFieldsChanged =
        f.title !== editingTask.title ||
        f.due_time !== (editingTask.due_time?.slice(0, 5) ?? null) ||
        f.estimated_duration !== editingTask.estimated_duration ||
        f.priority !== editingTask.priority;
      if (seriesFieldsChanged) {
        setAskScope(true);
        return;
      }
    }
    await save("this");
  };

  const save = async (scope: "this" | "future" | "all") => {
    if (!user) return;
    setSaving(true);
    setError("");
    const taskData = fields();
    const pattern = patternFor(repeat, dueDate || today, repeatDays);

    // Whole routine
    if (editingTask && series && scope !== "this") {
      const changes: SeriesChanges = {
        title: taskData.title,
        due_time: taskData.due_time,
        end_time: taskData.end_time,
        estimated_duration: taskData.estimated_duration,
        priority: taskData.priority,
        category: taskData.category,
        energy: taskData.energy,
        project_id: taskData.project_id,
        goal_id: taskData.goal_id,
      };
      const ok = await updateSeries(
        supabase,
        series,
        changes,
        scope,
        editingTask.occurrence_date ?? editingTask.due_date ?? today,
        today
      );
      setSaving(false);
      if (!ok) return setError("Couldn't update the routine. Try again.");
      toast(scope === "all" ? "Routine updated" : "Updated from this session on");
      return onTaskSaved();
    }

    // A one-off task becomes a routine
    if (pattern && !series) {
      const created = await createSeries(
        supabase,
        user.id,
        {
          ...taskData,
          pattern,
          start_date: dueDate || today,
          is_routine: isRoutine,
        },
        today
      );
      if (!created) {
        setSaving(false);
        return setError("Couldn't create the routine. Try again.");
      }
      // The edited task was the first session: keep it and link it
      if (editingTask) {
        await supabase.from("tasks").delete().eq("series_id", created.id).eq("occurrence_date", editingTask.due_date ?? today);
        await supabase
          .from("tasks")
          .update({ ...taskData, series_id: created.id, occurrence_date: editingTask.due_date ?? today })
          .eq("id", editingTask.id);
        await ensureOccurrences(supabase, today, [created]);
      }
      setSaving(false);
      toast(`Repeats ${describePattern(pattern).toLowerCase()}`);
      return onTaskSaved();
    }

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

  const stopRoutine = async () => {
    if (!series) return;
    setSaving(true);
    const ok = await stopSeries(supabase, series, today);
    setSaving(false);
    if (!ok) return setError("Couldn't stop the routine. Try again.");
    toast(`"${series.title}" stopped. Past sessions stay in your history.`);
    onTaskSaved();
  };

  const handleSplit = async () => {
    if (!session || !editingTask) return;
    setSplitting(true);
    setError("");
    try {
      const { steps: result } = await postAI<{ steps: string[] }>(session, "/api/coach", {
        mode: "steps",
        taskId: editingTask.id,
      });
      setSteps(result);
      setSelectedSteps(result.map(() => true));
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

  if (askScope && series) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{series.title}</span> is a routine ({describePattern(series.pattern).toLowerCase()}).
          Change only this session, or the routine?
        </p>
        {(
          [
            ["this", "Only this session"],
            ["future", "This and future sessions"],
            ["all", "All upcoming sessions"],
          ] as const
        ).map(([scope, label]) => (
          <Button
            key={scope}
            type="button"
            variant={scope === "this" ? "secondary" : "primary"}
            className="w-full"
            disabled={saving}
            onClick={() => save(scope)}
          >
            {label}
          </Button>
        ))}
        <Button type="button" variant="ghost" className="w-full" onClick={() => setAskScope(false)}>
          Back
        </Button>
      </div>
    );
  }

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

      <Field label="Date">
        {(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Start">
          {(id) => <Input id={id} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
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

      {warnings.length > 0 && (
        <div className="space-y-1 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn" role="status">
          {warnings.map((w) => (
            <p key={w}>⚠️ {w}</p>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Priority</p>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`rounded-lg py-1.5 text-sm font-medium transition ${
                priority === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {priorityLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {series ? (
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink">
          <RepeatIcon className="h-4 w-4 text-accent" />
          <span className="min-w-0 flex-1">
            {series.is_routine ? "Routine" : "Repeats"}: {describePattern(series.pattern).toLowerCase()}
            {series.until ? ` until ${series.until}` : ""}
          </span>
          <button type="button" onClick={stopRoutine} className="font-medium text-danger hover:underline">
            Stop
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <Field label="Repeat">
            {(id) => (
              <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatChoice)}>
                <option value="">Never</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="weekly">Every week on this day</option>
                <option value="days">On certain days…</option>
                <option value="every2">Every other day</option>
                <option value="monthly">Every month on this date</option>
              </Select>
            )}
          </Field>
          {repeat === "days" && (
            <div className="flex gap-1.5" role="group" aria-label="Repeat on">
              {WEEKDAYS.map((d) => {
                const on = repeatDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={d}
                    onClick={() => setRepeatDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                    className={`h-9 flex-1 rounded-lg text-sm font-semibold transition ${
                      on ? "bg-accent text-white" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {DAY_LABELS[d]}
                  </button>
                );
              })}
            </div>
          )}
          {repeat && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={isRoutine}
                onChange={(e) => setIsRoutine(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              It&apos;s a habit (gym, reading, prayer…): track streaks
            </label>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="text-sm font-medium text-accent hover:underline"
        aria-expanded={showMore}
      >
        {showMore ? "Fewer options" : "More options: notes, project, goal, focus…"}
      </button>

      {showMore && (
        <div className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Project or course">
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
            <Field label="Kind of work">
              {(id) => (
                <Select id={id} value={energy} onChange={(e) => setEnergy(e.target.value as TaskEnergy | "")}>
                  <option value="">Not set</option>
                  <option value="deep">🧠 Deep focus</option>
                  <option value="light">🪶 Light task</option>
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

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isFixed}
              onChange={(e) => setIsFixed(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Fixed appointment (exam, meeting): the planner never moves it
          </label>

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
                  {splitting ? "Thinking..." : "Break into subtasks with AI · 1 point"}
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
                    <Button type="button" size="sm" onClick={addSteps} disabled={saving || !selectedSteps.some(Boolean)}>
                      Add {selectedSteps.filter(Boolean).length} subtasks
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving ? "Saving..." : editingTask ? "Save changes" : repeat ? "Add routine" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
