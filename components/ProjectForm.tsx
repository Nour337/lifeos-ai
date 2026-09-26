"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getGoals } from "@/lib/queries/goals";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { PICKABLE_KINDS, PROJECT_KINDS, type Project, type ProjectKind } from "@/types/project";
import {
  DIFFICULTY_LABELS,
  IMPORTANCE_LABELS,
  type Difficulty,
  type Importance,
} from "@/types/persona";
import type { Goal } from "@/types/goal";

type ProjectFormProps = {
  onProjectSaved: () => void;
  editingProject?: Project | null;
  defaultKind?: ProjectKind;
  onCancel?: () => void;
};

export default function ProjectForm({
  onProjectSaved,
  editingProject,
  defaultKind = "project",
  onCancel,
}: ProjectFormProps) {
  const { user } = useAuth();
  // Initial values come from editingProject; the form remounts per project
  const [kind, setKind] = useState<ProjectKind>(editingProject?.kind ?? defaultKind);
  const [name, setName] = useState(editingProject?.name ?? "");
  const [description, setDescription] = useState(
    editingProject?.description ?? ""
  );
  const [deadline, setDeadline] = useState(editingProject?.deadline ?? "");
  const [goalId, setGoalId] = useState(editingProject?.goal_id ?? "");
  const [importance, setImportance] = useState<Importance | "">(editingProject?.importance ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty | "">(editingProject?.difficulty ?? "");
  const [weeklyHours, setWeeklyHours] = useState(
    editingProject?.weekly_hours != null ? String(editingProject.weekly_hours) : ""
  );
  const [progress, setProgress] = useState(editingProject?.progress ?? 0);
  // Off = calculated from the project's tasks
  const [manual, setManual] = useState(editingProject?.progress_manual ?? false);
  const [aiHelp, setAiHelp] = useState(editingProject?.ai_help ?? true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCourse = kind === "course";

  useEffect(() => {
    if (user) {
      getGoals().then(setGoals).catch(() => setGoals([]));
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    const hours = Number(weeklyHours);
    const projectData = {
      name: name.trim(),
      kind,
      description: description.trim() || null,
      deadline: deadline || null,
      goal_id: goalId || null,
      importance: importance || null,
      difficulty: isCourse ? difficulty || null : null,
      weekly_hours: weeklyHours && Number.isFinite(hours) ? Math.min(Math.max(hours, 0), 100) : null,
      progress: manual ? progress : 0,
      progress_manual: manual,
      ai_help: aiHelp,
    };

    const result = editingProject
      ? await supabase
          .from("projects")
          .update(projectData)
          .eq("id", editingProject.id)
      : await supabase
          .from("projects")
          .insert({ user_id: user.id, ...projectData });

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    onProjectSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>
              {(kind === "milestone" ? PROJECT_KINDS : PICKABLE_KINDS).map((k) => (
                <option key={k.value} value={k.value}>
                  {k.emoji} {k.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Importance">
          {(id) => (
            <Select
              id={id}
              value={importance}
              onChange={(e) => setImportance(e.target.value as Importance | "")}
            >
              <option value="">Not set</option>
              {Object.entries(IMPORTANCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={isCourse ? "Course name" : "Name"}>
        {(id) => (
          <Input
            id={id}
            placeholder={isCourse ? "e.g. Database Systems" : "e.g. Launch portfolio site"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus={!editingProject}
          />
        )}
      </Field>
      <Field label="Description">
        {(id) => (
          <Textarea
            id={id}
            placeholder="Optional"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={isCourse ? "Course ends" : "Deadline"}>
          {(id) => (
            <Input
              id={id}
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          )}
        </Field>
        <Field label="Hours per week">
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              placeholder="e.g. 6"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {isCourse && (
          <Field label="Difficulty">
            {(id) => (
              <Select
                id={id}
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}
              >
                <option value="">Not set</option>
                {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Goal" className={isCourse ? "" : "col-span-2"}>
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
      {isCourse && <p className="-mt-2 text-xs text-muted">Exams, quizzes and assignments are added on the course page.</p>}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={manual}
            onChange={(e) => setManual(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Set progress by hand{manual ? `: ${progress}%` : ""}
        </label>
        {manual ? (
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
            aria-label="Progress"
          />
        ) : (
          <p className="mt-1 text-xs text-muted">Calculated from its tasks.</p>
        )}
      </div>
      <label className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={aiHelp}
          onChange={(e) => setAiHelp(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Let the AI suggest tasks for this
      </label>
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
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving
            ? "Saving..."
            : editingProject
              ? "Save changes"
              : isCourse
                ? "Add course"
                : "Create project"}
        </Button>
      </div>
    </form>
  );
}
