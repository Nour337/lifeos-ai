"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { IMPORTANCE_LABELS, type Importance } from "@/types/persona";
import type { Goal } from "@/types/goal";

type GoalFormProps = {
  onGoalSaved: () => void;
  editingGoal?: Goal | null;
  onCancel?: () => void;
};

export default function GoalForm({
  onGoalSaved,
  editingGoal,
  onCancel,
}: GoalFormProps) {
  const { user } = useAuth();
  // Initial values come from editingGoal; the form remounts per goal
  const [name, setName] = useState(editingGoal?.name ?? "");
  const [why, setWhy] = useState(editingGoal?.why ?? "");
  const [description, setDescription] = useState(
    editingGoal?.description ?? ""
  );
  const [targetDate, setTargetDate] = useState(editingGoal?.target_date ?? "");
  const [priority, setPriority] = useState<Importance | "">(editingGoal?.priority ?? "");
  const [weeklyHours, setWeeklyHours] = useState(
    editingGoal?.weekly_hours != null ? String(editingGoal.weekly_hours) : ""
  );
  const [progress, setProgress] = useState(editingGoal?.progress ?? 0);
  // Off = calculated from the goal's tasks and milestones
  const [manual, setManual] = useState(editingGoal?.progress_manual ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    const hours = Number(weeklyHours);
    const goalData = {
      name: name.trim(),
      why: why.trim() || null,
      description: description.trim() || null,
      target_date: targetDate || null,
      priority: priority || null,
      weekly_hours: weeklyHours && Number.isFinite(hours) ? Math.min(Math.max(hours, 0), 100) : null,
      progress: manual ? progress : 0,
      progress_manual: manual,
    };

    const result = editingGoal
      ? await supabase.from("goals").update(goalData).eq("id", editingGoal.id)
      : await supabase.from("goals").insert({ user_id: user.id, ...goalData });

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    onGoalSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Goal">
        {(id) => (
          <Input
            id={id}
            placeholder="e.g. Learn AI automation"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus={!editingGoal}
          />
        )}
      </Field>
      <Field label="Why is this important to you?">
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            placeholder="Optional. The AI uses this to motivate you"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target date">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="Priority">
          {(id) => (
            <Select
              id={id}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Importance | "")}
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
      <Field label="Hours per week you can give it">
        {(id) => (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.5}
            placeholder="e.g. 5"
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(e.target.value)}
          />
        )}
      </Field>
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
          <p className="mt-1 text-xs text-muted">Calculated from its tasks and milestones.</p>
        )}
      </div>
      <Field label="Notes">
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            placeholder="Optional"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
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
          {saving ? "Saving..." : editingGoal ? "Save changes" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}
