"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button, Field, Input, Textarea } from "@/components/ui";
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
  const [description, setDescription] = useState(
    editingGoal?.description ?? ""
  );
  const [targetDate, setTargetDate] = useState(editingGoal?.target_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    const goalData = {
      name: name.trim(),
      description: description.trim() || null,
      target_date: targetDate || null,
    };

    const result = editingGoal
      ? await supabase.from("goals").update(goalData).eq("id", editingGoal.id)
      : await supabase
          .from("goals")
          .insert({ user_id: user.id, progress: 0, ...goalData });

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
            placeholder="e.g. Run a 10K"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus={!editingGoal}
          />
        )}
      </Field>
      <Field label="Why it matters">
        {(id) => (
          <Textarea
            id={id}
            placeholder="Optional"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
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
